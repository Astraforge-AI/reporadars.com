import { createServer } from "node:http";
import { validateAuthBaseURL } from "./auth-service.mjs";
import { randomUUID } from "node:crypto";

const headers = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};
const failure = (status, code) =>
  new Response(JSON.stringify({ error: { code } }), { status, headers });

export function createAdminHttpServer({
  baseURL,
  service,
  loadStatic,
  pageHandler,
  logRequest,
}) {
  const origin = validateAuthBaseURL(baseURL);
  const server = createServer(
    { maxHeaderSize: 16 * 1024 },
    async (req, res) => {
      const started = performance.now(),
        id = randomUUID();
      res.setHeader("X-Request-ID", id);
      if (logRequest)
        res.once("finish", () => {
          const pathname = (req.url || "/").split("?")[0];
          const route = pathname.startsWith("/api/auth/")
            ? "auth"
            : pathname.startsWith("/api/admin/")
              ? "admin"
              : pathname === "/api/intake/reports"
                ? "intake"
                : pathname.startsWith("/api/")
                  ? "api"
                  : /\/(?:_next|reporadars-assets)\//.test(pathname)
                    ? "asset"
                    : "page";
          try {
            const job = req.headers["x-reporadars-job-id"];
            logRequest({
              event: "http",
              id,
              route,
              method: req.method,
              status: res.statusCode,
              durationMs: Math.round((performance.now() - started) * 10) / 10,
              ...(route === "intake" && /^[a-f0-9]{64}$/.test(job || "")
                ? { job }
                : {}),
            });
          } catch {
            /* Logging failure must not affect an already completed response. */
          }
        });
      try {
        const url = new URL(req.url || "/", "http://request.invalid");
        if (
          url.origin !== "http://request.invalid" ||
          (url.pathname.includes("%") &&
            !(
              url.pathname.startsWith("/_next/static/") &&
              !url.pathname.replace(/%5[BbDd]/g, "").includes("%")
            ))
        ) {
          res.writeHead(400, headers);
          res.end('{"error":{"code":"INVALID_REQUEST"}}');
          return;
        }
        const route = url.pathname + url.search;
        let response;
        if (/^\/api(?:\/|$)/i.test(url.pathname)) {
          response = await service.handle(
            new Request(`${origin}${route}`, {
              method: req.method,
              headers: req.headers,
              body: ["GET", "HEAD"].includes(req.method) ? undefined : req,
              duplex: "half",
            }),
            { ip: req.socket.remoteAddress || "unknown" },
          );
        } else if (!["GET", "HEAD"].includes(req.method))
          response = failure(405, "METHOD_NOT_ALLOWED");
        else if (pageHandler) {
          await pageHandler(req, res);
          return;
        } else
          response = loadStatic
            ? await loadStatic(route, req.method, req.headers)
            : failure(404, "NOT_FOUND");
        const output = Object.fromEntries(response.headers);
        if (/^\/api(?:\/|$)/i.test(url.pathname))
          Object.assign(output, headers);
        const cookies = response.headers.getSetCookie();
        if (cookies.length) output["set-cookie"] = cookies;
        res.writeHead(response.status, output);
        res.end(
          req.method === "HEAD"
            ? undefined
            : Buffer.from(await response.arrayBuffer()),
        );
      } catch {
        if (!res.headersSent) res.writeHead(503, headers);
        res.end('{"error":{"code":"UNAVAILABLE"}}');
      }
    },
  );
  server.requestTimeout = 20_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return server;
}
