import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createGitHubClient,
  readGitHubCredential,
} from "../../server/github-client.mjs";

test("GitHub cooldown survives retries and credentials stay on the API request", async () => {
  const now = 1700000000000;
  let until = 0,
    calls = 0;
  const get = createGitHubClient({
    token: "isolated-test-github-token",
    clock: () => now,
    readCooldown: () => until,
    saveCooldown: (value) => {
      until = value;
    },
    fetcher: async (url, options) => {
      calls++;
      assert.equal(new URL(url).hostname, "api.github.com");
      assert.equal(options.redirect, "error");
      assert.equal(
        options.headers.Authorization,
        "Bearer isolated-test-github-token",
      );
      return new Response("", {
        status: 403,
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String((now + 3600000) / 1000),
        },
      });
    },
  });
  await assert.rejects(get("/search/repositories"), /rate limited/);
  assert.equal(until, now + 3600000);
  await assert.rejects(get("/search/repositories"), /cooldown/);
  await assert.rejects(get("//evil.test"), /Invalid/);
  assert.equal(calls, 1);
});

test("GitHub credential files refuse public permissions and symlinks", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "rr-github-credential-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "token"),
    link = join(dir, "link");
  await writeFile(file, "isolated-test-github-token\n", { mode: 0o600 });
  assert.equal(await readGitHubCredential(file), "isolated-test-github-token");
  await symlink(file, link);
  await assert.rejects(readGitHubCredential(link));
  await chmod(file, 0o644);
  await assert.rejects(readGitHubCredential(file), /private/);
});
