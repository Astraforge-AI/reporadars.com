"""Explicit, reversible origin activation; keeps old releases and runtime data."""
import argparse
import datetime
import grp
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import shutil
import subprocess
import time
import urllib.request
from release_support import unit_snapshot, restore_unit, release_manifest

parser = argparse.ArgumentParser()
parser.add_argument("--release", required=True)
parser.add_argument("--activate", action="store_true", required=True)
args = parser.parse_args()
if os.getuid() != 0 or not re.fullmatch(r"[a-z0-9-]{1,80}", args.release):
    raise SystemExit("Root and a safe release name are required")
checkout = Path(__file__).resolve().parents[2]
release = Path("/opt/reporadars/releases") / args.release
operation = Path("/opt/reporadars/operations") / args.release
current = Path("/opt/reporadars/current")
previous = current.resolve(strict=True)
if previous.parent != Path("/opt/reporadars/releases"):
    raise SystemExit("Active release must be in the managed release directory")
nginx = Path("/etc/nginx/conf.d/reporadars.conf")
config = nginx.read_text()
pattern = r"location /\s*\{\s*return 404;\s*\}"
if release.exists() or operation.exists():
    raise SystemExit("Release and operation must be new")
proxy = """location / {
        proxy_pass http://127.0.0.1:4320;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Reporadars-Client-IP $remote_addr;
        proxy_set_header X-Forwarded-For "";
        proxy_set_header X-Forwarded-Host "";
        proxy_set_header X-Forwarded-Proto "";
        proxy_set_header Forwarded "";
        proxy_set_header Connection "";
        proxy_connect_timeout 3s;
        proxy_read_timeout 30s;
        proxy_send_timeout 30s;
        add_header X-Content-Type-Options nosniff always;
    }"""
if len(re.findall(pattern, config)) != 1 and config.count(proxy) != 1:
    raise SystemExit("Expected existing origin fallback or exact Next proxy was not found")
unit_names = ["reporadars-intake.service", "reporadars-intake.timer", "reporadars-monitor.service", "reporadars-monitor.timer"]
unit_before = {name: unit_snapshot(Path("/etc/systemd/system") / name,
    checkout / "ops/reporadars" / name, previous / "ops/reporadars" / name) for name in unit_names}
dropdir = Path("/etc/systemd/system/reporadars.service.d")
dropin = dropdir / "next-catalog.conf"
previous_dropin = unit_snapshot(dropin, checkout / "ops/reporadars/next-catalog.conf", previous / "ops/reporadars/next-catalog.conf")
timer_active = subprocess.run(["systemctl", "is-active", "--quiet", "reporadars-intake.timer"]).returncode == 0
monitor_active = subprocess.run(["systemctl", "is-active", "--quiet", "reporadars-monitor.timer"]).returncode == 0
if not Path("/tmp/reporadars-radar-import").is_file():
    raise SystemExit("Build the verified importer binary before activation")

def run(*command):
    subprocess.run(command, check=True, cwd=checkout)

# A tested online SQLite backup, including WAL commits, precedes any activation.
backup_root = Path("/var/backups/reporadars")
if not backup_root.exists():
    backup_root.mkdir(mode=0o700)
run("/usr/bin/node", "ops/reporadars/backup.mjs")
operation.mkdir(mode=0o700)
shutil.copy2(nginx, operation / "nginx.before.conf")
(operation / "previous-release").write_text(str(previous) + "\n")
for name, before in unit_before.items():
    if before is not None:
        (operation / (name + ".before")).write_bytes(before)
if previous_dropin is not None:
    (operation / "next-catalog.conf.before").write_bytes(previous_dropin)
release.mkdir(mode=0o755)
for name in ["server", "src", "runtime-web", "node_modules", "ops"]:
    shutil.copytree(checkout / name, release / name, symlinks=True,
                    ignore=lambda directory, names: [n for n in names if n == "__pycache__" or n.endswith(".pyc") or (n == "cache" and Path(directory).name == ".next")])
for name in ["package.json", "package-lock.json"]:
    shutil.copy2(checkout / name, release / name)
(release / "scripts").mkdir()
shutil.copy2(checkout / "scripts/runtime-worker.mjs", release / "scripts/runtime-worker.mjs")
# Preserve the scanner's exact source without including generated intake data.
(release / "importer").mkdir()
for name in ["cmd", "internal"]:
    shutil.copytree(checkout / "importer" / name, release / "importer" / name)
for name in ["go.mod", "go.sum"]:
    shutil.copy2(checkout / "importer" / name, release / "importer" / name)
(release / "bin").mkdir()
shutil.copy2("/tmp/reporadars-radar-import", release / "bin/radar-import")
os.chmod(release / "bin/radar-import", 0o755)
# Shipped source and dependencies are public code; private runtime lives outside
# the release. Normalize access independently of the checkout's private folders.
for directory, dirs, files in os.walk(release, followlinks=False):
    os.chmod(directory, 0o755)
    for name in files:
        filename = Path(directory) / name
        if not filename.is_symlink():
            os.chmod(filename, 0o644 | (filename.stat().st_mode & 0o111))
# Verify the copied dependency graph as the service user, before activation.
manifest_sha256 = release_manifest(release)
run("runuser", "-u", "reporadars", "--", "env", "NODE_ENV=production", "/usr/bin/node", "--input-type=module", "-e",
    f"await import({json.dumps((release / 'server/production-start.mjs').as_uri())}); console.log('Release module graph verified')")

worker = "reporadars-intake"
try:
    account = pwd.getpwnam(worker)
except KeyError:
    run("useradd", "--system", "--user-group", "--home-dir", "/var/lib/reporadars-intake", "--shell", "/usr/sbin/nologin", worker)
    account = pwd.getpwnam(worker)
if account.pw_uid == 0 or account.pw_dir != "/var/lib/reporadars-intake":
    raise SystemExit("Existing intake account does not match dedicated service account")
group = grp.getgrnam(worker).gr_gid
private = Path("/var/lib/reporadars-intake")
private.mkdir(exist_ok=True)
os.chown(private, 0, group)
os.chmod(private, 0o710)
state = private / "state"
state.mkdir(exist_ok=True)
os.chown(state, account.pw_uid, group)
os.chmod(state, 0o700)
token = private / "service-token"
if not token.exists():
    fd = os.open(token, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o640)
    with os.fdopen(fd, "w") as handle:
        handle.write(secrets.token_urlsafe(48) + "\n")
    os.chown(token, 0, group)
    os.chmod(token, 0o640)
else:
    meta = token.lstat()
    if token.is_symlink() or meta.st_uid != 0 or meta.st_gid != group or meta.st_mode & 0o137:
        raise SystemExit("Existing intake credential has unsafe permissions")

dropdir.mkdir(exist_ok=True)
monitor_state = Path("/var/lib/reporadars-monitor")
monitor_state.mkdir(exist_ok=True, mode=0o750)
os.chown(monitor_state, 0, pwd.getpwnam("reporadars").pw_gid)
os.chmod(monitor_state, 0o750)
try:
    run("systemctl", "stop", "reporadars-intake.timer", "reporadars-intake.service")
    shutil.copy2(checkout / "ops/reporadars/next-catalog.conf", dropin)
    for name in unit_names:
        shutil.copy2(checkout / "ops/reporadars" / name, Path("/etc/systemd/system") / name)
    nginx.write_text(re.sub(pattern, proxy, config))
    run("nginx", "-t")
    staged = current.with_name("current-next")
    if staged.exists() or staged.is_symlink():
        raise RuntimeError("Unexpected staged symlink")
    staged.symlink_to(release)
    os.replace(staged, current)
    run("systemctl", "daemon-reload")
    run("systemctl", "restart", "reporadars.service")
    ready = False
    for attempt in range(40):
        try:
            request = urllib.request.Request("http://127.0.0.1:4320/api/auth/session", headers={"X-Reporadars-Client-IP": "127.0.0.1"})
            with urllib.request.urlopen(request, timeout=2) as response:
                ready = response.status == 200 and json.loads(response.read()).get("user") is None
            if ready:
                break
        except Exception:
            pass
        time.sleep(0.25)
    if not ready:
        raise RuntimeError("Origin failed the anonymous session health check")
    with urllib.request.urlopen("http://127.0.0.1:4320/skills", timeout=15) as response:
        if response.status != 200 or b"__NEXT_DATA__" not in response.read():
            raise RuntimeError("Origin failed the Next.js catalog health check")
    run("systemctl", "reload", "nginx")
    run("systemctl", "is-active", "reporadars.service")
    if timer_active:
        run("systemctl", "restart", "reporadars-intake.timer")
    run("systemctl", "enable", "--now", "reporadars-monitor.timer")
except Exception:
    run("systemctl", "stop", "reporadars-monitor.timer", "reporadars-monitor.service")
    rollback = current.with_name("current-rollback")
    rollback.symlink_to(previous)
    os.replace(rollback, current)
    shutil.copy2(operation / "nginx.before.conf", nginx)
    restore_unit(dropin, previous_dropin)
    for name, before in unit_before.items():
        restore_unit(Path("/etc/systemd/system") / name, before)
    run("systemctl", "daemon-reload")
    run("systemctl", "restart", "reporadars.service")
    run("nginx", "-t")
    run("systemctl", "reload", "nginx")
    if timer_active:
        run("systemctl", "restart", "reporadars-intake.timer")
    if monitor_active:
        run("systemctl", "restart", "reporadars-monitor.timer")
    raise

manifest = {"release": str(release), "previous": str(previous), "operation": str(operation), "activatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "scannerSha256": hashlib.sha256((release / "bin/radar-import").read_bytes()).hexdigest(), "manifestSha256": manifest_sha256, "cloudflare": "pending", "timer": "active" if timer_active else "prepared"}
(operation / "activation.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps(manifest))
