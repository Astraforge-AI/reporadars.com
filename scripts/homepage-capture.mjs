import { chromium } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
const base = process.env.BASE_URL || "http://127.0.0.1:4318";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
});
await mkdir("artifacts", { recursive: true });
const page = await browser.newPage({
  viewport: { width: 1487, height: 1058 },
  reducedMotion: "reduce",
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (e) => {
  if (e.type() === "error") errors.push(e.text());
});
await page.goto(base, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: "artifacts/desktop-final.png" });
console.log(
  "desktop",
  await page
    .locator(".hero-bottom,.signals-section")
    .evaluateAll((es) =>
      es.map((e) => ({
        y: e.getBoundingClientRect().y,
        h: e.getBoundingClientRect().height,
      })),
    ),
);
for (const width of [320, 390, 768, 1024, 1920]) {
  await page.setViewportSize({ width, height: width > 1000 ? 1080 : 844 });
  await page.evaluate(() => document.fonts.ready);
  console.log(
    "viewport",
    width,
    await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      headlineRight: Math.max(
        ...[...document.querySelectorAll(".headline-line")].map(
          (e) => e.getBoundingClientRect().right,
        ),
      ),
    })),
  );
  if ([390, 768, 1920].includes(width))
    await page.screenshot({
      path: `artifacts/responsive-${width}.png`,
      fullPage: true,
    });
}
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(base + "/?panel=about");
await page.locator("dialog[open]").waitFor();
await page.screenshot({ path: "artifacts/mobile-dialog.png" });
await page.keyboard.press("Escape");
console.log("console errors", errors);
if (process.env.REFERENCE_DIR) {
  const source = await readFile(
    join(
      process.env.REFERENCE_DIR,
      "exec-7a1b306d-823e-4c4b-a452-c4b46a775c83.png",
    ),
  );
  const built = await readFile("artifacts/desktop-final.png");
  const compare = await browser.newPage({
    viewport: { width: 2974, height: 1058 },
  });
  await compare.setContent(
    `<body style="margin:0;display:flex"><img width="1487" height="1058" src="data:image/png;base64,${source.toString("base64")}"><img width="1487" height="1058" src="data:image/png;base64,${built.toString("base64")}"></body>`,
  );
  await compare
    .locator("img")
    .evaluateAll((imgs) => Promise.all(imgs.map((i) => i.decode())));
  await compare.screenshot({ path: "artifacts/reference-comparison.png" });
  await compare.setViewportSize({ width: 1800, height: 420 });
  await compare.setContent(
    `<body style="margin:0;display:flex">${[source, built].map((image) => `<div style="width:900px;height:420px;position:relative;overflow:hidden"><img style="position:absolute;left:-30px;top:-145px;max-width:none" width="1487" height="1058" src="data:image/png;base64,${image.toString("base64")}"></div>`).join("")}</body>`,
  );
  await compare
    .locator("img")
    .evaluateAll((imgs) => Promise.all(imgs.map((i) => i.decode())));
  await compare.screenshot({ path: "artifacts/type-comparison.png" });
}
await browser.close();
if (errors.length) process.exitCode = 1;
