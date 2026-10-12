import next from "next";
import { createServer } from "node:http";
import { developmentSettings } from "./dev-settings.mjs";
import { skills, skillMarkdown } from "../src/data/skills.js";

const { authOrigin, host } = developmentSettings();
const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const port = Number(
  portIndex >= 0 ? args[portIndex + 1] : process.env.PORT || 4319,
);
const app = next({ dev: true, hostname: host, port, webpack: true });
await app.prepare();
const handle = app.getRequestHandler();
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://preview.invalid");
  if (
    url.origin !== "http://preview.invalid" ||
    (url.pathname.includes("%") &&
      !(
        url.pathname.startsWith("/_next/static/") &&
        !url.pathname.replace(/%5[BbDd]/g, "").includes("%")
      ))
  ) {
    res.writeHead(400, { "Cache-Control": "no-store" });
    res.end();
    return;
  }
  if (/^\/api(?:\/|$)/i.test(url.pathname)) {
    const route = url.pathname + url.search;
    if (!authOrigin && req.method === "GET" && route === "/api/auth/session") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ user: null, available: false }));
      return;
    }
    if (!authOrigin || !url.pathname.startsWith("/api/auth/")) {
      res.writeHead(503, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ error: { code: "UNAVAILABLE" } }));
      return;
    }
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4096) {
          res.writeHead(413);
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
      const output = Object.fromEntries(response.headers);
      const cookies = response.headers.getSetCookie();
      if (cookies.length) output["set-cookie"] = cookies;
      res.writeHead(response.status, output);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(503, { "Cache-Control": "no-store" });
      res.end();
    }
    return;
  }
  const download = /^\/skills\/([^/]+)\/SKILL\.md$/.exec(url.pathname);
  const skill =
    download &&
    skills.find((item) => item.id === download[1] && !item.imported);
  if (skill && ["GET", "HEAD"].includes(req.method)) {
    res.writeHead(200, {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${skill.id}-SKILL.md"`,
    });
    res.end(req.method === "HEAD" ? undefined : skillMarkdown(skill));
    return;
  }
  await handle(req, res);
});
server.listen(port, host, () =>
  console.log(`Next.js preview: http://${host}:${port}`),
);
