import { pathToFileURL } from "node:url";
import { stat } from "node:fs/promises";
import { createAdminHttpServer } from "../server/admin-http.mjs";

export async function loadStatic(route, method = "GET", headers = {}) {
  const file = new URL("../dist/reporadars.worker.mjs", import.meta.url);
  const version = (await stat(file)).mtimeMs;
  const worker = (await import(`${file.href}?version=${version}`)).default;
  return worker.fetch(
    new Request(`https://reporadars.com${route}`, { method, headers }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const port = Number(process.env.PORT || 4321);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Invalid preview port");
  const baseURL = `http://127.0.0.1:${port}`;
  // Static preview intentionally cannot authenticate or send mail. Tests inject
  // real isolated auth/admin services into createAdminHttpServer, never a backdoor.
  const service = {
    handle: async (request) => {
      const session =
        request.method === "GET" &&
        new URL(request.url).pathname === "/api/auth/session";
      return new Response(
        JSON.stringify(
          session
            ? { user: null, available: false }
            : { error: { code: "UNAVAILABLE" } },
        ),
        {
          status: session ? 200 : 503,
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
          },
        },
      );
    },
  };
  createAdminHttpServer({ baseURL, service, loadStatic }).listen(
    port,
    "127.0.0.1",
    () => console.log(`Admin static preview ${baseURL}/ru/admin`),
  );
}
