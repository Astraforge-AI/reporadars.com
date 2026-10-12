import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import Database from "better-sqlite3";

import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { magicLink } from "better-auth/plugins";

const MAX_BODY_BYTES = 4 * 1024;
const LINK_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const NONCE_COOKIE = "rr_login_nonce";

const defaultLimits = Object.freeze({
  global: 30, ip: 10, email: 3,
  confirmGlobal: 60, confirmIp: 20,
  queue: 16, concurrency: 2, mailTimeoutMs: 7_000,
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function makeNonceHash(secret, nonce) {
  return createHmac("sha256", secret).update(nonce).digest("hex");
}

function boundedInteger(value, fallback, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

export function validateAuthBaseURL(value) {
  const url = new URL(value);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Auth base URL must be a clean HTTPS origin (or HTTP loopback)");
  }
  return url.origin;
}

function json(status, value, headers) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("cache-control", "no-store");
  return new Response(JSON.stringify(value), { status, headers: responseHeaders });
}

function failure(status, code) {
  return json(status, { error: { code } });
}

function cookieValue(headers, name) {
  const cookie = headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

function responseCookies(response) {
  return typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : response.headers.get("set-cookie") ? [response.headers.get("set-cookie")] : [];
}

function cookieRequestHeader(existing, setCookies) {
  const values = new Map();
  for (const part of (existing || "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name) values.set(name, value.join("="));
  }
  for (const setCookie of setCookies) {
    const [name, ...value] = setCookie.split(";", 1)[0].split("=");
    if (name) values.set(name, value.join("="));
  }
  return [...values].map(([name, value]) => `${name}=${value}`).join("; ");
}

function appendSetCookies(headers, setCookies) {
  for (const setCookie of setCookies) headers.append("set-cookie", setCookie);
}

function nonceSetCookie(nonce, secure) {
  return `${NONCE_COOKIE}=${nonce}; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=600${secure ? "; Secure" : ""}`;
}

function expiredNonceCookie(secure) {
  return `${NONCE_COOKIE}=; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}

async function readJson(request) {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
  } catch {
    return null;
  }
}

function isEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function equalHash(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function createMailQueue(sendMail, { concurrency, queue, mailTimeoutMs }) {
  let active = 0;
  const waiting = [];
  const drain = () => {
    while (active < concurrency && waiting.length) {
      const item = waiting.shift();
      active += 1;
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(item.timeout);
        active -= 1;
        callback(value);
        drain();
      };
      item.finish = finish;
      Promise.resolve(sendMail(item.message, { signal: item.controller.signal })).then(
        (value) => finish(item.resolve, value),
        (error) => finish(item.reject, error),
      ).finally(() => {
        // A non-cooperating transport may settle after the timeout; its queue slot is already released.
      });
    }
  };
  return (message) => new Promise((resolve, reject) => {
    if (active + waiting.length >= queue) {
      reject(new Error("mail queue unavailable"));
      return;
    }
    const item = { message, resolve, reject, controller: new AbortController(), finish: null, timeout: null };
    item.timeout = setTimeout(() => {
      item.controller.abort();
      if (item.finish) item.finish(reject, new Error("mail delivery timed out"));
      else {
        const index = waiting.indexOf(item);
        if (index !== -1) waiting.splice(index, 1);
        reject(new Error("mail delivery timed out"));
      }
    }, mailTimeoutMs);
    waiting.push(item);
    drain();
  });
}

function initializeLocalTables(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS reporadars_auth_challenge (
      token_hash TEXT PRIMARY KEY NOT NULL,
      nonce_hash TEXT NOT NULL,
      email TEXT NOT NULL,
      locale TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      claimed_at INTEGER,
      failed_attempts INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS reporadars_auth_rate_limit (
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      bucket INTEGER NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (kind, key, bucket)
    );
  `);
}

function assertMigrated(db) {
  const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  for (const name of ["user", "session", "account", "verification", "reporadars_auth_challenge", "reporadars_auth_rate_limit"]) {
    if (!names.has(name)) throw new Error("Auth database is not migrated");
  }
}

export async function migrateAuthDatabase({ databasePath, baseURL, secret, sendMail = async () => {} }) {
  const db = new Database(databasePath);
  try {
    const origin = validateAuthBaseURL(baseURL);
    const options = buildAuthOptions({ db, baseURL: origin, secret, sendMail, onMail: async () => {} });
    const { runMigrations } = await getMigrations(options);
    await runMigrations();
    initializeLocalTables(db);
  } finally {
    db.close();
  }
}

function buildAuthOptions({ db, baseURL, secret, sendMail, onMail }) {
  const secure = new URL(baseURL).protocol === "https:";
  return {
    database: db,
    baseURL,
    secret,
    trustedOrigins: [baseURL],
    session: { expiresIn: SESSION_TTL_SECONDS },
    rateLimit: { enabled: false },
    advanced: { useSecureCookies: secure },
    plugins: [magicLink({
      expiresIn: LINK_TTL_MS / 1000,
      storeToken: "hashed",
      rateLimit: { window: 60, max: Number.MAX_SAFE_INTEGER },
      sendMagicLink: async ({ email, token, metadata }) => {
        await onMail({ email, token, metadata });
        const locale = metadata?.locale === "ru" ? "ru" : "en";
        const link = new URL(locale === "ru" ? "/ru/login" : "/login", baseURL);
        link.hash = `email-token=${encodeURIComponent(token)}`;
        await sendMail({ to: email, url: link.toString(), locale });
      },
    })],
  };
}

export async function createAuthService({ baseURL, secret, databasePath, sendMail, clock = Date.now, limits = {} }) {
  if (typeof sendMail !== "function") throw new Error("SMTP transport is required");
  if (typeof secret !== "string" || secret.length < 32) throw new Error("Auth secret is required");
  if (typeof databasePath !== "string" || !databasePath) throw new Error("Database path is required");
  const origin = validateAuthBaseURL(baseURL);
  const secure = new URL(origin).protocol === "https:";
  const resolvedLimits = {
    ...defaultLimits,
    ...limits,
    global: boundedInteger(limits.global, defaultLimits.global, 1, 120),
    ip: boundedInteger(limits.ip, defaultLimits.ip, 1, 60),
    email: boundedInteger(limits.email, defaultLimits.email, 1, 20),
    confirmGlobal: boundedInteger(limits.confirmGlobal, defaultLimits.confirmGlobal, 1, 240),
    confirmIp: boundedInteger(limits.confirmIp, defaultLimits.confirmIp, 1, 60),
    queue: boundedInteger(limits.queue, defaultLimits.queue, 1, 16),
    concurrency: boundedInteger(limits.concurrency, defaultLimits.concurrency, 1, 4),
    mailTimeoutMs: boundedInteger(limits.mailTimeoutMs, defaultLimits.mailTimeoutMs, 1, 7_000),
  };
  const db = new Database(databasePath);
  db.exec("PRAGMA busy_timeout = 5000;");
  assertMigrated(db);
  const sendBoundedMail = createMailQueue(sendMail, resolvedLimits);
  const options = buildAuthOptions({ db, baseURL: origin, secret, sendMail: async ({ to, url, locale }) => {
    // The plugin supplies the correctly localized fragment URL; this guard keeps the queued transport token-free.
    try {
      await sendBoundedMail({ to, url, locale });
    } catch (error) {
      const token = new URL(url).hash.slice("#email-token=".length);
      db.prepare("DELETE FROM reporadars_auth_challenge WHERE token_hash = ? AND claimed_at IS NULL").run(sha256(token));
      throw error;
    }
  }, onMail: async (data) => {
    const tokenHash = sha256(data.token);
    const locale = data.metadata?.locale === "ru" ? "ru" : "en";
    const nonceHash = data.metadata?.nonceHash;
    if (typeof nonceHash !== "string") throw new Error("Missing magic-link binding");
    db.prepare("INSERT INTO reporadars_auth_challenge (token_hash, nonce_hash, email, locale, expires_at) VALUES (?, ?, ?, ?, ?)")
      .run(tokenHash, nonceHash, data.email, locale, clock() + LINK_TTL_MS);
  } });
  const auth = betterAuth(options);
  const context = await auth.$context;
  await context.checkSchema?.();

  const currentSession = async (headers) => auth.api.getSession({ headers, query: { disableCookieCache: true } });
  const consumeDimensions = (dimensions) => {
    const now = clock();
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const [kind, key, window, max] of dimensions) {
        const bucket = Math.floor(now / window);
        const row = db.prepare("SELECT count FROM reporadars_auth_rate_limit WHERE kind = ? AND key = ? AND bucket = ?").get(kind, key, bucket);
        if (row && row.count >= max) {
          db.exec("ROLLBACK");
          return false;
        }
      }
      for (const [kind, key, window] of dimensions) {
        const bucket = Math.floor(now / window);
        db.prepare("INSERT INTO reporadars_auth_rate_limit (kind, key, bucket, count) VALUES (?, ?, ?, 1) ON CONFLICT(kind, key, bucket) DO UPDATE SET count = count + 1")
          .run(kind, key, bucket);
      }
      db.exec("COMMIT");
      return true;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  };
  const consumeLimits = (email, ip) => consumeDimensions([
    ["global", "all", 60_000, resolvedLimits.global],
    ["ip", ip, 60 * 60_000, resolvedLimits.ip],
    ["email", email, 15 * 60_000, resolvedLimits.email],
  ]);
  const consumeConfirmationLimits = (ip) => consumeDimensions([
    ["confirm-global", "all", 60_000, resolvedLimits.confirmGlobal],
    ["confirm-ip", ip, 15 * 60_000, resolvedLimits.confirmIp],
  ]);
  const cleanupExpired = () => {
    const now = clock();
    db.prepare("DELETE FROM reporadars_auth_challenge WHERE expires_at <= ?").run(now);
    const oldestBucket = {
      global: Math.floor(now / 60_000) - 2,
      "confirm-global": Math.floor(now / 60_000) - 2,
      ip: Math.floor(now / (60 * 60_000)) - 2,
      email: Math.floor(now / (15 * 60_000)) - 2,
      "confirm-ip": Math.floor(now / (15 * 60_000)) - 2,
    };
    for (const [kind, bucket] of Object.entries(oldestBucket)) {
      db.prepare("DELETE FROM reporadars_auth_rate_limit WHERE kind = ? AND bucket < ?").run(kind, bucket);
    }
  };

  const claimChallenge = (token, nonce) => {
    const tokenHash = sha256(token);
    const nonceHash = makeNonceHash(secret, nonce);
    const now = clock();
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare("SELECT nonce_hash, expires_at, claimed_at, failed_attempts FROM reporadars_auth_challenge WHERE token_hash = ?").get(tokenHash);
      if (!row || row.claimed_at || row.expires_at <= now || row.failed_attempts >= 5) {
        db.exec("ROLLBACK");
        return false;
      }
      if (!equalHash(row.nonce_hash, nonceHash)) {
        db.prepare("UPDATE reporadars_auth_challenge SET failed_attempts = failed_attempts + 1 WHERE token_hash = ? AND claimed_at IS NULL").run(tokenHash);
        db.exec("COMMIT");
        return false;
      }
      const result = db.prepare("UPDATE reporadars_auth_challenge SET claimed_at = ? WHERE token_hash = ? AND claimed_at IS NULL AND expires_at > ?").run(now, tokenHash, now);
      db.exec("COMMIT");
      return result.changes === 1;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  };

  const validPost = (request) => request.headers.get("origin") === origin
    && (request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase() === "application/json";

  const handle = async (request, { ip } = {}) => {
    let url;
    try { url = new URL(request.url); } catch { return failure(404, "NOT_FOUND"); }
    if (url.origin !== origin) return failure(404, "NOT_FOUND");
    const path = url.pathname;
    if (request.method === "GET" && path === "/api/auth/session") {
      const session = await currentSession(request.headers);
      return json(200, { user: session ? { id: session.user.id, email: session.user.email } : null });
    }
    if (request.method !== "POST" || !new Set(["/api/auth/request-link", "/api/auth/confirm", "/api/auth/sign-out"]).has(path)) return failure(404, "NOT_FOUND");
    if (!validPost(request)) return failure(403, "FORBIDDEN");
    const payload = await readJson(request);
    if (!payload || Array.isArray(payload) || typeof payload !== "object") return failure(400, "INVALID_REQUEST");
    cleanupExpired();

    if (path === "/api/auth/request-link") {
      if (await currentSession(request.headers)) return failure(409, "ALREADY_SIGNED_IN");
      if (!isEmail(payload.email) || !["en", "ru"].includes(payload.locale)) return failure(400, "INVALID_EMAIL");
      const email = payload.email.trim().toLowerCase();
      if (!consumeLimits(email, typeof ip === "string" ? ip : "unknown")) return failure(429, "RATE_LIMITED");
      const nonce = randomBytes(32).toString("base64url");
      try {
        await auth.api.signInMagicLink({
          body: { email, callbackURL: "/login", metadata: { locale: payload.locale, nonceHash: makeNonceHash(secret, nonce) } },
          headers: new Headers({ origin, "content-type": "application/json" }),
        });
      } catch {
        return failure(503, "UNAVAILABLE");
      }
      const headers = new Headers();
      headers.append("set-cookie", nonceSetCookie(nonce, secure));
      return json(202, { ok: true }, headers);
    }

    if (path === "/api/auth/confirm") {
      if (!consumeConfirmationLimits(typeof ip === "string" ? ip : "unknown")) return failure(429, "RATE_LIMITED");
      if (await currentSession(request.headers)) return failure(409, "ALREADY_SIGNED_IN");
      if (typeof payload.token !== "string" || !/^[A-Za-z0-9_-]{20,200}$/.test(payload.token)) return failure(403, "INVALID_LINK");
      const nonce = cookieValue(request.headers, NONCE_COOKIE);
      if (!nonce || !claimChallenge(payload.token, nonce)) return failure(403, "INVALID_LINK");
      let verified;
      try {
        verified = await auth.api.magicLinkVerify({
          query: { token: payload.token, callbackURL: "/login" },
          headers: request.headers,
          asResponse: true,
        });
      } catch {
        return failure(403, "INVALID_LINK");
      }
      const setCookies = responseCookies(verified);
      const sessionHeaders = new Headers(request.headers);
      sessionHeaders.set("cookie", cookieRequestHeader(request.headers.get("cookie"), setCookies));
      const session = await currentSession(sessionHeaders);
      if (!session) return failure(403, "INVALID_LINK");
      const headers = new Headers();
      appendSetCookies(headers, setCookies);
      headers.append("set-cookie", expiredNonceCookie(secure));
      return json(200, { ok: true, user: { id: session.user.id, email: session.user.email } }, headers);
    }

    const signedOut = await auth.api.signOut({ headers: request.headers, body: {}, asResponse: true });
    const headers = new Headers();
    appendSetCookies(headers, responseCookies(signedOut));
    return json(200, { ok: true }, headers);
  };

  return { handle, close: async () => db.close() };
}
