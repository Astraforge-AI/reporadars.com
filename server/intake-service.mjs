import Database from "better-sqlite3";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { normalizeRepository, normalizeSourceURL } from "./github-source.mjs";

export const POLICY_VERSION = "metadata-v1";
const repoPattern = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const sha = /^[a-f0-9]{64}$/;
const licenses = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "CC0-1.0",
]);
const json = (status, data) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
const fail = (status, code) => json(status, { error: { code } });
const text = (value, max) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= max &&
  !/[\u0000-\u0008]/.test(value);
const fingerprint = (value) => createHash("sha256").update(value).digest("hex");
const onlyKeys = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => keys.includes(key));
const relativePath = (value) =>
  text(value, 512) &&
  !/[\\\u0000-\u001f]/.test(value) &&
  !value.startsWith("/") &&
  value.split("/").every((part) => part && part !== "." && part !== "..");

export function decisionFor(candidate, source, artifact) {
  if (
    candidate.status === "blocked" ||
    candidate.findings.some((finding) => finding.severity === "high")
  )
    return "blocked";
  if (
    !source?.allow_auto ||
    !source?.rights_confirmed ||
    !licenses.has(candidate.license) ||
    candidate.qualityScore < 60 ||
    candidate.findings.some((finding) => finding.severity === "medium") ||
    (artifact?.kind === "actions" &&
      source?.workflow_id !== artifact.workflowId) ||
    (artifact && !artifact.digestVerified)
  )
    return "needs_review";
  return "published";
}

export function createIntakeService({ databasePath, editorialPath, token }) {
  if (!text(token, 512) || token.length < 40)
    throw new Error("Private intake token is required");
  const db = new Database(databasePath);
  const editorial = new Database(editorialPath, { fileMustExist: true });
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  editorial.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS source (repository TEXT PRIMARY KEY, allow_auto INTEGER NOT NULL DEFAULT 0, rights_confirmed INTEGER NOT NULL DEFAULT 0, updated_by TEXT, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS source_workflow (repository TEXT PRIMARY KEY, workflow_id INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS intake_control (id INTEGER PRIMARY KEY CHECK(id=1),paused INTEGER NOT NULL,interval_hours INTEGER NOT NULL,updated_by TEXT,updated_at INTEGER NOT NULL);
    INSERT OR IGNORE INTO intake_control VALUES(1,0,24,NULL,0);
    CREATE TABLE IF NOT EXISTS intake_run (id TEXT PRIMARY KEY,started_at INTEGER NOT NULL,finished_at INTEGER NOT NULL,status TEXT NOT NULL,metadata TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS intake_run_request (id TEXT PRIMARY KEY,requested_at INTEGER NOT NULL,requested_by TEXT NOT NULL,status TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS candidate (id TEXT PRIMARY KEY, repository TEXT NOT NULL, skill_id TEXT NOT NULL, commit_sha TEXT NOT NULL, bundle_sha TEXT NOT NULL, origin_key TEXT NOT NULL, status TEXT NOT NULL, metadata TEXT NOT NULL, revision INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(repository,skill_id,commit_sha,bundle_sha,origin_key));
    CREATE INDEX IF NOT EXISTS candidate_recent ON candidate(updated_at DESC);
    CREATE TABLE IF NOT EXISTS event (id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, candidate_id TEXT NOT NULL, created_at INTEGER NOT NULL);
  `);
  editorial.exec(
    `CREATE TABLE IF NOT EXISTS reporadars_intake_receipt (id TEXT PRIMARY KEY, slug TEXT NOT NULL, revision INTEGER NOT NULL, metadata TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  );

  function publish(row, actor, reviewKind) {
    const meta = JSON.parse(row.metadata),
      c = meta.candidate,
      now = Date.now();
    const receipt = `${row.id}:${POLICY_VERSION}`;
    return editorial.transaction(() => {
      if (
        editorial
          .prepare("SELECT id FROM reporadars_intake_receipt WHERE id = ?")
          .get(receipt)
      )
        return true;
      const existing = editorial
        .prepare("SELECT * FROM reporadars_admin_record WHERE slug = ?")
        .get(c.id);
      if (existing) {
        const previous = editorial
          .prepare(
            "SELECT revision,metadata FROM reporadars_intake_receipt WHERE slug = ? ORDER BY created_at DESC LIMIT 1",
          )
          .get(c.id);
        // Preserve editorial edits and archives; an update then requires review.
        if (
          !previous ||
          existing.revision !== previous.revision ||
          existing.status !== "published" ||
          (reviewKind === "automated" &&
            JSON.parse(previous.metadata).commit !== row.commit_sha)
        )
          return false;
      }
      const duplicate = editorial
        .prepare(
          "SELECT r.slug FROM reporadars_intake_receipt e JOIN reporadars_admin_record r ON r.slug=e.slug AND r.revision=e.revision WHERE r.status='published' AND e.slug<>? AND json_extract(e.metadata,'$.bundleSha256')=? LIMIT 1",
        )
        .get(c.id, row.bundle_sha);
      if (duplicate) return false;
      const revision = (existing?.revision || 0) + 1;
      const enBody = `${c.description}\n\nSource: ${c.sourceUrl}\nLicense declared upstream: ${c.license || "unspecified"}.\nThis catalog publishes metadata only. Inspect the original package before use.`;
      const ruBody = `Оригинальное описание: ${c.description}\n\nИсточник: ${c.sourceUrl}\nЛицензия, указанная автором: ${c.license || "не указана"}.\nВ каталоге опубликованы только метаданные. Изучите исходный пакет перед использованием.`;
      const values = [
        c.name,
        c.name,
        c.description.slice(0, 600),
        `Оригинальное описание: ${c.description}`.slice(0, 600),
        enBody,
        ruBody,
        c.sourceUrl,
        now,
      ];
      if (existing)
        editorial
          .prepare(
            "UPDATE reporadars_admin_record SET title_en=?,title_ru=?,summary_en=?,summary_ru=?,body_en=?,body_ru=?,source_url=?,updated_at=?,revision=revision+1 WHERE id=?",
          )
          .run(...values, existing.id);
      else
        editorial
          .prepare(
            "INSERT INTO reporadars_admin_record (id,kind,slug,title_en,title_ru,summary_en,summary_ru,body_en,body_ru,source_url,category,skill_ids,status,revision,created_at,updated_at) VALUES (?,'skill',?,?,?,?,?,?,?,?,'research','[]','published',1,?,?)",
          )
          .run(`intake-${c.id}`, c.id, ...values.slice(0, 7), now, now);
      const provenance = {
        repository: row.repository,
        commit: row.commit_sha,
        bundleSha256: row.bundle_sha,
        archiveSha256: meta.archiveSha256,
        path: c.path,
        package: meta.package || null,
        reviewKind,
        actor,
        policyVersion: POLICY_VERSION,
      };
      editorial
        .prepare("INSERT INTO reporadars_intake_receipt VALUES (?,?,?,?,?)")
        .run(receipt, c.id, revision, JSON.stringify(provenance), now);
      return true;
    })();
  }
  function mark(id, status, actor, action) {
    db.transaction(() => {
      db.prepare(
        "UPDATE candidate SET status=?,revision=revision+1,updated_at=? WHERE id=?",
      ).run(status, Date.now(), id);
      db.prepare(
        "INSERT INTO event(actor,action,candidate_id,created_at) VALUES(?,?,?,?)",
      ).run(actor, action, id, Date.now());
    })();
  }
  function acceptReport(report) {
    if (report?.repository?.url) {
      report = structuredClone(report);
      report.repository.url = normalizeRepository(report.repository.url);
      if (report.package?.sourceUrl)
        report.package.sourceUrl = normalizeSourceURL(report.package.sourceUrl);
      if (Array.isArray(report.skills))
        for (const c of report.skills) {
          if (c?.sourceUrl) c.sourceUrl = normalizeSourceURL(c.sourceUrl);
        }
    }
    if (
      !onlyKeys(report, [
        "schemaVersion",
        "repository",
        "commit",
        "archiveSha256",
        "generatedAt",
        "skills",
        "package",
      ]) ||
      !onlyKeys(report.repository, ["url", "owner", "name"]) ||
      report.schemaVersion !== 1 ||
      !repoPattern.test(report.repository?.url || "") ||
      !/^[a-f0-9]{40}$/.test(report.commit || "") ||
      !sha.test(report.archiveSha256 || "") ||
      !Array.isArray(report.skills) ||
      report.skills.length > 200
    )
      throw new Error("Invalid report");
    const logicalRepository = report.repository.url;
    const existingSources = db
      .prepare(
        "SELECT repository FROM source WHERE repository=? COLLATE NOCASE",
      )
      .all(logicalRepository);
    if (existingSources.length > 1)
      throw new Error("Ambiguous source aliases require an editor");
    const repository = existingSources[0]?.repository || logicalRepository;
    const artifact = report.package;
    const releasePackage = artifact?.kind === "release";
    const actionsPackage = artifact?.kind === "actions";
    if (
      artifact &&
      (!onlyKeys(artifact, [
        "kind",
        "id",
        "tag",
        "name",
        "sourceUrl",
        "digestVerified",
        "runId",
        "workflowId",
        "workflowPath",
        "runAttempt",
      ]) ||
        (!releasePackage && !actionsPackage) ||
        !Number.isSafeInteger(artifact.id) ||
        artifact.id < 1 ||
        !text(artifact.name, 255) ||
        typeof artifact.digestVerified !== "boolean" ||
        typeof artifact.sourceUrl !== "string" ||
        (releasePackage &&
          (!text(artifact.tag, 128) ||
            !artifact.sourceUrl.startsWith(
              `${logicalRepository}/releases/download/`,
            ))) ||
        (actionsPackage &&
          (!Number.isSafeInteger(artifact.runId) ||
            artifact.runId < 1 ||
            !Number.isSafeInteger(artifact.workflowId) ||
            artifact.workflowId < 1 ||
            !Number.isSafeInteger(artifact.runAttempt) ||
            artifact.runAttempt < 1 ||
            !text(artifact.workflowPath, 512) ||
            !artifact.workflowPath.startsWith(".github/workflows/") ||
            artifact.sourceUrl !==
              `${logicalRepository}/actions/runs/${artifact.runId}` ||
            db
              .prepare(
                "SELECT workflow_id FROM source_workflow WHERE repository=?",
              )
              .get(repository)?.workflow_id !== artifact.workflowId)))
    )
      throw new Error("Invalid package evidence");
    for (const c of report.skills) {
      if (
        !onlyKeys(c, [
          "id",
          "path",
          "name",
          "description",
          "sourceUrl",
          "bundleSha256",
          "license",
          "qualityScore",
          "status",
          "findings",
          "files",
          "reviewText",
        ]) ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.id || "") ||
        c.id.length > 160 ||
        !text(c.name, 160) ||
        !text(c.description, 1024) ||
        !relativePath(c.path) ||
        (c.reviewText !== undefined &&
          (typeof c.reviewText !== "string" ||
            c.reviewText.length > 256 * 1024)) ||
        (c.files !== undefined &&
          (!Array.isArray(c.files) ||
            c.files.length > 200 ||
            !c.files.every(
              (f) =>
                onlyKeys(f, ["path", "sha256", "bytes"]) &&
                relativePath(f.path) &&
                sha.test(f.sha256 || "") &&
                Number.isSafeInteger(f.bytes) &&
                f.bytes >= 0 &&
                f.bytes <= 512 * 1024,
            ))) ||
        !sha.test(c.bundleSha256 || "") ||
        typeof c.license !== "string" ||
        c.license.length > 200 ||
        !Number.isInteger(c.qualityScore) ||
        c.qualityScore < 0 ||
        c.qualityScore > 100 ||
        !["needs_review", "blocked"].includes(c.status) ||
        !Array.isArray(c.findings) ||
        c.findings.length > 200 ||
        !c.findings.every(
          (f) =>
            onlyKeys(f, ["code", "severity", "path", "line", "message"]) &&
            ["info", "medium", "high"].includes(f.severity) &&
            text(f.code, 100) &&
            (f.path === undefined || text(f.path, 512)) &&
            (f.line === undefined ||
              (Number.isInteger(f.line) && f.line >= 0 && f.line < 10000000)) &&
            (f.message === undefined || text(f.message, 2000)),
        ) ||
        !text(c.sourceUrl, 2048) ||
        !(artifact
          ? c.sourceUrl === artifact.sourceUrl
          : c.sourceUrl.startsWith(
              actionsPackage
                ? `${logicalRepository}/actions/runs/${artifact.runId}`
                : artifact
                  ? `${logicalRepository}/releases/download/`
                  : `${logicalRepository}/blob/${report.commit}/`,
            )) ||
        /[\u0000-\u001f]/.test(c.sourceUrl)
      )
        throw new Error("Invalid candidate");
    }
    const seenPaths = new Set();
    for (const c of report.skills) {
      if (seenPaths.has(c.path)) throw new Error("Duplicate skill path");
      seenPaths.add(c.path);
      const aliases = db
        .prepare(
          "SELECT DISTINCT skill_id FROM candidate WHERE repository=? COLLATE NOCASE AND json_extract(metadata,'$.candidate.path')=?",
        )
        .all(repository, c.path);
      if (aliases.length > 1)
        throw new Error("Ambiguous skill aliases require an editor");
      if (aliases.length) c.id = aliases[0].skill_id;
    }
    db.prepare("INSERT OR IGNORE INTO source VALUES(?,0,0,NULL,?)").run(
      repository,
      Date.now(),
    );
    const source = db
      .prepare(
        "SELECT source.*,source_workflow.workflow_id FROM source LEFT JOIN source_workflow USING(repository) WHERE repository=?",
      )
      .get(repository);
    let added = 0,
      published = 0;
    for (const c of report.skills) {
      // Source and built bundle versions coexist; identical content is idempotent.
      const originKey = artifact
        ? `${artifact.kind}:${artifact.id}:${report.archiveSha256}`
        : "source";
      const id = fingerprint(
        `${repository}:${c.id}:${report.commit}:${c.bundleSha256}:${originKey}`,
      );
      const candidate = {
        id: c.id,
        name: c.name,
        description: c.description,
        path: c.path,
        sourceUrl: c.sourceUrl,
        bundleSha256: c.bundleSha256,
        license: c.license,
        qualityScore: c.qualityScore,
        status: c.status,
        reviewText: typeof c.reviewText === "string" ? c.reviewText : "",
        findings: c.findings.map(({ code, severity, path, line, message }) => ({
          code,
          severity,
          path,
          line,
          message,
        })),
      };
      const metadata = JSON.stringify({
        candidate,
        archiveSha256: report.archiveSha256,
        package: artifact || null,
      });
      const result = db
        .prepare(
          "INSERT OR IGNORE INTO candidate VALUES(?,?,?,?,?,?,? ,?,1,?,?)",
        )
        .run(
          id,
          repository,
          c.id,
          report.commit,
          c.bundleSha256,
          originKey,
          decisionFor(c, source, artifact),
          metadata,
          Date.now(),
          Date.now(),
        );
      added += result.changes;
      const row = db.prepare("SELECT * FROM candidate WHERE id=?").get(id);
      if (row.status === "published") {
        if (publish(row, "service:intake", "automated")) published++;
        else mark(id, "needs_review", "service:intake", "editorial_conflict");
      }
    }
    return {
      added,
      published,
      scanned: report.skills.length,
      policyVersion: POLICY_VERSION,
    };
  }
  function control() {
    const row = db.prepare("SELECT * FROM intake_control WHERE id=1").get();
    return {
      paused: Boolean(row.paused),
      intervalHours: row.interval_hours,
      manualRequest:
        db
          .prepare(
            "SELECT id,requested_at AS requestedAt FROM intake_run_request WHERE status='pending' ORDER BY requested_at LIMIT 1",
          )
          .get() || null,
      manualAvailableAt:
        (db.prepare("SELECT max(requested_at) n FROM intake_run_request").get()
          .n || 0) + 900000,
      lastRunAt:
        db
          .prepare(
            "SELECT max(finished_at) n FROM intake_run WHERE status IN ('complete','failed')",
          )
          .get().n || 0,
    };
  }
  function acceptRun(report) {
    if (
      report.schemaVersion !== 1 ||
      !/^[a-f0-9-]{36}$/.test(report.id || "") ||
      !Number.isSafeInteger(report.startedAt) ||
      !Number.isSafeInteger(report.finishedAt) ||
      report.startedAt < 1 ||
      report.finishedAt < report.startedAt ||
      report.finishedAt > Date.now() + 60000 ||
      !["complete", "failed", "paused"].includes(report.status) ||
      (report.manualRequestId !== undefined &&
        !/^[a-f0-9-]{36}$/.test(report.manualRequestId)) ||
      !Array.isArray(report.jobs) ||
      report.jobs.length > 100 ||
      !report.jobs.every(
        (j) =>
          repoPattern.test(j.repository || "") &&
          ["source", "release", "actions"].includes(j.kind) &&
          [
            "queued",
            "running",
            "complete",
            "failed",
            "skipped",
            "blocked",
          ].includes(j.state) &&
          Number.isSafeInteger(j.attempts) &&
          j.attempts >= 0,
      ) ||
      !["repositories", "completed", "failed", "skipped", "blocked"].every(
        (k) =>
          Number.isSafeInteger(report.summary?.[k]) &&
          report.summary[k] >= 0 &&
          report.summary[k] <= 1000,
      )
    )
      throw new Error("Invalid run summary");
    const safe = {
      manualRequestId: report.manualRequestId || null,
      githubCooldownUntil:
        Number.isSafeInteger(report.githubCooldownUntil) &&
        report.githubCooldownUntil >= 0 &&
        report.githubCooldownUntil <= Date.now() + 86400000
          ? report.githubCooldownUntil
          : 0,
      summary: Object.fromEntries(
        ["repositories", "completed", "failed", "skipped", "blocked"].map(
          (k) => [k, report.summary[k]],
        ),
      ),
      jobs: report.jobs.map(({ repository, kind, state, attempts }) => ({
        repository,
        kind,
        state,
        attempts,
      })),
    };
    db.transaction(() => {
      db.prepare("INSERT OR IGNORE INTO intake_run VALUES(?,?,?,?,?)").run(
        report.id,
        report.startedAt,
        report.finishedAt,
        report.status,
        JSON.stringify(safe),
      );
      if (report.manualRequestId)
        db.prepare(
          "UPDATE intake_run_request SET status=? WHERE id=? AND status='pending'",
        ).run(report.status, report.manualRequestId);
    })();
    return { ok: true };
  }
  async function input(request, limit) {
    const reader = request.body?.getReader();
    if (!reader) return null;
    let length = 0;
    const parts = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > limit) {
          await reader.cancel();
          return null;
        }
        parts.push(Buffer.from(value));
      }
      return JSON.parse(Buffer.concat(parts).toString());
    } catch {
      return null;
    }
  }
  return {
    acceptReport,
    async worker(request) {
      const supplied = Buffer.from(request.headers.get("authorization") || "");
      const expected = Buffer.from(`Bearer ${token}`);
      if (
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      )
        return fail(401, "UNAUTHENTICATED");
      if (request.method === "GET") {
        const offset = Number(
          new URL(request.url).searchParams.get("offset") || 0,
        );
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000000)
          return fail(400, "INVALID_REQUEST");
        const sourceTotal = db.prepare("SELECT count(*) n FROM source").get().n;
        return json(200, {
          sources: db
            .prepare(
              "SELECT repository FROM source ORDER BY repository LIMIT 100 OFFSET ?",
            )
            .all(offset % (sourceTotal || 1))
            .map((row) => row.repository),
          sourcePolicies: db
            .prepare(
              "SELECT repository,workflow_id AS workflowId FROM source_workflow ORDER BY repository",
            )
            .all(),
          control: control(),
          sourceTotal,
        });
      }
      if (request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED");
      try {
        const report = await input(request, 12 * 1024 * 1024);
        if (report?.type === "run") return json(200, acceptRun(report));
        if (control().paused) return fail(409, "INTAKE_PAUSED");
        return json(200, acceptReport(report));
      } catch {
        return fail(400, "INVALID_REPORT");
      }
    },
    async admin(request, user) {
      const url = new URL(request.url),
        path = url.pathname;
      if (request.method === "GET" && path === "/api/admin/intake") {
        const limit = Number(url.searchParams.get("limit") || 25),
          offset = Number(url.searchParams.get("offset") || 0);
        const sourceOffset = Number(url.searchParams.get("sourceOffset") || 0);
        const status = url.searchParams.get("status") || "",
          query = (url.searchParams.get("q") || "").trim();
        if (
          !Number.isSafeInteger(limit) ||
          limit < 1 ||
          limit > 100 ||
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          offset > 10000000 ||
          !Number.isSafeInteger(sourceOffset) ||
          sourceOffset < 0 ||
          sourceOffset > 10000000 ||
          query.length > 200 ||
          (status &&
            !["needs_review", "blocked", "published", "rejected"].includes(
              status,
            ))
        )
          return fail(400, "INVALID_REQUEST");
        const where =
          "WHERE (?='' OR status=?) AND (?='' OR instr(lower(repository||' '||skill_id||' '||metadata),lower(?))>0)";
        const filter = [status, status, query, query];
        return json(200, {
          items: db
            .prepare(
              `SELECT id,repository,skill_id AS skillId,commit_sha AS commitSha,status,revision,created_at AS createdAt,metadata FROM candidate ${where} ORDER BY updated_at DESC,id ASC LIMIT ? OFFSET ?`,
            )
            .all(...filter, limit, offset)
            .map(({ metadata, ...row }) => {
              const { candidate, ...meta } = JSON.parse(metadata);
              const { reviewText, ...summary } = candidate;
              return {
                ...row,
                ...meta,
                candidate: summary,
              };
            }),
          total: db
            .prepare(`SELECT count(*) n FROM candidate ${where}`)
            .get(...filter).n,
          offset,
          limit,
          sources: db
            .prepare(
              "SELECT source.*,source_workflow.workflow_id AS workflow_id FROM source LEFT JOIN source_workflow USING(repository) ORDER BY repository LIMIT 25 OFFSET ?",
            )
            .all(sourceOffset),
          sourceOffset,
          sourceTotal: db.prepare("SELECT count(*) n FROM source").get().n,
          counts: db
            .prepare(
              "SELECT status,count(*) AS count FROM candidate GROUP BY status",
            )
            .all(),
          policyVersion: POLICY_VERSION,
          control: control(),
          runs: db
            .prepare(
              "SELECT * FROM intake_run ORDER BY started_at DESC LIMIT 20",
            )
            .all()
            .map(({ metadata, ...r }) => ({ ...r, ...JSON.parse(metadata) })),
        });
      }
      const detailId = path.match(
        /^\/api\/admin\/intake\/([a-f0-9]{64})$/,
      )?.[1];
      if (request.method === "GET" && detailId) {
        const row = db
          .prepare("SELECT * FROM candidate WHERE id=?")
          .get(detailId);
        if (!row) return fail(404, "NOT_FOUND");
        const published = editorial
          .prepare(
            "SELECT metadata FROM reporadars_intake_receipt WHERE slug=? ORDER BY created_at DESC LIMIT 1",
          )
          .get(row.skill_id);
        const current = editorial
          .prepare(
            "SELECT title_en,summary_en,source_url,revision,status FROM reporadars_admin_record WHERE slug=?",
          )
          .get(row.skill_id);
        const metadata = JSON.parse(row.metadata);
        const previous = published ? JSON.parse(published.metadata) : null;
        const changes = current
          ? [
              ["name", current.title_en, metadata.candidate.name],
              [
                "description",
                current.summary_en,
                metadata.candidate.description,
              ],
              ["source", current.source_url, metadata.candidate.sourceUrl],
              ["commit", previous?.commit || "", row.commit_sha],
              ["bundle", previous?.bundleSha256 || "", row.bundle_sha],
              ["path", previous?.path || "", metadata.candidate.path],
            ]
              .filter(([, before, after]) => before !== after)
              .map(([field, before, after]) => ({ field, before, after }))
          : [];
        const conflicts = editorial
          .prepare(
            "SELECT DISTINCT r.slug,r.title_en AS title FROM reporadars_intake_receipt e JOIN reporadars_admin_record r ON r.slug=e.slug AND r.revision=e.revision WHERE r.status='published' AND e.slug<>? AND json_extract(e.metadata,'$.bundleSha256')=? LIMIT 20",
          )
          .all(row.skill_id, row.bundle_sha);
        return json(200, {
          id: row.id,
          revision: row.revision,
          status: row.status,
          commitSha: row.commit_sha,
          ...metadata,
          previous,
          changes,
          conflicts,
          current: current
            ? { revision: current.revision, status: current.status }
            : null,
        });
      }
      const body = await input(request, 4096);
      if (request.method === "POST" && path === "/api/admin/intake/run") {
        if (!onlyKeys(body, [])) return fail(400, "INVALID_REQUEST");
        if (control().paused) return fail(409, "INTAKE_PAUSED");
        return db.transaction(() => {
          const current = control();
          if (current.manualRequest) return json(202, { control: current });
          if (Date.now() < current.manualAvailableAt)
            return fail(429, "RUN_COOLDOWN");
          const id = randomUUID(),
            now = Date.now();
          db.prepare(
            "INSERT INTO intake_run_request VALUES(?,?,?,'pending')",
          ).run(id, now, user.id);
          db.prepare(
            "INSERT INTO event(actor,action,candidate_id,created_at) VALUES(?,?,?,?)",
          ).run(user.id, "intake_run_request", id, now);
          return json(202, { control: control() });
        })();
      }
      if (request.method === "POST" && path === "/api/admin/intake/control") {
        if (
          !body ||
          typeof body.paused !== "boolean" ||
          !Number.isSafeInteger(body.intervalHours) ||
          body.intervalHours < 6 ||
          body.intervalHours > 168
        )
          return fail(400, "INVALID_REQUEST");
        db.transaction(() => {
          db.prepare(
            "UPDATE intake_control SET paused=?,interval_hours=?,updated_by=?,updated_at=? WHERE id=1",
          ).run(Number(body.paused), body.intervalHours, user.id, Date.now());
          db.prepare(
            "INSERT INTO event(actor,action,candidate_id,created_at) VALUES(?,?,?,?)",
          ).run(
            user.id,
            body.paused ? "intake_pause" : "intake_resume",
            "control",
            Date.now(),
          );
        })();
        return json(200, { control: control() });
      }
      if (request.method === "POST" && path === "/api/admin/intake/sources") {
        try {
          body.repository = normalizeRepository(body?.repository);
          const aliases = db
            .prepare(
              "SELECT repository FROM source WHERE repository=? COLLATE NOCASE",
            )
            .all(body.repository);
          if (aliases.length > 1) return fail(409, "AMBIGUOUS_SOURCE");
          if (aliases.length) body.repository = aliases[0].repository;
        } catch {
          return fail(400, "INVALID_REQUEST");
        }
        if (
          !body ||
          !repoPattern.test(body.repository || "") ||
          typeof body.allowAuto !== "boolean" ||
          (body.workflowId !== undefined &&
            body.workflowId !== null &&
            (!Number.isSafeInteger(body.workflowId) || body.workflowId < 1)) ||
          (body.allowAuto && body.rightsConfirmed !== true)
        )
          return fail(400, "INVALID_REQUEST");
        db.transaction(() => {
          db.prepare(
            "INSERT INTO source VALUES(?,?,?,?,?) ON CONFLICT(repository) DO UPDATE SET allow_auto=excluded.allow_auto,rights_confirmed=excluded.rights_confirmed,updated_by=excluded.updated_by,updated_at=excluded.updated_at",
          ).run(
            body.repository,
            Number(body.allowAuto),
            Number(body.rightsConfirmed === true),
            user.id,
            Date.now(),
          );
          if (body.workflowId === null)
            db.prepare("DELETE FROM source_workflow WHERE repository=?").run(
              body.repository,
            );
          else if (body.workflowId !== undefined)
            db.prepare(
              "INSERT INTO source_workflow VALUES(?,?) ON CONFLICT(repository) DO UPDATE SET workflow_id=excluded.workflow_id",
            ).run(body.repository, body.workflowId);
          db.prepare(
            "INSERT INTO event(actor,action,candidate_id,created_at) VALUES(?,?,?,?)",
          ).run(user.id, "source_policy", body.repository, Date.now());
        })();
        const source = db
          .prepare(
            "SELECT source.*,source_workflow.workflow_id FROM source LEFT JOIN source_workflow USING(repository) WHERE repository=?",
          )
          .get(body.repository);
        for (const row of db
          .prepare(
            "SELECT * FROM candidate WHERE repository=? AND status='needs_review' LIMIT 200",
          )
          .all(body.repository)) {
          const meta = JSON.parse(row.metadata);
          if (
            !control().paused &&
            decisionFor(meta.candidate, source, meta.package) === "published" &&
            publish(row, "service:intake", "automated")
          )
            mark(
              row.id,
              "published",
              "service:intake",
              "source_policy_publish",
            );
        }
        return json(200, { ok: true });
      }
      const id = path.match(/^\/api\/admin\/intake\/([a-f0-9]{64})$/)?.[1];
      if (
        request.method !== "POST" ||
        !id ||
        !body ||
        !["approve", "reject"].includes(body.decision)
      )
        return fail(400, "INVALID_REQUEST");
      const row = db.prepare("SELECT * FROM candidate WHERE id=?").get(id);
      if (!row) return fail(404, "NOT_FOUND");
      if (
        row.revision !== body.revision ||
        !["needs_review", "blocked"].includes(row.status)
      )
        return fail(409, "CONFLICT");
      if (
        body.decision === "approve" &&
        (row.status === "blocked" || body.rightsConfirmed !== true)
      )
        return fail(403, "FORBIDDEN");
      if (body.decision === "approve" && !publish(row, user.id, "human"))
        return fail(409, "EDITORIAL_CONFLICT");
      mark(
        id,
        body.decision === "approve" ? "published" : "rejected",
        user.id,
        body.decision,
      );
      return json(200, { ok: true });
    },
    health() {
      db.prepare("SELECT id FROM intake_control WHERE id=1").get();
      editorial.prepare("SELECT id FROM reporadars_admin_record LIMIT 1").get();
    },
    close() {
      db.close();
      editorial.close();
    },
  };
}
