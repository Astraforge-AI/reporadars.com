import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import test from "node:test";

import { journalEntries } from "../src/data/journal.js";
import { getLocalizedSkills } from "../src/data/skills-ru.js";
import { pagePaths, skills } from "../src/data/skills.js";
import { localeHref, splitLocalePath } from "../src/locale-paths.js";
import { createHomepageWorker } from "../scripts/homepage-worker.mjs";

const builtWorkerUrl = new URL(
  "../dist/reporadars.worker.mjs",
  import.meta.url,
);

// Deliberately defer this import: the shared build is produced by the root task.
async function builtWorker() {
  const { mtimeMs } = await stat(builtWorkerUrl);
  return (await import(`${builtWorkerUrl.href}?locale-test=${mtimeMs}`))
    .default;
}

test("locale path helpers only recognize the /ru boundary and preserve safe suffixes", () => {
  assert.deepEqual(splitLocalePath("/ru/skills?q=seo#table"), {
    locale: "ru",
    path: "/skills",
  });
  assert.deepEqual(splitLocalePath("/ru"), { locale: "ru", path: "/" });
  assert.deepEqual(splitLocalePath("/rubbish?q=seo"), {
    locale: "en",
    path: "/rubbish",
  });
  assert.equal(
    localeHref("/skills?q=seo#table", "ru"),
    "/ru/skills?q=seo#table",
  );
  assert.equal(
    localeHref("/ru/skills?q=seo#table", "en"),
    "/skills?q=seo#table",
  );
  assert.equal(
    localeHref("//elsewhere.test/path", "ru"),
    "//elsewhere.test/path",
  );
  assert.equal(
    localeHref("https://elsewhere.test/path", "ru"),
    "https://elsewhere.test/path",
  );
});

test("Russian catalog data has one localized record for every stable skill ID", () => {
  const russian = getLocalizedSkills("ru");
  assert.equal(skills.length, 8);
  assert.equal(russian.length, skills.length);
  assert.deepEqual(
    russian.map(({ id }) => id),
    skills.map(({ id }) => id),
  );
  for (const skill of russian) {
    assert.match(skill.title, /\S/);
    assert.match(skill.summary, /\S/);
    assert.match(skill.searchTerms, new RegExp(skill.id));
  }
});

test("journal fixture has five distinct articles, each with eight unique sections", () => {
  assert.equal(journalEntries.length, 5);
  assert.equal(new Set(journalEntries.map(({ id }) => id)).size, 5);
  for (const article of journalEntries) {
    assert.equal(article.sections.length, 8, article.id);
    assert.equal(
      new Set(article.sections.map(([id]) => id)).size,
      8,
      article.id,
    );
    assert.match(article.title.en, /\S/);
    assert.match(article.title.ru, /\S/);
  }
});

test("built SSR direct-loads every English and Russian route with language metadata", async () => {
  const worker = await builtWorker();
  for (const path of pagePaths) {
    const response = await worker.fetch(
      new Request(`https://reporadars.com${path}`),
    );
    assert.equal(response.status, path.endsWith("/404") ? 404 : 200, path);
    const html = await response.text();
    const locale = path === "/ru" || path.startsWith("/ru/") ? "ru" : "en";
    assert.match(
      html,
      new RegExp(`<html[^>]+lang=["']${locale}["']`, "i"),
      path,
    );
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "";
    assert.match(h1.replace(/<[^>]+>/g, " "), /\S/, path);
    assert.match(
      html,
      new RegExp(
        `<link[^>]+rel=["']canonical["'][^>]+href=["']https://reporadars\\.com${path === "/" ? "/" : path}["']`,
        "i",
      ),
      path,
    );
    assert.match(html, /hreflang=["']en["']/i, path);
    assert.match(html, /hreflang=["']ru["']/i, path);
  }
});

test("Next.js page data and encoded route chunks are served without origin fallback", async () => {
  const worker = await builtWorker();
  const homepage = await (
    await worker.fetch(new Request("https://reporadars.com/"))
  ).text();
  const nextData = JSON.parse(
    homepage.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)[1],
  );
  for (const path of pagePaths.filter((path) => path !== "/404")) {
    const route = path === "/" ? "/index" : path;
    const response = await worker.fetch(
      new Request(
        `https://reporadars.com/_next/data/${nextData.buildId}${route}.json`,
      ),
    );
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("Content-Type"), /application\/json/);
    assert.equal((await response.json()).pageProps.path, path);
  }
  const chunk = homepage.match(/src="([^"]*%5B[^\"]*\.js)"/i)[1];
  const response = await worker.fetch(
    new Request(`https://reporadars.com${chunk}`),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /javascript/);
});

test("404 routes remain errors even with a matching ETag", async () => {
  const worker = await builtWorker();
  for (const path of ["/404", "/ru/404", "/404.html"]) {
    const response = await worker.fetch(
      new Request(`https://reporadars.com${path}`, {
        headers: { "If-None-Match": "*" },
      }),
    );
    assert.equal(response.status, 404, path);
    assert.notEqual(response.status, 304, path);
    assert.match(await response.text(), /<h1/i, path);
  }
});

test("API and non-GET requests pass unchanged to origin in the scoped worker unit", async () => {
  const requests = [];
  const worker = createHomepageWorker({}, async (request) => {
    requests.push(request);
    return new Response("origin", { status: 202 });
  });
  for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]) {
    const body = ["GET", "HEAD"].includes(method)
      ? undefined
      : "no-write-fixture";
    const response = await worker.fetch(
      new Request("https://reporadars.com/api/workspace", {
        method,
        headers: { "X-Locale-Test": method },
        body,
      }),
    );
    assert.equal(response.status, 202, method);
  }
  assert.equal(requests.length, 6);
  for (const [index, request] of requests.entries()) {
    assert.equal(request.url, "https://reporadars.com/api/workspace");
    assert.equal(request.headers.get("X-Locale-Test"), request.method);
    if (!["GET", "HEAD"].includes(request.method))
      assert.equal(await request.text(), "no-write-fixture");
    assert.equal(
      request.method,
      ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"][index],
    );
  }
});

test("only browser HTML 404s from safe origin routes receive the designed fallback", async () => {
  const fallback = {
    body: Buffer.from("Designed fallback").toString("base64"),
    type: "text/html; charset=utf-8",
    etag: '"fallback"',
    cache: "no-store",
    release: "test",
  };
  const seen = [];
  const worker = createHomepageWorker(
    { "/404.html": fallback },
    async (request) => {
      seen.push(request);
      if (new URL(request.url).pathname === "/ok")
        return new Response("origin success", {
          headers: { "Content-Type": "text/html" },
        });
      return new Response("origin missing", {
        status: 404,
        headers: {
          "Content-Type":
            new URL(request.url).pathname === "/image.png"
              ? "image/png"
              : "text/html; charset=utf-8",
        },
      });
    },
  );
  const browser404 = await worker.fetch(
    new Request("https://reporadars.com/unlisted", {
      headers: { Accept: "text/html,application/xhtml+xml" },
    }),
  );
  assert.equal(browser404.status, 404);
  assert.equal(await browser404.text(), "Designed fallback");
  for (const path of [
    "/api/nope",
    "/v1/nope",
    "/deckview-api/nope",
    "/health",
    "/image.png",
  ]) {
    const response = await worker.fetch(
      new Request(`https://reporadars.com${path}`, {
        headers: { Accept: "text/html" },
      }),
    );
    assert.equal(response.status, 404, path);
    assert.equal(await response.text(), "origin missing", path);
  }
  const nonBrowser = await worker.fetch(
    new Request("https://reporadars.com/unlisted", {
      headers: { Accept: "application/json" },
    }),
  );
  assert.equal(await nonBrowser.text(), "origin missing");
  const success = await worker.fetch(
    new Request("https://reporadars.com/ok", {
      headers: { Accept: "text/html" },
    }),
  );
  assert.equal(success.status, 200);
  assert.equal(await success.text(), "origin success");
  assert.equal(seen.length, 8);
});
