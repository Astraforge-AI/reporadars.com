import Database from "better-sqlite3";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { createGitHubClient, readGitHubCredential } from "./github-client.mjs";
import { discoveryQueries, repositoryLinks } from "./discovery.mjs";

export function intakeOrigin(value = "http://127.0.0.1:4320") {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !(
      url.origin === "http://127.0.0.1:4320" ||
      (url.protocol === "https:" &&
        url.hostname === "localhost" &&
        Number(url.port) >= 1024)
    )
  )
    throw new Error(
      "Intake API must be the production loopback or isolated localhost HTTPS staging",
    );
  return url.origin;
}

export async function runIntake({
  statePath,
  tokenFile,
  binary,
  githubTokenFile,
  serviceOrigin,
  recoveryOnly = false,
  limit = 5,
}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20)
    throw new Error("Repository budget must be 1..20");
  const origin = intakeOrigin(serviceOrigin);
  const token = (await readFile(tokenFile, "utf8")).trim();
  const githubToken = await readGitHubCredential(githubTokenFile);
  if (token.length < 40) throw new Error("Invalid intake credential");
  const service = async (method, report, jobId) => {
    const job = jobId ? createHash("sha256").update(jobId).digest("hex") : null;
    // Dedicated loopback API: credential and reports never cross an external HTTP connection.
    // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request
    const offset =
      method === "GET"
        ? db.prepare("SELECT value FROM cursor WHERE key='sources'").get()
            ?.value || 0
        : 0;
    const response = await fetch(
      `${origin}/api/intake/reports${method === "GET" ? `?offset=${offset}` : ""}`,
      {
        method,
        signal: AbortSignal.timeout(20000),
        redirect: "error",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Reporadars-Client-IP": "127.0.0.1",
          ...(job ? { "X-Reporadars-Job-ID": job } : {}),
        },
        body: report ? JSON.stringify(report) : undefined,
      },
    );
    const requestId = response.headers.get("x-request-id");
    if (job && /^[a-f0-9-]{36}$/.test(requestId || ""))
      console.log(
        JSON.stringify({
          event: "intake_job_request",
          job,
          requestId,
          status: response.status,
        }),
      );
    if (!response.ok) throw new Error(`Intake API HTTP ${response.status}`);
    return response.json();
  };
  const db = new Database(statePath);
  db.pragma("journal_mode=WAL");
  db.pragma("busy_timeout=5000");
  db.exec(
    "CREATE TABLE IF NOT EXISTS job(id TEXT PRIMARY KEY, repository TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0, error TEXT, updated_at INTEGER NOT NULL)",
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS discovery_repository(repository TEXT PRIMARY KEY,found_in TEXT NOT NULL,checked_at INTEGER NOT NULL DEFAULT 0)",
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS cursor(key TEXT PRIMARY KEY,value INTEGER NOT NULL)",
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS job_payload(id TEXT PRIMARY KEY,args TEXT NOT NULL); CREATE TABLE IF NOT EXISTS run_outbox(id TEXT PRIMARY KEY,metadata TEXT NOT NULL,mirrored INTEGER NOT NULL DEFAULT 0)",
  );
  const github = createGitHubClient({
    token: githubToken,
    readCooldown: () =>
      db.prepare("SELECT value FROM cursor WHERE key='github-cooldown'").get()
        ?.value || 0,
    saveCooldown: (value) =>
      db
        .prepare(
          "INSERT INTO cursor VALUES('github-cooldown',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(value),
  });
  const work = await mkdtemp(join(tmpdir(), "radar-intake-"));
  let completed = 0,
    failed = 0,
    skipped = 0,
    blocked = 0;
  let repositories = 0,
    requestedRun = null,
    paused = false,
    started = false;
  const runId = randomUUID(),
    startedAt = Date.now();
  try {
    let known = await service("GET");
    const outbox = db
      .prepare("SELECT id,metadata FROM run_outbox WHERE mirrored=0 LIMIT 10")
      .all();
    for (const previous of outbox) {
      await service("POST", JSON.parse(previous.metadata));
      db.prepare("UPDATE run_outbox SET mirrored=1 WHERE id=?").run(
        previous.id,
      );
    }
    if (outbox.length) known = await service("GET");
    const manualRequestId = !recoveryOnly
      ? known.control?.manualRequest?.id
      : null;
    const discoveryDue =
      !recoveryOnly &&
      (Boolean(manualRequestId) ||
        !known.control?.lastRunAt ||
        Date.now() >=
          known.control.lastRunAt +
            (known.control.intervalHours || 24) * 3600000);
    const pending = db
      .prepare(
        "SELECT 1 FROM job JOIN job_payload USING(id) WHERE state IN ('queued','failed','running') AND next_attempt<=? AND lease_until<=? LIMIT 1",
      )
      .get(Date.now(), Date.now());
    const cooldown =
      db.prepare("SELECT value FROM cursor WHERE key='github-cooldown'").get()
        ?.value || 0;
    if (
      known.control?.paused ||
      cooldown > Date.now() ||
      (!recoveryOnly && !discoveryDue && !pending)
    )
      return { repositories: 0, completed, failed, skipped, blocked };
    started = true;
    if (manualRequestId) requestedRun = manualRequestId;
    if (discoveryDue) {
      const searchCursor =
        db.prepare("SELECT value FROM cursor WHERE key='search-query'").get()
          ?.value || 0;
      const query = discoveryQueries[searchCursor % discoveryQueries.length],
        page = (Math.floor(searchCursor / discoveryQueries.length) % 10) + 1;
      const discovered = await github(
        `/search/repositories?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=10&page=${page}`,
      );
      db.prepare(
        "INSERT INTO cursor VALUES('search-query',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).run(searchCursor + 1);
      const remember = (repository, source) => {
        if (
          /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(
            repository,
          ) &&
          db.prepare("SELECT count(*) n FROM discovery_repository").get().n <
            10000
        )
          db.prepare(
            "INSERT OR IGNORE INTO discovery_repository VALUES(?,?,0)",
          ).run(repository, source);
      };
      for (const item of discovered.items || []) remember(item.html_url, query);
      // One bounded README seed per run, depth one; links are not fetched recursively.
      const seed = "https://github.com/VoltAgent/awesome-agent-skills";
      const readme = await github(
        "/repos/VoltAgent/awesome-agent-skills/readme",
        true,
      );
      if (
        readme?.encoding === "base64" &&
        readme.size <= 512 * 1024 &&
        typeof readme.content === "string"
      )
        for (const repo of repositoryLinks(
          Buffer.from(readme.content, "base64").toString("utf8"),
        ))
          remember(repo, seed);
      db.exec(
        "CREATE TABLE IF NOT EXISTS cursor(key TEXT PRIMARY KEY,value INTEGER NOT NULL)",
      );
      const offset =
        db.prepare("SELECT value FROM cursor WHERE key='sources'").get()
          ?.value || 0;
      const sources = known.sources || [],
        ordered = sources;
      const discoveredOffset =
        db.prepare("SELECT value FROM cursor WHERE key='discovered'").get()
          ?.value || 0;
      const discoveredRepos = db
        .prepare(
          "SELECT repository FROM discovery_repository ORDER BY checked_at ASC,repository ASC LIMIT 200",
        )
        .all()
        .map((item) => item.repository)
        .filter((url) => !sources.includes(url));
      const fresh = [
        ...discoveredRepos.slice(
          discoveredOffset % discoveredRepos.length || 0,
        ),
        ...discoveredRepos.slice(
          0,
          discoveredOffset % discoveredRepos.length || 0,
        ),
      ];
      const knownBudget = Math.max(0, limit - 2);
      const repos = [
        ...new Set([
          ...ordered.slice(0, knownBudget),
          ...fresh,
          ...ordered.slice(knownBudget),
        ]),
      ]
        .filter((url) =>
          /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(url),
        )
        .slice(0, limit);
      db.prepare(
        "INSERT INTO cursor VALUES('sources',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).run(offset + Math.max(1, knownBudget));
      db.prepare(
        "INSERT INTO cursor VALUES('discovered',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).run(discoveredOffset + Math.max(1, limit - knownBudget));
      repositories = repos.length;
      const enqueue = db.transaction((job) => {
        const args =
          githubTokenFile && job.kind !== "actions"
            ? [...job.args, "--github-token-file", githubTokenFile]
            : job.args;
        db.prepare(
          "INSERT OR IGNORE INTO job(id,repository,kind,state,updated_at) VALUES(?,?,?,'queued',?)",
        ).run(job.id, job.repository, job.kind, Date.now());
        db.prepare(
          "INSERT INTO job_payload VALUES(?,?) ON CONFLICT(id) DO UPDATE SET args=excluded.args",
        ).run(job.id, JSON.stringify(args));
      });
      let packageJobs = 0;
      for (const repository of repos) {
        db.prepare(
          "UPDATE discovery_repository SET checked_at=? WHERE repository=?",
        ).run(Date.now(), repository);
        const slug = repository.slice("https://github.com/".length);
        const commit = await github(`/repos/${slug}/commits/HEAD`, true);
        if (!commit) {
          skipped++;
          continue;
        }
        if (!/^[a-f0-9]{40}$/.test(commit.sha))
          throw new Error("Invalid GitHub commit");
        enqueue({
          id: `${repository}:source:${commit.sha}`,
          repository,
          kind: "source",
          args: ["scan", "--repo", repository, "--ref", commit.sha],
        });
        const release = await github(`/repos/${slug}/releases/latest`, true);
        if (
          release &&
          !release.draft &&
          !release.prerelease &&
          /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(release.tag_name)
        ) {
          for (const asset of (release.assets || [])
            .filter(
              (a) =>
                a.state === "uploaded" &&
                /\.(zip|skill|tar\.gz|tgz)$/i.test(a.name) &&
                a.size > 0 &&
                a.size <= 32 * 1024 * 1024 &&
                Number.isSafeInteger(a.id),
            )
            .slice(0, Math.max(0, 3 - packageJobs))) {
            packageJobs++;
            enqueue({
              id: `${repository}:release:${asset.id}:${asset.digest || asset.updated_at}`,
              repository,
              kind: "release",
              args: [
                "scan-release",
                "--repo",
                repository,
                "--tag",
                release.tag_name,
                "--asset-id",
                String(asset.id),
              ],
            });
          }
        }
        const workflowId = known.sourcePolicies?.find(
          (s) => s.repository === repository,
        )?.workflowId;
        if (
          githubTokenFile &&
          Number.isSafeInteger(workflowId) &&
          workflowId > 0 &&
          packageJobs < 3
        ) {
          const artifacts = await github(
            `/repos/${slug}/actions/artifacts?per_page=10`,
            true,
          );
          for (const asset of (artifacts?.artifacts || [])
            .filter(
              (a) =>
                !a.expired &&
                Date.parse(a.expires_at) > Date.now() &&
                Number.isSafeInteger(a.id) &&
                a.id > 0 &&
                /skill/i.test(a.name || "") &&
                a.size_in_bytes > 0 &&
                a.size_in_bytes <= 32 * 1024 * 1024,
            )
            .slice(0, 3 - packageJobs)) {
            packageJobs++;
            enqueue({
              id: `${repository}:actions:${asset.id}:${asset.digest || asset.updated_at}`,
              repository,
              kind: "actions",
              args: [
                "scan-actions",
                "--repo",
                repository,
                "--artifact-id",
                String(asset.id),
                "--workflow-id",
                String(workflowId),
                "--github-token-file",
                githubTokenFile,
              ],
            });
          }
        }
      }
    }
    const jobs = db
      .prepare(
        "SELECT job.*,job_payload.args FROM job JOIN job_payload USING(id) WHERE (state IN ('queued','failed') OR (state='running' AND lease_until<?)) AND next_attempt<=? ORDER BY updated_at ASC,id ASC LIMIT ?",
      )
      .all(Date.now(), Date.now(), recoveryOnly ? limit : limit + 3);
    for (const job of jobs) {
      if ((await service("GET")).control?.paused) {
        paused = true;
        break;
      }
      const args = JSON.parse(job.args);
      const now = Date.now();
      const claimed = db
        .prepare(
          "UPDATE job SET state='running',attempts=attempts+1,lease_until=?,updated_at=? WHERE id=? AND (state IN ('queued','failed') OR (state='running' AND lease_until<?)) AND next_attempt<=?",
        )
        .run(now + 180000, now, job.id, now, now).changes;
      if (!claimed) continue;
      const output = join(
        work,
        `report-${completed + failed + skipped + blocked}.json`,
      );
      try {
        await new Promise((accept, reject) => {
          const child = spawn(resolve(binary), [...args, "--out", output], {
            stdio: ["ignore", "ignore", "pipe"],
            env: { PATH: process.env.PATH, GOMAXPROCS: "2" },
            timeout: 120000,
            killSignal: "SIGKILL",
          });
          let message = "";
          child.stderr.on("data", (chunk) => {
            if (message.length < 300)
              message += chunk.toString().slice(0, 300 - message.length);
          });
          child.once("error", reject);
          child.once("exit", (code) =>
            code === 0
              ? accept()
              : reject(new Error(message.trim() || "Scanner failed")),
          );
        });
        const raw = await readFile(output, "utf8");
        if (raw.length > 12 * 1024 * 1024) throw new Error("Report too large");
        await service("POST", JSON.parse(raw), job.id);
        db.prepare(
          "UPDATE job SET state='complete',lease_until=0,error=NULL,updated_at=? WHERE id=?",
        ).run(Date.now(), job.id);
        completed++;
      } catch (error) {
        if (
          /\b429\b|\b403\b.*rate limit|GitHub API rate limited/.test(
            error.message,
          )
        ) {
          const until = Date.now() + 15 * 60000;
          db.prepare(
            "INSERT INTO cursor VALUES('github-cooldown',?) ON CONFLICT(key) DO UPDATE SET value=max(value,excluded.value)",
          ).run(until);
          db.prepare(
            "UPDATE job SET state='queued',lease_until=0,next_attempt=?,error='GitHub rate limited',updated_at=? WHERE id=?",
          ).run(until, Date.now(), job.id);
          break;
        }
        if (/Intake API HTTP 409/.test(error.message)) {
          db.prepare(
            "UPDATE job SET state='queued',lease_until=0,next_attempt=0,error=NULL,updated_at=? WHERE id=?",
          ).run(Date.now(), job.id);
          paused = true;
          break;
        }
        if (
          /Intake API HTTP (?:400|413)|(?:ZIP|TAR) archive (?:expands|contains|has)|archive contains an unsafe|artifact packages (?:expand|contain|exceed)|skill limit exceeded|unapproved or untrusted workflow|invalid or foreign artifact|invalid or excessive ZIP|invalid TAR|corrupt (?:gzip|TAR)|ZIP file is corrupt|(?:asset|artifact) (?:size|digest) mismatch|empty, excessive|archive too large|excessive TAR/.test(
            error.message,
          )
        ) {
          db.prepare(
            "UPDATE job SET state='blocked',lease_until=0,error=?,updated_at=? WHERE id=?",
          ).run(error.message.slice(0, 120), Date.now(), job.id);
          blocked++;
          continue;
        }
        if (
          /no SKILL.md files found|artifact expired or unavailable/.test(
            error.message,
          )
        ) {
          db.prepare(
            "UPDATE job SET state='skipped',lease_until=0,error=?,updated_at=? WHERE id=?",
          ).run(
            error.message.includes("artifact expired")
              ? "Artifact expired or unavailable"
              : "No SKILL.md files",
            Date.now(),
            job.id,
          );
          skipped++;
          continue;
        }
        db.prepare(
          "UPDATE job SET state='failed',lease_until=0,next_attempt=?,error=?,updated_at=? WHERE id=?",
        ).run(
          Date.now() + 6 * 60 * 60 * 1000,
          String(error.message).slice(0, 120),
          Date.now(),
          job.id,
        );
        failed++;
      }
    }
    return { repositories, completed, failed, skipped, blocked };
  } catch (error) {
    if (
      (db.prepare("SELECT value FROM cursor WHERE key='github-cooldown'").get()
        ?.value || 0) > Date.now()
    )
      return { repositories, completed, failed, skipped, blocked };
    failed++;
    throw error;
  } finally {
    if (started) {
      const summary = { repositories, completed, failed, skipped, blocked };
      const report = {
        type: "run",
        ...(requestedRun ? { manualRequestId: requestedRun } : {}),
        githubCooldownUntil:
          db
            .prepare("SELECT value FROM cursor WHERE key='github-cooldown'")
            .get()?.value || 0,
        schemaVersion: 1,
        id: runId,
        startedAt,
        finishedAt: Date.now(),
        status: paused ? "paused" : failed ? "failed" : "complete",
        summary,
        jobs: db
          .prepare(
            "SELECT repository,kind,state,attempts FROM job ORDER BY updated_at DESC LIMIT 100",
          )
          .all(),
      };
      db.prepare("INSERT INTO run_outbox VALUES(?,?,0)").run(
        runId,
        JSON.stringify(report),
      );
      try {
        await service("POST", report);
        db.prepare("UPDATE run_outbox SET mirrored=1 WHERE id=?").run(runId);
      } catch {
        /* Retained privately for the next successful run. */
      }
    }
    db.close();
    await rm(work, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.umask(0o077);
  runIntake({
    statePath: process.env.INTAKE_STATE_PATH,
    tokenFile: process.env.INTAKE_TOKEN_FILE,
    binary: process.env.INTAKE_BINARY,
    githubTokenFile: process.env.INTAKE_GITHUB_TOKEN_FILE,
    serviceOrigin: process.env.INTAKE_SERVICE_ORIGIN,
    recoveryOnly: process.argv.slice(2).includes("--recover-queue-only"),
    limit: Number(process.env.INTAKE_REPOSITORY_LIMIT || 5),
  })
    .then((result) => {
      console.log(JSON.stringify(result));
      if (result.failed) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(`Intake failed: ${String(error.message).slice(0, 120)}`);
      process.exitCode = 1;
    });
}
