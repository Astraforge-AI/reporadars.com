import { expect, test } from "@playwright/test";

const workspaceKey = "reporadars.workspace.v1";
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

async function expectNoHorizontalOverflow(page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}

test.describe("Reporadars catalog", () => {
  test("searches, filters, preserves URL state across reload, and clears an empty library", async ({
    page,
  }) => {
    await page.goto("/skills?q=seo&category=research");
    const search = page.getByRole("searchbox", { name: "Search skills" });
    await expect(search).toHaveValue("seo");
    await expect(page.getByRole("button", { name: "Research" })).toHaveClass(
      /is-active/,
    );
    await expect(page.locator(".catalog-table tbody tr")).toHaveCount(1);

    await search.fill("not-a-signal");
    await expect(page).toHaveURL(/q=not-a-signal.*category=research/);
    await expect(
      page.getByText("No skills found."),
    ).toBeVisible();
    await page.reload();
    await expect(search).toHaveValue("not-a-signal");
    await page
      .getByRole("button", { name: "Clear search and filters" })
      .click();
    await expect(page).toHaveURL("/skills");
    await expect(page.locator(".catalog-table tbody tr")).toHaveCount(6);
  });

  test("paginates the eight-skill library and opens an item detail", async ({
    page,
  }) => {
    await page.goto("/skills");
    await expect(page.getByText("Page 1 of 2")).toBeVisible();
    await expect(page.locator(".catalog-table tbody tr")).toHaveCount(6);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Page 2 of 2")).toBeVisible();
    await expect(page.locator(".catalog-table tbody tr")).toHaveCount(2);
    await page.getByRole("link", { name: "Vector Store Hygiene" }).click();
    await expect(page).toHaveURL("/skills/vector-store-hygiene");
    await expect(
      page.getByRole("heading", { name: "Vector Store Hygiene", exact: true }),
    ).toBeVisible();
  });

  test("switches README and CHANGELOG documentation tabs with the keyboard", async ({
    page,
  }) => {
    await page.goto("/skills/seo-audit");
    const readme = page.getByRole("tab", { name: "readme" });
    const changelog = page.getByRole("tab", { name: "changelog" });
    await expect(readme).toHaveAttribute("aria-selected", "true");
    await readme.focus();
    await page.keyboard.press("ArrowRight");
    await expect(changelog).toBeFocused();
    await expect(changelog).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toContainText("Version 0.1.0");
    await page.keyboard.press("Home");
    await expect(readme).toBeFocused();
    await expect(page.getByRole("tabpanel")).toContainText("Capabilities");
  });

  test("serves a real downloadable markdown draft with frontmatter", async ({
    page,
  }) => {
    await page.goto("/skills/seo-audit");
    const download = page.getByRole("link", { name: "Download draft" });
    await expect(download).toHaveAttribute("download", "");
    const response = await page.request.get(
      await download.getAttribute("href"),
    );
    expect(response.ok()).toBe(true);
    const body = await response.text();
    expect(body).toMatch(/^---\nname: seo-audit\ndescription:/);
    expect(body).toContain("# SEO Audit");
  });

  test("copies the CLI preview and explains when the clipboard is unavailable", async ({
    page,
    context,
  }, testInfo) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(testInfo.project.use.baseURL).origin,
    });
    await page.goto("/skills/seo-audit");
    const copy = page.getByRole("button", {
      name: "Copy npx reporadars add seo-audit",
    });
    await copy.click();
    await expect(page.getByRole("status")).toContainText(
      "Command copied — CLI coming soon.",
    );
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("npx reporadars add seo-audit");

    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: () => Promise.reject(new Error("blocked")) },
      });
    });
    await page.reload();
    await page
      .getByRole("button", { name: "Copy npx reporadars add seo-audit" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Copy unavailable. Select the command to copy.",
    );
  });

  test("saves a skill, persists settings, removes saved items, and confirms reset before clearing", async ({
    page,
  }) => {
    await page.goto("/skills/seo-audit");
    await page.getByRole("button", { name: "Save skill" }).click();
    await expect(
      page.getByRole("button", { name: "Saved to local list" }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.goto("/account?tab=settings");
    await expect(page.getByRole("tab", { name: "Settings" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByLabel("Display name").fill("Ada Radar");
    await page.getByLabel("Role").fill("Catalog editor");
    await page.getByRole("radio", { name: /Example curator portrait/ }).check();
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Ada Radar." }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: /Example curator portrait/ }),
    ).toBeChecked();

    await page.getByRole("tab", { name: "Saved signals" }).click();
    await page
      .getByRole("button", { name: "Remove SEO Audit from saved signals" })
      .click();
    await expect(
      page.getByText("Your next useful signal belongs here."),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Reset local workspace" }).click();
    await expect(
      page.getByRole("button", { name: "Confirm reset" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(
      page.getByRole("button", { name: "Reset local workspace" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Reset local workspace" }).click();
    await page.getByRole("button", { name: "Confirm reset" }).click();
    await expect(
      page.getByRole("heading", { name: "Your workspace." }),
    ).toBeVisible();
  });

  test("recovers from corrupt browser state and warns when storage writes fail", async ({
    page,
  }) => {
    await page.addInitScript(
      (key) => localStorage.setItem(key, "{not json"),
      workspaceKey,
    );
    await page.goto("/account");
    await expect(
      page.getByRole("heading", { name: "Your workspace." }),
    ).toBeVisible();

    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new Error("quota");
      };
    });
    await page.reload();
    await page.goto("/skills/seo-audit");
    await page.getByRole("button", { name: "Save skill" }).click();
    await expect(page.locator("#root").getByRole("alert")).toContainText(
      "Could not save to this browser. Changes will last only for this visit.",
    );
  });

  test("keeps catalog heading and layout inside compact, tablet, and desktop viewports", async ({
    page,
  }) => {
    for (const [width, height] of [
      [320, 740],
      [390, 844],
      [768, 1024],
      [1440, 900],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto("/skills");
      await page.evaluate(() => document.fonts.ready);
      const heading = page.getByRole("heading", { name: "Skills catalog." });
      await expect(heading).toBeVisible();
      const box = await heading.boundingBox();
      expect(box).not.toBeNull();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      const header = await page.locator(".site-header").boundingBox();
      const accountLink = await page
        .locator(".account-header-link")
        .boundingBox();
      expect(accountLink.y).toBeGreaterThanOrEqual(header.y);
      expect(accountLink.y + accountLink.height).toBeLessThanOrEqual(
        header.y + header.height,
      );
      await expectNoHorizontalOverflow(page);
    }
  });
});
