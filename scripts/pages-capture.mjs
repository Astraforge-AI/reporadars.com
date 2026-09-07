import { chromium } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
const base = process.env.BASE_URL || "http://127.0.0.1:4318";
const folder = process.env.CAPTURE_DIR || "artifacts/pages-final";
await mkdir(folder, { recursive: true });
const refs = process.env.REFERENCE_DIR;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1487, height: 1058 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
});
const errors = [];
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const targets = [
  ["library", "/skills", "exec-fb0251ea-89ad-4ada-b135-b64caf254f7e.png"],
  [
    "skill",
    "/skills/seo-audit",
    "exec-bfc95f42-415a-47fb-b67d-5e792d7dc92a.png",
  ],
  ["account", "/account", "exec-bd7fc948-bbec-4308-80b2-771774d5b14f.png"],
];
for (const [name, path, reference] of targets) {
  await page.setViewportSize({ width: 1487, height: 1058 });
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  if (name === "account") {
    await page.screenshot({ path: `${folder}/account-empty.png` });
    // Isolated QA fixture only. It never ships in HTML or default application state.
    await page.evaluate(() =>
      localStorage.setItem(
        "reporadars.workspace.v1",
        JSON.stringify({
          version: 1,
          profile: {
            name: "Kate Andersen",
            role: "Skill curator",
            bio: "Curating reliable tools for developers and agents.",
            avatar: "portrait",
          },
          savedIds: [
            "api-contract",
            "sql-performance",
            "security-review",
            "seo-audit",
            "browser-testing",
          ],
        }),
      ),
    );
    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
  }
  await page.screenshot({ path: `${folder}/${name}-desktop.png` });
  if (refs) {
    const source = await readFile(join(refs, reference)),
      actual = await readFile(`${folder}/${name}-desktop.png`);
    const comparison = await context.newPage();
    await comparison.setViewportSize({ width: 2974, height: 1058 });
    await comparison.setContent(
      `<body style="margin:0;display:flex">${[source, actual].map((b) => `<img width="1487" height="1058" src="data:image/png;base64,${b.toString("base64")}">`).join("")}</body>`,
    );
    await comparison
      .locator("img")
      .evaluateAll((es) => Promise.all(es.map((e) => e.decode())));
    await comparison.screenshot({ path: `${folder}/${name}-comparison.png` });
    await comparison.setViewportSize({ width: 1800, height: 330 });
    await comparison.setContent(
      `<body style="margin:0;display:flex">${[source, actual].map((b) => `<div style="width:900px;height:330px;position:relative;overflow:hidden"><img style="position:absolute;left:-30px;top:-125px;max-width:none" width="1487" height="1058" src="data:image/png;base64,${b.toString("base64")}"></div>`).join("")}</body>`,
    );
    await comparison
      .locator("img")
      .evaluateAll((es) => Promise.all(es.map((e) => e.decode())));
    await comparison.screenshot({
      path: `${folder}/${name}-type-comparison.png`,
    });
    await comparison.close();
  }
  for (const width of [320, 390, 768, 1920]) {
    await page.setViewportSize({ width, height: width > 1000 ? 1080 : 844 });
    await page.evaluate(() => document.fonts.ready);
    const bounds = await page.evaluate(() => ({
      viewport: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    console.log(name, bounds);
    if (bounds.scroll > bounds.viewport)
      errors.push(`${name} horizontal overflow ${width}`);
    await page.screenshot({
      path: `${folder}/${name}-${width}.png`,
      fullPage: true,
    });
  }
}
await page.setViewportSize({ width: 1487, height: 1058 });
await page.goto(base + "/", { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: `${folder}/home.png` });
console.log({ base, folder, errors });
await browser.close();
if (errors.length) process.exitCode = 1;
