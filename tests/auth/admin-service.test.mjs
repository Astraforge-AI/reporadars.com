import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import {
  createAuthService,
  migrateAuthDatabase,
} from "../../server/auth-service.mjs";
import { migrateAdminDatabase } from "../../server/admin-store.mjs";
import { bootstrapAdmin } from "../../server/admin-bootstrap.mjs";
import { createAdminService } from "../../server/admin-service.mjs";

const origin = "http://localhost:4173";
const secret = "test-only-secret-that-is-long-enough-for-better-auth";

function cookies(response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

async function json(response) {
  return response.json();
}

async function setup(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "reporadars-admin-"));
  const databasePath = path.join(directory, "app.sqlite");
  const messages = [];
  const authOptions = {
    baseURL: origin,
    secret,
    databasePath,
    sendMail: async (message) => messages.push(message),
  };
  await migrateAuthDatabase(authOptions);
  await migrateAdminDatabase({ databasePath });
  const authService = await createAuthService(authOptions);
  const adminService = createAdminService({
    databasePath,
    baseURL: origin,
    authService,
  });
  t.after(async () => {
    await adminService.close();
    await authService.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { databasePath, messages, authService, adminService };
}

async function signIn(authService, messages, email) {
  const requested = await authService.handle(
    new Request(`${origin}/api/auth/request-link`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ email, locale: "en" }),
    }),
    { ip: "127.0.0.1" },
  );
  assert.equal(requested.status, 202);
  const token = new URL(messages.at(-1).url).hash.slice("#email-token=".length);
  const confirmed = await authService.handle(
    new Request(`${origin}/api/auth/confirm`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        cookie: cookies(requested),
      },
      body: JSON.stringify({ token }),
    }),
    { ip: "127.0.0.1" },
  );
  assert.equal(confirmed.status, 200);
  return { cookie: cookies(confirmed), user: (await json(confirmed)).user };
}

function request(
  service,
  route,
  { method = "GET", cookie, payload, headers = {}, ip = "127.0.0.1" } = {},
) {
  const requestHeaders = new Headers(headers);
  if (cookie) requestHeaders.set("cookie", cookie);
  if (method !== "GET") {
    requestHeaders.set("origin", headers.origin || origin);
    requestHeaders.set("content-type", "application/json");
    requestHeaders.set("sec-fetch-site", "same-origin");
  }
  return service.handle(
    new Request(`${origin}${route}`, {
      method,
      headers: requestHeaders,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
    { ip },
  );
}

const skill = {
  kind: "skill",
  slug: "secure-research",
  title: { en: "Secure research", ru: "Безопасное исследование" },
  summary: { en: "A safe summary", ru: "Безопасное описание" },
  body: { en: "# Safe", ru: "# Безопасно" },
  sourceUrl: "https://example.com/source",
  category: "research",
  skillIds: [],
};

test("admin endpoints reject anonymous, ordinary, and unverified sessions then accept confirmed bootstrap admin", async (t) => {
  const { adminService, authService, messages, databasePath } = await setup(t);
  assert.equal((await request(adminService, "/api/admin/session")).status, 401);
  const ordinary = await signIn(authService, messages, "reader@example.com");
  assert.equal(
    (
      await request(adminService, "/api/admin/session", {
        cookie: ordinary.cookie,
      })
    ).status,
    403,
  );
  const boot = await bootstrapAdmin({
    databasePath,
    email: "admin@example.com",
  });
  assert.equal(boot.adminState, "pending");
  const unverified = await signIn(authService, messages, "admin@example.com");
  const db = new Database(databasePath);
  db.prepare("UPDATE user SET emailVerified = 0 WHERE id = ?").run(
    unverified.user.id,
  );
  assert.equal(
    (
      await request(adminService, "/api/admin/session", {
        cookie: unverified.cookie,
      })
    ).status,
    403,
  );
  db.prepare("UPDATE user SET emailVerified = 1 WHERE id = ?").run(
    unverified.user.id,
  );
  db.close();
  const session = await request(adminService, "/api/admin/session", {
    cookie: unverified.cookie,
  });
  assert.equal(session.status, 200);
  assert.deepEqual(await json(session), {
    user: { id: unverified.user.id, email: "admin@example.com" },
    role: "admin",
  });
});

test("audit failure rolls back a record mutation without a new audit row", async (t) => {
  const { adminService, authService, messages, databasePath } = await setup(t);
  await bootstrapAdmin({ databasePath, email: "atomic@example.com" });
  const admin = await signIn(authService, messages, "atomic@example.com");
  const created = await request(adminService, "/api/admin/records", {
    method: "POST",
    cookie: admin.cookie,
    payload: skill,
  });
  const item = (await json(created)).item;
  const db = new Database(databasePath);
  const before = db
    .prepare("SELECT count(*) AS count FROM reporadars_admin_audit")
    .get().count;
  db.exec(
    "CREATE TRIGGER reject_admin_audit BEFORE INSERT ON reporadars_admin_audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END",
  );
  db.close();
  assert.equal(
    (
      await request(adminService, `/api/admin/records/${item.id}`, {
        method: "PATCH",
        cookie: admin.cookie,
        payload: { revision: 1, summary: { en: "Changed", ru: "Изменено" } },
      })
    ).status,
    503,
  );
  const verify = new Database(databasePath, { readonly: true });
  assert.equal(
    verify
      .prepare("SELECT revision FROM reporadars_admin_record WHERE id=?")
      .get(item.id).revision,
    1,
  );
  assert.equal(
    verify.prepare("SELECT count(*) AS count FROM reporadars_admin_audit").get()
      .count,
    before,
  );
  verify.close();
  const failedCreate = await request(adminService, "/api/admin/records", {
    method: "POST",
    cookie: admin.cookie,
    payload: { ...skill, slug: "audit-aborted-create" },
  });
  assert.equal(failedCreate.status, 503);
  const createVerify = new Database(databasePath, { readonly: true });
  assert.equal(
    createVerify
      .prepare(
        "SELECT count(*) AS count FROM reporadars_admin_record WHERE slug=?",
      )
      .get("audit-aborted-create").count,
    0,
  );
  createVerify.close();
});

test("concurrent revisions use CAS with one update and one conflict", async (t) => {
  const { adminService, authService, messages, databasePath } = await setup(t);
  await bootstrapAdmin({ databasePath, email: "race@example.com" });
  const admin = await signIn(authService, messages, "race@example.com");
  const item = (
    await json(
      await request(adminService, "/api/admin/records", {
        method: "POST",
        cookie: admin.cookie,
        payload: skill,
      }),
    )
  ).item;
  const writes = await Promise.all(
    ["First", "Second"].map((en) =>
      request(adminService, `/api/admin/records/${item.id}`, {
        method: "PATCH",
        cookie: admin.cookie,
        payload: { revision: 1, summary: { en, ru: "Изменено" } },
      }),
    ),
  );
  assert.deepEqual(writes.map(({ status }) => status).sort(), [200, 409]);
  const db = new Database(databasePath, { readonly: true });
  assert.equal(
    db
      .prepare("SELECT revision FROM reporadars_admin_record WHERE id=?")
      .get(item.id).revision,
    2,
  );
  assert.equal(
    db
      .prepare(
        "SELECT count(*) AS count FROM reporadars_admin_audit WHERE entity_id=?",
      )
      .get(item.id).count,
    2,
  );
  db.close();
});

test("validation, bounded streams and malformed auth checks fail closed without creating a database", async (t) => {
  const { adminService, authService, messages, databasePath } = await setup(t);
  await bootstrapAdmin({ databasePath, email: "bounds@example.com" });
  const admin = await signIn(authService, messages, "bounds@example.com");
  const collection = {
    ...skill,
    kind: "collection",
    slug: "bad-collection",
    category: "general",
    sourceUrl: "",
    skillIds: ["missing-skill"],
  };
  assert.equal(
    (
      await request(adminService, "/api/admin/records", {
        method: "POST",
        cookie: admin.cookie,
        payload: collection,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(adminService, "/api/admin/records", {
        method: "POST",
        cookie: admin.cookie,
        payload: {
          ...skill,
          slug: "unsafe-url",
          sourceUrl: "http://example.com",
        },
      })
    ).status,
    400,
  );
  const oversized = await adminService.handle(
    new Request(`${origin}/api/admin/records`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
        cookie: admin.cookie,
      },
      body: JSON.stringify({ pad: "x".repeat(65 * 1024) }),
    }),
  );
  assert.equal(oversized.status, 400);
  const malformed = createAdminService({
    databasePath,
    baseURL: origin,
    authService: {
      handle: async () =>
        new Response(
          JSON.stringify({ user: { id: 7, email: "x@example.com" } }),
        ),
    },
  });
  assert.equal((await request(malformed, "/api/admin/session")).status, 503);
  await malformed.close();
  const missingPath = path.join(path.dirname(databasePath), "missing.sqlite");
  assert.throws(() =>
    createAdminService({
      databasePath,
      baseURL: "https://example.com/path",
      authService,
    }),
  );
  assert.throws(() =>
    createAdminService({
      databasePath: missingPath,
      baseURL: origin,
      authService,
    }),
  );
  assert.equal(existsSync(missingPath), false);
});

test("reopened storage preserves bounded admin pagination while public projection excludes draft and archived", async (t) => {
  const { adminService, authService, messages, databasePath } = await setup(t);
  await bootstrapAdmin({ databasePath, email: "persist@example.com" });
  const admin = await signIn(authService, messages, "persist@example.com");
  const first = (
    await json(
      await request(adminService, "/api/admin/records", {
        method: "POST",
        cookie: admin.cookie,
        payload: skill,
      }),
    )
  ).item;
  const second = (
    await json(
      await request(adminService, "/api/admin/records", {
        method: "POST",
        cookie: admin.cookie,
        payload: { ...skill, slug: "second-skill" },
      }),
    )
  ).item;
  const third = (
    await json(
      await request(adminService, "/api/admin/records", {
        method: "POST",
        cookie: admin.cookie,
        payload: { ...skill, slug: "third-skill" },
      }),
    )
  ).item;
  assert.equal(
    (
      await request(adminService, `/api/admin/records/${first.id}/status`, {
        method: "POST",
        cookie: admin.cookie,
        payload: { revision: 1, status: "published" },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(adminService, `/api/admin/records/${third.id}/status`, {
        method: "POST",
        cookie: admin.cookie,
        payload: { revision: 1, status: "archived" },
      })
    ).status,
    200,
  );
  await adminService.close();
  const reopened = createAdminService({
    databasePath,
    baseURL: origin,
    authService,
  });
  t.after(() => reopened.close());
  const one = await json(
    await request(reopened, "/api/admin/records?kind=skill&page=1&pageSize=1", {
      cookie: admin.cookie,
    }),
  );
  const two = await json(
    await request(reopened, "/api/admin/records?kind=skill&page=2&pageSize=1", {
      cookie: admin.cookie,
    }),
  );
  assert.equal(one.total, 3);
  assert.notEqual(one.items[0].id, two.items[0].id);
  assert.deepEqual(
    (
      await json(
        await request(reopened, "/api/content?kind=skill&page=1&pageSize=20"),
      )
    ).items.map(({ id }) => id),
    [first.id],
  );
  assert.ok(second.id);
});

test("bootstrap is idempotent, never overwrites user values or resurrects a revoked grant", async (t) => {
  const { databasePath } = await setup(t);
  const first = await bootstrapAdmin({
    databasePath,
    email: "bootstrap@example.com",
  });
  const db = new Database(databasePath);
  db.prepare("UPDATE user SET name = ?, emailVerified = 1 WHERE id = ?").run(
    "Preserved",
    first.user.id,
  );
  db.prepare(
    "UPDATE reporadars_admin_grant SET state = 'revoked' WHERE user_id = ?",
  ).run(first.user.id);
  db.close();
  const repeated = await bootstrapAdmin({
    databasePath,
    email: "bootstrap@example.com",
  });
  assert.equal(repeated.adminState, "revoked");
  assert.deepEqual(repeated.user, {
    id: first.user.id,
    email: "bootstrap@example.com",
    emailVerified: true,
  });
});

test("admin writes enforce exact origin, bounded body and immutable validated fields", async (t) => {
  const { adminService, authService, messages, databasePath } = await setup(t);
  await bootstrapAdmin({ databasePath, email: "editor@example.com" });
  const editor = await signIn(authService, messages, "editor@example.com");
  const db = new Database(databasePath);
  db.close();
  assert.equal(
    (
      await request(adminService, "/api/admin/records", {
        method: "POST",
        cookie: editor.cookie,
        headers: { origin: "https://attacker.example" },
        payload: skill,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(adminService, "/api/admin/records", {
        method: "POST",
        cookie: editor.cookie,
        payload: { ...skill, status: "published" },
      })
    ).status,
    400,
  );
  const created = await request(adminService, "/api/admin/records", {
    method: "POST",
    cookie: editor.cookie,
    payload: { ...skill, title: { en: "<img src=x onerror=1>", ru: "Текст" } },
  });
  assert.equal(created.status, 201);
  const item = (await json(created)).item;
  assert.equal(item.status, "draft");
  assert.equal(item.revision, 1);
  assert.equal(item.title.en, "<img src=x onerror=1>");
  assert.equal(
    (
      await request(adminService, "/api/admin/records", {
        method: "POST",
        cookie: editor.cookie,
        payload: { ...skill, title: { en: "Duplicate", ru: "Дубликат" } },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(adminService, `/api/admin/records/${item.id}`, {
        method: "PATCH",
        cookie: editor.cookie,
        payload: { revision: 1, slug: "changed" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(adminService, "/api/admin/records?kind=bad", {
        cookie: editor.cookie,
      })
    ).status,
    400,
  );
});

test("record mutation is revisioned and audited atomically, publishes a bounded public projection", async (t) => {
  const { adminService, authService, messages, databasePath } = await setup(t);
  await bootstrapAdmin({ databasePath, email: "publisher@example.com" });
  const publisher = await signIn(
    authService,
    messages,
    "publisher@example.com",
  );
  const db = new Database(databasePath);
  db.close();
  const created = await request(adminService, "/api/admin/records", {
    method: "POST",
    cookie: publisher.cookie,
    payload: skill,
  });
  const item = (await json(created)).item;
  const conflict = await request(
    adminService,
    `/api/admin/records/${item.id}`,
    {
      method: "PATCH",
      cookie: publisher.cookie,
      payload: { revision: 0, summary: skill.summary },
    },
  );
  assert.equal(conflict.status, 409);
  const published = await request(
    adminService,
    `/api/admin/records/${item.id}/status`,
    {
      method: "POST",
      cookie: publisher.cookie,
      payload: { revision: 1, status: "published" },
    },
  );
  assert.equal(published.status, 200);
  const publicContent = await request(
    adminService,
    "/api/content?kind=skill&page=1&pageSize=20",
  );
  assert.equal(publicContent.status, 200);
  assert.equal((await json(publicContent)).items.length, 1);
  const audit = await request(
    adminService,
    "/api/admin/audit?page=1&pageSize=20",
    { cookie: publisher.cookie },
  );
  assert.equal((await json(audit)).items.length, 3);
  assert.equal(
    (
      await request(adminService, `/api/admin/records/${item.id}`, {
        method: "PATCH",
        cookie: publisher.cookie,
        payload: { revision: 2, title: skill.title },
      })
    ).status,
    409,
  );
});

test("revocation takes effect immediately and submissions are limited, moderated, and never auto-published", async (t) => {
  const { adminService, authService, messages, databasePath } = await setup(t);
  await bootstrapAdmin({ databasePath, email: "moderator@example.com" });
  const moderator = await signIn(
    authService,
    messages,
    "moderator@example.com",
  );
  const ordinary = await signIn(authService, messages, "submitter@example.com");
  const db = new Database(databasePath);
  db.close();
  const submission = await request(adminService, "/api/submissions", {
    method: "POST",
    cookie: ordinary.cookie,
    payload: {
      title: "Useful skill",
      sourceUrl: "https://example.com",
      description: "Description",
    },
  });
  assert.equal(submission.status, 201);
  const submitted = (await json(submission)).item;
  for (let index = 0; index < 4; index += 1) {
    const response = await request(adminService, "/api/submissions", {
      method: "POST",
      cookie: ordinary.cookie,
      payload: {
        title: `Useful skill ${index}`,
        sourceUrl: "https://example.com",
        description: "Description",
      },
    });
    assert.equal(response.status, 201);
  }
  assert.equal(
    (
      await request(adminService, "/api/submissions", {
        method: "POST",
        cookie: ordinary.cookie,
        payload: {
          title: "Over cap",
          sourceUrl: "https://example.com",
          description: "Description",
        },
      })
    ).status,
    429,
  );
  assert.equal(
    (
      await request(adminService, "/api/submissions", {
        method: "POST",
        cookie: ordinary.cookie,
        payload: {
          title: "Too large",
          sourceUrl: "https://example.com",
          description: "x".repeat(17_000),
        },
      })
    ).status,
    400,
  );
  const moderated = await request(
    adminService,
    `/api/admin/submissions/${submitted.id}`,
    {
      method: "PATCH",
      cookie: moderator.cookie,
      payload: { revision: 1, status: "accepted", note: "Review passed" },
    },
  );
  assert.equal(moderated.status, 200);
  assert.equal((await json(moderated)).item.status, "accepted");
  const reopened = new Database(databasePath);
  reopened
    .prepare(
      "UPDATE reporadars_admin_grant SET state = 'revoked' WHERE user_id = ?",
    )
    .run(moderator.user.id);
  reopened.close();
  assert.equal(
    (
      await request(adminService, "/api/admin/overview", {
        cookie: moderator.cookie,
      })
    ).status,
    403,
  );
});
