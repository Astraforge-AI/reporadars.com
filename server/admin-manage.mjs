import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { initializeAdminRuntime, readAdminRuntime } from "./admin-runtime.mjs";
import { bootstrapAdmin } from "./admin-bootstrap.mjs";

export async function manage(args) {
  const [command, ...rest] = args;
  if (!["init", "grant", "status"].includes(command) || rest.length % 2)
    throw new Error(
      "Use init --directory PATH --origin HTTPS_ORIGIN; grant/status --directory PATH --email ADDRESS",
    );
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i].replace(/^--/, "");
    if (
      !rest[i].startsWith("--") ||
      !["directory", "origin", "email"].includes(key) ||
      key in options ||
      !rest[i + 1]
    )
      throw new Error("Invalid CLI arguments");
    options[key] = rest[i + 1];
  }
  if (command === "init") {
    if (options.email || !options.origin || !options.directory)
      throw new Error("Init requires directory and origin only");
    const runtime = await initializeAdminRuntime(options);
    return {
      initialized: true,
      directory: runtime.directory,
      origin: runtime.origin,
      activated: false,
    };
  }
  if (options.origin || !options.directory || !options.email)
    throw new Error("Grant/status requires directory and email only");
  const config = await readAdminRuntime(options.directory);
  if (command === "grant")
    return {
      account: await bootstrapAdmin({
        databasePath: config.databasePath,
        email: options.email,
      }),
      activated: false,
    };
  const db = new Database(config.databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const user = db
      .prepare("SELECT id,email,emailVerified FROM user WHERE lower(email)=?")
      .get(options.email.trim().toLowerCase());
    return {
      user: user
        ? {
            id: user.id,
            email: user.email,
            emailVerified: Boolean(user.emailVerified),
          }
        : null,
      adminState: user
        ? db
            .prepare("SELECT state FROM reporadars_admin_grant WHERE user_id=?")
            .get(user.id)?.state || null
        : null,
      activated: false,
    };
  } finally {
    db.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.umask(0o077);
  manage(process.argv.slice(2))
    .then((result) => console.log(JSON.stringify(result)))
    .catch(() => {
      console.error(
        "Admin runtime operation failed. Existing files were preserved; inspect arguments, private permissions and schema.",
      );
      process.exitCode = 1;
    });
}
