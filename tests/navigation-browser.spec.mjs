import { expect, test } from "@playwright/test";

const browserErrors = new WeakMap();

test.beforeEach(({ page }) => {
  const errors = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    const pathname = new URL(message.location().url || "about:blank").pathname;
    if (
      /^\/(?:ru\/)?404$/.test(pathname) &&
      /^Failed to load resource: the server responded with a status of 404 \((?:Not Found)?\)$/.test(
        message.text(),
      )
    )
      return;
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
});

test.afterEach(({ page }) => {
  expect(browserErrors.get(page), "browser console and page errors").toEqual(
    [],
  );
});

const copy = {
  en: {
    catalog: "Catalog",
    collections: "Collections",
    about: "How it works",
    journal: "Journal",
    workspaceMenu: "Workspace menu",
    workspace: "My workspace",
    saved: "Saved signals",
    settings: "Settings",
    close: "Close dialog",
    save: "Save skill",
  },
  ru: {
    catalog: "Каталог",
    collections: "Коллекции",
    about: "Как это работает",
    journal: "Журнал",
    workspaceMenu: "Меню кабинета",
    workspace: "Мой кабинет",
    saved: "Сохранённые скиллы",
    settings: "Настройки",
    close: "Закрыть диалог",
    save: "Сохранить скилл",
  },
};

function localPath(locale, path) {
  return locale === "ru"
    ? `/ru${path === "/" ? "" : path.replace(/^\/(?=[?#])/, "")}`
    : path;
}

function header(page) {
  return page.locator(".unified-header");
}

function footer(page) {
  return page.locator(".unified-footer");
}

async function expectHeaderDestinations(page, locale) {
  const t = copy[locale];
  const bar = header(page);
  await expect(bar).toBeVisible();
  await expect(
    bar.getByRole("link", { name: t.catalog, exact: true }),
  ).toHaveAttribute("href", localPath(locale, "/skills"));
  await expect(
    bar.getByRole("link", { name: t.collections, exact: true }),
  ).toHaveAttribute("href", localPath(locale, "/collections"));
  await expect(
    bar.getByRole("link", { name: t.about, exact: true }),
  ).toHaveCount(0);
  await expect(
    footer(page).getByRole("link", { name: t.about, exact: true }),
  ).toHaveCount(0);
  await expect(
    bar.getByRole("link", { name: t.journal, exact: true }),
  ).toHaveAttribute("href", localPath(locale, "/journal"));
}

async function openWorkspace(page, locale) {
  await header(page)
    .getByRole("button", { name: copy[locale].workspaceMenu })
    .click();
  await expect(page.locator(".workspace-menu")).toBeVisible();
}

async function expectNoHorizontalOverflow(page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}

test.describe("unified navigation", () => {
  test("keeps collection navigation, browser history, and native modified links coherent", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    await expectHeaderDestinations(page, "en");

    const collections = header(page).getByRole("link", {
      name: "Collections",
      exact: true,
    });
    const opened = context.waitForEvent("page");
    await collections.click({ modifiers: ["Control"] });
    const tab = await opened;
    await tab.waitForLoadState();
    await expect(tab).toHaveURL("/collections");
    await expect(page).toHaveURL("/");
    await tab.close();

    await collections.click();
    await expect(page).toHaveURL("/collections");
    await expect(page.locator(".skill-collection")).toHaveCount(3);
    await page.goBack();
    await expect(page).toHaveURL("/");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await page.goForward();
    await expect(page).toHaveURL("/collections");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
  });

  test("flows from a deep collection link through saved workspace and related editorial content", async ({
    page,
  }) => {
    await page.goto("/?panel=collections");
    await expect(page.locator("dialog[open]")).toBeVisible();
    const skill = page
      .locator("dialog[open]")
      .getByRole("link", { name: /SEO Audit/i })
      .first();
    await expect(skill).toHaveAttribute("href", "/skills/seo-audit");
    await skill.click();
    await expect(page).toHaveURL("/skills/seo-audit");
    await page.getByRole("button", { name: "Save skill" }).click();

    await openWorkspace(page, "en");
    const menu = page.locator(".workspace-menu");
    const savedLink = menu.getByRole("link", { name: /Saved signals/ });
    await expect(savedLink).toHaveAttribute("href", "/account?tab=saved");
    await expect(savedLink).toContainText("1");
    await savedLink.click();
    await expect(page).toHaveURL("/account?tab=saved");
    await expect(page.getByText("SEO Audit", { exact: true })).toBeVisible();

    await header(page)
      .getByRole("link", { name: "Journal", exact: true })
      .click();
    await expect(page).toHaveURL("/journal");
    await page
      .locator(".journal-row")
      .first()
      .getByRole("link")
      .first()
      .click();
    await expect(page).toHaveURL(/\/journal\//);
    const relatedSkill = page
      .locator(".page-connections")
      .locator('a[href^="/skills/"]')
      .first();
    await expect(relatedSkill).toBeVisible();
  });

  test("workspace dropdown has ordinary links and closes on Escape and outside click", async ({
    page,
  }) => {
    await page.goto("/skills");
    await openWorkspace(page, "en");
    const menu = page.locator(".workspace-menu");
    await expect(
      menu.getByRole("link", { name: "My workspace", exact: true }),
    ).toHaveAttribute("href", "/account");
    await expect(menu.getByRole("link", { name: /Settings/ })).toHaveAttribute(
      "href",
      "/account?tab=settings",
    );
    await expect(menu.locator('[role="menuitem"], [role="menu"]')).toHaveCount(
      0,
    );
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(
      header(page).getByRole("button", { name: "Workspace menu" }),
    ).toBeFocused();

    await openWorkspace(page, "en");
    await page.locator("main").click({ position: { x: 5, y: 5 } });
    await expect(menu).toBeHidden();
  });

  test("marks Catalog and Journal as active and keeps Russian through the same workspace flow", async ({
    page,
  }) => {
    await page.goto("/skills");
    await expect(
      header(page).getByRole("link", { name: "Catalog", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await header(page)
      .getByRole("link", { name: "Journal", exact: true })
      .click();
    await expect(
      header(page).getByRole("link", { name: "Journal", exact: true }),
    ).toHaveAttribute("aria-current", "page");

    await page.goto("/ru/skills/seo-audit");
    await expectHeaderDestinations(page, "ru");
    await page.getByRole("button", { name: copy.ru.save }).click();
    await openWorkspace(page, "ru");
    const savedLink = page
      .locator(".workspace-menu")
      .getByRole("link", { name: /Сохранённые скиллы/ });
    await expect(savedLink).toContainText("1");
    await savedLink.click();
    await expect(page).toHaveURL("/ru/account?tab=saved");
    await header(page)
      .getByRole("link", { name: "Журнал", exact: true })
      .click();
    await expect(page).toHaveURL("/ru/journal");
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  });

  test("uses the global header and footer on direct login and 404 routes", async ({
    page,
  }) => {
    for (const [locale, path] of [
      ["en", "/login"],
      ["en", "/404"],
      ["ru", "/ru/login"],
      ["ru", "/ru/404"],
    ]) {
      const response = await page.goto(path);
      expect(response.status()).toBe(path.endsWith("/404") ? 404 : 200);
      await expectHeaderDestinations(page, locale);
      await expect(footer(page)).toBeVisible();
      await expect(
        footer(page).getByRole("link", {
          name: copy[locale].catalog,
          exact: true,
        }),
      ).toHaveAttribute("href", localPath(locale, "/skills"));
    }
  });

  test("keeps header, menu, and footer links on-screen at mobile and tablet widths", async ({
    page,
  }) => {
    for (const [width, height] of [
      [320, 740],
      [768, 1024],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto("/journal");
      await expectHeaderDestinations(page, "en");
      await openWorkspace(page, "en");
      for (const locator of [
        header(page),
        page.locator(".workspace-menu"),
        footer(page),
      ]) {
        const box = await locator.boundingBox();
        expect(
          box,
          `${width}px ${await locator.getAttribute("class")}`,
        ).not.toBeNull();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      await expectNoHorizontalOverflow(page);
    }
  });
});
