import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("relative production launcher from a release symlink reports safe configuration failure", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "rr-production-entry-"));
  const current = path.join(directory, "current");
  await symlink(process.cwd(), current, "dir");
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["server/production-start.mjs"], {
        cwd: current,
        env: { PATH: process.env.PATH, AUTH_MODE: "invalid" },
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      child.once("error", reject);
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("close", (code, signal) => resolve({ code, signal, stderr }));
    });
    assert.equal(result.signal, null);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /^Production startup failed; check private runtime and SMTP configuration\.\n$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
