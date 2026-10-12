import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stagingOrigin, captureStagingMail } from "../../server/staging-start.mjs";

test("staging refuses public origins and privileged/ambiguous endpoints", () => {
  assert.equal(stagingOrigin("https://localhost:4443"), 4443);
  for (const value of ["https://reporadars.com", "http://localhost:4443",
    "https://localhost:443", "https://localhost:4443/path", "https://user@localhost:4443",
    "https://localhost:4443/?x=1", "https://127.0.0.1:4443"])
    assert.throws(() => stagingOrigin(value));
});

test("staging captures mail privately without sending or accepting public login links", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "rr-stage-mail-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const send = captureStagingMail(dir, "https://localhost:4443");
  await send({ to: "tester@example.test", url: "https://localhost:4443/login?token=fixture", locale: "ru" });
  await assert.rejects(send({ to: "tester@example.test", url: "https://reporadars.com/login?token=fixture" }));
  const files = await readdir(dir);
  assert.equal(files.length, 1);
  assert.equal((await lstat(join(dir, files[0]))).mode & 0o077, 0);
  assert.equal(JSON.parse(await readFile(join(dir, files[0]), "utf8")).locale, "ru");
});
