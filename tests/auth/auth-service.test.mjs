import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { createAuthService, migrateAuthDatabase } from "../../server/auth-service.mjs";
import { createAbortableTlsSocketProvider } from "../../server/smtp.mjs";

const origin = "http://localhost:4173";
const secret = "test-only-secret-that-is-long-enough-for-better-auth";

function cookies(response) {
  return response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
}

async function body(response) {
  return response.json();
}

async function setup(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "reporadars-auth-"));
  const messages = [];
  let now = 1_700_000_000_000;
  const serviceOptions = {
    baseURL: origin,
    secret,
    databasePath: path.join(directory, "auth.sqlite"),
    sendMail: async (message) => messages.push(message),
    clock: () => now,
    ...options,
  };
  await migrateAuthDatabase(serviceOptions);
  const service = await createAuthService(serviceOptions);
  t.after(async () => {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    service,
    messages,
    dbPath: path.join(directory, "auth.sqlite"),
    tick(milliseconds) { now += milliseconds; },
  };
}

function request(service, route, { method = "GET", payload, cookie, ip = "127.0.0.1", headers = {} } = {}) {
  const requestHeaders = new Headers(headers);
  if (method === "POST") {
    if (headers.origin !== null) requestHeaders.set("origin", headers.origin || origin);
    requestHeaders.set("content-type", "application/json");
  }
  if (cookie) requestHeaders.set("cookie", cookie);
  return service.handle(new Request(`${origin}${route}`, {
    method,
    headers: requestHeaders,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  }), { ip });
}

function emailToken(message) {
  return new URL(message.url).hash.slice("#email-token=".length);
}

test("request to inert landing, POST confirm, session, and logout use only wrapper routes", async (t) => {
  const { service, messages } = await setup(t);
  const requested = await request(service, "/api/auth/request-link", {
    method: "POST",
    payload: { email: "reader@example.com", locale: "ru" },
  });
  assert.equal(requested.status, 202);
  assert.deepEqual(await body(requested), { ok: true });
  assert.equal(messages.length, 1);
  assert.match(requested.headers.getSetCookie()[0], /HttpOnly; SameSite=Strict/);
  assert.equal(new URL(messages[0].url).pathname, "/ru/login");
  assert.match(new URL(messages[0].url).hash, /^#email-token=/);
  assert.equal((await request(service, "/api/auth/magic-link/verify?token=x")).status, 404);
  assert.equal((await request(service, "/api/auth/magic-link/verify?token=x", { method: "HEAD" })).status, 404);

  const confirmed = await request(service, "/api/auth/confirm", {
    method: "POST",
    cookie: cookies(requested),
    payload: { token: emailToken(messages[0]) },
  });
  assert.equal(confirmed.status, 200);
  const confirmedBody = await body(confirmed);
  assert.equal(confirmedBody.ok, true);
  assert.match(confirmedBody.user.id, /^[A-Za-z0-9_-]+$/);
  assert.equal(confirmedBody.user.email, "reader@example.com");
  const sessionCookie = cookies(confirmed);
  const session = await request(service, "/api/auth/session", { cookie: sessionCookie });
  const sessionBody = await body(session);
  assert.equal(sessionBody.user.id, confirmedBody.user.id);
  assert.equal(sessionBody.user.email, "reader@example.com");
  const signedOut = await request(service, "/api/auth/sign-out", { method: "POST", cookie: sessionCookie, payload: {} });
  assert.equal(signedOut.status, 200);
  assert.deepEqual(await body(signedOut), { ok: true });
  assert.deepEqual(await body(await request(service, "/api/auth/session", { cookie: sessionCookie })), { user: null });
});

test("confirm refuses a missing or foreign browser nonce without consuming the matching challenge", async (t) => {
  const { service, messages } = await setup(t);
  const requested = await request(service, "/api/auth/request-link", { method: "POST", payload: { email: "reader@example.com", locale: "en" } });
  const token = emailToken(messages[0]);
  assert.equal((await request(service, "/api/auth/confirm", { method: "POST", payload: { token } })).status, 403);
  assert.equal((await request(service, "/api/auth/confirm", { method: "POST", cookie: "rr_login_nonce=other", payload: { token } })).status, 403);
  assert.equal((await request(service, "/api/auth/confirm", { method: "POST", cookie: cookies(requested), payload: { token } })).status, 200);
});

test("rejects non-origin JSON posts, raw GET/HEAD, oversized input, and already signed-in actions", async (t) => {
  const { service, messages } = await setup(t);
  const noOrigin = await service.handle(new Request(`${origin}/api/auth/request-link`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"email":"reader@example.com","locale":"en"}' }), { ip: "127.0.0.1" });
  assert.equal(noOrigin.status, 403);
  assert.equal((await request(service, "/api/auth/request-link", { method: "POST", headers: { origin: "https://attacker.example" }, payload: { email: "reader@example.com", locale: "en" } })).status, 403);
  assert.equal((await request(service, "/api/auth/request-link", { method: "GET" })).status, 404);
  assert.equal((await request(service, "/api/auth/session", { method: "HEAD" })).status, 404);
  const enormous = await service.handle(new Request(`${origin}/api/auth/request-link`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email: "reader@example.com", locale: "en", pad: "x".repeat(4097) }) }), { ip: "127.0.0.1" });
  assert.equal(enormous.status, 400);
  const requested = await request(service, "/api/auth/request-link", { method: "POST", payload: { email: "reader@example.com", locale: "en" } });
  const confirmed = await request(service, "/api/auth/confirm", { method: "POST", cookie: cookies(requested), payload: { token: emailToken(messages[0]) } });
  const loggedIn = cookies(confirmed);
  assert.equal((await request(service, "/api/auth/request-link", { method: "POST", cookie: loggedIn, payload: { email: "reader@example.com", locale: "en" } })).status, 409);
  assert.equal((await request(service, "/api/auth/confirm", { method: "POST", cookie: loggedIn, payload: { token: "x".repeat(32) } })).status, 409);
});

test("expired, replayed, and concurrently claimed links never mint another session", async (t) => {
  const { service, messages, tick, dbPath } = await setup(t);
  const expired = await request(service, "/api/auth/request-link", { method: "POST", payload: { email: "expired@example.com", locale: "en" } });
  tick(601_000);
  assert.equal((await request(service, "/api/auth/confirm", { method: "POST", cookie: cookies(expired), payload: { token: emailToken(messages[0]) } })).status, 403);
  const inspection = new Database(dbPath, { readonly: true });
  assert.equal(inspection.prepare("SELECT count(*) AS count FROM reporadars_auth_challenge").get().count, 0);
  inspection.close();
  const requested = await request(service, "/api/auth/request-link", { method: "POST", payload: { email: "once@example.com", locale: "en" } });
  const options = { method: "POST", cookie: cookies(requested), payload: { token: emailToken(messages[1]) } };
  const [first, second] = await Promise.all([request(service, "/api/auth/confirm", options), request(service, "/api/auth/confirm", options)]);
  assert.deepEqual([first.status, second.status].sort(), [200, 403]);
  assert.equal((await request(service, "/api/auth/confirm", options)).status, 403);
});

test("SMTP failures are bounded and limits persist across a service restart without forwarded-header trust", async (t) => {
  const failing = await setup(t, { sendMail: async () => { throw new Error("smtp down"); } });
  const unavailable = await request(failing.service, "/api/auth/request-link", { method: "POST", payload: { email: "reader@example.com", locale: "en" } });
  assert.equal(unavailable.status, 503);

  const directory = await mkdtemp(path.join(os.tmpdir(), "reporadars-auth-persist-"));
  const dbPath = path.join(directory, "auth.sqlite");
  const options = { baseURL: origin, secret, databasePath: dbPath, sendMail: async () => {}, limits: { email: 1 } };
  await migrateAuthDatabase(options);
  const first = await createAuthService(options);
  const once = await request(first, "/api/auth/request-link", { method: "POST", ip: "203.0.113.9", payload: { email: "limit@example.com", locale: "en" } });
  assert.equal(once.status, 202);
  await first.close();
  const second = await createAuthService(options);
  t.after(async () => { await second.close(); await rm(directory, { recursive: true, force: true }); });
  const limited = await request(second, "/api/auth/request-link", { method: "POST", ip: "203.0.113.9", headers: { "x-forwarded-for": "198.51.100.7" }, payload: { email: "limit@example.com", locale: "en" } });
  assert.equal(limited.status, 429);
});

test("service refuses an unmigrated database instead of changing an existing startup database", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "reporadars-auth-unmigrated-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(
    createAuthService({ baseURL: origin, secret, databasePath: path.join(directory, "auth.sqlite"), sendMail: async () => {} }),
    /migrated/,
  );
});

test("confirmation attempts are persistently rate limited before session lookup", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "reporadars-auth-confirm-limit-"));
  const dbPath = path.join(directory, "auth.sqlite");
  const options = { baseURL: origin, secret, databasePath: dbPath, sendMail: async () => {}, limits: { confirmIp: 1 } };
  await migrateAuthDatabase(options);
  const first = await createAuthService(options);
  assert.equal((await request(first, "/api/auth/confirm", { method: "POST", ip: "203.0.113.22", payload: { token: "x".repeat(32) } })).status, 403);
  await first.close();
  const second = await createAuthService(options);
  t.after(async () => { await second.close(); await rm(directory, { recursive: true, force: true }); });
  assert.equal((await request(second, "/api/auth/confirm", { method: "POST", ip: "203.0.113.22", payload: { token: "x".repeat(32) } })).status, 429);
});

test("a stalled transport is aborted and returns a bounded unavailable response", { timeout: 1_000 }, async (t) => {
  let aborted = false;
  const { service } = await setup(t, {
    limits: { mailTimeoutMs: 25 },
    sendMail: (_message, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        aborted = true;
        reject(new Error("aborted"));
      }, { once: true });
    }),
  });
  const response = await request(service, "/api/auth/request-link", { method: "POST", payload: { email: "stall@example.com", locale: "en" } });
  assert.equal(response.status, 503);
  assert.equal(aborted, true);
});

test("stored binding hashes secrets and the IP limiter ignores forwarded headers", async (t) => {
  const { service, messages, dbPath } = await setup(t, { limits: { ip: 1, email: 20 } });
  const first = await request(service, "/api/auth/request-link", { method: "POST", ip: "203.0.113.50", payload: { email: "one@example.com", locale: "en" } });
  assert.equal(first.status, 202);
  const database = new Database(dbPath, { readonly: true });
  const row = database.prepare("SELECT token_hash, nonce_hash FROM reporadars_auth_challenge").get();
  database.close();
  assert.notEqual(row.token_hash, emailToken(messages[0]));
  assert.notEqual(row.nonce_hash, cookies(first).split("=", 2)[1]);
  assert.equal((await request(service, "/api/auth/request-link", { method: "POST", ip: "203.0.113.50", headers: { "x-forwarded-for": "198.51.100.2" }, payload: { email: "two@example.com", locale: "en" } })).status, 429);
});

test("service accepts only a clean HTTPS origin or explicit HTTP loopback", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "reporadars-auth-url-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const baseURL of ["https://example.com/path", "https://user@example.com", "http://example.com"]) {
    await assert.rejects(createAuthService({ baseURL, secret, databasePath: path.join(directory, "auth.sqlite"), sendMail: async () => {} }));
  }
});

test("aborting a stalled local TLS handshake destroys its actual TCP socket and rejects the callback", async (t) => {
  let resolveConnection;
  let resolveClose;
  const connected = new Promise((resolve) => { resolveConnection = resolve; });
  const closed = new Promise((resolve) => { resolveClose = resolve; });
  const server = createServer((socket) => {
    resolveConnection();
    socket.once("close", resolveClose);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const controller = new AbortController();
  const provider = createAbortableTlsSocketProvider({ host: "127.0.0.1", port: address.port, signal: controller.signal });
  const callback = new Promise((resolve, reject) => provider.getSocket({}, (error, value) => error ? reject(error) : resolve(value)));
  await connected;
  controller.abort();
  await assert.rejects(callback, /mail delivery aborted/);
  await closed;
});
