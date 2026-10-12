import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, lstat, rm, readFile, chmod, symlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import {
  initializeAdminRuntime,
  readAdminRuntime,
} from "../../server/admin-runtime.mjs";
import { createAdminHttpServer } from "../../server/admin-http.mjs";
import { startAdmin } from "../../server/admin-start.mjs";

test("runtime rejects symlink aliases and paths resolving into the checkout before writing", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "rr-admin-paths-"));
  try {
    const checkout = fileURLToPath(new URL("../../", import.meta.url));
    const alias = path.join(parent, "checkout-alias");
    await symlink(checkout, alias, "dir");
    const target = path.join(alias, "must-not-create-admin-runtime");
    await assert.rejects(
      initializeAdminRuntime({
        directory: target,
        origin: "https://reporadars.com",
      }),
      /outside the checkout/,
    );
    await assert.rejects(lstat(target), { code: "ENOENT" });
    const directory = path.join(parent, "private");
    await initializeAdminRuntime({
      directory,
      origin: "https://reporadars.com",
    });
    const runtimeAlias = path.join(parent, "runtime-alias");
    await symlink(directory, runtimeAlias, "dir");
    await assert.rejects(readAdminRuntime(runtimeAlias), /private/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("SMTP runtime refuses root before reading configuration or opening a listener", async (t) => {
  t.mock.method(process, "getuid", () => 0);
  await assert.rejects(startAdmin(), /as root/);
});

test("runtime initialization is explicit, private, outside checkout and never overwrites existing state", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "rr-admin-runtime-"));
  try {
    const directory = path.join(parent, "private");
    await assert.rejects(
      initializeAdminRuntime({
        directory,
        origin: "http://public.example.test",
      }),
    );
    await assert.rejects(lstat(directory), { code: "ENOENT" });
    await initializeAdminRuntime({
      directory,
      origin: "https://reporadars.com",
    });
    const config = await readAdminRuntime(directory);
    assert.equal(config.origin, "https://reporadars.com");
    assert.equal((await lstat(directory)).mode & 0o077, 0);
    for (const file of ["auth.sqlite", "auth-secret", "runtime.json"])
      assert.equal((await lstat(path.join(directory, file))).mode & 0o077, 0);
    assert(config.secret.length >= 32);
    const before = await readFile(path.join(directory, "auth-secret"));
    await assert.rejects(
      initializeAdminRuntime({ directory, origin: "https://reporadars.com" }),
    );
    assert.deepEqual(
      await readFile(path.join(directory, "auth-secret")),
      before,
    );
    await chmod(path.join(directory, "auth-secret"), 0o644);
    await assert.rejects(readAdminRuntime(directory), /private/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("HTTP adapter does not send canonical API or encoded routes to static origin and preserves cookies", async () => {
  let staticCalls = 0;
  const paths = [];
  const service = {
    async handle(request) {
      paths.push(new URL(request.url).pathname);
      return new Response("{}", {
        headers: {
          "content-type": "application/json",
          "set-cookie": "rr_test=x; HttpOnly",
          "cache-control": "no-store",
        },
      });
    },
  };
  const server = createAdminHttpServer({
    baseURL: "http://127.0.0.1",
    service,
    loadStatic: async () => {
      staticCalls++;
      return new Response("static");
    },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const raw = (requestPath) =>
    new Promise((resolve, reject) => {
      http
        .get({ hostname: "127.0.0.1", port, path: requestPath }, (res) => {
          res.resume();
          res.once("end", () => resolve(res));
        })
        .once("error", reject);
    });
  try {
    const response = await raw("/outside/../api/admin/session");
    assert.equal(response.statusCode, 200);
    assert.equal(staticCalls, 0);
    assert.deepEqual(paths, ["/api/admin/session"]);
    assert.match(response.headers["set-cookie"][0], /HttpOnly/);
    assert.equal((await raw("/%61pi/admin/session")).statusCode, 400);
    assert.equal(
      (await raw("http://external.example/api/admin/session")).statusCode,
      400,
    );
    assert.equal(staticCalls, 0);
    assert.equal((await raw("/admin")).statusCode, 200);
    assert.equal(staticCalls, 1);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
