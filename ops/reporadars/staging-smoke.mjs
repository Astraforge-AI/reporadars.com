import assert from "node:assert/strict";
import { readFile, readdir, realpath, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { stagingOrigin } from "../../server/staging-start.mjs";

const runtime = await realpath(process.argv[2] || "");
if (!runtime.startsWith("/var/lib/reporadars-staging/"))
  throw new Error("Smoke test is restricted to the isolated staging runtime");
const { origin, intakeTokenFile } = JSON.parse(
  await readFile(join(runtime, "runtime.json"), "utf8"),
);
stagingOrigin(origin);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
});
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const slug = `staging-smoke-${Date.now()}`;
try {
  assert.equal(
    (await context.request.get(`${origin}/api/admin/intake`)).status(),
    401,
  );
  const before = new Set(await readdir(runtime));
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email address").fill("staging-owner@example.test");
  await page.getByRole("button", { name: "Continue with email" }).click();
  let filename;
  for (let i = 0; i < 40; i++) {
    filename = (await readdir(runtime)).find(
      (name) => name.startsWith("mail-") && !before.has(name),
    );
    if (filename) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(filename, "local mail capture missing");
  const mail = JSON.parse(await readFile(join(runtime, filename), "utf8"));
  assert.equal(new URL(mail.url).origin, origin);
  await page.goto(mail.url);
  await page.getByRole("button", { name: "Confirm sign-in" }).click();
  await page.getByText("staging-owner@example.test", { exact: true }).waitFor();
  await page.goto(`${origin}/admin`);
  await page.getByRole("heading", { name: "Editorial desk" }).waitFor();
  const session = (await context.cookies(origin)).find((cookie) =>
    /session_token/.test(cookie.name),
  );
  assert.ok(session?.httpOnly && session.secure && session.sameSite === "Lax");
  await page.getByRole("button", { name: "New record" }).click();
  for (const [label, value] of Object.entries({
    Slug: slug,
    "English title": "Staging smoke skill",
    "Russian title": "Проверка staging",
    "English summary": "An isolated test record.",
    "Russian summary": "Изолированная тестовая запись.",
    "English body": "Inspect only staging data.",
    "Russian body": "Проверяйте только данные staging.",
    "Source URL": "https://example.test/source",
  }))
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("button", { name: "Publish", exact: true }).waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  let published = false;
  for (let i = 0; i < 30; i++) {
    const records = await (
      await context.request.get(
        `${origin}/api/admin/records?kind=skill&q=${slug}`,
      )
    ).json();
    if (
      records.items?.some(
        (item) => item.slug === slug && item.status === "published",
      )
    ) {
      published = true;
      break;
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(published, "staging record was not published");
  const response = await page.goto(`${origin}/ru/skills/${slug}`);
  assert.equal(response.status(), 200);
  await page
    .getByRole("heading", { name: "Проверка staging", exact: true })
    .waitFor();
  assert.equal(await page.locator("html").getAttribute("lang"), "ru");
  const serviceToken = (
    await readFile(intakeTokenFile || join(runtime, "intake-token"), "utf8")
  ).trim();
  const repository = "https://github.com/fixture/staging-skills",
    commit = "a".repeat(40);
  const report = {
    schemaVersion: 1,
    repository: { url: repository },
    commit,
    archiveSha256: "c".repeat(64),
    skills: Array.from({ length: 32 }, (_, i) => ({
      id: `staging-candidate-${i}`,
      name: `Staging candidate ${i}`,
      description: "Isolated smoke-test candidate.",
      path: `skill-${i}/SKILL.md`,
      sourceUrl: `${repository}/blob/${commit}/skill-${i}/SKILL.md`,
      bundleSha256: "b".repeat(64),
      license: "MIT",
      qualityScore: 80,
      status: "needs_review",
      reviewText: "Review only these isolated instructions.",
      findings: [
        {
          code: "fixture-review",
          severity: "info",
          path: `skill-${i}/SKILL.md`,
          line: 3,
          message: "Inspect the fixture.",
        },
      ],
    })),
  };
  const intake = await context.request.post(`${origin}/api/intake/reports`, {
    headers: { Authorization: `Bearer ${serviceToken}` },
    data: report,
  });
  assert.equal(intake.status(), 200);
  await page.goto(`${origin}/admin`);
  await page.getByRole("link", { name: "GitHub imports", exact: true }).click();
  await page
    .getByRole("heading", { name: "GitHub imports", exact: true })
    .waitFor();
  await page
    .getByRole("searchbox", { name: "Search candidates" })
    .fill("Staging candidate");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page
    .getByRole("button", { name: "Inspect", exact: true })
    .first()
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Inspect", exact: true }).count(),
    25,
  );
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page
    .getByRole("button", { name: "Inspect", exact: true })
    .first()
    .waitFor();
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("button")).filter(
        (b) => b.textContent === "Inspect",
      ).length === 7,
  );
  const second = await (
    await context.request.get(
      `${origin}/api/admin/intake?offset=25&q=Staging%20candidate`,
    )
  ).json();
  assert.equal(second.items.length, 7);
  await page
    .getByRole("button", { name: "Inspect", exact: true })
    .first()
    .click();
  await page
    .getByRole("heading", { level: 3 })
    .filter({ hasText: "Staging candidate" })
    .waitFor();
  assert.ok(await page.getByText(/Inspect the fixture/).count());
  await page.getByRole("button", { name: "Pause import", exact: true }).click();
  await page.getByText("Import is paused", { exact: true }).waitFor();
  const paused = await context.request.post(`${origin}/api/intake/reports`, {
    headers: { Authorization: `Bearer ${serviceToken}` },
    data: report,
  });
  assert.equal(paused.status(), 409);
  await page
    .getByRole("button", { name: "Resume import", exact: true })
    .click();
  await page
    .getByText("Scheduled import is enabled", { exact: true })
    .waitFor();
  const beforeRun = (
    await (await context.request.get(`${origin}/api/admin/intake`)).json()
  ).control;
  if (!beforeRun.manualRequest && beforeRun.manualAvailableAt <= Date.now()) {
    await page
      .getByRole("button", { name: "Run a limited import", exact: true })
      .click();
    assert.ok(
      await page
        .getByRole("button", { name: "Run queued", exact: true })
        .isDisabled(),
    );
  }
  const repeatRun = await context.request.post(
    `${origin}/api/admin/intake/run`,
    { headers: { Origin: origin, "Sec-Fetch-Site": "same-origin" }, data: {} },
  );
  assert.ok(
    [202, 429].includes(repeatRun.status()),
    `Manual request returned ${repeatRun.status()}`,
  );
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    accessibility.violations.map((item) => ({
      id: item.id,
      nodes: item.nodes.map((node) => node.target),
    })),
    [],
  );
  await mkdir(resolve("output/playwright"), { recursive: true });
  await page.screenshot({
    path: resolve("output/playwright/staging-intake.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      origin,
      login: "confirmed via local capture",
      publication: "EN/RU runtime",
      queue: "32 candidates across pages",
      manualRun: "queued or deduplicated/rate limited",
      pageErrors: 0,
    }),
  );
} finally {
  await browser.close();
}
