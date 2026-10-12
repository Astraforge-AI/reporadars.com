import Database from "better-sqlite3";
import { realpathSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
  statfs,
  chmod,
} from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyInstallationBackup } from "./backup.mjs";

export function operationalIssues({
  healthy,
  databaseHealthy = true,
  queueHealthy = true,
  paused,
  intervalHours,
  lastRunAt,
  lastRunStatus,
  pendingSince,
  backupAt,
  backupValid,
  freeBytes,
  now = Date.now(),
}) {
  const issues = [];
  if (!healthy) issues.push("origin_unavailable");
  if (!databaseHealthy) issues.push("database_unavailable");
  if (!queueHealthy) issues.push("queue_unavailable");
  if (
    !paused &&
    (!lastRunAt || now - lastRunAt > (intervalHours + 2) * 3600000)
  )
    issues.push("intake_stale");
  if (!paused && lastRunStatus === "failed") issues.push("intake_failed");
  if (
    !paused &&
    pendingSince &&
    now - pendingSince > Math.max(intervalHours + 2, 26) * 3600000
  )
    issues.push("queue_stalled");
  if (!backupValid || !backupAt || now - backupAt > 30 * 3600000)
    issues.push("backup_stale_or_invalid");
  if (freeBytes === null) issues.push("disk_unavailable");
  else if (freeBytes < 1024 * 1024 * 1024) issues.push("disk_low");
  return issues;
}

export async function monitorInstallation({
  runtime = "/var/lib/reporadars/runtime",
  workerState = "/var/lib/reporadars-intake/state/jobs.sqlite",
  backups = "/var/backups/reporadars",
  state = "/var/lib/reporadars-monitor/state.json",
  fetchImpl = fetch,
  now = Date.now(),
} = {}) {
  let databaseHealthy = true,
    queueHealthy = true;
  let healthy = false,
    paused = false,
    intervalHours = 24,
    lastRunAt = 0,
    lastRunStatus = "unknown",
    pendingSince = 0,
    backupAt = 0,
    backupValid = false;
  try {
    const response = await fetchImpl("http://127.0.0.1:4320/api/health", {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers: { "X-Reporadars-Client-IP": "127.0.0.1" },
    });
    healthy = response.ok && (await response.json()).status === "ok";
  } catch {
    /* Diagnosed by the issue code, without logging request secrets. */
  }
  let intake;
  try {
    intake = new Database(join(runtime, "intake.sqlite"), {
      readonly: true,
      fileMustExist: true,
    });
    const control = intake
      .prepare("SELECT paused,interval_hours FROM intake_control WHERE id=1")
      .get();
    paused = Boolean(control.paused);
    intervalHours = control.interval_hours;
    const run = intake
      .prepare(
        "SELECT finished_at,status FROM intake_run ORDER BY finished_at DESC LIMIT 1",
      )
      .get();
    lastRunAt = run?.finished_at || 0;
    lastRunStatus = run?.status || "unknown";
  } catch {
    databaseHealthy = false;
  } finally {
    intake?.close();
  }
  let jobs;
  try {
    jobs = new Database(workerState, { readonly: true, fileMustExist: true });
    pendingSince =
      jobs
        .prepare(
          "SELECT min(updated_at) AS oldest FROM job WHERE state IN ('queued','failed','running')",
        )
        .get()?.oldest || 0;
  } catch {
    queueHealthy = false;
  } finally {
    jobs?.close();
  }
  const names = (await readdir(backups).catch(() => []))
    .filter((name) => /^\d{4}-\d{2}-\d{2}T[0-9:.-]+Z$/.test(name))
    .sort();
  if (names.length) {
    const latest = join(backups, names.at(-1));
    try {
      const manifest = JSON.parse(
        await readFile(join(latest, "manifest.json"), "utf8"),
      );
      backupAt = Date.parse(manifest.createdAt) || 0;
      backupValid = (await verifyInstallationBackup(latest)).complete === true;
    } catch {
      /* Incomplete/corrupt backup is an operational issue. */
    }
  }
  const disk = await statfs(runtime).catch(() => null);
  const freeBytes = disk ? disk.bavail * disk.bsize : null;
  const snapshot = {
    schemaVersion: 1,
    checkedAt: now,
    healthy,
    databaseHealthy,
    queueHealthy,
    paused,
    intervalHours,
    lastRunAt,
    lastRunStatus,
    backupAt,
    backupValid,
    freeBytes,
    issues: operationalIssues({
      healthy,
      databaseHealthy,
      queueHealthy,
      paused,
      intervalHours,
      lastRunAt,
      lastRunStatus,
      pendingSince,
      backupAt,
      backupValid,
      freeBytes,
      now,
    }),
  };
  const directory = join(state, "..");
  await mkdir(directory, { recursive: true, mode: 0o750 });
  let previous;
  try {
    previous = JSON.parse(await readFile(state, "utf8"));
  } catch {
    /* First observation. */
  }
  const temporary = state + ".next";
  await writeFile(temporary, JSON.stringify(snapshot) + "\n", { mode: 0o640 });
  await chmod(temporary, 0o640);
  await rename(temporary, state);
  const changed =
    JSON.stringify(previous?.issues) !== JSON.stringify(snapshot.issues);
  return { ...snapshot, changed };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  process.umask(0o027);
  monitorInstallation()
    .then((result) => {
      if (result.changed)
        console.log(JSON.stringify({ event: "operations_changed", ...result }));
      if (result.issues.length) process.exitCode = 1;
    })
    .catch(() => {
      console.error(
        JSON.stringify({
          event: "monitor_failed",
          code: "MONITOR_UNAVAILABLE",
        }),
      );
      process.exitCode = 1;
    });
}
