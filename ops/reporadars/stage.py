"""Create an isolated loopback HTTPS staging release; never touch production."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import shutil
import ssl
import subprocess
import time
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--release", required=True)
parser.add_argument("--with-intake", action="store_true")
args = parser.parse_args()
if os.getuid() != 0 or not re.fullmatch(r"[a-z0-9-]{1,80}", args.release):
    raise SystemExit("Root and a safe new release name are required")
checkout = Path(__file__).resolve().parents[2]
root = Path("/opt/reporadars-staging")
release = root / "releases" / args.release
runtime = Path("/var/lib/reporadars-staging") / args.release
unit = Path("/etc/systemd/system/reporadars-staging.service")
if release.exists() or runtime.exists():
    raise SystemExit("Staging release and runtime must be new")
if unit.exists() and "# Reporadars isolated staging" not in unit.read_text():
    raise SystemExit("Existing staging unit is not owned by this script")
if args.with_intake and not Path("/tmp/reporadars-radar-import").is_file():
    raise SystemExit("Build the verified scanner before staging intake")

def run(*command, **kwargs):
    subprocess.run(command, check=True, cwd=checkout, **kwargs)

user = "reporadars-staging"
try:
    account = pwd.getpwnam(user)
except KeyError:
    run("useradd", "--system", "--user-group", "--home-dir", "/var/lib/reporadars-staging", "--shell", "/usr/sbin/nologin", user)
    account = pwd.getpwnam(user)
if account.pw_uid == 0 or account.pw_dir != "/var/lib/reporadars-staging":
    raise SystemExit("Unexpected staging service account")
release.mkdir(parents=True, mode=0o755)
for name in ["server", "src", "runtime-web", "node_modules"]:
    shutil.copytree(checkout / name, release / name, symlinks=True,
                    ignore=lambda directory, names: [n for n in names if n == "cache" and Path(directory).name == ".next"])
for name in ["package.json", "package-lock.json"]:
    shutil.copy2(checkout / name, release / name)
if args.with_intake:
    (release / "bin").mkdir()
    shutil.copy2("/tmp/reporadars-radar-import", release / "bin/radar-import")
    os.chmod(release / "bin/radar-import", 0o755)
for directory, dirs, files in os.walk(release, followlinks=False):
    os.chmod(directory, 0o755)
    for name in files:
        filename = Path(directory) / name
        if not filename.is_symlink():
            os.chmod(filename, 0o644 | (filename.stat().st_mode & 0o111))
manifest = {}
for filename in sorted(release.rglob("*")):
    if filename.is_file() and not filename.is_symlink():
        manifest[str(filename.relative_to(release))] = hashlib.sha256(filename.read_bytes()).hexdigest()
(release / "release-manifest.json").write_text(json.dumps({
    "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "files": manifest,
}, sort_keys=True) + "\n")

runtime.parent.mkdir(exist_ok=True, mode=0o755)
os.chown(runtime.parent, account.pw_uid, account.pw_gid)
module = (release / "server/admin-runtime.mjs").as_uri()
code = f"const m=await import({json.dumps(module)}); await m.initializeAdminRuntime({{directory:{json.dumps(str(runtime))},origin:'https://localhost:4443'}});"
run("runuser", "-u", user, "--", "/usr/bin/node", "--input-type=module", "-e", code)
token = runtime / "intake-token"
fd = os.open(token, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as handle:
    handle.write(secrets.token_urlsafe(48) + "\n")
os.chown(token, account.pw_uid, account.pw_gid)
run("runuser", "-u", user, "--", "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", str(runtime / "tls-key.pem"), "-out", str(runtime / "tls-cert.pem"),
    "-days", "30", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost",
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for name in ["tls-key.pem", "tls-cert.pem"]:
    os.chmod(runtime / name, 0o600)

intake_units = []
if args.with_intake:
    worker = "reporadars-staging-intake"
    try:
        worker_account = pwd.getpwnam(worker)
    except KeyError:
        run("useradd", "--system", "--user-group", "--home-dir", "/var/lib/reporadars-staging-intake", "--shell", "/usr/sbin/nologin", worker)
        worker_account = pwd.getpwnam(worker)
    if worker_account.pw_uid == 0 or worker_account.pw_dir != "/var/lib/reporadars-staging-intake":
        raise SystemExit("Unexpected staging intake service account")
    run("usermod", "-a", "-G", worker, user)
    private_root = Path(worker_account.pw_dir)
    private_root.mkdir(exist_ok=True, mode=0o710)
    os.chown(private_root, 0, worker_account.pw_gid)
    private = private_root / args.release
    private.mkdir(mode=0o710)
    os.chown(private, 0, worker_account.pw_gid)
    worker_state = private / "state"
    worker_state.mkdir(mode=0o700)
    os.chown(worker_state, worker_account.pw_uid, worker_account.pw_gid)
    worker_token = private / "service-token"
    shutil.copy2(token, worker_token)
    os.chown(worker_token, 0, worker_account.pw_gid)
    os.chmod(worker_token, 0o640)
    certificate = private / "tls-cert.pem"
    shutil.copy2(runtime / "tls-cert.pem", certificate)
    os.chown(certificate, 0, worker_account.pw_gid)
    os.chmod(certificate, 0o640)
    settings_path = runtime / "runtime.json"
    settings = json.loads(settings_path.read_text())
    settings["intakeTokenFile"] = str(worker_token)
    settings_path.write_text(json.dumps(settings) + "\n")
    intake_service = f"""# Reporadars isolated staging
[Unit]
Description=Reporadars isolated staging GitHub intake
After=network-online.target reporadars-staging.service
Requires=reporadars-staging.service
[Service]
Type=oneshot
User={worker}
Group={worker}
WorkingDirectory={release}
Environment=NODE_ENV=production
Environment=NODE_EXTRA_CA_CERTS={certificate}
Environment=NODE_OPTIONS=--dns-result-order=ipv4first
Environment=INTAKE_SERVICE_ORIGIN=https://localhost:4443
Environment=INTAKE_STATE_PATH={worker_state}/jobs.sqlite
Environment=INTAKE_TOKEN_FILE={worker_token}
Environment=INTAKE_BINARY={release}/bin/radar-import
Environment=INTAKE_REPOSITORY_LIMIT=3
ExecStart=/usr/bin/node server/intake-worker.mjs
TimeoutStartSec=15min
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
InaccessiblePaths=/var/lib/reporadars/runtime /var/lib/reporadars/smtp.json /var/lib/reporadars-intake
ReadWritePaths={worker_state}
MemoryMax=384M
TasksMax=64
CapabilityBoundingSet=
"""
    intake_timer = """# Reporadars isolated staging
[Unit]
Description=Check scheduled and requested isolated staging imports
[Timer]
OnCalendar=*-*-* *:*:00 UTC
RandomizedDelaySec=15s
Persistent=true
Unit=reporadars-staging-intake.service
[Install]
WantedBy=timers.target
"""
    for name, content in [("reporadars-staging-intake.service", intake_service), ("reporadars-staging-intake.timer", intake_timer)]:
        target = Path("/etc/systemd/system") / name
        if target.exists() and "# Reporadars isolated staging" not in target.read_text():
            raise SystemExit("Foreign staging intake unit")
        intake_units.append((target, target.read_bytes() if target.exists() else None, content))

previous_unit = unit.read_bytes() if unit.exists() else None
unit.write_text(f"""# Reporadars isolated staging
[Unit]
Description=Reporadars isolated local HTTPS staging
After=network.target
[Service]
User={user}
Group={user}
WorkingDirectory={release}
Environment=NODE_ENV=production
Environment=STAGING_RUNTIME_DIR={runtime}
ExecStart=/usr/bin/node server/staging-start.mjs
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths={runtime}
MemoryMax=512M
TasksMax=64
Restart=on-failure
[Install]
WantedBy=multi-user.target
""")
try:
    for target, before, content in intake_units:
        target.write_text(content)
    run("systemctl", "daemon-reload")
    run("systemctl", "restart", "reporadars-staging.service")
    context = ssl.create_default_context(cafile=str(runtime / "tls-cert.pem"))
    healthy = False
    for attempt in range(30):
        try:
            with urllib.request.urlopen("https://localhost:4443/api/auth/session", context=context, timeout=2) as response:
                healthy = response.status == 200 and json.loads(response.read()).get("user") is None
            if healthy:
                break
        except Exception:
            pass
        time.sleep(0.5)
    if not healthy:
        raise RuntimeError("Staging health check failed")
    with urllib.request.urlopen("https://localhost:4443/ru/skills", context=context, timeout=10) as response:
        if response.status != 200 or b"__NEXT_DATA__" not in response.read():
            raise RuntimeError("Staging Next.js rendering failed")
    if args.with_intake:
        run("systemctl", "enable", "--now", "reporadars-staging-intake.timer")
except Exception:
    for target, before, content in intake_units:
        if before is None:
            target.unlink(missing_ok=True)
        else:
            target.write_bytes(before)
    if previous_unit:
        unit.write_bytes(previous_unit)
        run("systemctl", "daemon-reload")
        run("systemctl", "restart", "reporadars-staging.service")
    else:
        run("systemctl", "stop", "reporadars-staging.service")
    raise
print(json.dumps({"release": str(release), "runtime": str(runtime),
                  "origin": "https://localhost:4443", "health": "ok", "mail": "private local capture"}))
