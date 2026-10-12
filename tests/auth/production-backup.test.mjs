import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  lstat,
  rm,
  chmod,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import {
  backupRuntime,
  backupInstallation,
  verifyInstallationBackup,
  restoreInstallationBackup,
} from "../../ops/reporadars/backup.mjs";

test("online backup includes committed WAL data, preserves metadata, and refuses overwrite", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "rr-backup-test-"));
  const source = path.join(parent, "source");
  await mkdir(source, { mode: 0o700 });
  const db = new Database(path.join(source, "auth.sqlite"));
  try {
    db.pragma("journal_mode=WAL");
    db.exec(
      "CREATE TABLE user(id TEXT PRIMARY KEY,email TEXT); CREATE TABLE reporadars_admin_grant(user_id TEXT,state TEXT)",
    );
    db.prepare("INSERT INTO user VALUES(?,?)").run(
      "original-id",
      "fixture@example.test",
    );
    db.prepare("INSERT INTO reporadars_admin_grant VALUES(?,?)").run(
      "original-id",
      "pending",
    );
    await writeFile(
      path.join(source, "auth-secret"),
      "isolated-test-secret-not-production\n",
      { mode: 0o600 },
    );
    await writeFile(
      path.join(source, "runtime.json"),
      JSON.stringify({
        version: 1,
        environment: "staging",
        origin: "https://example.test",
      }),
      { mode: 0o600 },
    );
    const destination = path.join(parent, "backup");
    const result = await backupRuntime(source, destination);
    assert.equal(result.integrity, "ok");
    assert.equal(result.users, 1);
    const restored = new Database(path.join(destination, "auth.sqlite"), {
      readonly: true,
    });
    try {
      assert.equal(
        restored
          .prepare("SELECT state FROM reporadars_admin_grant WHERE user_id=?")
          .get("original-id").state,
        "pending",
      );
      assert.equal(restored.pragma("integrity_check", { simple: true }), "ok");
    } finally {
      restored.close();
    }
    for (const file of ["auth-secret", "runtime.json"])
      assert.deepEqual(
        await readFile(path.join(destination, file)),
        await readFile(path.join(source, file)),
      );
    for (const file of ["auth.sqlite", "auth-secret", "runtime.json"])
      assert.equal((await lstat(path.join(destination, file))).mode & 0o077, 0);
    await assert.rejects(backupRuntime(source, destination), {
      code: "EEXIST",
    });
  } finally {
    db.close();
    await rm(parent, { recursive: true, force: true });
  }
});

test("complete installation backup restores all three WAL databases and private settings into a new directory", async (t) => {
  const parent = await mkdtemp(path.join(tmpdir(), "rr-full-backup-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const runtime = path.join(parent, "runtime"),
    worker = path.join(parent, "worker");
  await mkdir(runtime, { mode: 0o700 });
  await mkdir(worker, { mode: 0o700 });
  const databases = [];
  for (const [file, sql] of [
    [
      path.join(runtime, "auth.sqlite"),
      "CREATE TABLE user(id TEXT); CREATE TABLE reporadars_admin_grant(user_id TEXT); INSERT INTO user VALUES('fixture');",
    ],
    [
      path.join(runtime, "intake.sqlite"),
      "CREATE TABLE candidate(id TEXT); INSERT INTO candidate VALUES('queued-fixture');",
    ],
    [
      path.join(worker, "jobs.sqlite"),
      "CREATE TABLE job(id TEXT,state TEXT); INSERT INTO job VALUES('fixture-job','complete');",
    ],
  ]) {
    const db = new Database(file);
    db.pragma("journal_mode=WAL");
    db.exec(sql);
    await chmod(file,0o600);
    databases.push(db);
  }
  t.after(() => {
    for (const db of databases) db.close();
  });
  for (const [file, value] of [
    [path.join(runtime, "auth-secret"), "isolated-backup-fixture-secret"],
    [path.join(runtime, "runtime.json"), '{"environment":"fixture"}'],
    [path.join(worker, "service-token"), "isolated-fixture-token"],
    [path.join(parent, "smtp.json"), '{"host":"fixture.example.test"}'],
  ])
    await writeFile(file, value, { mode: 0o600 });
  const backup = path.join(parent, "backup"),
    restored = path.join(parent, "restored");
  const result = await backupInstallation(
    {
      runtime,
      workerState: path.join(worker, "jobs.sqlite"),
      workerToken: path.join(worker, "service-token"),
      mailConfig: path.join(parent, "smtp.json"),
    },
    backup,
  );
  assert.equal(result.databases, 3);
  assert.equal(result.complete, true);
  assert.equal((await verifyInstallationBackup(backup)).files, 7);
  assert.equal(
    (await restoreInstallationBackup(backup, restored)).complete,
    true,
  );
  const jobs = new Database(path.join(restored, "worker/jobs.sqlite"), {
    readonly: true,
  });
  try {
    assert.equal(jobs.prepare("SELECT state FROM job").get().state, "complete");
  } finally {
    jobs.close();
  }
  await assert.rejects(restoreInstallationBackup(backup, restored), {
    code: "EEXIST",
  });
  await writeFile(path.join(backup, "auth-secret"), "corrupt fixture");
  await assert.rejects(verifyInstallationBackup(backup), /checksum/);
});
