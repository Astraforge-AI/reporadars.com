import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { runIntake } from "../server/intake-worker.mjs";

test("queue recovery respects pause, avoids discovery, requeues a pause race and blocks invalid reports", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "rr-worker-control-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const options = {
    statePath: join(dir, "jobs.sqlite"),
    tokenFile: join(dir, "token"),
    binary: join(dir, "scanner"),
    limit: 1,
  };
  await writeFile(
    options.tokenFile,
    "isolated-worker-control-token-with-over-forty-characters",
  );
  await writeFile(
    options.binary,
    "#!/usr/bin/env node\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.writeFileSync(args[args.indexOf('--out')+1],JSON.stringify({schemaVersion:1,skills:[{id:'fixture-candidate'}]}));",
    { mode: 0o700 },
  );
  const original = globalThis.fetch,
    runs = [];
  let paused = true,
    status = 409;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (url, request = {}) => {
    assert.equal(
      new URL(url).hostname,
      "127.0.0.1",
      "recovery must not search GitHub",
    );
    if (request.method === "GET")
      return Response.json({
        sources: [],
        control: { paused, lastRunAt: Date.now(), intervalHours: 24 },
      });
    const body = JSON.parse(request.body);
    if (body.type === "run") {
      runs.push(body);
      return Response.json({ ok: true });
    }
    return Response.json(
      { error: { code: status === 409 ? "INTAKE_PAUSED" : "INVALID_REPORT" } },
      { status },
    );
  };
  await runIntake({ ...options, recoveryOnly: true });
  const db = new Database(options.statePath);
  db.prepare(
    "INSERT INTO job(id,repository,kind,state,updated_at) VALUES('restore-fixture','https://github.com/fixture/source','source','queued',0)",
  ).run();
  db.prepare("INSERT INTO job_payload VALUES('restore-fixture',?)").run(
    JSON.stringify([
      "scan",
      "--repo",
      "https://github.com/fixture/source",
      "--ref",
      "a".repeat(40),
    ]),
  );
  db.close();
  paused = false;
  const interrupted = await runIntake(options); // Existing queue recovers without new discovery.
  assert.equal(runs.length, 1);
  assert.equal(interrupted.failed, 0);
  assert.equal(runs.at(-1).status, "paused");
  let read = new Database(options.statePath);
  assert.equal(read.prepare("SELECT state FROM job").get().state, "queued");
  read.close();
  status = 400;
  const invalid = await runIntake({ ...options, recoveryOnly: true });
  assert.equal(invalid.blocked, 1);
  assert.equal(invalid.failed, 0);
  read = new Database(options.statePath);
  assert.equal(read.prepare("SELECT state FROM job").get().state, "blocked");
  read.close();
});

test("a queued manual request bypasses cadence once, retains pause and mirrors its identity", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "rr-manual-run-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const tokenFile = join(dir, "token");
  await writeFile(
    tokenFile,
    "isolated-manual-run-token-over-forty-characters",
    { mode: 0o600 },
  );
  const options = {
    statePath: join(dir, "jobs.sqlite"),
    tokenFile,
    binary: join(dir, "unused-scanner"),
    serviceOrigin: "http://127.0.0.1:4320",
    limit: 1,
  };
  const original = globalThis.fetch,
    requestId = "11111111-1111-1111-1111-111111111111",
    runs = [];
  let paused = true,
    manualRequest = { id: requestId },
    githubCalls = 0;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (url, request = {}) => {
    if (new URL(url).hostname === "api.github.com") {
      githubCalls++;
      return String(url).includes("/search/")
        ? Response.json({ items: [] })
        : Response.json({}, { status: 404 });
    }
    assert.equal(new URL(url).hostname, "127.0.0.1");
    if (request.method === "GET")
      return Response.json({
        sources: [],
        control: {
          paused,
          manualRequest,
          intervalHours: 24,
          lastRunAt: Date.now(),
        },
      });
    const body = JSON.parse(request.body);
    assert.equal(body.type, "run");
    runs.push(body);
    manualRequest = null;
    return Response.json({ ok: true });
  };
  await runIntake(options);
  assert.equal(githubCalls, 0);
  assert.equal(runs.length, 0);
  paused = false;
  await runIntake(options);
  assert.ok(githubCalls > 0);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].manualRequestId, requestId);
  const calls = githubCalls;
  await runIntake(options);
  assert.equal(githubCalls, calls);
  assert.equal(runs.length, 1);
});

test("scanner rate limits persist cooldown and retain remaining queue without repeated requests", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "rr-scanner-rate-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const tokenFile = join(dir, "token"),
    binary = join(dir, "scanner");
  await writeFile(
    tokenFile,
    "isolated-scanner-rate-token-over-forty-characters",
    { mode: 0o600 },
  );
  await writeFile(
    binary,
    "#!/usr/bin/env node\nconsole.error('radar-import: scan fetch failed: unexpected HTTP response: 403 rate limit exceeded');process.exit(1);",
    { mode: 0o700 },
  );
  const options = {
    statePath: join(dir, "jobs.sqlite"),
    tokenFile,
    binary,
    serviceOrigin: "http://127.0.0.1:4320",
    recoveryOnly: true,
    limit: 2,
  };
  const original = globalThis.fetch,
    runs = [];
  let paused = true;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (url, request = {}) => {
    assert.equal(new URL(url).hostname, "127.0.0.1");
    if (request.method === "GET")
      return Response.json({ sources: [], control: { paused } });
    const body = JSON.parse(request.body);
    assert.equal(body.type, "run");
    runs.push(body);
    return Response.json({ ok: true });
  };
  await runIntake(options);
  let db = new Database(options.statePath);
  for (let i = 0; i < 2; i++) {
    db.prepare(
      "INSERT INTO job(id,repository,kind,state,updated_at) VALUES(?,?,'source','queued',?)",
    ).run(`job-${i}`, `https://github.com/fixture/source-${i}`, i);
    db.prepare("INSERT INTO job_payload VALUES(?,?)").run(
      `job-${i}`,
      JSON.stringify(["scan"]),
    );
  }
  db.close();
  paused = false;
  const result = await runIntake(options);
  assert.equal(result.failed, 0);
  assert.equal(runs[0].status, "complete");
  assert.ok(runs[0].githubCooldownUntil > Date.now());
  db = new Database(options.statePath);
  assert.deepEqual(
    db.prepare("SELECT state,attempts FROM job ORDER BY id").all(),
    [
      { state: "queued", attempts: 1 },
      { state: "queued", attempts: 0 },
    ],
  );
  db.close();
  await runIntake(options);
  assert.equal(runs.length, 1);
});

test("discovery imports each immutable job once and remembers repositories without SKILL.md", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "rr-worker-"));
  const tokenFile = join(dir, "token"),
    binary = join(dir, "fixture-scanner"),
    statePath = join(dir, "jobs.sqlite");
  await writeFile(
    tokenFile,
    "isolated-test-token-with-more-than-forty-characters",
    { mode: 0o600 },
  );
  await writeFile(
    binary,
    `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const args=process.argv.slice(2);
if(args.includes('https://github.com/fixture/bad-archive')){console.error('radar-import: scan fetch failed: ZIP archive contains an unsafe entry');process.exit(1);}
if(args.includes('https://github.com/fixture/empty')){console.error('radar-import: scan analysis failed: no SKILL.md files found');process.exit(1);}
if(process.env.INTAKE_TOKEN_FILE || process.env.ADMIN_RUNTIME_DIR)process.exit(2);
writeFileSync(args[args.indexOf('--out')+1],JSON.stringify({schemaVersion:1,skills:[]}));
`,
    { mode: 0o700 },
  );
  const original = globalThis.fetch;
  let posts = 0;
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname === "127.0.0.1") {
      assert.equal(
        options.headers.Authorization,
        "Bearer isolated-test-token-with-more-than-forty-characters",
      );
      if (options.method === "POST") {
        if (JSON.parse(options.body).type === "run")
          return Response.json({ ok: true });
        posts++;
        return Response.json({ added: 0 });
      }
      return Response.json({ sources: [] });
    }
    assert.equal(parsed.hostname, "api.github.com");
    if (parsed.pathname.startsWith("/search/"))
      return Response.json({
        items: [
          { html_url: "https://github.com/fixture/skills" },
          { html_url: "https://github.com/fixture/empty" },
          { html_url: "https://github.com/fixture/bad-archive" },
        ],
      });
    if (parsed.pathname.endsWith("/commits/HEAD"))
      return Response.json({ sha: "a".repeat(40) });
    if (parsed.pathname.endsWith("/releases/latest"))
      return new Response("", { status: 404 });
    if (parsed.pathname.endsWith("/readme"))
      return new Response("", { status: 404 });
    throw new Error("Unexpected endpoint");
  };
  t.after(async () => {
    globalThis.fetch = original;
    await rm(dir, { recursive: true, force: true });
  });
  const options = { statePath, tokenFile, binary, limit: 3 };
  assert.deepEqual(await runIntake(options), {
    repositories: 3,
    completed: 1,
    failed: 0,
    skipped: 1,
    blocked: 1,
  });
  assert.deepEqual(await runIntake(options), {
    repositories: 3,
    completed: 0,
    failed: 0,
    skipped: 0,
    blocked: 0,
  });
  assert.equal(posts, 1);
  const db = new Database(statePath, { readonly: true });
  assert.deepEqual(
    db
      .prepare("SELECT state FROM job ORDER BY state")
      .all()
      .map((row) => row.state),
    ["blocked", "complete", "skipped"],
  );
  db.close();
});

test("worker queues Actions only for an approved source workflow and a private GitHub credential", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "rr-actions-worker-"));
  const tokenFile = join(dir, "service-token"),
    githubTokenFile = join(dir, "github-token"),
    binary = join(dir, "scanner"),
    statePath = join(dir, "jobs.sqlite");
  await writeFile(
    tokenFile,
    "isolated-test-token-with-more-than-forty-characters",
    { mode: 0o600 },
  );
  await writeFile(githubTokenFile, "isolated-test-github-credential", {
    mode: 0o600,
  });
  await writeFile(
    binary,
    `#!/usr/bin/env node
import {writeFileSync,readFileSync} from 'node:fs';
const args=process.argv.slice(2);
if(process.env.INTAKE_GITHUB_TOKEN_FILE || process.env.INTAKE_TOKEN_FILE || process.env.MAIL_CONFIG_FILE)process.exit(2);
if(args[0]==='scan-actions' && (args[args.indexOf('--workflow-id')+1]!=='4' || readFileSync(args[args.indexOf('--github-token-file')+1],'utf8')!=='isolated-test-github-credential'))process.exit(3);
writeFileSync(args[args.indexOf('--out')+1],JSON.stringify({command:args[0]}));
`,
    { mode: 0o700 },
  );
  const original = globalThis.fetch,
    commands = [];
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname === "127.0.0.1") {
      if (options.method === "POST") {
        if (JSON.parse(options.body).type === "run")
          return Response.json({ ok: true });
        commands.push(JSON.parse(options.body).command);
        return Response.json({ added: 0 });
      }
      return Response.json({
        sources: ["https://github.com/fixture/skills"],
        sourcePolicies: [
          { repository: "https://github.com/fixture/skills", workflowId: 4 },
        ],
      });
    }
    assert.equal(
      options.headers.Authorization,
      "Bearer isolated-test-github-credential",
    );
    if (parsed.pathname.startsWith("/search/"))
      return Response.json({ items: [] });
    if (parsed.pathname.endsWith("/commits/HEAD"))
      return Response.json({ sha: "a".repeat(40) });
    if (parsed.pathname.endsWith("/releases/latest"))
      return new Response("", { status: 404 });
    if (parsed.pathname.endsWith("/readme"))
      return new Response("", { status: 404 });
    if (parsed.pathname.endsWith("/actions/artifacts"))
      return Response.json({
        artifacts: [
          {
            id: 11,
            name: "skills",
            size_in_bytes: 100,
            expired: false,
            expires_at: new Date(Date.now() + 3600000).toISOString(),
            digest: "sha256:fixture",
          },
        ],
      });
    throw new Error("Unexpected API endpoint");
  };
  t.after(async () => {
    globalThis.fetch = original;
    await rm(dir, { recursive: true, force: true });
  });
  const options = { statePath, tokenFile, githubTokenFile, binary, limit: 1 };
  assert.equal((await runIntake(options)).completed, 2);
  assert.deepEqual(commands.sort(), ["scan", "scan-actions"]);
  assert.equal((await runIntake(options)).completed, 0);
});

test("paused worker performs no discovery, and a leased queued job survives source rotation", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "rr-worker-recovery-"));
  const tokenFile = join(dir, "token"),
    binary = join(dir, "scanner"),
    statePath = join(dir, "jobs.sqlite");
  await writeFile(
    tokenFile,
    "isolated-test-token-with-more-than-forty-characters",
    { mode: 0o600 },
  );
  await writeFile(
    binary,
    `#!/usr/bin/env node
import {writeFileSync} from 'node:fs';
const args=process.argv.slice(2);writeFileSync(args[args.indexOf('--out')+1],JSON.stringify({schemaVersion:1,skills:[]}));
`,
    { mode: 0o700 },
  );
  let paused = true,
    posts = 0,
    external = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (new URL(url).hostname === "127.0.0.1") {
      if (options.method === "POST") {
        if (JSON.parse(options.body).type !== "run") posts++;
        return Response.json({ ok: true });
      }
      return Response.json({ sources: [], control: { paused } });
    }
    external++;
    return Response.json({ items: [] });
  };
  t.after(async () => {
    globalThis.fetch = original;
    await rm(dir, { recursive: true, force: true });
  });
  const options = { statePath, tokenFile, binary, limit: 1 };
  assert.equal((await runIntake(options)).completed, 0);
  assert.equal(external, 0);
  const db = new Database(statePath);
  db.prepare(
    "INSERT INTO job(id,repository,kind,state,lease_until,updated_at) VALUES('recovery','https://github.com/fixture/old-source','source','running',0,0)",
  ).run();
  db.prepare("INSERT INTO job_payload VALUES('recovery',?)").run(
    JSON.stringify([
      "scan",
      "--repo",
      "https://github.com/fixture/old-source",
      "--ref",
      "a".repeat(40),
    ]),
  );
  db.close();
  paused = false;
  assert.equal((await runIntake(options)).completed, 1);
  assert.equal(posts, 1);
});
