import test from "node:test";
import assert from "node:assert/strict";
import { createHomepageWorker } from "../scripts/homepage-worker.mjs";
const files = {
  "/": {
    body: Buffer.from("<h1>Reporadars</h1>").toString("base64"),
    type: "text/html; charset=utf-8",
    cache: "public, max-age=0, must-revalidate",
    etag: '"homepage"',
    release: "test",
  },
  "/reporadars-assets/assets/app.js": {
    body: Buffer.from('console.log("hello")').toString("base64"),
    type: "text/javascript",
    cache: "public, max-age=31536000, immutable",
    etag: '"script"',
    release: "test",
  },
};
test("serves homepage, query strings and assets with appropriate headers", async () => {
  const worker = createHomepageWorker(files, () => {
    throw new Error("Unexpected origin");
  });
  for (const path of ["/", "/?utm_source=test", "/index.html"]) {
    const response = await worker.fetch(
      new Request(`https://reporadars.com${path}`),
    );
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "<h1>Reporadars</h1>");
    assert.match(
      response.headers.get("Content-Security-Policy"),
      /frame-ancestors 'none'/,
    );
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  const js = await worker.fetch(
    new Request("https://reporadars.com/reporadars-assets/assets/app.js"),
  );
  assert.match(js.headers.get("Cache-Control"), /immutable/);
});
test("retains original API request method, URL, headers and body", async () => {
  for (const path of [
    "/health",
    "/v1",
    "/render",
    "/translate",
    "/archetypes",
    "/",
  ]) {
    const request = new Request(`https://reporadars.com${path}?lang=en`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Test": "original" },
      body: '{"test":true}',
    });
    let called = false;
    const worker = createHomepageWorker(files, async (incoming) => {
      called = true;
      assert.equal(incoming, request);
      assert.equal(await incoming.text(), '{"test":true}');
      return new Response("origin", { status: 202 });
    });
    assert.equal((await worker.fetch(request)).status, 202);
    assert.ok(called);
  }
  const response = await createHomepageWorker(
    files,
    () => new Response("healthy"),
  ).fetch(new Request("https://reporadars.com/health"));
  assert.equal(await response.text(), "healthy");
});
test("owned missing assets are 404; HEAD and ETag responses have no bodies", async () => {
  const worker = createHomepageWorker(files, () => {
    throw new Error("Unexpected origin");
  });
  const missing = await worker.fetch(
    new Request("https://reporadars.com/reporadars-assets/missing.js"),
  );
  assert.equal(missing.status, 404);
  const head = await worker.fetch(
    new Request("https://reporadars.com/", { method: "HEAD" }),
  );
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  const cached = await worker.fetch(
    new Request("https://reporadars.com/", {
      headers: { "If-None-Match": '"other", "homepage"' },
    }),
  );
  assert.equal(cached.status, 304);
  assert.equal(await cached.text(), "");
});
test("redirects www homepage while retaining query and API behavior", async () => {
  const worker = createHomepageWorker(files, () => new Response("origin"));
  const response = await worker.fetch(
    new Request("https://www.reporadars.com/?ref=launch"),
  );
  assert.equal(response.status, 308);
  assert.equal(
    response.headers.get("Location"),
    "https://reporadars.com/?ref=launch",
  );
  assert.equal(
    await (
      await worker.fetch(new Request("https://www.reporadars.com/health"))
    ).text(),
    "origin",
  );
});
test("revalidates weak CDN ETags and wildcards using GET/HEAD comparison semantics", async () => {
  const worker = createHomepageWorker(files, () => {
    throw new Error("Unexpected origin");
  });
  for (const method of ["GET", "HEAD"]) {
    for (const tag of ['W/"homepage"', '"other", W/"homepage"', "*"]) {
      const cached = await worker.fetch(
        new Request("https://reporadars.com/", {
          method,
          headers: { "If-None-Match": tag },
        }),
      );
      assert.equal(cached.status, 304, `${method} ${tag}`);
      assert.equal(await cached.text(), "");
    }
  }
  const changed = await worker.fetch(
    new Request("https://reporadars.com/", {
      headers: { "If-None-Match": 'W/"outdated"' },
    }),
  );
  assert.equal(changed.status, 200);
  assert.equal(await changed.text(), "<h1>Reporadars</h1>");
});
