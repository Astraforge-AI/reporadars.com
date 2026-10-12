import { createServer } from "node:http";
import { chmod, lstat, mkdir, open, readFile, realpath, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createAuthService, migrateAuthDatabase, validateAuthBaseURL } from "./auth-service.mjs";
import { createSmtpSender } from "./smtp.mjs";

async function privateSecret(pathname) {
  if (!pathname || !pathname.startsWith("/")) throw new Error("AUTH_SECRET_FILE must be an absolute path");
  const metadata = await stat(pathname);
  if (!metadata.isFile() || metadata.uid !== process.getuid() || (metadata.mode & 0o077) !== 0) {
    throw new Error("AUTH_SECRET_FILE must be a private file owned by this user");
  }
  const secret = (await readFile(pathname, "utf8")).trimEnd();
  if (Buffer.byteLength(secret) < 32) throw new Error("AUTH_SECRET_FILE must contain at least 32 bytes");
  return secret;
}

async function privateDatabase(pathname) {
  if (!pathname || !pathname.startsWith("/")) throw new Error("AUTH_DATABASE_PATH must be an absolute path");
  const resolved = path.resolve(pathname);
  const checkout = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  await mkdir(path.dirname(resolved), { recursive: true, mode: 0o700 });
  const directory = await realpath(path.dirname(resolved));
  if (directory === checkout || directory.startsWith(`${checkout}${path.sep}`)) throw new Error("AUTH_DATABASE_PATH must be outside the checkout");
  const directoryMetadata = await stat(directory);
  if (!directoryMetadata.isDirectory() || directoryMetadata.uid !== process.getuid() || (directoryMetadata.mode & 0o077) !== 0) {
    throw new Error("AUTH_DATABASE_PATH parent must be a private directory owned by this user");
  }
  let created = false;
  try {
    const link = await lstat(resolved);
    const metadata = await stat(resolved);
    if (link.isSymbolicLink() || !metadata.isFile() || metadata.uid !== process.getuid() || (metadata.mode & 0o077) !== 0) {
      throw new Error("AUTH_DATABASE_PATH must be a private file owned by this user");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const file = await open(resolved, "a", 0o600);
    await file.close();
    await chmod(resolved, 0o600);
    created = true;
  }
  return { path: resolved, created };
}

function toRequest(request, baseURL) {
  return new Request(new URL(request.url || "/", baseURL), {
    method: request.method,
    headers: request.headers,
    body: ["GET", "HEAD"].includes(request.method || "") ? undefined : request,
    duplex: "half",
  });
}

async function writeResponse(response, nodeResponse) {
  nodeResponse.statusCode = response.status;
  for (const [name, value] of response.headers) {
    if (name.toLowerCase() !== "set-cookie") nodeResponse.setHeader(name, value);
  }
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  if (cookies.length) nodeResponse.setHeader("set-cookie", cookies);
  nodeResponse.end(Buffer.from(await response.arrayBuffer()));
}

export async function start() {
  if (process.env.AUTH_MODE !== "smtp") throw new Error("AUTH_MODE=smtp is required");
  if (!process.env.AUTH_BASE_URL) throw new Error("AUTH_BASE_URL is required");
  const rawBaseURL = process.env.AUTH_BASE_URL;
  const baseURL = validateAuthBaseURL(rawBaseURL);
  if (!baseURL.startsWith("https://")) throw new Error("AUTH_BASE_URL must use HTTPS in smtp mode");
  const database = await privateDatabase(process.env.AUTH_DATABASE_PATH);
  const secret = await privateSecret(process.env.AUTH_SECRET_FILE);
  const sendMail = await createSmtpSender({ configPath: process.env.MAIL_CONFIG_FILE });
  if (process.env.AUTH_MIGRATE && process.env.AUTH_MIGRATE !== "yes") throw new Error("AUTH_MIGRATE must be exactly yes");
  if (process.env.AUTH_MIGRATE === "yes") {
    if (!database.created) throw new Error("AUTH_MIGRATE=yes only initializes a new empty database");
    await migrateAuthDatabase({ baseURL: rawBaseURL, secret, databasePath: database.path });
  }
  const service = await createAuthService({ baseURL: rawBaseURL, secret, databasePath: database.path, sendMail });
  await chmod(database.path, 0o600);
  const port = Number(process.env.AUTH_PORT || 4320);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("AUTH_PORT must be a valid TCP port");
  const server = createServer(async (request, response) => {
    try {
      const result = await service.handle(toRequest(request, baseURL), { ip: request.socket.remoteAddress || "unknown" });
      await writeResponse(result, response);
    } catch {
      response.statusCode = 503;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end('{"error":{"code":"UNAVAILABLE"}}');
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const close = async () => {
    await new Promise((resolve) => server.close(resolve));
    await service.close();
  };
  process.once("SIGTERM", () => { void close().finally(() => process.exit(0)); });
  process.once("SIGINT", () => { void close().finally(() => process.exit(0)); });
  return { server, close };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((error) => {
    process.stderr.write(`auth startup failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
