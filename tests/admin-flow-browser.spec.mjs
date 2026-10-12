import { test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import path from "node:path";
import Database from "better-sqlite3";
import {
  migrateAuthDatabase,
  createAuthService,
} from "../server/auth-service.mjs";
import { migrateAdminDatabase } from "../server/admin-store.mjs";
import { bootstrapAdmin } from "../server/admin-bootstrap.mjs";
import { createAdminService } from "../server/admin-service.mjs";
import { createAdminHttpServer } from "../server/admin-http.mjs";
import { loadStatic } from "../scripts/admin-preview.mjs";

test("real verified admin creates and publishes content; normal and revoked users remain blocked", async ({
  browser,
}, testInfo) => {
  test.setTimeout(45000);
  const directory = await mkdtemp(path.join(tmpdir(), "rr-admin-browser-"));
  const databasePath = path.join(directory, "auth.sqlite");
  const messages = [];
  let auth, admin, server;
  const contexts = [];
  try {
    const reservation = createServer();
    await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
    const port = reservation.address().port;
    await new Promise((r) => reservation.close(r));
    const origin = `http://127.0.0.1:${port}`;
    const options = {
      baseURL: origin,
      databasePath,
      secret: "isolated-admin-browser-secret-not-for-production-2026",
      sendMail: async (mail) => messages.push(mail),
    };
    await migrateAuthDatabase(options);
    await migrateAdminDatabase({ databasePath });
    const boot = await bootstrapAdmin({
      databasePath,
      email: "owner@example.test",
    });
    expect(boot.user.emailVerified).toBe(false);
    auth = await createAuthService(options);
    admin = await createAdminService({
      databasePath,
      baseURL: origin,
      authService: auth,
    });
    server = createAdminHttpServer({
      baseURL: origin,
      service: admin,
      loadStatic,
    });
    await new Promise((r) => server.listen(port, "127.0.0.1", r));
    const owner = await browser.newContext();
    contexts.push(owner);
    const page = await owner.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const adminHtml = await page.goto(`${origin}/admin`);
    expect(adminHtml.headers()["cache-control"]).toContain("no-store");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
    await expect(
      page.getByRole("heading", { name: "Admin access required" }),
    ).toBeVisible();
    expect(
      (await owner.request.get(`${origin}/api/admin/overview`)).status(),
    ).toBe(401);
    await page.goto(`${origin}/login`);
    await page.getByLabel("Email address").fill("owner@example.test");
    await page.getByRole("button", { name: "Continue with email" }).click();
    await expect.poll(() => messages.length).toBe(1);
    await page.goto(messages[0].url);
    await page.getByRole("button", { name: "Confirm sign-in" }).click();
    await expect(
      page.getByText("owner@example.test", { exact: true }),
    ).toBeVisible();
    // No SQL promotion or forged session: genuine confirmation activates the grant.
    await page.goto(`${origin}/admin`);
    await expect(
      page.getByRole("heading", { name: "Editorial desk" }),
    ).toBeVisible();
    expect(
      (await owner.request.get(`${origin}/api/admin/session`)).status(),
    ).toBe(200);
    await page.getByRole("button", { name: "New record" }).click();
    for (const [label, value] of Object.entries({
      Slug: "browser-review-fixture",
      "English title": "Browser review fixture",
      "Russian title": "Тест браузерной проверки",
      "English summary": "An isolated test record.",
      "Russian summary": "Изолированная тестовая запись.",
      "English body": "Review only the authorized test scope.",
      "Russian body": "Проверяйте только разрешённую тестовую область.",
      "Source URL": "https://example.test/source",
    }))
      await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect
      .poll(
        async () =>
          (
            await (
              await owner.request.get(`${origin}/api/admin/records?kind=skill`)
            ).json()
          ).total,
      )
      .toBe(1);
    expect(
      (await (await fetch(`${origin}/api/content?kind=skill`)).json()).total,
    ).toBe(0);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await fetch(`${origin}/api/content?kind=skill`)).json())
            .total,
      )
      .toBe(1);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Editorial desk" }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: testInfo.outputPath("admin-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/ru/admin`);
    await expect(page.locator(".admin-title")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("admin-mobile-ru.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${origin}/admin`);
    const audit = await (
      await owner.request.get(`${origin}/api/admin/audit`)
    ).json();
    expect(audit.items.some((item) => item.action === "record.published")).toBe(
      true,
    );
    expect(audit.items.some((item) => item.action === "record.created")).toBe(
      true,
    );
    const ordinary = await browser.newContext();
    contexts.push(ordinary);
    const reader = await ordinary.newPage();
    await reader.goto(`${origin}/login`);
    await reader.getByLabel("Email address").fill("reader@example.test");
    await reader.getByRole("button", { name: "Continue with email" }).click();
    await expect.poll(() => messages.length).toBe(2);
    await reader.goto(messages[1].url);
    await reader.getByRole("button", { name: "Confirm sign-in" }).click();
    await expect(
      reader.getByText("reader@example.test", { exact: true }),
    ).toBeVisible();
    expect(
      (await ordinary.request.get(`${origin}/api/admin/records`)).status(),
    ).toBe(403);
    await reader.goto(`${origin}/admin`);
    await expect(
      reader.getByRole("heading", { name: "Admin access required" }),
    ).toBeVisible();
    const db = new Database(databasePath);
    db.prepare(
      "UPDATE reporadars_admin_grant SET state='revoked' WHERE user_id=?",
    ).run(boot.user.id);
    db.close();
    expect(
      (await owner.request.get(`${origin}/api/admin/session`)).status(),
    ).toBe(403);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Admin access required" }),
    ).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    for (const context of contexts) await context.close();
    if (server) await new Promise((r) => server.close(r));
    await admin?.close();
    await auth?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
