import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createPreviewServer } from "../../scripts/homepage-preview.mjs";

function rawRequest(port, pathname, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path: pathname, method },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("canonical and encoded auth paths never reach the Worker origin fallback", async () => {
  let workerCalls = 0;
  const server = createPreviewServer({
    loadWorker: async () => ({
      fetch: async () => {
        workerCalls++;
        return new Response("static page");
      },
    }),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    for (const route of [
      "/api/auth/session",
      "/x/../api/auth/session",
      "/%2e/api/auth/session",
    ]) {
      assert.equal(await rawRequest(port, route), 200);
    }
    for (const route of [
      "/x/../api/auth/confirm",
      "/api",
      "/API/auth/session",
    ]) {
      assert.equal(await rawRequest(port, route), 503);
    }
    for (const route of [
      "/%61pi/auth/session",
      "/api%2fauth/session",
      "http://external.invalid/api/auth/session",
    ]) {
      assert.equal(await rawRequest(port, route), 400);
    }
    assert.equal(await rawRequest(port, "/other", "POST"), 405);
    assert.equal(workerCalls, 0);
    assert.equal(await rawRequest(port, "/login"), 200);
    assert.equal(workerCalls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("preview and Next.js development reject non-loopback auth upstreams", async () => {
  assert.throws(() =>
    createPreviewServer({ authOrigin: "https://reporadars.com" }),
  );
  assert.throws(() =>
    createPreviewServer({ authOrigin: "http://127.0.0.1:4320/path" }),
  );
  const previous = process.env.AUTH_PREVIEW_API_ORIGIN;
  try {
    process.env.AUTH_PREVIEW_API_ORIGIN = "http://127.0.0.1:4320";
    const { developmentSettings } =
      await import("../../scripts/dev-settings.mjs");
    assert.equal(developmentSettings().host, "127.0.0.1");
    assert.equal(developmentSettings().authOrigin, "http://127.0.0.1:4320");
    assert.throws(() => developmentSettings("https://reporadars.com"));
    assert.throws(() => developmentSettings("http://127.0.0.1:4320/path"));
  } finally {
    if (previous === undefined) delete process.env.AUTH_PREVIEW_API_ORIGIN;
    else process.env.AUTH_PREVIEW_API_ORIGIN = previous;
  }
});
