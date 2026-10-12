import test from "node:test";
import assert from "node:assert/strict";
import { repositoryLinks } from "../../server/discovery.mjs";
test("README discovery is bounded, deduplicated, public GitHub only and one level deep", () => {
  const text =
    "[one](https://github.com/owner/skills/tree/main) https://github.com/OWNER/skills https://github.com/other/bundle.git http://127.0.0.1/private https://evil.test/a/b https://github.com/topics/skills";
  assert.deepEqual(repositoryLinks(text), [
    "https://github.com/owner/skills",
    "https://github.com/other/bundle",
  ]);
  assert.equal(repositoryLinks(text, 1).length, 1);
  assert.throws(() => repositoryLinks("x".repeat(512 * 1024 + 1)), /budget/);
});
