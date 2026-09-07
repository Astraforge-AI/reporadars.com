import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const manifest = JSON.parse(
  await readFile(new URL("../dist/homepage-manifest.json", import.meta.url)),
);
const base = process.env.BASE_URL || "http://127.0.0.1:4318";
const get = (path, options = {}) =>
  fetch(new URL(path, base), {
    signal: AbortSignal.timeout(15000),
    ...options,
  });
let count = 0;
let downloads = 0;
const pending = [...manifest.files];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (pending.length) {
      const path = pending.shift();
      const response = await get(path);
      assert.equal(
        response.status,
        /\/404(?:\.html)?$/.test(path) ? 404 : 200,
        path,
      );
      assert.equal(
        response.headers.get("x-reporadars-release"),
        manifest.release,
        path,
      );
      const bytes = Buffer.from(await response.arrayBuffer());
      const digest = `"${createHash("sha256").update(bytes).digest("hex").slice(0, 24)}"`;
      assert.equal(
        response.headers.get("etag")?.replace(/^W\//, ""),
        digest,
        `${path} content digest`,
      );
      if (response.headers.get("content-type").includes("text/html")) {
        const locale = /^\/ru(?:\/|$)/.test(path) ? "ru" : "en";
        assert.equal(response.headers.get("content-language"), locale, path);
        const html = bytes.toString();
        assert.match(html, new RegExp(`<html lang="${locale}"`), path);
        assert.match(html, /hreflang="ru"/, path);
        assert.match(html, /hreflang="en"/, path);
        if (/\/(?:account|login)$/.test(path))
          assert.equal(
            response.headers.get("cache-control"),
            "private, no-store",
            path,
          );
      }
      if (path.endsWith("/SKILL.md")) {
        assert.match(
          response.headers.get("content-disposition"),
          /^attachment;/,
        );
        assert.match(bytes.toString(), /^---\n/);
        downloads++;
      }
      count++;
    }
  }),
);
for (const path of [
  "/",
  "/ru",
  "/login",
  "/ru/skills",
  "/journal/seo-audit-boundaries",
]) {
  const head = await get(path, { method: "HEAD" });
  assert.equal(head.status, 200, path);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal(
    (
      await get(path, {
        headers: { "If-None-Match": head.headers.get("etag") },
      })
    ).status,
    304,
  );
}
for (const path of [
  "/skills/missing",
  "/ru/journal/missing",
  "/404",
  "/ru/404",
]) {
  const response = await get(path, { headers: { "If-None-Match": "*" } });
  assert.equal(response.status, 404, path);
  assert.match(await response.text(), /<h1/);
}
if (process.env.VERIFY_ORIGIN === "1") {
  assert.equal(
    new URL(base).hostname,
    "reporadars.com",
    "origin checks require the explicitly selected public site",
  );
  for (const host of ["reporadars.com", "www.reporadars.com"]) {
    const health = await fetch(`https://${host}/health`, {
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, "ok");
    assert.equal(health.headers.get("x-reporadars-release"), null);
    const v1 = await fetch(`https://${host}/v1`, {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(v1.status, 301);
    const api = await fetch(`https://${host}/deckview-api/v1/archetypes`, {
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(api.status, 200);
    assert.equal(api.headers.get("x-reporadars-release"), null);
    console.log({
      host,
      archetypesBytes: (await api.arrayBuffer()).byteLength,
      health: "ok",
      v1: 301,
    });
  }
  const redirect = await fetch(
    "https://www.reporadars.com/ru/journal/?type=review",
    { redirect: "manual" },
  );
  assert.equal(redirect.status, 308);
  assert.equal(
    redirect.headers.get("location"),
    "https://reporadars.com/ru/journal?type=review",
  );
  const missing = await get("/reporadars-check-missing-page", {
    headers: { Accept: "text/html" },
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("x-reporadars-release"), manifest.release);
}
console.log({
  base,
  release: manifest.release,
  resources: count,
  downloads,
  result: "PASS",
});
