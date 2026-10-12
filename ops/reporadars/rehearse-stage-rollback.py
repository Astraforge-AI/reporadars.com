"""Exercise startup/HTTP failures only on the dedicated staging service."""
import hashlib
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import time
import urllib.error
import urllib.request

if os.getuid() != 0:
    raise SystemExit("Run the isolated staging rehearsal as root")
unit = Path("/etc/systemd/system/reporadars-staging.service")
before = unit.read_bytes()
if b"# Reporadars isolated staging" not in before:
    raise SystemExit("Expected our isolated staging unit")
runtime = Path(re.search(rb"STAGING_RUNTIME_DIR=([^\n]+)", before)[1].decode())
if not runtime.resolve().is_relative_to(Path("/var/lib/reporadars-staging")):
    raise SystemExit("Staging runtime must be isolated")
if subprocess.run(["systemctl", "is-active", "--quiet", "reporadars-staging-intake.service"]).returncode == 0:
    raise SystemExit("Wait for the staging intake job to finish before rehearsing")
dropdir = Path("/run/systemd/system/reporadars-staging.service.d")
dropin = dropdir / "rehearsal.conf"
scratch = Path("/run/reporadars-staging-rehearsal")
if dropin.exists() or scratch.exists():
    raise SystemExit("Unexpected existing rehearsal files")
dropdir.mkdir(parents=True, exist_ok=True)
scratch.mkdir(mode=0o755)
script = scratch / "http-failure.mjs"
script.write_text('''import { createServer } from "node:https";
import { readFileSync } from "node:fs";
const dir=process.env.STAGING_RUNTIME_DIR;
createServer({key:readFileSync(dir+"/tls-key.pem"),cert:readFileSync(dir+"/tls-cert.pem")},(req,res)=>{res.writeHead(503);res.end("Rehearsal failure");}).listen(4443,"127.0.0.1");
''')
os.chmod(script, 0o644)
context = ssl.create_default_context(cafile=str(runtime / "tls-cert.pem"))
timer_active = subprocess.run(["systemctl", "is-active", "--quiet", "reporadars-staging-intake.timer"]).returncode == 0
def run(*command):
    return subprocess.run(command, check=True, stdout=subprocess.DEVNULL)
def status():
    try:
        with urllib.request.urlopen("https://localhost:4443/api/health", context=context, timeout=2) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code
    except Exception:
        return 0
def wait_status(expected):
    for _ in range(40):
        if status() == expected:
            return
        time.sleep(.25)
    raise RuntimeError("Rehearsal HTTP state did not converge")
results = []
try:
    if timer_active:
        run("systemctl", "stop", "reporadars-staging-intake.timer")
    for failure, filename in [("startup", scratch / "missing.mjs"), ("health", script)]:
        try:
            dropin.write_text(f"[Service]\nExecStart=\nExecStart=/usr/bin/node {filename}\nRestart=no\n")
            run("systemctl", "daemon-reload")
            run("systemctl", "restart", "reporadars-staging.service")
            if failure == "startup":
                failed = False
                for _ in range(40):
                    failed = subprocess.run(["systemctl", "is-failed", "--quiet", "reporadars-staging.service"]).returncode == 0
                    if failed: break
                    time.sleep(.1)
                if not failed: raise RuntimeError("Expected an actual startup failure")
            wait_status(0 if failure == "startup" else 503)
        finally:
            dropin.unlink(missing_ok=True)
            run("systemctl", "daemon-reload")
            run("systemctl", "restart", "reporadars-staging.service")
            wait_status(200)
        results.append({"failure": failure, "restoredStatus": 200, "databaseRollback": False})
    if unit.read_bytes() != before:
        raise RuntimeError("Persistent staging configuration changed")
finally:
    dropin.unlink(missing_ok=True)
    script.unlink(missing_ok=True)
    scratch.rmdir()
    if timer_active:
        run("systemctl", "restart", "reporadars-staging-intake.timer")
print(json.dumps({"scope": "isolated staging", "configurationSha256": hashlib.sha256(before).hexdigest(), "checks": results}))
