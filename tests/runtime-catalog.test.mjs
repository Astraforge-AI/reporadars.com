import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import next from "next";
import { chromium } from "@playwright/test";
import { migrateAuthDatabase } from "../server/auth-service.mjs";
import { migrateAdminDatabase } from "../server/admin-store.mjs";
import { runtimePages } from "../server/runtime-pages.mjs";
import { createAdminHttpServer } from "../server/admin-http.mjs";
import { catalogResponse } from "../server/catalog-api.mjs";

test(
  "runtime Next serves new slugs, client navigation, locale, saved skills, updates and archives without rebuild",
  { timeout: 45000 },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "rr-runtime-")),
      databasePath = join(dir, "auth.sqlite");
    await migrateAuthDatabase({
      databasePath,
      baseURL: "http://localhost:4337",
      secret: "isolated-runtime-test-secret-with-enough-characters",
    });
    await migrateAdminDatabase({ databasePath });
    const db = new Database(databasePath),
      now = Date.now();
    db.prepare(
      "INSERT INTO reporadars_admin_record VALUES(?, 'skill', ?, ?, ?, ?, ?, ?, ?, ?, 'build', '[]', 'published', 1, ?, ?)",
    ).run(
      "fixture-runtime",
      "runtime-skill",
      "Runtime skill",
      "Новый скилл",
      "Useful workflow",
      "Полезный процесс",
      "Read source instructions.",
      "Изучите исходные инструкции.",
      "https://github.com/fixture/skills",
      now,
      now,
    );
    const insertEditorial = db.prepare(
      "INSERT INTO reporadars_admin_record VALUES(?,?,?,?,?,?,?,?,?,?,? ,?,'published',1,?,?)",
    );
    for (const [id, kind, slug, titleEn, titleRu] of [
      [
        "fixture-collection",
        "collection",
        "runtime-collection",
        "Runtime collection",
        "Подборка из базы",
      ],
      [
        "fixture-article",
        "article",
        "runtime-article",
        "Runtime article",
        "Статья из базы",
      ],
    ])
      insertEditorial.run(
        id,
        kind,
        slug,
        titleEn,
        titleRu,
        "Published editorial content.",
        "Редакционный материал.",
        "Plain-text body from SQLite.",
        "Текст статьи из SQLite.",
        "https://example.test/source",
        "research",
        '["fixture-runtime"]',
        now,
        now,
      );
    process.env.REPORADARS_DATABASE_PATH = databasePath;
    const web = next({ dev: false, dir: resolve("runtime-web") });
    await web.prepare();
    const server = createAdminHttpServer({
      baseURL: "http://localhost:4337",
      service: {
        handle: async (request) =>
          new URL(request.url).pathname === "/api/catalog"
            ? catalogResponse(request, databasePath)
            : Response.json({ user: null }),
      },
      pageHandler: runtimePages(web.getRequestHandler(), databasePath),
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseURL = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      headless: true,
    });
    t.after(async () => {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
      await web.close();
      db.close();
      await rm(dir, { recursive: true, force: true });
    });
    const markdown = await fetch(`${baseURL}/skills/security-review/SKILL.md`);
    assert.equal(markdown.status, 200);
    assert.match(markdown.headers.get("content-disposition"), /attachment/);
    const heading404 = await fetch(`${baseURL}/404`);
    assert.equal(heading404.status, 404);
    assert.match(await heading404.text(), /Reporadars/);
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${baseURL}/ru/collections`);
    await page
      .getByRole("heading", { name: "Подборка из базы", exact: true })
      .waitFor();
    assert.ok(
      await page
        .locator('#runtime-collection a[href="/ru/skills/runtime-skill"]')
        .count(),
    );
    await page.goto(`${baseURL}/ru/journal`);
    await page
      .getByRole("link", { name: "Статья из базы", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Статья из базы.", exact: true, level: 1 })
      .waitFor();
    assert.ok(
      await page.getByText("Текст статьи из SQLite.", { exact: true }).count(),
    );
    assert.equal(await page.locator('meta[name="robots"]').count(), 0);
    const sitemap = await fetch(`${baseURL}/sitemap.xml`);
    assert.equal(sitemap.status, 200);
    const xml = await sitemap.text();
    assert.ok(xml.includes("/ru/journal/runtime-article"));
    assert.ok(xml.includes('hreflang="ru"'));
    assert.ok(!xml.includes("seo-audit-boundaries"));
    await page.goto(`${baseURL}/skills`);
    await page
      .getByRole("link", { name: "Runtime skill", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Runtime skill", exact: true })
      .waitFor();
    await page.getByRole("button", { name: /Save signal|Save skill/ }).click();
    await page.goto(`${baseURL}/account?tab=saved`);
    assert.ok(await page.locator('a[href="/skills/runtime-skill"]').count());
    let response = await page.goto(`${baseURL}/ru/skills/runtime-skill`);
    assert.equal(response.status(), 200);
    assert.equal(await page.locator("html").getAttribute("lang"), "ru");
    await page
      .getByRole("heading", { name: "Новый скилл", exact: true })
      .waitFor();
    db.prepare(
      "UPDATE reporadars_admin_record SET title_ru='Обновлённый скилл',revision=2 WHERE kind='skill'",
    ).run();
    await page.reload();
    await page
      .getByRole("heading", { name: "Обновлённый скилл", exact: true })
      .waitFor();
    db.prepare(
      "UPDATE reporadars_admin_record SET status='archived',revision=3 WHERE kind='skill'",
    ).run();
    response = await page.reload();
    assert.equal(response.status(), 404);
    db.prepare(
      "UPDATE reporadars_admin_record SET status='archived',revision=2 WHERE kind='article'",
    ).run();
    response = await page.goto(`${baseURL}/ru/journal/runtime-article`);
    assert.equal(response.status(), 404);
    assert.ok(
      !(await (await fetch(`${baseURL}/sitemap.xml`)).text()).includes(
        "runtime-article",
      ),
    );
    assert.equal(errors.length, 0, errors.join("\n"));
  },
);
