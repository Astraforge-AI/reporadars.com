import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { validateAuthBaseURL } from "./auth-service.mjs";
import { catalogResponse } from "./catalog-api.mjs";
import { healthResponse } from "./health.mjs";

const MAX_BODY_BYTES = 64 * 1024;
const kinds = new Set(["skill", "collection", "article"]);
const recordStates = new Set(["draft", "published", "archived"]);
const submissionStates = new Set(["pending", "accepted", "rejected"]);
const categories = {
  skill: new Set(["research", "build", "review", "operate", "protect"]),
  article: new Set(["new-signal", "review", "release", "retired"]),
  collection: new Set(["general"]),
};

function response(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
function fail(status, code) {
  return response(status, { error: { code } });
}
function timestamp(value) {
  return new Date(value).toISOString();
}
function text(value, maximum, { required = false } = {}) {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    (required && !value.trim())
  )
    return null;
  return value;
}
function url(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      ? value
      : null;
  } catch {
    return null;
  }
}
function pageParams(params) {
  const page = params.get("page") === null ? 1 : Number(params.get("page"));
  const pageSize =
    params.get("pageSize") === null ? 20 : Number(params.get("pageSize"));
  return Number.isInteger(page) &&
    page >= 1 &&
    page <= 10000 &&
    Number.isInteger(pageSize) &&
    pageSize >= 1 &&
    pageSize <= 100
    ? { page, pageSize }
    : null;
}
async function readJson(request, maximum = MAX_BODY_BYTES) {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum))
    return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}
function ownOnly(value, allowed) {
  return value && Object.keys(value).every((key) => allowed.has(key));
}
function record(row) {
  return {
    id: row.id,
    kind: row.kind,
    slug: row.slug,
    title: { en: row.title_en, ru: row.title_ru },
    summary: { en: row.summary_en, ru: row.summary_ru },
    body: { en: row.body_en, ru: row.body_ru },
    sourceUrl: row.source_url,
    category: row.category,
    skillIds: JSON.parse(row.skill_ids),
    status: row.status,
    revision: row.revision,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}
function submission(row, includeSubmitter = false) {
  const item = {
    id: row.id,
    title: row.title,
    sourceUrl: row.source_url,
    description: row.description,
    status: row.status,
    note: row.note,
    revision: row.revision,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
  return includeSubmitter ? { ...item, submitterId: row.submitter_id } : item;
}
function audit(row) {
  return {
    id: row.id,
    actorId: row.actor_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    revision: row.revision,
    createdAt: timestamp(row.created_at),
  };
}

function validateRecord(input, { creation = false } = {}) {
  const allowed = creation
    ? new Set([
        "kind",
        "slug",
        "title",
        "summary",
        "body",
        "sourceUrl",
        "category",
        "skillIds",
      ])
    : new Set([
        "revision",
        "title",
        "summary",
        "body",
        "sourceUrl",
        "category",
        "skillIds",
      ]);
  if (
    !ownOnly(input, allowed) ||
    (creation && !kinds.has(input.kind)) ||
    (!creation && (!Number.isInteger(input.revision) || input.revision < 0))
  )
    return null;
  const fields = {};
  for (const [key, maximum] of [
    ["title", 160],
    ["summary", 600],
    ["body", 12000],
  ]) {
    if (input[key] !== undefined) {
      if (
        !input[key] ||
        typeof input[key] !== "object" ||
        !ownOnly(input[key], new Set(["en", "ru"]))
      )
        return null;
      const en = text(input[key].en, maximum);
      const ru = text(input[key].ru, maximum);
      if (
        en === null ||
        ru === null ||
        (key === "title" && !en.trim() && !ru.trim())
      )
        return null;
      fields[`${key}_en`] = en;
      fields[`${key}_ru`] = ru;
    } else if (creation) return null;
  }
  if (input.sourceUrl !== undefined) {
    const value = url(input.sourceUrl);
    if (value === null) return null;
    fields.source_url = value;
  } else if (creation) return null;
  const kind = creation ? input.kind : undefined;
  if (input.category !== undefined) {
    if (typeof input.category !== "string") return null;
    fields.category = input.category;
  } else if (creation) return null;
  if (input.skillIds !== undefined) {
    if (
      !Array.isArray(input.skillIds) ||
      input.skillIds.length > 50 ||
      new Set(input.skillIds).size !== input.skillIds.length ||
      !input.skillIds.every(
        (id) => typeof id === "string" && id.length > 0 && id.length <= 128,
      )
    )
      return null;
    fields.skill_ids = input.skillIds;
  } else if (creation) return null;
  if (creation) {
    if (
      typeof input.slug !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug) ||
      input.slug.length > 80 ||
      (!text(fields.title_en, 160, { required: true }) &&
        !text(fields.title_ru, 160, { required: true }))
    )
      return null;
    fields.kind = kind;
    fields.slug = input.slug;
  }
  return { fields, revision: input.revision };
}

export function createAdminService({
  databasePath,
  baseURL,
  authService,
  intakeService,
}) {
  if (
    typeof databasePath !== "string" ||
    !databasePath ||
    typeof baseURL !== "string" ||
    !authService?.handle
  )
    throw new Error("Admin service configuration is required");
  const origin = validateAuthBaseURL(baseURL);
  const db = new Database(databasePath, { fileMustExist: true });
  db.pragma("busy_timeout = 5000");
  const tables = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map(({ name }) => name),
  );
  if (
    ![
      "user",
      "reporadars_admin_grant",
      "reporadars_admin_record",
      "reporadars_admin_submission",
      "reporadars_admin_audit",
      "reporadars_admin_rate_limit",
    ].every((name) => tables.has(name))
  ) {
    db.close();
    throw new Error("Admin database is not migrated");
  }
  const writeAllowed = (request) =>
    request.headers.get("origin") === origin &&
    (request.headers.get("content-type") || "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase() === "application/json" &&
    request.headers.get("sec-fetch-site") === "same-origin";
  const identity = async (request, admin) => {
    let sessionResponse;
    try {
      sessionResponse = await authService.handle(
        new Request(`${origin}/api/auth/session`, { headers: request.headers }),
      );
    } catch {
      return { error: 503 };
    }
    if (!sessionResponse || sessionResponse.status !== 200)
      return { error: 503 };
    let session;
    try {
      session = await sessionResponse.json();
    } catch {
      return { error: 503 };
    }
    if (session?.user === null) return { error: 401 };
    if (
      !session?.user ||
      typeof session.user.id !== "string" ||
      !session.user.id ||
      typeof session.user.email !== "string"
    )
      return { error: 503 };
    const user = db
      .prepare("SELECT id, email, emailVerified FROM user WHERE id = ?")
      .get(session.user.id);
    if (!user || !user.emailVerified) return { error: 403 };
    if (admin) {
      const grant = db
        .prepare("SELECT state FROM reporadars_admin_grant WHERE user_id = ?")
        .get(user.id);
      if (!grant || grant.state === "revoked") return { error: 403 };
      if (grant.state === "pending") {
        const now = Date.now();
        db.exec("BEGIN IMMEDIATE");
        try {
          const changed = db
            .prepare(
              "UPDATE reporadars_admin_grant SET state='active',updated_at=? WHERE user_id=? AND state='pending'",
            )
            .run(now, user.id).changes;
          if (changed !== 1) {
            db.exec("ROLLBACK");
            return { error: 403 };
          }
          db.prepare(
            "INSERT INTO reporadars_admin_audit(id,actor_id,action,entity_type,entity_id,revision,created_at) VALUES(?,?,?,?,?,?,?)",
          ).run(
            randomUUID(),
            user.id,
            "grant.activated",
            "grant",
            user.id,
            1,
            now,
          );
          db.exec("COMMIT");
        } catch {
          try {
            db.exec("ROLLBACK");
          } catch {}
          return { error: 503 };
        }
      }
    }
    return { user };
  };
  const consume = (userId, cap, milliseconds) => {
    const bucket = Math.floor(Date.now() / milliseconds);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "DELETE FROM reporadars_admin_rate_limit WHERE user_id = ? AND bucket < ?",
      ).run(`${cap}:${userId}`, bucket - 2);
      const row = db
        .prepare(
          "SELECT count FROM reporadars_admin_rate_limit WHERE user_id = ? AND bucket = ?",
        )
        .get(`${cap}:${userId}`, bucket);
      if (row?.count >= cap) {
        db.exec("ROLLBACK");
        return false;
      }
      db.prepare(
        "INSERT INTO reporadars_admin_rate_limit(user_id,bucket,count) VALUES(?,?,1) ON CONFLICT(user_id,bucket) DO UPDATE SET count=count+1",
      ).run(`${cap}:${userId}`, bucket);
      db.exec("COMMIT");
      return true;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw error;
    }
  };
  const auditWrite = (actorId, action, entityType, entityId, revision, now) =>
    db
      .prepare(
        "INSERT INTO reporadars_admin_audit(id,actor_id,action,entity_type,entity_id,revision,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(randomUUID(), actorId, action, entityType, entityId, revision, now);
  const validSkillIds = (ids) =>
    !ids.length ||
    ids.length ===
      db
        .prepare(
          `SELECT count(*) AS count FROM reporadars_admin_record WHERE kind = 'skill' AND status != 'archived' AND id IN (${ids.map(() => "?").join(",")})`,
        )
        .get(...ids).count;
  const handle = async (request, { ip } = {}) => {
    let parsed;
    try {
      parsed = new URL(request.url);
    } catch {
      return fail(404, "NOT_FOUND");
    }
    if (parsed.origin !== origin) return fail(404, "NOT_FOUND");
    const path = parsed.pathname;
    if (path === "/api/health" && request.method === "GET")
      return healthResponse(databasePath, intakeService);
    if (path === "/api/catalog") return catalogResponse(request, databasePath);
    if (path.startsWith("/api/auth/"))
      return authService.handle(request, { ip });
    if (path === "/api/intake/reports" && intakeService)
      return intakeService.worker(request);
    const publicContent = path === "/api/content" && request.method === "GET";
    const isSubmission =
      path === "/api/submissions" && request.method === "POST";
    const protectedRoute = path.startsWith("/api/admin/") || isSubmission;
    if (!publicContent && !protectedRoute) return fail(404, "NOT_FOUND");
    if (publicContent) {
      const paging = pageParams(parsed.searchParams);
      const kind = parsed.searchParams.get("kind");
      if (
        !paging ||
        !kinds.has(kind) ||
        [...parsed.searchParams.keys()].some(
          (key) => !["kind", "page", "pageSize"].includes(key),
        )
      )
        return fail(400, "INVALID_REQUEST");
      const total = db
        .prepare(
          "SELECT count(*) AS count FROM reporadars_admin_record WHERE kind = ? AND status = 'published'",
        )
        .get(kind).count;
      const items = db
        .prepare(
          "SELECT * FROM reporadars_admin_record WHERE kind = ? AND status = 'published' ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?",
        )
        .all(kind, paging.pageSize, (paging.page - 1) * paging.pageSize)
        .map(record);
      return response(200, { items, total, ...paging });
    }
    const authenticated = await identity(request, !isSubmission);
    if (authenticated.error)
      return fail(
        authenticated.error,
        authenticated.error === 401
          ? "UNAUTHENTICATED"
          : authenticated.error === 403
            ? "FORBIDDEN"
            : "UNAVAILABLE",
      );
    if (request.method !== "GET" && !writeAllowed(request))
      return fail(403, "FORBIDDEN");
    if (path.startsWith("/api/admin/intake") && intakeService)
      return intakeService.admin(request, authenticated.user);
    if (isSubmission) {
      const input = await readJson(request, 16 * 1024);
      if (
        !input ||
        !ownOnly(input, new Set(["title", "sourceUrl", "description"]))
      )
        return fail(400, "INVALID_REQUEST");
      const title = text(input.title, 160, { required: true });
      const sourceUrl = url(input.sourceUrl);
      const description = text(input.description, 4000, { required: true });
      if (
        title === null ||
        sourceUrl === null ||
        !sourceUrl ||
        description === null ||
        !consume(authenticated.user.id, 5, 3_600_000)
      )
        return fail(
          title === null ||
            sourceUrl === null ||
            !sourceUrl ||
            description === null
            ? 400
            : 429,
          title === null ||
            sourceUrl === null ||
            !sourceUrl ||
            description === null
            ? "INVALID_REQUEST"
            : "RATE_LIMITED",
        );
      const now = Date.now();
      const id = randomUUID();
      db.prepare(
        "INSERT INTO reporadars_admin_submission(id,submitter_id,title,source_url,description,status,note,revision,created_at,updated_at) VALUES(?,?,?,?,?,'pending','',1,?,?)",
      ).run(id, authenticated.user.id, title, sourceUrl, description, now, now);
      return response(201, {
        item: submission(
          db
            .prepare("SELECT * FROM reporadars_admin_submission WHERE id=?")
            .get(id),
        ),
      });
    }
    if (
      request.method !== "GET" &&
      !consume(authenticated.user.id, 120, 60_000)
    )
      return fail(429, "RATE_LIMITED");
    if (path === "/api/admin/session" && request.method === "GET")
      return response(200, {
        user: { id: authenticated.user.id, email: authenticated.user.email },
        role: "admin",
      });
    if (path === "/api/admin/overview" && request.method === "GET") {
      const count = (where = "", params = []) =>
        db
          .prepare(
            `SELECT count(*) AS count FROM reporadars_admin_record ${where}`,
          )
          .get(...params).count;
      const recentActivity = db
        .prepare(
          "SELECT * FROM reporadars_admin_audit ORDER BY created_at DESC LIMIT 20",
        )
        .all()
        .map(audit);
      return response(200, {
        counts: {
          skills: count("WHERE kind='skill'"),
          collections: count("WHERE kind='collection'"),
          articles: count("WHERE kind='article'"),
          submissionsPending: db
            .prepare(
              "SELECT count(*) AS count FROM reporadars_admin_submission WHERE status='pending'",
            )
            .get().count,
          users: db.prepare("SELECT count(*) AS count FROM user").get().count,
          published: count("WHERE status='published'"),
        },
        recentActivity,
        publicationTarget: "editorial-store",
      });
    }
    if (path === "/api/admin/records" && request.method === "GET") {
      const paging = pageParams(parsed.searchParams);
      const kind = parsed.searchParams.get("kind");
      const status = parsed.searchParams.get("status");
      const q = parsed.searchParams.get("q");
      if (
        !paging ||
        (kind && !kinds.has(kind)) ||
        (status && !recordStates.has(status)) ||
        (q !== null && q.length > 100) ||
        [...parsed.searchParams.keys()].some(
          (key) => !["kind", "status", "q", "page", "pageSize"].includes(key),
        )
      )
        return fail(400, "INVALID_REQUEST");
      const where = [];
      const values = [];
      if (kind) {
        where.push("kind=?");
        values.push(kind);
      }
      if (status) {
        where.push("status=?");
        values.push(status);
      }
      if (q) {
        where.push("(slug LIKE ? OR title_en LIKE ? OR title_ru LIKE ?)");
        values.push(`%${q}%`, `%${q}%`, `%${q}%`);
      }
      const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const total = db
        .prepare(
          `SELECT count(*) AS count FROM reporadars_admin_record ${clause}`,
        )
        .get(...values).count;
      const items = db
        .prepare(
          `SELECT * FROM reporadars_admin_record ${clause} ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?`,
        )
        .all(...values, paging.pageSize, (paging.page - 1) * paging.pageSize)
        .map(record);
      return response(200, { items, total, ...paging });
    }
    if (path === "/api/admin/records" && request.method === "POST") {
      const input = validateRecord(await readJson(request), { creation: true });
      if (
        !input ||
        !categories[input.fields.kind].has(input.fields.category) ||
        (input.fields.kind !== "collection" && input.fields.skill_ids.length) ||
        !validSkillIds(input.fields.skill_ids)
      )
        return fail(400, "INVALID_REQUEST");
      const now = Date.now();
      const id = randomUUID();
      try {
        db.exec("BEGIN IMMEDIATE");
        db.prepare(
          "INSERT INTO reporadars_admin_record(id,kind,slug,title_en,title_ru,summary_en,summary_ru,body_en,body_ru,source_url,category,skill_ids,status,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'draft',1,?,?)",
        ).run(
          id,
          input.fields.kind,
          input.fields.slug,
          input.fields.title_en,
          input.fields.title_ru,
          input.fields.summary_en,
          input.fields.summary_ru,
          input.fields.body_en,
          input.fields.body_ru,
          input.fields.source_url,
          input.fields.category,
          JSON.stringify(input.fields.skill_ids),
          now,
          now,
        );
        auditWrite(
          authenticated.user.id,
          "record.created",
          "record",
          id,
          1,
          now,
        );
        db.exec("COMMIT");
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {}
        return fail(
          error?.code === "SQLITE_CONSTRAINT_UNIQUE" ||
            error?.code === "SQLITE_CONSTRAINT_PRIMARYKEY"
            ? 409
            : 503,
          error?.code === "SQLITE_CONSTRAINT_UNIQUE" ||
            error?.code === "SQLITE_CONSTRAINT_PRIMARYKEY"
            ? "CONFLICT"
            : "UNAVAILABLE",
        );
      }
      return response(201, {
        item: record(
          db
            .prepare("SELECT * FROM reporadars_admin_record WHERE id=?")
            .get(id),
        ),
      });
    }
    const recordMatch = path.match(/^\/api\/admin\/records\/([^/]+)$/);
    const statusMatch = path.match(/^\/api\/admin\/records\/([^/]+)\/status$/);
    if (recordMatch && request.method === "GET") {
      const row = db
        .prepare("SELECT * FROM reporadars_admin_record WHERE id=?")
        .get(recordMatch[1]);
      return row
        ? response(200, { item: record(row) })
        : fail(404, "NOT_FOUND");
    }
    if (recordMatch && request.method === "PATCH") {
      const input = validateRecord(await readJson(request));
      const old = db
        .prepare("SELECT * FROM reporadars_admin_record WHERE id=?")
        .get(recordMatch[1]);
      if (!input) return fail(400, "INVALID_REQUEST");
      if (!old) return fail(404, "NOT_FOUND");
      if (old.status !== "draft") return fail(409, "STATE_CONFLICT");
      if (old.revision !== input.revision) return fail(409, "CONFLICT");
      const merged = {
        ...old,
        ...input.fields,
        skill_ids: input.fields.skill_ids || JSON.parse(old.skill_ids),
      };
      if (
        !categories[old.kind].has(merged.category) ||
        (old.kind !== "collection" && merged.skill_ids.length) ||
        !validSkillIds(merged.skill_ids)
      )
        return fail(400, "INVALID_REQUEST");
      const now = Date.now();
      const fields = Object.keys(input.fields);
      if (!fields.length) return fail(400, "INVALID_REQUEST");
      try {
        db.exec("BEGIN IMMEDIATE");
        const assignments = fields.map((key) => `${key}=?`).join(",");
        const changed = db
          .prepare(
            `UPDATE reporadars_admin_record SET ${assignments}, revision=revision+1, updated_at=? WHERE id=? AND revision=?`,
          )
          .run(
            ...fields.map((key) =>
              key === "skill_ids"
                ? JSON.stringify(input.fields[key])
                : input.fields[key],
            ),
            now,
            old.id,
            old.revision,
          ).changes;
        if (changed !== 1) throw new Error("conflict");
        auditWrite(
          authenticated.user.id,
          "record.updated",
          "record",
          old.id,
          old.revision + 1,
          now,
        );
        db.exec("COMMIT");
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {}
        return fail(
          error.message === "conflict" ? 409 : 503,
          error.message === "conflict" ? "CONFLICT" : "UNAVAILABLE",
        );
      }
      return response(200, {
        item: record(
          db
            .prepare("SELECT * FROM reporadars_admin_record WHERE id=?")
            .get(old.id),
        ),
      });
    }
    if (statusMatch && request.method === "POST") {
      const input = await readJson(request);
      const old = db
        .prepare("SELECT * FROM reporadars_admin_record WHERE id=?")
        .get(statusMatch[1]);
      if (
        !input ||
        !ownOnly(input, new Set(["revision", "status"])) ||
        !Number.isInteger(input.revision) ||
        !recordStates.has(input.status)
      )
        return fail(400, "INVALID_REQUEST");
      if (!old) return fail(404, "NOT_FOUND");
      if (old.revision !== input.revision) return fail(409, "CONFLICT");
      if (
        input.status === "published" &&
        (!old.title_en.trim() ||
          !old.title_ru.trim() ||
          !old.summary_en.trim() ||
          !old.summary_ru.trim() ||
          !old.body_en.trim() ||
          !old.body_ru.trim() ||
          ((old.kind === "skill" || old.kind === "article") &&
            !old.source_url) ||
          (old.kind === "collection" &&
            (!JSON.parse(old.skill_ids).length ||
              !validSkillIds(JSON.parse(old.skill_ids)))))
      )
        return fail(400, "INVALID_STATE");
      const now = Date.now();
      try {
        db.exec("BEGIN IMMEDIATE");
        const changed = db
          .prepare(
            "UPDATE reporadars_admin_record SET status=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?",
          )
          .run(input.status, now, old.id, old.revision).changes;
        if (changed !== 1) throw new Error("conflict");
        auditWrite(
          authenticated.user.id,
          `record.${input.status}`,
          "record",
          old.id,
          old.revision + 1,
          now,
        );
        db.exec("COMMIT");
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {}
        return fail(
          error.message === "conflict" ? 409 : 503,
          error.message === "conflict" ? "CONFLICT" : "UNAVAILABLE",
        );
      }
      return response(200, {
        item: record(
          db
            .prepare("SELECT * FROM reporadars_admin_record WHERE id=?")
            .get(old.id),
        ),
      });
    }
    if (path === "/api/admin/users" && request.method === "GET") {
      const paging = pageParams(parsed.searchParams);
      const q = parsed.searchParams.get("q");
      if (
        !paging ||
        (q !== null && q.length > 100) ||
        [...parsed.searchParams.keys()].some(
          (key) => !["q", "page", "pageSize"].includes(key),
        )
      )
        return fail(400, "INVALID_REQUEST");
      const where = q ? "WHERE u.email LIKE ? OR u.name LIKE ?" : "";
      const values = q ? [`%${q}%`, `%${q}%`] : [];
      const total = db
        .prepare(`SELECT count(*) AS count FROM user u ${where}`)
        .get(...values).count;
      const items = db
        .prepare(
          `SELECT u.id,u.email,u.name,u.emailVerified,u.createdAt,g.state adminState FROM user u LEFT JOIN reporadars_admin_grant g ON g.user_id=u.id ${where} ORDER BY u.createdAt DESC LIMIT ? OFFSET ?`,
        )
        .all(...values, paging.pageSize, (paging.page - 1) * paging.pageSize)
        .map((row) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          emailVerified: Boolean(row.emailVerified),
          role: row.adminState === "active" ? "admin" : "user",
          adminState: row.adminState || null,
          createdAt: timestamp(row.createdAt),
        }));
      return response(200, { items, total, ...paging });
    }
    if (path === "/api/admin/audit" && request.method === "GET") {
      const paging = pageParams(parsed.searchParams);
      if (
        !paging ||
        [...parsed.searchParams.keys()].some(
          (key) => !["page", "pageSize"].includes(key),
        )
      )
        return fail(400, "INVALID_REQUEST");
      const total = db
        .prepare("SELECT count(*) AS count FROM reporadars_admin_audit")
        .get().count;
      return response(200, {
        items: db
          .prepare(
            "SELECT * FROM reporadars_admin_audit ORDER BY created_at DESC LIMIT ? OFFSET ?",
          )
          .all(paging.pageSize, (paging.page - 1) * paging.pageSize)
          .map(audit),
        total,
        ...paging,
      });
    }
    if (path === "/api/admin/submissions" && request.method === "GET") {
      const paging = pageParams(parsed.searchParams);
      const status = parsed.searchParams.get("status");
      if (
        !paging ||
        (status && !submissionStates.has(status)) ||
        [...parsed.searchParams.keys()].some(
          (key) => !["status", "page", "pageSize"].includes(key),
        )
      )
        return fail(400, "INVALID_REQUEST");
      const clause = status ? "WHERE status=?" : "";
      const total = db
        .prepare(
          `SELECT count(*) AS count FROM reporadars_admin_submission ${clause}`,
        )
        .get(...(status ? [status] : [])).count;
      return response(200, {
        items: db
          .prepare(
            `SELECT * FROM reporadars_admin_submission ${clause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
          )
          .all(
            ...(status ? [status] : []),
            paging.pageSize,
            (paging.page - 1) * paging.pageSize,
          )
          .map((row) => submission(row, true)),
        total,
        ...paging,
      });
    }
    const submissionMatch = path.match(/^\/api\/admin\/submissions\/([^/]+)$/);
    if (submissionMatch && request.method === "PATCH") {
      const input = await readJson(request);
      const old = db
        .prepare("SELECT * FROM reporadars_admin_submission WHERE id=?")
        .get(submissionMatch[1]);
      if (
        !input ||
        !ownOnly(input, new Set(["revision", "status", "note"])) ||
        !Number.isInteger(input.revision) ||
        !submissionStates.has(input.status) ||
        text(input.note, 2000) === null
      )
        return fail(400, "INVALID_REQUEST");
      if (!old) return fail(404, "NOT_FOUND");
      if (old.revision !== input.revision) return fail(409, "CONFLICT");
      const now = Date.now();
      try {
        db.exec("BEGIN IMMEDIATE");
        const changed = db
          .prepare(
            "UPDATE reporadars_admin_submission SET status=?,note=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?",
          )
          .run(input.status, input.note, now, old.id, old.revision).changes;
        if (changed !== 1) throw new Error("conflict");
        auditWrite(
          authenticated.user.id,
          `submission.${input.status}`,
          "submission",
          old.id,
          old.revision + 1,
          now,
        );
        db.exec("COMMIT");
      } catch (error) {
        try {
          db.exec("ROLLBACK");
        } catch {}
        return fail(
          error.message === "conflict" ? 409 : 503,
          error.message === "conflict" ? "CONFLICT" : "UNAVAILABLE",
        );
      }
      return response(200, {
        item: submission(
          db
            .prepare("SELECT * FROM reporadars_admin_submission WHERE id=?")
            .get(old.id),
          true,
        ),
      });
    }
    return fail(404, "NOT_FOUND");
  };
  let closed = false;
  return {
    handle,
    close: async () => {
      if (!closed) {
        closed = true;
        db.close();
      }
    },
  };
}
