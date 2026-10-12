import Database from "better-sqlite3";
import { realpath } from "node:fs/promises";
import { join } from "node:path";

const runtime = await realpath(process.argv[2] || ""),
  count = Number(process.argv[3] || 2005);
if (
  !runtime.startsWith("/var/lib/reporadars-staging/") ||
  !Number.isInteger(count) ||
  count < 1 ||
  count > 10000
)
  throw new Error(
    "Load fixtures are restricted to isolated staging and at most 10000 records",
  );
const db = new Database(join(runtime, "auth.sqlite"), { fileMustExist: true }),
  now = Date.now();
try {
  db.pragma("busy_timeout=5000");
  const insert = db.prepare(
    "INSERT OR IGNORE INTO reporadars_admin_record VALUES(?,'skill',?,?,?,?,?,?,?,?,'build','[]','published',1,?,?)",
  );
  db.transaction(() => {
    for (let i = 0; i < count; i++)
      insert.run(
        `isolated-load-${i}`,
        `isolated-load-${i}`,
        `Load fixture ${i}`,
        `Нагрузочная запись ${i}`,
        "Isolated staging fixture",
        "Тестовая запись staging",
        "Use only in the isolated load test.",
        "Используйте только в нагрузочном тесте staging.",
        "https://example.test/staging-fixture",
        now - count + i,
        now - count + i,
      );
  })();
  console.log(
    JSON.stringify({ fixtureRecords: count, runtime: "isolated staging" }),
  );
} finally {
  db.close();
}
