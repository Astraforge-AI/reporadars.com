import test from "node:test";
import assert from "node:assert/strict";
import {
  operationalIssues,
  monitorInstallation,
} from "../../ops/reporadars/monitor.mjs";
import { backupInstallation } from "../../ops/reporadars/backup.mjs";
import Database from "better-sqlite3";
import { mkdtemp, mkdir, chmod, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("monitor reports meaningful failures, tolerates configured pauses and uses the configured cadence", () => {
  const now = Date.now(),
    ok = {
      healthy: true,
      paused: false,
      intervalHours: 24,
      lastRunAt: now - 25 * 3600000,
      lastRunStatus: "complete",
      pendingSince: 0,
      backupAt: now - 24 * 3600000,
      backupValid: true,
      freeBytes: 2 ** 32,
      now,
    };
  assert.deepEqual(operationalIssues(ok), []);
  assert.deepEqual(
    operationalIssues({ ...ok, databaseHealthy: false, queueHealthy: false }),
    ["database_unavailable", "queue_unavailable"],
  );
  assert.deepEqual(operationalIssues({ ...ok, freeBytes: null }), [
    "disk_unavailable",
  ]);
  assert.deepEqual(operationalIssues({ ...ok, intervalHours: 6 }), [
    "intake_stale",
  ]);
  assert.deepEqual(
    operationalIssues({
      ...ok,
      paused: true,
      lastRunAt: 0,
      lastRunStatus: "failed",
      pendingSince: 1,
    }),
    [],
  );
  assert.deepEqual(
    operationalIssues({
      ...ok,
      healthy: false,
      lastRunAt: 0,
      lastRunStatus: "failed",
      pendingSince: now - 30 * 3600000,
      backupValid: false,
      freeBytes: 0,
    }),
    [
      "origin_unavailable",
      "intake_stale",
      "intake_failed",
      "queue_stalled",
      "backup_stale_or_invalid",
      "disk_low",
    ],
  );
});
test("monitor verifies the real backup directory naming and stays quiet when the issue set is unchanged", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "rr-monitor-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = join(root, "runtime"),
    backups = join(root, "backups");
  await mkdir(runtime);
  await mkdir(backups);
  const now = Date.now(),
    dbs = [];
  for (const [path, sql] of [
    [
      join(runtime, "auth.sqlite"),
      "CREATE TABLE user(id); CREATE TABLE reporadars_admin_grant(user_id);",
    ],
    [
      join(runtime, "intake.sqlite"),
      "CREATE TABLE intake_control(id,paused,interval_hours); INSERT INTO intake_control VALUES(1,0,24); CREATE TABLE intake_run(finished_at,status); INSERT INTO intake_run VALUES(" +
        now +
        ",'complete');",
    ],
    [
      join(root, "jobs.sqlite"),
      "CREATE TABLE job(state,updated_at); INSERT INTO job VALUES('complete',0);",
    ],
  ]) {
    const db = new Database(path);
    db.exec(sql);
    dbs.push(db);
    await chmod(path, 0o600);
  }
  t.after(() => dbs.forEach((db) => db.close()));
  for (const [path, value] of [
    [join(runtime, "auth-secret"), "isolated-monitor-secret"],
    [join(runtime, "runtime.json"), "{}"],
    [join(root, "service-token"), "isolated-monitor-token"],
    [join(root, "smtp.json"), "{}"],
  ])
    await writeFile(path, value, { mode: 0o600 });
  const destination = join(
    backups,
    new Date(now).toISOString().replaceAll(":", "-"),
  );
  await backupInstallation(
    {
      runtime,
      workerState: join(root, "jobs.sqlite"),
      workerToken: join(root, "service-token"),
      mailConfig: join(root, "smtp.json"),
    },
    destination,
  );
  const options = {
    runtime,
    workerState: join(root, "jobs.sqlite"),
    backups,
    state: join(root, "monitor/state.json"),
    now,
    fetchImpl: async () => Response.json({ status: "ok" }),
  };
  const first = await monitorInstallation(options);
  assert.equal(first.backupValid, true);
  assert.equal(first.issues.includes("backup_stale_or_invalid"), false);
  assert.equal(first.changed, true);
  assert.equal(
    (await monitorInstallation({ ...options, now: now + 1 })).changed,
    false,
  );
  dbs[1].exec("UPDATE intake_run SET status='failed'");
  const failure = await monitorInstallation({ ...options, now: now + 2 });
  assert.equal(failure.changed, true);
  assert.ok(failure.issues.includes("intake_failed"));
});
