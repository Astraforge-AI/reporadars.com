import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const path of [
  "/skills",
  "/ru/skills",
  "/collections",
  "/login",
  "/account",
]) {
  test(`accessibility and keyboard entry: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.locator("#main").waitFor();
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", {
      name: path.startsWith("/ru")
        ? "Перейти к содержимому"
        : "Skip to content",
    });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
  });
}
