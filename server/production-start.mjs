import { pathToFileURL } from "node:url";
import { createAuthService } from "./auth-service.mjs";
import { createSmtpSender } from "./smtp.mjs";
import { createAdminService } from "./admin-service.mjs";
import { readAdminRuntime } from "./admin-runtime.mjs";
import { createAdminHttpServer } from "./admin-http.mjs";
import { withProductionProxy } from "./production-proxy.mjs";
import { resolve } from "node:path";
import next from "next";
import { readFile } from "node:fs/promises";
import { createIntakeService } from "./intake-service.mjs";
import { runtimePages } from "./runtime-pages.mjs";

function productionPort(value = process.env.ADMIN_PORT || 4320) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("ADMIN_PORT must be an unprivileged TCP port");
  return port;
}

async function closeServer(server) {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
}

export async function startProduction() {
  if (process.getuid() === 0)
    throw new Error("Do not run the production application as root");
  if (process.env.AUTH_MODE !== "smtp")
    throw new Error("AUTH_MODE=smtp is required");
  if (Object.hasOwn(process.env, "ADMIN_SERVE_STATIC"))
    throw new Error("ADMIN_SERVE_STATIC is not supported in production");
  const port = productionPort();
  const config = await readAdminRuntime(process.env.ADMIN_RUNTIME_DIR);
  const sendMail = await createSmtpSender({
    configPath: process.env.MAIL_CONFIG_FILE,
  });
  let auth, admin, server, web, intake;
  try {
    auth = await createAuthService({
      baseURL: config.origin,
      databasePath: config.databasePath,
      secret: config.secret,
      sendMail,
    });
    if (process.env.INTAKE_TOKEN_FILE) {
      intake = createIntakeService({
        databasePath: resolve(process.env.ADMIN_RUNTIME_DIR, "intake.sqlite"),
        editorialPath: config.databasePath,
        token: (await readFile(process.env.INTAKE_TOKEN_FILE, "utf8")).trim(),
      });
    }
    admin = await createAdminService({
      baseURL: config.origin,
      databasePath: config.databasePath,
      authService: auth,
      intakeService: intake,
    });
    if (process.env.REPORADARS_NEXT === "1") {
      process.env.REPORADARS_DATABASE_PATH = config.databasePath;
      web = next({ dev: false, dir: resolve("runtime-web") });
      await web.prepare();
    }
    server = createAdminHttpServer({
      baseURL: config.origin,
      service: withProductionProxy(admin),
      logRequest: (event) => console.log(JSON.stringify(event)),
      pageHandler: web
        ? runtimePages(web.getRequestHandler(), config.databasePath)
        : undefined,
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
  } catch (error) {
    await closeServer(server);
    await web?.close();
    intake?.close();
    await admin?.close();
    await auth?.close();
    throw error;
  }
  let closing;
  const close = () =>
    closing ||
    (closing = (async () => {
      await closeServer(server);
      await web?.close();
      intake?.close();
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
  startProduction()
    .then(({ close }) => {
      for (const signal of ["SIGTERM", "SIGINT"])
        process.once(signal, () => void close().finally(() => process.exit(0)));
    })
    .catch(() => {
      console.error(
        "Production startup failed; check private runtime and SMTP configuration.",
      );
      process.exitCode = 1;
    });
}
