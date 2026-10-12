import { skills, skillMarkdown } from "../src/data/skills.js";
import { readPublicCatalog } from "./public-catalog.mjs";
import { sitemapDocument } from "./sitemap.mjs";

export function runtimePages(handler, databasePath) {
  return async (req, res) => {
    const url = new URL(req.url, "http://request.invalid");
    if (url.pathname === "/robots.txt") {
      const body = Buffer.from(
        "User-agent: *\nDisallow: /admin\nDisallow: /account\nDisallow: /login\nDisallow: /ru/admin\nDisallow: /ru/account\nDisallow: /ru/login\nDisallow: /api/\nSitemap: https://reporadars.com/sitemap.xml\n",
      );
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=60",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    }
    if (/^\/sitemap(?:-[1-9][0-9]*)?\.xml$/.test(url.pathname)) {
      const document = sitemapDocument(databasePath, url.pathname);
      res.writeHead(document ? 200 : 404, {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=60",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : document || "");
      return;
    }
    if (url.pathname.endsWith(".html")) {
      const path = url.pathname
        .replace(/\/index\.html$/, "/")
        .replace(/\.html$/, "");
      res.writeHead(308, {
        Location: path + url.search,
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }
    const id = url.pathname.match(/^\/skills\/([a-z0-9-]+)\/SKILL\.md$/)?.[1];
    if (id) {
      const catalog = readPublicCatalog(databasePath);
      const skill = skills.find((item) => item.id === id && !item.imported);
      if (
        !skill ||
        catalog.archived.includes(id) ||
        catalog.items.some((item) => item.slug === id)
      ) {
        res.writeHead(404, { "Cache-Control": "no-store" });
        res.end();
        return;
      }
      const body = Buffer.from(skillMarkdown(skill));
      res.writeHead(200, {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${id}-SKILL.md"`,
        "Content-Length": body.length,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    }
    return handler(req, res);
  };
}
