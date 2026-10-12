import { expect, test } from "@playwright/test";

const workspaceKey = "reporadars.workspace.v1";
const browserErrors = new WeakMap();
const expectedUnavailableAuth = new WeakSet();

test.beforeEach(async ({ page }) => {
  const errors = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    // HTTP/2 omits the HTTP/1 reason phrase. Exempt only the deliberate
    // error document, never a missing asset or an unrelated console error.
    const url = new URL(message.location().url || "about:blank");
    if (
      expectedUnavailableAuth.has(page) &&
      url.pathname === "/api/auth/request-link" &&
      /^Failed to load resource: the server responded with a status of 503 /.test(
        message.text(),
      )
    )
      return;
    if (
      /^\/(?:ru\/)?404$/.test(url.pathname) &&
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

async function expectNoOverflow(page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}

test.describe("locale and editorial routes", () => {
  test("English headings are readable and internal routes share one transition", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator(".hero h1")).toHaveCSS(
      "font-family",
      /DM Sans/,
    );

    await page
      .locator(".unified-header")
      .getByRole("link", { name: "Journal", exact: true })
      .click({ noWaitAfter: true });
    await expect(page.locator("html")).toHaveAttribute(
      "data-page-transition",
      "leaving",
    );
    await page.waitForURL("/journal");
  });

  test("language switching keeps the exact route, query, and fragment", async ({
    page,
  }) => {
    await page.goto("/skills?q=seo#library");
    await page.getByRole("link", { name: "RU", exact: true }).click();
    await expect(page).toHaveURL("/ru/skills?q=seo#library");
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    await page.getByRole("link", { name: "EN", exact: true }).click();
    await expect(page).toHaveURL("/skills?q=seo#library");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("Russian existing catalog routes stay Russian and share only local workspace state", async ({
    page,
  }) => {
    await page.goto("/ru/skills/seo-audit");
    await page.getByRole("button", { name: /сохранить скилл/i }).click();
    await page
      .locator(".unified-header")
      .getByRole("link", { name: /журнал/i })
      .click();
    await expect(page).toHaveURL("/ru/journal");
    await page.goto("/account");
    await page.getByRole("tab", { name: /saved signals/i }).click();
    await expect(page.getByText(/SEO Audit|SEO-аудит/)).toBeVisible();
    await expect(page.getByText(/signed in|вошли/i)).toHaveCount(0);
  });

  test("login validates locally and truthfully handles an unavailable auth backend", async ({
    page,
  }) => {
    const requests = [];
    expectedUnavailableAuth.add(page);
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({ json: { user: null } }),
    );
    await page.route("**/api/auth/request-link", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "UNAVAILABLE" } }),
      }),
    );
    page.on("request", (request) => {
      if (["fetch", "xhr"].includes(request.resourceType()))
        requests.push(request.url());
    });
    await page.goto("/login?mode=signup");
    await expect(
      page.getByRole("heading", { name: /create a radar/i }),
    ).toBeVisible();
    await page.getByRole("button", { name: /continue with email/i }).click();
    await expect(page.getByRole("status")).toContainText(
      "Enter a valid email address.",
    );
    await page.getByLabel("Email address").fill("person@example.test");
    await page.getByRole("button", { name: /continue with email/i }).click();
    await expect(page.getByRole("status")).toContainText(
      "We could not confirm email delivery. Please try again.",
    );
    await expect(page.getByRole("status")).not.toContainText(
      "Check your email",
    );
    expect(
      requests.every((url) => new URL(url).pathname.startsWith("/api/auth/")),
    ).toBe(true);
    expect(
      requests.filter((url) => url.endsWith("/request-link")),
    ).toHaveLength(1);
    await expect
      .poll(() =>
        page.evaluate((key) => localStorage.getItem(key), workspaceKey),
      )
      .toBeNull();
  });

  test("journal filters update immediately and an unknown type falls back to all", async ({
    page,
  }) => {
    await page.goto("/journal");
    const allRows = await page.locator(".journal-row").count();
    await page.getByRole("link", { name: "Reviews" }).click();
    await expect(page).toHaveURL("/journal?type=review");
    await expect(page.locator(".journal-row")).toHaveCount(1);
    await expect(
      page.getByRole("link", { name: "RU", exact: true }),
    ).toHaveAttribute("href", "/ru/journal?type=review");
    await page.goto("/journal?type=unknown");
    await expect(page.locator(".journal-row")).toHaveCount(allRows);
    await expect(
      page.getByRole("link", { name: "All updates" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("all five English and Russian articles expose eight navigable sections", async ({
    page,
  }) => {
    const ids = [
      "seo-audit-boundaries",
      "reviewing-signal-quality",
      "retiring-legacy-analytics",
      "rollback-readiness-notes",
      "agent-compatibility-notes",
    ];
    for (const locale of ["", "/ru"]) {
      for (const id of ids) {
        await page.goto(`${locale}/journal/${id}`);
        await expect(page.locator(".article-section")).toHaveCount(8);
        await expect(page.locator(".article-toc a")).toHaveCount(8);
      }
    }
  });

  test("modified journal filter clicks preserve native new-tab behavior", async ({
    page,
    context,
  }) => {
    await page.goto("/journal");
    const opened = context.waitForEvent("page");
    await page
      .getByRole("link", { name: "Reviews", exact: true })
      .click({ modifiers: ["Control"] });
    const tab = await opened;
    await tab.waitForLoadState();
    await expect(tab).toHaveURL("/journal?type=review");
    await expect(page).toHaveURL("/journal");
    await tab.close();
  });

  test("the complete sign-in heading remains readable at 320px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    for (const path of ["/login", "/ru/login"]) {
      await page.goto(path);
      expect(
        await page
          .locator("h1")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
    }
  });

  test("404 suggests real skills and sends its search to the locale library", async ({
    page,
  }) => {
    expect((await page.goto("/ru/404")).status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: /страница не найдена/i }),
    ).toBeVisible();
    for (const id of ["seo-audit", "security-review", "browser-testing"]) {
      await expect(
        page.locator(`.suggested-signals a[href="/ru/skills/${id}"]`),
      ).toHaveCount(1);
    }
    await page.getByLabel(/поиск проверенных навыков/i).fill("seo");
    await page.getByRole("button", { name: /открыть каталог/i }).click();
    await expect(page).toHaveURL("/ru/skills?q=seo");
  });

  test("new pages direct-load in both languages without browser errors", async ({
    page,
  }) => {
    for (const locale of ["", "/ru"]) {
      for (const path of [
        "/collections",
        "/login",
        "/404",
        "/journal",
        "/journal/seo-audit-boundaries",
      ]) {
        const response = await page.goto(`${locale}${path}`);
        expect(response.status()).toBe(path === "/404" ? 404 : 200);
        await expect(page.locator("h1")).not.toBeEmpty();
        await expect(page.locator("html")).toHaveAttribute(
          "lang",
          locale ? "ru" : "en",
        );
      }
    }
  });

  test("editorial views and a Russian existing page fit compact and tablet viewports", async ({
    page,
  }) => {
    for (const [width, height] of [
      [320, 740],
      [390, 844],
      [768, 1024],
    ]) {
      await page.setViewportSize({ width, height });
      for (const path of [
        "/login",
        "/404",
        "/journal",
        "/journal/seo-audit-boundaries",
        "/ru/skills",
      ]) {
        const response = await page.goto(path);
        expect(response.status()).toBe(path === "/404" ? 404 : 200);
        await expect(page.locator("h1")).toBeVisible();
        await expectNoOverflow(page);
      }
    }
  });

  test("Russian library skill names stay inside their cell and off adjacent summaries on narrow screens", async ({
    page,
  }) => {
    for (const [width, height] of [
      [320, 740],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto("/ru/skills");
      const collisions = await page
        .locator(".catalog-table tbody tr")
        .evaluateAll((rows) =>
          rows.flatMap((row) => {
            const title = row
              .querySelector(".catalog-skill strong")
              ?.getBoundingClientRect();
            const skillCell = row.querySelector("td")?.getBoundingClientRect();
            const summary = row
              .querySelector(".catalog-summary")
              ?.getBoundingClientRect();
            if (!title || !skillCell || !summary)
              return ["missing catalog geometry"];
            const overlapsSummary =
              title.left < summary.right &&
              summary.left < title.right &&
              title.top < summary.bottom &&
              summary.top < title.bottom;
            return [
              ...(title.right > skillCell.right + 1
                ? ["title exceeds skill cell"]
                : []),
              ...(overlapsSummary ? ["title overlaps summary"] : []),
            ];
          }),
        );
      expect(collisions, `${width}px Russian catalog geometry`).toEqual([]);
      await expectNoOverflow(page);
    }
  });
});
