import test from "node:test";
import assert from "node:assert/strict";
import { createHomepageWorker } from "../scripts/homepage-worker.mjs";
import {
  skills,
  pagePaths,
  skillMarkdown,
  resolvePage,
} from "../src/data/skills.js";
const file = (body, type = "text/html; charset=utf-8") => ({
  body: Buffer.from(body).toString("base64"),
  type,
  etag: '"test"',
  cache: "private, no-store",
  release: "test",
});
const files = {
  "/": file("home"),
  "/skills": file("library"),
  "/collections": file("collections"),
  "/skills/seo-audit": file("SEO Audit"),
  "/account": file("local workspace"),
  "/404.html": file("Signal not found"),
  "/skills/seo-audit/SKILL.md": {
    ...file("---\nname: seo-audit\n---", "text/markdown; charset=utf-8"),
    download: "seo-audit-SKILL.md",
  },
};
test("explicit pages serve deep links, safe markdown downloads, and unknown skill 404s", async () => {
  const worker = createHomepageWorker(files, () => new Response("origin"));
  for (const path of [
    "/skills",
    "/collections",
    "/skills/seo-audit",
    "/account",
  ]) {
    const r = await worker.fetch(new Request("https://reporadars.com" + path));
    assert.equal(r.status, 200);
    assert.match(r.headers.get("Content-Type"), /text\/html/);
  }
  const dl = await worker.fetch(
    new Request("https://reporadars.com/skills/seo-audit/SKILL.md"),
  );
  assert.match(
    dl.headers.get("Content-Disposition"),
    /attachment; filename="seo-audit-SKILL.md"/,
  );
  assert.match(await dl.text(), /name: seo-audit/);
  const missing = await worker.fetch(
    new Request("https://reporadars.com/skills/missing", {
      headers: { "If-None-Match": "*" },
    }),
  );
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), "Signal not found");
  assert.equal(
    await (
      await worker.fetch(new Request("https://reporadars.com/api/private"))
    ).text(),
    "origin",
  );
  assert.equal(
    await (
      await worker.fetch(
        new Request("https://reporadars.com/skills/seo-audit", {
          method: "POST",
          body: "test",
        }),
      )
    ).text(),
    "origin",
  );
});
test("canonicalizes only existing app pages without rewriting www API or root index contract", async () => {
  const worker = createHomepageWorker(files, () => new Response("origin"));
  for (const url of [
    "https://reporadars.com/skills/?q=seo",
    "https://www.reporadars.com/skills?q=seo",
  ]) {
    const r = await worker.fetch(new Request(url));
    assert.equal(r.status, 308);
    assert.equal(
      r.headers.get("Location"),
      "https://reporadars.com/skills?q=seo",
    );
  }
  assert.equal(
    (await worker.fetch(new Request("https://reporadars.com/index.html")))
      .status,
    200,
  );
  assert.equal(
    await (
      await worker.fetch(new Request("https://www.reporadars.com/health"))
    ).text(),
    "origin",
  );
});
test("catalog IDs, page paths and skill downloads form a bounded consistent registry", () => {
  assert.equal(new Set(skills.map((s) => s.id)).size, skills.length);
  for (const skill of skills) {
    assert.match(skill.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(resolvePage("/skills/" + skill.id).skill.id, skill.id);
    assert(pagePaths.includes("/skills/" + skill.id));
    const text = skillMarkdown(skill);
    assert.match(text, /status: draft/);
    assert.match(text, /## Scope and permissions/);
    assert.match(text, /## Reference/);
    assert(!text.includes("undefined"));
    assert.equal(new URL(skill.sourceUrl).protocol, "https:");
  }
  assert.equal(resolvePage("/skills/not-in-library").type, "not-found");
});
