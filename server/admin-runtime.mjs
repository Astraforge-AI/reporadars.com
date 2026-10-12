import { lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrateAuthDatabase, validateAuthBaseURL } from "./auth-service.mjs";
import { migrateAdminDatabase } from "./admin-store.mjs";

const checkout = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function outsideCheckout(directory) {
  if (typeof directory !== "string" || !path.isAbsolute(directory))
    throw new Error("Runtime directory must be absolute");
  const actual = await realpath(directory);
  const root = await realpath(checkout);
  if (actual === root || actual.startsWith(`${root}${path.sep}`))
    throw new Error("Runtime must be outside the checkout");
  return actual;
}

async function privateFile(filename) {
  const meta = await lstat(filename);
  if (
    !meta.isFile() ||
    meta.isSymbolicLink() ||
    meta.uid !== process.getuid() ||
    (meta.mode & 0o077) !== 0
  )
    throw new Error(
      "Runtime files must be private, regular, and owned by the current user",
    );
  return meta;
}

async function privateDirectory(directory) {
  const meta = await lstat(directory);
  if (
    !meta.isDirectory() ||
    meta.isSymbolicLink() ||
    meta.uid !== process.getuid() ||
    (meta.mode & 0o077) !== 0
  )
    throw new Error(
      "Runtime directory must be private and owned by the current user",
    );
  return outsideCheckout(directory);
}

async function writeNew(filename, content) {
  const file = await open(filename, "wx", 0o600);
  try {
    await file.writeFile(content);
  } finally {
    await file.close();
  }
}

export async function initializeAdminRuntime({ directory, origin }) {
  const baseURL = validateAuthBaseURL(origin);
  if (!baseURL.startsWith("https://"))
    throw new Error("Staging runtime requires a clean HTTPS origin");
  if (typeof directory !== "string" || !path.isAbsolute(directory))
    throw new Error("Runtime directory must be absolute");
  const parent = await outsideCheckout(path.dirname(directory));
  const target = path.join(parent, path.basename(directory));
  if (target === checkout || target.startsWith(`${checkout}${path.sep}`))
    throw new Error("Runtime must be outside the checkout");
  // Deliberately no recursive creation or overwrite: existing runtime is protected.
  await mkdir(target, { mode: 0o700 });
  await privateDirectory(target);
  const secret = randomBytes(48).toString("base64url");
  const databasePath = path.join(target, "auth.sqlite");
  await writeNew(path.join(target, "auth-secret"), secret + "\n");
  await writeNew(databasePath, "");
  await migrateAuthDatabase({ databasePath, baseURL, secret });
  await migrateAdminDatabase({ databasePath });
  // Written last; partial initialization is retained for inspection, never reused silently.
  await writeNew(
    path.join(target, "runtime.json"),
    JSON.stringify(
      {
        version: 1,
        environment: "staging",
        origin: baseURL,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  return { directory: target, origin: baseURL };
}

export async function readAdminRuntime(directory) {
  const actual = await privateDirectory(directory);
  const configPath = path.join(actual, "runtime.json");
  const secretPath = path.join(actual, "auth-secret");
  const databasePath = path.join(actual, "auth.sqlite");
  if (
    (await privateFile(configPath)).size > 4096 ||
    (await privateFile(secretPath)).size > 4096
  )
    throw new Error("Invalid runtime metadata size");
  await privateFile(databasePath);
  for (const suffix of ["-wal", "-shm"]) {
    try {
      await privateFile(databasePath + suffix);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (config.version !== 1 || config.environment !== "staging")
    throw new Error("Unsupported runtime metadata");
  const origin = validateAuthBaseURL(config.origin);
  if (!origin.startsWith("https://")) throw new Error("Runtime requires HTTPS");
  const secret = (await readFile(secretPath, "utf8")).trim();
  if (secret.length < 32) throw new Error("Invalid runtime secret");
  return { directory: actual, origin, databasePath, secret };
}
