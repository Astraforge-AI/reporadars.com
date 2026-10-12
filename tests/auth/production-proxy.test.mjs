import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { withProductionProxy } from "../../server/production-proxy.mjs";
import { startProduction } from "../../server/production-start.mjs";
import { createAdminHttpServer } from "../../server/admin-http.mjs";

function request(headers = {}) {
  return new Request("https://reporadars.com/api/admin/session", { headers });
}

test("production proxy refuses forged, missing, and non-single client identities", async () => {
  let calls = 0;
  const proxy = withProductionProxy({
    async handle() {
      calls++;
      return new Response("ok");
    },
  });
  for (const [ip, header] of [
    ["203.0.113.8", "198.51.100.9"],
    ["127.0.0.1", undefined],
    ["127.0.0.1", "198.51.100.9, 2001:db8::1"],
    ["127.0.0.1", "not-an-ip"],
  ]) {
    const response = await proxy.handle(request(header ? { "x-reporadars-client-ip": header } : {}), { ip });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: { code: "UNAVAILABLE" } });
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(calls, 0);
});

test("production proxy supplies valid IPv4 and IPv6 identity independently of forwarding headers", async () => {
  const seen = [];
  const proxy = withProductionProxy({
    async handle(_request, context) {
      seen.push(context.ip);
      return new Response("ok");
    },
  });
  for (const ip of ["198.51.100.9", "2001:db8::9"]) {
    const response = await proxy.handle(request({
      "x-reporadars-client-ip": ip,
      "x-forwarded-for": "203.0.113.99",
      "cf-connecting-ip": "203.0.113.100",
    }), { ip: "127.0.0.1" });
    assert.equal(response.status, 200);
  }
  assert.deepEqual(seen, ["198.51.100.9", "2001:db8::9"]);
});

test("HTTP integration preserves request body, cookies and multiple response cookies", async () => {
  let received;
  const proxy = withProductionProxy({
    async handle(input, context) {
      received = { method: input.method, body: await input.text(), cookie: input.headers.get("cookie"), ip: context.ip };
      const headers = new Headers({ "content-type": "application/json" });
      headers.append("set-cookie", "first=1; HttpOnly");
      headers.append("set-cookie", "second=2; Secure");
      return new Response("{}", { headers });
    },
  });
  const server = createAdminHttpServer({ baseURL: "http://127.0.0.1", service: proxy });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const result = await new Promise((resolve, reject) => {
      const req = http.request({ hostname: "127.0.0.1", port, path: "/api/admin/session", method: "POST", headers: {
        "x-reporadars-client-ip": "2001:db8::5", cookie: "session=abc", "content-type": "application/json",
      } }, (res) => { res.resume(); res.once("end", () => resolve(res)); });
      req.once("error", reject);
      req.end('{"ok":true}');
    });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(received, { method: "POST", body: '{"ok":true}', cookie: "session=abc", ip: "2001:db8::5" });
    assert.deepEqual(result.headers["set-cookie"], ["first=1; HttpOnly", "second=2; Secure"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("production startup refuses root before reading runtime configuration", async (t) => {
  t.mock.method(process, "getuid", () => 0);
  await assert.rejects(startProduction(), /as root/);
});

test("production startup rejects an invalid port before reading runtime configuration", async (t) => {
  const env = { ...process.env, AUTH_MODE: "smtp", ADMIN_PORT: "not-a-port" };
  delete env.ADMIN_SERVE_STATIC;
  t.mock.property(process, "env", env);
  t.mock.method(process, "getuid", () => 1000);
  await assert.rejects(startProduction(), /unprivileged TCP port/);
});
