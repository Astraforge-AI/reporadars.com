import Database from "better-sqlite3";

export function healthResponse(databasePath, intakeService) {
  const db = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    db.pragma("busy_timeout=1000");
    db.prepare("SELECT id FROM reporadars_admin_record LIMIT 1").get();
    intakeService?.health();
    return Response.json(
      { status: "ok" },
      { headers: { "cache-control": "no-store" } },
    );
  } finally {
    db.close();
  }
}
