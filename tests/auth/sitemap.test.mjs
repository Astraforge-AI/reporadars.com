import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sitemapDocument } from "../../server/sitemap.mjs";

test("large sitemap splits every published route without including archived records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rr-sitemap-")),
    path = join(directory, "records.sqlite");
  try {
    const db = new Database(path);
    db.exec(
      "CREATE TABLE reporadars_admin_record(kind,slug,status,updated_at)",
    );
    const insert = db.prepare(
      "INSERT INTO reporadars_admin_record VALUES('skill',?,?,?)",
    );
    db.transaction(() => {
      for (let i = 0; i < 10001; i++)
        insert.run(`public-${i}`, "published", 1700000000000);
    })();
    insert.run("hidden", "archived", 1700000000000);
    db.close();
    assert.match(sitemapDocument(path, "/sitemap.xml"), /<sitemapindex/);
    const first = sitemapDocument(path, "/sitemap-1.xml"),
      second = sitemapDocument(path, "/sitemap-2.xml");
    assert.equal((first.match(/<url>/g) || []).length, 20000);
    assert.equal((second.match(/<url>/g) || []).length, 8);
    const locations = [
      ...(first + second).matchAll(/<loc>([^<]+)<\/loc>/g),
    ].map((match) => match[1]);
    assert.equal(new Set(locations).size, 20008);
    assert.equal((first + second).includes("/skills/hidden"), false);
    assert.equal(sitemapDocument(path, "/sitemap-3.xml"), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
