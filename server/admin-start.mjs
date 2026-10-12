import { pathToFileURL } from "node:url";
import { createAuthService } from "./auth-service.mjs";
import { createSmtpSender } from "./smtp.mjs";
import { createAdminService } from "./admin-service.mjs";
import { readAdminRuntime } from "./admin-runtime.mjs";
import { createAdminHttpServer } from "./admin-http.mjs";
import { loadStatic } from "../scripts/admin-preview.mjs";

export async function startAdmin() {
  if (process.getuid() === 0)
    throw new Error("Do not run the admin application as root");
  if (process.env.AUTH_MODE !== "smtp")
    throw new Error("AUTH_MODE=smtp is required");
  if (
    process.env.ADMIN_SERVE_STATIC &&
    process.env.ADMIN_SERVE_STATIC !== "yes"
  )
    throw new Error("ADMIN_SERVE_STATIC must be exactly yes");
  const port = Number(process.env.ADMIN_PORT || 4320);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("ADMIN_PORT must be an unprivileged TCP port");
  const config = await readAdminRuntime(process.env.ADMIN_RUNTIME_DIR);
  const sendMail = await createSmtpSender({
    configPath: process.env.MAIL_CONFIG_FILE,
  });
  let auth, admin, server;
  try {
    auth = await createAuthService({
      baseURL: config.origin,
      databasePath: config.databasePath,
      secret: config.secret,
      sendMail,
    });
    admin = await createAdminService({
      baseURL: config.origin,
      databasePath: config.databasePath,
      authService: auth,
    });
    server = createAdminHttpServer({
      baseURL: config.origin,
      service: admin,
      loadStatic:
        process.env.ADMIN_SERVE_STATIC === "yes" ? loadStatic : undefined,
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (server?.listening) await new Promise((r) => server.close(r));
    await admin?.close();
    await auth?.close();
    throw error;
  }
  let closing;
  const close = () =>
    closing ||
    (closing = (async () => {
      await new Promise((r) => server.close(r));
      await admin.close();
      await auth.close();
    })());
  return { server, close };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.umask(0o077);
  startAdmin()
    .then(({ close }) => {
      for (const signal of ["SIGTERM", "SIGINT"])
        process.once(signal, () => void close().finally(() => process.exit(0)));
    })
    .catch(() => {
      console.error(
        "Admin startup failed; check private runtime, SMTP configuration and explicit migrations.",
      );
      process.exitCode = 1;
    });
}
