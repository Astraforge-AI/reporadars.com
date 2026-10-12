import Database from "better-sqlite3";

function assertAuthSchema(db) {
  const tables = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map(({ name }) => name),
  );
  if (
    !["user", "session", "account", "verification"].every((name) =>
      tables.has(name),
    )
  )
    throw new Error("Auth database is not migrated");
  const columns = new Set(
    db
      .prepare("PRAGMA table_info(user)")
      .all()
      .map(({ name }) => name),
  );
  if (
    !["id", "email", "emailVerified", "createdAt", "updatedAt"].every((name) =>
      columns.has(name),
    )
  )
    throw new Error("Auth user schema is incompatible");
}

export async function migrateAdminDatabase({ databasePath }) {
  if (typeof databasePath !== "string" || !databasePath)
    throw new Error("Database path is required");
  const db = new Database(databasePath, { fileMustExist: true });
  try {
    db.pragma("busy_timeout = 5000");
    assertAuthSchema(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS reporadars_admin_grant (
        user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id),
        state TEXT NOT NULL CHECK(state IN ('pending', 'active', 'revoked')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reporadars_admin_record (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('skill', 'collection', 'article')),
        slug TEXT NOT NULL UNIQUE,
        title_en TEXT NOT NULL, title_ru TEXT NOT NULL,
        summary_en TEXT NOT NULL, summary_ru TEXT NOT NULL,
        body_en TEXT NOT NULL, body_ru TEXT NOT NULL,
        source_url TEXT NOT NULL, category TEXT NOT NULL,
        skill_ids TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('draft', 'published', 'archived')),
        revision INTEGER NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS reporadars_admin_record_list ON reporadars_admin_record(kind, status, updated_at DESC);
      CREATE TABLE IF NOT EXISTS reporadars_admin_submission (
        id TEXT PRIMARY KEY NOT NULL,
        submitter_id TEXT NOT NULL REFERENCES user(id),
        title TEXT NOT NULL, source_url TEXT NOT NULL, description TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'rejected')),
        note TEXT NOT NULL, revision INTEGER NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reporadars_admin_audit (
        id TEXT PRIMARY KEY NOT NULL, actor_id TEXT NOT NULL REFERENCES user(id),
        action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
        revision INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS reporadars_admin_audit_recent ON reporadars_admin_audit(created_at DESC);
      CREATE TABLE IF NOT EXISTS reporadars_admin_rate_limit (
        user_id TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL,
        PRIMARY KEY(user_id, bucket)
      );
    `);
  } finally {
    db.close();
  }
}
