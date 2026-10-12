import Database from "better-sqlite3";
import {
  copyFile,
  mkdir,
  chmod,
  readFile,
  lstat,
  open,
  constants,
  writeFile,
} from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";

export async function backupRuntime(source, destination) {
  await mkdir(destination, { mode: 0o700 });
  const database = new Database(path.join(source, "auth.sqlite"), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    await database.backup(path.join(destination, "auth.sqlite"));
  } finally {
    database.close();
  }
  // The queue has its own SQLite WAL; use its online backup API as well.
  const intakePath = path.join(source, "intake.sqlite");
  const intakeMeta = await lstat(intakePath).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (intakeMeta) {
    if (!intakeMeta.isFile() || intakeMeta.isSymbolicLink())
      throw new Error("Unsafe intake database");
    const intake = new Database(intakePath, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      await intake.backup(path.join(destination, "intake.sqlite"));
    } finally {
      intake.close();
    }
    await chmod(path.join(destination, "intake.sqlite"), 0o600);
  }
  for (const name of ["auth-secret", "runtime.json"]) {
    await copyFile(path.join(source, name), path.join(destination, name));
    await chmod(path.join(destination, name), 0o600);
    if (
      !Buffer.from(await readFile(path.join(source, name))).equals(
        await readFile(path.join(destination, name)),
      )
    )
      throw new Error("Backup metadata mismatch");
  }
  await chmod(path.join(destination, "auth.sqlite"), 0o600);
  const restored = new Database(path.join(destination, "auth.sqlite"), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    if (restored.pragma("integrity_check", { simple: true }) !== "ok")
      throw new Error("Backup integrity check failed");
    const tables = restored
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => row.name);
    if (!tables.includes("user") || !tables.includes("reporadars_admin_grant"))
      throw new Error("Backup schema missing");
    return {
      directory: destination,
      integrity: "ok",
      users: restored.prepare("SELECT count(*) n FROM user").get().n,
    };
  } finally {
    restored.close();
  }
}

async function copyPrivate(source, destination) {
  const file = await open(
    source,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const meta = await file.stat();
    if (!meta.isFile() || meta.size > 65536 || meta.mode & 0o037)
      throw new Error("Unsafe private backup input");
    await writeFile(destination, await file.readFile(), {
      flag: "wx",
      mode: 0o600,
    });
  } finally {
    await file.close();
  }
}

export async function backupInstallation(
  { runtime, workerState, workerToken, mailConfig },
  destination,
) {
  const result = await backupRuntime(runtime, destination);
  const workerDir = path.join(destination, "worker");
  await mkdir(workerDir, { mode: 0o700 });
  const meta = await lstat(workerState);
  if (!meta.isFile() || meta.isSymbolicLink() || meta.mode & 0o077)
    throw new Error("Unsafe worker database");
  const jobs = new Database(workerState, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    await jobs.backup(path.join(workerDir, "jobs.sqlite"));
  } finally {
    jobs.close();
  }
  await chmod(path.join(workerDir, "jobs.sqlite"), 0o600);
  await copyPrivate(workerToken, path.join(workerDir, "service-token"));
  await copyPrivate(mailConfig, path.join(destination, "smtp.json"));
  const files = [
    "auth.sqlite",
    "auth-secret",
    "runtime.json",
    "smtp.json",
    "worker/jobs.sqlite",
    "worker/service-token",
  ];
  if (await lstat(path.join(destination, "intake.sqlite")).catch(() => null))
    files.push("intake.sqlite");
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    files: {},
  };
  for (const name of files) {
    const filename = path.join(destination, name);
    if (name.endsWith(".sqlite")) {
      const db = new Database(filename, {
        readonly: true,
        fileMustExist: true,
      });
      try {
        if (db.pragma("integrity_check", { simple: true }) !== "ok")
          throw new Error("Backup database is corrupt");
      } finally {
        db.close();
      }
    }
    manifest.files[name] = createHash("sha256")
      .update(await readFile(filename))
      .digest("hex");
  }
  await writeFile(
    path.join(destination, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  return {
    ...result,
    databases: files.filter((x) => x.endsWith(".sqlite")).length,
    complete: true,
  };
}

export async function verifyInstallationBackup(directory) {
  const manifest = JSON.parse(
    await readFile(path.join(directory, "manifest.json"), "utf8"),
  );
  const expected = [
    "auth.sqlite",
    "auth-secret",
    "runtime.json",
    "smtp.json",
    "worker/jobs.sqlite",
    "worker/service-token",
  ];
  if (
    manifest.version !== 1 ||
    !expected.every((name) => typeof manifest.files?.[name] === "string")
  )
    throw new Error("Incomplete backup manifest");
  for (const [name, hash] of Object.entries(manifest.files)) {
    if (![...expected, "intake.sqlite"].includes(name))
      throw new Error("Unknown backup file");
    const filename = path.join(directory, name),
      meta = await lstat(filename);
    if (!meta.isFile() || meta.isSymbolicLink() || meta.mode & 0o077)
      throw new Error("Unsafe backup file");
    if (
      createHash("sha256")
        .update(await readFile(filename))
        .digest("hex") !== hash
    )
      throw new Error("Backup checksum mismatch");
    if (name.endsWith(".sqlite")) {
      const db = new Database(filename, {
        readonly: true,
        fileMustExist: true,
      });
      try {
        if (db.pragma("integrity_check", { simple: true }) !== "ok")
          throw new Error("Backup integrity check failed");
      } finally {
        db.close();
      }
    }
  }
  return { complete: true, files: Object.keys(manifest.files).length };
}

// Recovery rehearsal always creates a new private directory; it cannot restore
// over a live runtime or delete old copies. Activation is a separate operation.
export async function restoreInstallationBackup(directory, destination) {
  await verifyInstallationBackup(directory);
  await mkdir(destination, { mode: 0o700 });
  await mkdir(path.join(destination, "worker"), { mode: 0o700 });
  const manifest = JSON.parse(
    await readFile(path.join(directory, "manifest.json"), "utf8"),
  );
  for (const name of Object.keys(manifest.files)) {
    const source = path.join(directory, name),
      target = path.join(destination, name);
    if (name.endsWith(".sqlite")) {
      const db = new Database(source, { readonly: true, fileMustExist: true });
      try {
        await db.backup(target);
      } finally {
        db.close();
      }
      await chmod(target, 0o600);
    } else await copyPrivate(source, target);
  }
  await copyPrivate(
    path.join(directory, "manifest.json"),
    path.join(destination, "manifest.json"),
  );
  return verifyInstallationBackup(destination);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.umask(0o077);
  if (process.getuid() !== 0)
    throw new Error("Run the scheduled backup as root");
  const stamp = new Date().toISOString().replaceAll(":", "-");
  backupInstallation(
    {
      runtime: "/var/lib/reporadars/runtime",
      workerState: "/var/lib/reporadars-intake/state/jobs.sqlite",
      workerToken: "/var/lib/reporadars-intake/service-token",
      mailConfig: "/var/lib/reporadars/smtp.json",
    },
    `/var/backups/reporadars/${stamp}`,
  )
    .then((result) => console.log(JSON.stringify(result)))
    .catch(() => {
      console.error("Reporadars backup failed; existing runtime retained.");
      process.exitCode = 1;
    });
}
