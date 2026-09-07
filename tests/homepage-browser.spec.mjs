import { expect, test } from "@playwright/test";

const signalNames = [
  "SEO Audit",
  "Vector Store Hygiene",
  "Evaluation Frameworks",
];
const browserErrors = new WeakMap();

test.beforeEach(({ page }) => {
  const errors = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
});

test.afterEach(({ page }) => {
  expect(browserErrors.get(page), "browser console and page errors").toEqual(
    [],
  );
});

async function openDialog(page, name) {
  await page.getByRole("button", { name }).click();
  await expect(page.locator("dialog[open]")).toBeVisible();
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

test.describe("Reporadars homepage", () => {
  test("sends signal cards and Catalog navigation to the catalog routes", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    for (const name of signalNames) {
      const title = page.getByRole("link", { name: `View ${name}` });
      await expect(title).toHaveAttribute("href", /\/skills\//);
    }

    const header = page.locator(".unified-header");
    await expect(
      header.getByRole("link", { name: "Catalog", exact: true }),
    ).toHaveAttribute("href", "/skills");
    await expect(
      page.getByRole("link", { name: "View all signals" }),
    ).toHaveAttribute("href", "/skills");

    const cardSources = page.locator(".source-link");
    await expect(cardSources).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      await expect(cardSources.nth(index)).toHaveAttribute("target", "_blank");
      await expect(cardSources.nth(index)).toHaveAttribute("rel", /noopener/);
    }
  });

  test("uses native install modal with focus trapped and returned to its trigger", async ({
    page,
  }) => {
    await page.goto("/");

    {
      const trigger = page.getByRole("button", {
        name: "Learn about the Reporadars installation command",
      });
      await trigger.focus();
      await trigger.press("Enter");
      await expect(page).toHaveURL("/?panel=install");
      const dialog = page.locator("dialog[open]");
      await expect(dialog).toHaveJSProperty("open", true);
      await expect(dialog).toHaveAttribute("aria-labelledby", "dialog-title");
      await expect(
        dialog.getByRole("button", { name: "Close dialog" }),
      ).toBeFocused();

      // Native modal dialogs must keep keyboard focus inside even when tabbing past the last control.
      for (let index = 0; index < 12; index += 1)
        await page.keyboard.press("Tab");
      await expect
        .poll(() =>
          page.evaluate(
            () => document.activeElement?.closest("dialog")?.open ?? false,
          ),
        )
        .toBe(true);

      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await expect(page).toHaveURL("/");
    }
  });

  test("copies the install preview and makes clear that it cannot run yet", async ({
    page,
    context,
  }, testInfo) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(testInfo.project.use.baseURL).origin,
    });
    await page.goto("/");
    await openDialog(page, "Learn about the Reporadars installation command");

    await page.getByRole("button", { name: "Copy preview" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Preview copied. The command is not ready to run yet.",
    );
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("npx reporadars add seo-audit");
  });

  test("keeps the heading and dialogs inside compact and tablet viewports", async ({
    page,
  }) => {
    for (const [width, height] of [
      [320, 740],
      [390, 844],
      [768, 1024],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);
      const heading = page.getByRole("heading", {
        name: /Only the signals worth giving your agent/i,
      });
      await expect(heading).toBeVisible();
      const headingBox = await heading.boundingBox();
      expect(headingBox).not.toBeNull();
      expect(headingBox.x).toBeGreaterThanOrEqual(0);
      expect(headingBox.x + headingBox.width).toBeLessThanOrEqual(width);
      const headlineLines = heading.locator(".headline-line");
      await expect(headlineLines).toHaveCount(2);
      for (let index = 0; index < 2; index += 1) {
        const lineBox = await headlineLines.nth(index).boundingBox();
        expect(
          lineBox,
          `headline line ${index + 1} at ${width}px`,
        ).not.toBeNull();
        expect(lineBox.x).toBeGreaterThanOrEqual(0);
        expect(lineBox.x + lineBox.width).toBeLessThanOrEqual(width);
      }
      await expectNoHorizontalOverflow(page);

      await page.goto("/?panel=about");
      await expect(page.locator("dialog[open]")).toBeVisible();
      const dialog = page.locator("dialog[open]");
      const box = await dialog.boundingBox();
      expect(box).not.toBeNull();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.height).toBeLessThanOrEqual(height);
      await expectNoHorizontalOverflow(page);
    }
  });

  test("disables UI animation and transitions when reduced motion is requested", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect
      .poll(() =>
        page
          .locator(".hero-art img")
          .evaluate((element) => getComputedStyle(element).animationName),
      )
      .toBe("none");
    await openDialog(page, "Learn about the Reporadars installation command");
    await expect(page.locator("dialog[open]")).toBeVisible();
    await expect(
      await page
        .locator("dialog[open]")
        .evaluate((element) => getComputedStyle(element).animationName),
    ).toBe("none");
    await expect(
      await page
        .locator(".command-button")
        .evaluate((element) => getComputedStyle(element).transitionDuration),
    ).toBe("0s");
  });
});
