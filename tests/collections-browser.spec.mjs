import { expect, test } from "@playwright/test";

for (const [prefix, label, title] of [
  ["", "Collections", "Skill Collections — Reporadars"],
  ["/ru", "Коллекции", "Коллекции скиллов — Reporadars"],
]) {
  test(`${prefix || "en"} collections connect real skills and retain language`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto(prefix || "/");
    await page
      .locator(".unified-header")
      .getByRole("link", { name: label, exact: true })
      .click();
    await expect(page).toHaveURL(`${prefix}/collections`);
    await expect(page).toHaveTitle(title);
    await expect(page.locator("h1")).not.toBeEmpty();
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    await expect(
      page
        .locator(".unified-header")
        .getByRole("link", { name: label, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page
        .locator(".unified-footer")
        .getByRole("link", { name: label, exact: true }),
    ).toHaveAttribute("href", `${prefix}/collections`);
    await expect(page.locator(".skill-collection")).toHaveCount(3);
    const links = page.locator(".collection-skill-link");
    await expect(links).toHaveCount(8);
    const hrefs = await links.evaluateAll((items) =>
      items.map((el) => el.getAttribute("href")),
    );
    expect(new Set(hrefs).size).toBe(8);
    for (const href of hrefs)
      expect((await page.request.get(href)).status()).toBe(200);
    await page
      .locator('.collections-jump-links a[href$="#data-and-discovery"]')
      .click();
    await expect(page).toHaveURL(`${prefix}/collections#data-and-discovery`);
    const otherLocale = prefix ? "EN" : "RU";
    await page.getByRole("link", { name: otherLocale, exact: true }).click();
    const otherPrefix = prefix ? "" : "/ru";
    await expect(page).toHaveURL(
      `${otherPrefix}/collections#data-and-discovery`,
    );
    await page
      .locator(`.collection-skill-link[href="${otherPrefix}/skills/seo-audit"]`)
      .click();
    await expect(page).toHaveURL(`${otherPrefix}/skills/seo-audit`);
    expect(errors).toEqual([]);
  });
}

test("collections are prerendered and canonicalized in both locales", async ({
  browser,
  baseURL,
  request,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL,
  });
  const page = await context.newPage();
  for (const prefix of ["", "/ru"]) {
    const response = await page.goto(`${prefix}/collections`);
    expect(response.status()).toBe(200);
    await expect(page.locator(".collection-skill-link")).toHaveCount(8);
    await expect(page.locator("html")).toHaveAttribute(
      "lang",
      prefix ? "ru" : "en",
    );
    const redirected = await request.get(`${prefix}/collections/?from=menu`, {
      maxRedirects: 0,
    });
    expect(redirected.status()).toBe(308);
    expect(redirected.headers().location).toBe(
      `https://reporadars.com${prefix}/collections?from=menu`,
    );
  }
  await context.close();
});

test("collections keep headings and links within mobile, tablet and desktop bounds", async ({
  page,
}) => {
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/collections", "/ru/collections"]) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const overflow = await page
        .locator(
          "h1, .collections-group-heading h2, .collections-skill-copy strong",
        )
        .evaluateAll((items) =>
          items
            .filter((el) => el.scrollWidth > el.clientWidth + 1)
            .map((el) => el.textContent),
        );
      expect(overflow).toEqual([]);
      await expect(
        page.locator(
          '.unified-header a[href*="panel=about"], .unified-footer a[href*="panel=about"]',
        ),
      ).toHaveCount(0);
    }
  }
});
