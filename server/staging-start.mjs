import { createServer as createHttpsServer } from "node:https";
import { randomUUID } from "node:crypto";
import { lstat, open, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import next from "next";
import { readAdminRuntime } from "./admin-runtime.mjs";
import { createAuthService } from "./auth-service.mjs";
import { createAdminService } from "./admin-service.mjs";
import { createIntakeService } from "./intake-service.mjs";
import { createAdminHttpServer } from "./admin-http.mjs";
import { runtimePages } from "./runtime-pages.mjs";

export function stagingOrigin(origin) {
  const url = new URL(origin);
  const port = Number(url.port);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "localhost" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535
  )
    throw new Error("Staging requires an unprivileged localhost HTTPS origin");
  return port;
}

async function privateRead(filename, shared = false) {
  const meta = await lstat(filename);
  if (
    !meta.isFile() ||
    meta.isSymbolicLink() ||
    !(meta.uid === process.getuid() || (shared && meta.uid === 0)) ||
    (meta.mode & (shared ? 0o037 : 0o077)) !== 0 ||
    meta.size > 16 * 1024
  )
    throw new Error("Unsafe staging credential");
  return readFile(filename);
}

export function captureStagingMail(directory, origin) {
  stagingOrigin(origin);
  let count = 0;
  return async ({ to, url, locale }) => {
    const link = new URL(url);
    if (link.origin !== origin || ++count > 1000)
      throw new Error("Invalid staging message or capture budget exceeded");
    // Private local capture only: this transport has no SMTP/network capability.
    const file = await open(
      join(directory, `mail-${randomUUID()}.json`),
      "wx",
      0o600,
    );
    try {
      await file.writeFile(JSON.stringify({ to, url, locale }) + "\n");
    } finally {
      await file.close();
    }
  };
}

export async function startStaging(
  directory = process.env.STAGING_RUNTIME_DIR,
) {
  if (process.getuid() === 0)
    throw new Error("Run staging as its dedicated service user");
  const config = await readAdminRuntime(directory);
  const port = stagingOrigin(config.origin);
  const settings = JSON.parse(
    await readFile(join(config.directory, "runtime.json"), "utf8"),
  );
  const token = (
    await privateRead(
      settings.intakeTokenFile || join(config.directory, "intake-token"),
      true,
    )
  )
    .toString()
    .trim();
  const key = await privateRead(join(config.directory, "tls-key.pem"));
  const cert = await privateRead(join(config.directory, "tls-cert.pem"));
  let auth, admin, intake, web, server;
  const close = async () => {
    if (server?.listening) {
      server.closeIdleConnections();
      await new Promise((done) => server.close(done));
    }
    await web?.close();
    intake?.close();
    await admin?.close();
    await auth?.close();
  };
  try {
    auth = await createAuthService({
      ...config,
      baseURL: config.origin,
      sendMail: captureStagingMail(config.directory, config.origin),
    });
    intake = createIntakeService({
      databasePath: join(config.directory, "intake.sqlite"),
      editorialPath: config.databasePath,
      token,
    });
    admin = await createAdminService({
      baseURL: config.origin,
      databasePath: config.databasePath,
      authService: auth,
      intakeService: intake,
    });
    process.env.REPORADARS_DATABASE_PATH = config.databasePath;
    web = next({ dev: false, dir: resolve("runtime-web") });
    await web.prepare();
    const bridge = createAdminHttpServer({
      baseURL: config.origin,
      service: admin,
      logRequest: (event) => console.log(JSON.stringify(event)),
      pageHandler: runtimePages(web.getRequestHandler(), config.databasePath),
    });
    server = createHttpsServer(
      { key, cert, maxHeaderSize: 16 * 1024 },
      bridge.listeners("request")[0],
    );
    server.requestTimeout = bridge.requestTimeout;
    server.headersTimeout = bridge.headersTimeout;
    await new Promise((done, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", done);
    });
    return { server, close };
  } catch (error) {
    await close();
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.umask(0o077);
  startStaging()
    .then(({ close }) => {
      for (const signal of ["SIGTERM", "SIGINT"])
        process.once(signal, () => void close().finally(() => process.exit(0)));
    })
    .catch(() => {
      console.error(
        "Isolated staging startup failed; inspect local configuration.",
      );
      process.exitCode = 1;
    });
}
