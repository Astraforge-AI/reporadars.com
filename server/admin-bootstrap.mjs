import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

function normalizedEmail(email) {
  if (
    typeof email !== "string" ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  )
    throw new Error("Valid email is required");
  return email.trim().toLowerCase();
}

export async function bootstrapAdmin({ databasePath, email }) {
  if (typeof databasePath !== "string" || !databasePath)
    throw new Error("Admin database is not migrated");
  const db = new Database(databasePath, { fileMustExist: true });
  try {
    const target = normalizedEmail(email);
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map(({ name }) => name),
    );
    if (!["user", "reporadars_admin_grant"].every((name) => tables.has(name)))
      throw new Error("Admin database is not migrated");
    const now = Date.now();
    db.exec("BEGIN IMMEDIATE");
    try {
      let user = db
        .prepare("SELECT id, email, emailVerified FROM user WHERE email = ?")
        .get(target);
      if (!user) {
        const id = randomUUID();
        db.prepare(
          "INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run(id, "", target, 0, null, now, now);
        user = { id, email: target, emailVerified: 0 };
      }
      const grant = db
        .prepare("SELECT state FROM reporadars_admin_grant WHERE user_id = ?")
        .get(user.id);
      if (!grant)
        db.prepare(
          "INSERT INTO reporadars_admin_grant (user_id, state, created_at, updated_at) VALUES (?, 'pending', ?, ?)",
        ).run(user.id, now, now);
      db.exec("COMMIT");
      return {
        user: {
          id: user.id,
          email: user.email,
          emailVerified: Boolean(user.emailVerified),
        },
        adminState: grant?.state || "pending",
      };
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw error;
    }
  } finally {
    db.close();
  }
}
