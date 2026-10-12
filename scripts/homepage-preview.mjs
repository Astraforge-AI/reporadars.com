import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { stat } from "node:fs/promises";
let worker, loadedVersion;
async function loadBuiltWorker() {
  const path = `${process.cwd()}/dist/reporadars.worker.mjs`;
  const version = (await stat(path)).mtimeMs;
  if (!worker || version !== loadedVersion) {
    worker = (await import(`${pathToFileURL(path)}?version=${version}`))
      .default;
    loadedVersion = version;
  }
  return worker;
}

export function createPreviewServer({
  authOrigin,
  loadWorker = loadBuiltWorker,
} = {}) {
  if (authOrigin) {
    const url = new URL(authOrigin);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      throw new Error(
        "The auth preview target must be a loopback HTTP origin.",
      );
    }
  }
  return createServer(async (req, res) => {
    try {
      // Classify the same canonical URL the Worker will see; raw dot segments
      // must not bypass the API boundary. Encoded/absolute-form routes fail closed.
      const requestUrl = new URL(req.url, "http://preview.invalid");
      if (
        requestUrl.origin !== "http://preview.invalid" ||
        (requestUrl.pathname.includes("%") &&
          !(
            requestUrl.pathname.startsWith("/_next/static/") &&
            !requestUrl.pathname.replace(/%5[BbDd]/g, "").includes("%")
          ))
      ) {
        res.writeHead(400, { "Cache-Control": "no-store" });
        res.end();
        return;
      }
      const route = requestUrl.pathname + requestUrl.search;
      // A local preview must never fall through to the production auth origin.
      if (/^\/api(?:\/|$)/i.test(requestUrl.pathname)) {
        if (
          !authOrigin &&
          req.method === "GET" &&
          route === "/api/auth/session"
        ) {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          res.end(JSON.stringify({ user: null, available: false }));
          return;
        }
        if (!authOrigin || !requestUrl.pathname.startsWith("/api/auth/")) {
          res.writeHead(503, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          res.end(JSON.stringify({ error: { code: "UNAVAILABLE" } }));
          return;
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 4096) {
            res.writeHead(413, { "Cache-Control": "no-store" });
            res.end();
            return;
          }
          chunks.push(chunk);
        }
        const headers = new Headers();
        for (const name of [
          "content-type",
          "origin",
          "cookie",
          "sec-fetch-site",
        ]) {
          if (req.headers[name]) headers.set(name, req.headers[name]);
        }
        const response = await fetch(`${authOrigin}${route}`, {
          method: req.method,
          headers,
          body: chunks.length ? Buffer.concat(chunks) : undefined,
          redirect: "manual",
          signal: AbortSignal.timeout(20000),
        });
        const outputHeaders = Object.fromEntries(response.headers);
        const cookies = response.headers.getSetCookie();
        if (cookies.length) outputHeaders["set-cookie"] = cookies;
        res.writeHead(response.status, outputHeaders);
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      if (!["GET", "HEAD"].includes(req.method)) {
        res.writeHead(405, { Allow: "GET, HEAD", "Cache-Control": "no-store" });
        res.end();
        return;
      }
      const worker = await loadWorker();
      const response = await worker.fetch(
        new Request(`https://reporadars.com${route}`, {
          method: req.method,
          headers: req.headers,
        }),
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(503, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ error: { code: "UNAVAILABLE" } }));
    }
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const port = Number(process.env.PORT || 4318);
  createPreviewServer({
    authOrigin: process.env.AUTH_PREVIEW_API_ORIGIN,
  }).listen(port, "127.0.0.1", () =>
    console.log(`Built homepage preview http://127.0.0.1:${port}`),
  );
}
