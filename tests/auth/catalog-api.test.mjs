import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrateAuthDatabase } from "../../server/auth-service.mjs";
import { migrateAdminDatabase } from "../../server/admin-store.mjs";
import { catalogResponse } from "../../server/catalog-api.mjs";
import { readPublicCatalog } from "../../server/public-catalog.mjs";

test("public search pages the entire catalog, matches Cyrillic, resolves saved IDs and omits private fields", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rr-search-")),
    databasePath = join(directory, "auth.sqlite");
  try {
    await migrateAuthDatabase({
      databasePath,
      baseURL: "http://localhost:4337",
      secret: "test-only-secret-long-enough-for-auth",
    });
    await migrateAdminDatabase({ databasePath });
    const db = new Database(databasePath),
      now = Date.now();
    const insert = db.prepare(
      "INSERT INTO reporadars_admin_record VALUES(?,'skill',?,?,?,?,?,?,?,?,'build','[]',?,1,?,?)",
    );
    db.transaction(() => {
      for (let i = 0; i < 2005; i++)
        insert.run(
          `id-${i}`,
          `search-skill-${i}`,
          `Search ${i}`,
          i === 0 ? "Проверка кириллицы" : `Поиск ${i}`,
          "Published task",
          "Рабочая задача",
          "Plain source instructions",
          "Исходные инструкции",
          "https://github.com/fixture/search",
          "published",
          now + i,
          now + i,
        );
      insert.run(
        "draft-only",
        "private-draft",
        "Private",
        "Черновик",
        "Draft",
        "Черновик",
        "Hidden",
        "Скрыто",
        "https://example.test",
        "draft",
        now,
        now,
      );
    })();
    db.close();
    for (const [query, status] of [
      ["", 200],
      ["pageSize=10000", 400],
    ]) {
      const head = catalogResponse(
        new Request(`http://localhost:4337/api/catalog?${query}`, {
          method: "HEAD",
        }),
        databasePath,
      );
      assert.equal(head.status, status);
      assert.equal(await head.text(), "");
      assert.equal(head.headers.get("cache-control"), "no-store");
    }
    const request = async (query) =>
      catalogResponse(
        new Request(`http://localhost:4337/api/catalog?${query}`),
        databasePath,
      );
    const search = await (
      await request("locale=ru&q=ПРОВЕРКА%20КИРИЛЛИЦЫ")
    ).json();
    assert.equal(search.total, 1);
    assert.equal(search.items[0].title, "Проверка кириллицы");
    const final = await (await request("q=Published%20task&page=335")).json();
    assert.equal(final.total, 2005);
    assert.equal(final.items.length, 1);
    assert.equal(final.items[0].id, "search-skill-0");
    assert.equal(JSON.stringify(final).includes("updated_by"), false);
    const saved = await (
      await request("ids=search-skill-0,private-draft&pageSize=100")
    ).json();
    assert.deepEqual(
      saved.items.map((item) => item.id),
      ["search-skill-0"],
    );
    assert.equal(readPublicCatalog(databasePath).items.length, 100);
    assert.ok(
      readPublicCatalog(databasePath, "search-skill-0").items.some(
        (item) => item.slug === "search-skill-0",
      ),
    );
    for (const query of [
      "pageSize=101",
      "q=" + "x".repeat(201),
      "ids=../private",
      "extra=secret",
    ])
      assert.equal((await request(query)).status, 400);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
