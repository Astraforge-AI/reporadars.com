import { chromium } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
const base = process.env.BASE_URL || "http://127.0.0.1:4318";
const folder = process.env.CAPTURE_DIR || "artifacts/locale-final";
const refs = process.env.REFERENCE_DIR;
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1487, height: 1058 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
});
const page = await context.newPage();
const errors = [];
let target = "";
page.on("pageerror", (error) => errors.push(`${target}: ${error.message}`));
page.on("console", (message) => {
  const resourcePath = new URL(message.location().url || "about:blank")
    .pathname;
  const expected404 =
    /^\/(?:ru\/)?404$/.test(resourcePath) &&
    /^Failed to load resource: the server responded with a status of 404 \((?:Not Found)?\)$/.test(
      message.text(),
    );
  if (message.type() === "error" && !expected404)
    errors.push(`${target}: ${message.text()}`);
});
const targets = [
  ["login", "/login", "exec-c6a2e9fe-f783-41c2-8e6c-2bd860b8b236.png"],
  ["notfound", "/404", "exec-60e4b9d4-eec1-480a-ab4e-ff3c853f70fc.png"],
  ["journal", "/journal", "exec-b8a50da6-05af-4b9d-84cc-4a48e90c3000.png"],
  [
    "article",
    "/journal/seo-audit-boundaries",
    "exec-b7792329-3298-464c-b6d5-80a16cd84150.png",
  ],
  ["home", "/"],
  ["library", "/skills"],
  ["skill", "/skills/seo-audit"],
  ["account", "/account"],
];
for (const [name, path, reference] of targets) {
  for (const locale of ["en", "ru"]) {
    target = locale === "ru" ? `/ru${path === "/" ? "" : path}` : path;
    await page.setViewportSize({ width: 1487, height: 1058 });
    await page.goto(base + target, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${folder}/${name}-${locale}-desktop.png` });
    if (refs && reference && locale === "en") {
      const buffers = await Promise.all([
        readFile(join(refs, reference)),
        readFile(`${folder}/${name}-en-desktop.png`),
      ]);
      const comparison = await context.newPage();
      await comparison.setViewportSize({ width: 2974, height: 1058 });
      await comparison.setContent(
        `<body style="margin:0;display:flex">${buffers.map((b) => `<img width="1487" height="1058" src="data:image/png;base64,${b.toString("base64")}">`).join("")}</body>`,
      );
      await comparison
        .locator("img")
        .evaluateAll((es) => Promise.all(es.map((e) => e.decode())));
      await comparison.screenshot({ path: `${folder}/${name}-comparison.png` });
      await comparison.setViewportSize({ width: 1800, height: 330 });
      await comparison.setContent(
        `<body style="margin:0;display:flex">${buffers.map((b) => `<div style="width:900px;height:330px;position:relative;overflow:hidden"><img style="position:absolute;left:-40px;top:-130px;max-width:none" width="1487" height="1058" src="data:image/png;base64,${b.toString("base64")}"></div>`).join("")}</body>`,
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
      const bounds = await page.evaluate(() => ({
        viewport: innerWidth,
        scroll: document.documentElement.scrollWidth,
        title: document.querySelector("h1")?.getBoundingClientRect().toJSON(),
      }));
      if (bounds.scroll > width)
        errors.push(`${target}: document overflow ${width}/${bounds.scroll}`);
      if (bounds.title?.x < -1 || bounds.title?.right > width + 1)
        errors.push(
          `${target}: heading overflow ${width}/${JSON.stringify(bounds.title)}`,
        );
      await page.screenshot({
        path: `${folder}/${name}-${locale}-${width}.png`,
        fullPage: true,
      });
    }
    console.log({ target, captured: 5 });
  }
}
console.log({ base, folder, errors });
await browser.close();
if (errors.length) process.exitCode = 1;
