import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRepository,
  normalizeSourceURL,
} from "../../server/github-source.mjs";
test("GitHub aliases share one root while refs, credentials, encoded paths and traversal are rejected", () => {
  for (const url of [
    "https://github.com/Owner/Repo",
    "https://github.com/owner/repo.git",
    "https://github.com/OWNER/REPO/",
  ])
    assert.equal(normalizeRepository(url), "https://github.com/owner/repo");
  for (const url of [
    "http://github.com/a/b",
    "https://token@github.com/a/b",
    "https://github.com/a/b?ref=main",
    "https://github.com/a/b/tree/main",
    "https://github.com/a/x/../b",
    "https://github.com/a/%62",
    "https://github.com.evil.test/a/b",
  ])
    assert.throws(() => normalizeRepository(url));
  assert.equal(
    normalizeSourceURL("https://github.com/Owner/Repo/blob/abc/Case/SKILL.md"),
    "https://github.com/owner/repo/blob/abc/Case/SKILL.md",
  );
});
