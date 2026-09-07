import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyWorkspace,
  normalizeWorkspace,
  readWorkspace,
  writeWorkspace,
  WORKSPACE_KEY,
} from "../src/workspace-store.js";
test("workspace validates persisted shape, allowed IDs, lengths, avatar and duplicates", () => {
  const value = normalizeWorkspace(
    {
      version: 1,
      profile: {
        name: " A ".repeat(40),
        role: null,
        bio: 42,
        avatar: "javascript:alert(1)",
      },
      savedIds: ["seo-audit", "seo-audit", "unknown", null],
    },
    ["seo-audit"],
  );
  assert.equal(value.profile.name.length, 40);
  assert.equal(value.profile.role, emptyWorkspace.profile.role);
  assert.equal(value.profile.avatar, "radar");
  assert.deepEqual(value.savedIds, ["seo-audit"]);
  assert.deepEqual(normalizeWorkspace({ version: 2 }, []), emptyWorkspace);
});
test("reads and writes only the owned storage key; corrupted/quota storage is explicit", () => {
  const data = new Map();
  const storage = {
    getItem: (key) => data.get(key),
    setItem: (key, value) => data.set(key, value),
  };
  assert.deepEqual(readWorkspace(storage, ["seo-audit"]).value, emptyWorkspace);
  writeWorkspace(storage, { ...emptyWorkspace, savedIds: ["seo-audit"] }, [
    "seo-audit",
  ]);
  assert.deepEqual([...data.keys()], [WORKSPACE_KEY]);
  assert.deepEqual(readWorkspace(storage, ["seo-audit"]).value.savedIds, [
    "seo-audit",
  ]);
  data.set(WORKSPACE_KEY, "{broken");
  assert.match(readWorkspace(storage, []).error, /unreadable/);
  assert.match(
    writeWorkspace(
      {
        setItem() {
          throw Error("quota");
        },
      },
      emptyWorkspace,
      [],
    ).error,
    /Could not save/,
  );
});
