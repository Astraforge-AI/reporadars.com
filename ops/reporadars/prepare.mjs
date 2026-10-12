// Explicit first activation only. Never overwrites a release, runtime, or current link.
import {
  cpSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  chownSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { backupRuntime } from "./backup.mjs";

if (process.getuid() !== 0) throw new Error("Run explicit preparation as root");
process.umask(0o077);
const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const root = "/opt/reporadars";
const release = `${root}/releases/20260907-email-admin-v1`;
const state = "/var/lib/reporadars";
const sourceRuntime = "/home/debian/.local/share/reporadars-admin-staging";
const initialBackup = "/var/backups/reporadars/before-activation-20260907";
for (const target of [release, state, `${root}/current`, initialBackup])
  if (existsSync(target)) throw new Error(`Target already exists: ${target}`);
execFileSync("/usr/bin/test", [
  "-f",
  path.join(repo, "server/production-start.mjs"),
]);
execFileSync("/usr/bin/test", [
  "-f",
  path.join(repo, "dist/reporadars.worker.mjs"),
]);
try {
  execFileSync("/usr/bin/id", ["reporadars"], { stdio: "ignore" });
} catch {
  execFileSync("/usr/sbin/useradd", [
    "--system",
    "--user-group",
    "--home-dir",
    state,
    "--no-create-home",
    "--shell",
    "/usr/sbin/nologin",
    "reporadars",
  ]);
}
const uid = Number(
  execFileSync("/usr/bin/id", ["-u", "reporadars"], {
    encoding: "utf8",
  }).trim(),
);
const gid = Number(
  execFileSync("/usr/bin/id", ["-g", "reporadars"], {
    encoding: "utf8",
  }).trim(),
);
mkdirSync(`${root}/releases`, { recursive: true, mode: 0o755 });
chmodSync(root, 0o755);
chmodSync(`${root}/releases`, 0o755);
mkdirSync(release, { mode: 0o755 });
for (const directory of ["server", "scripts", "ops", "node_modules"])
  cpSync(path.join(repo, directory), path.join(release, directory), {
    recursive: true,
    errorOnExist: true,
    force: false,
    verbatimSymlinks: true,
  });
for (const name of ["package.json", "package-lock.json"])
  copyFileSync(path.join(repo, name), path.join(release, name));
mkdirSync(path.join(release, "dist"), { mode: 0o755 });
copyFileSync(
  path.join(repo, "dist/reporadars.worker.mjs"),
  path.join(release, "dist/reporadars.worker.mjs"),
);
execFileSync("/usr/bin/chown", ["-R", "root:root", release]);
execFileSync("/usr/bin/chmod", ["-R", "u=rwX,go=rX", release]);
function assertContainedLinks(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const resolved = realpathSync(target);
      if (!resolved.startsWith(`${release}/`))
        throw new Error("Release symlink escapes immutable snapshot");
    } else if (entry.isDirectory()) assertContainedLinks(target);
  }
}
assertContainedLinks(release);
mkdirSync("/var/backups/reporadars", { recursive: true, mode: 0o700 });
const backup = await backupRuntime(sourceRuntime, initialBackup);
mkdirSync(state, { mode: 0o755 });
chmodSync(state, 0o755);
const runtime = path.join(state, "runtime");
mkdirSync(runtime, { mode: 0o700 });
chownSync(runtime, uid, gid);
for (const name of ["auth.sqlite", "auth-secret", "runtime.json"]) {
  const target = path.join(runtime, name);
  copyFileSync(path.join(initialBackup, name), target);
  chmodSync(target, 0o600);
  chownSync(target, uid, gid);
}
const smtp = path.join(state, "smtp.json");
copyFileSync("/etc/reporadars/noreply-smtp.json", smtp);
chmodSync(smtp, 0o600);
chownSync(smtp, uid, gid);
const workerSha256 = createHash("sha256")
  .update(readFileSync(path.join(release, "dist/reporadars.worker.mjs")))
  .digest("hex");
const manifest = {
  release,
  createdAt: new Date().toISOString(),
  workerSha256,
  previousWorkerVersion: "e76a370a-adec-4043-96c8-e9704b8f627b",
  previousWorkerRelease: "c75e3e935ba9",
  runtime,
  backup: backup.directory,
};
writeFileSync(
  path.join(release, "activation-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
  { flag: "wx", mode: 0o644 },
);
symlinkSync(release, `${root}/current`);
console.log(JSON.stringify({ ...manifest, activated: false }));
