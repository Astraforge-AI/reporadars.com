import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { extname, join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CircleIcon } from "@phosphor-icons/react";
import { securityHeaders, createHomepageWorker } from "./homepage-worker.mjs";
import { skills, skillMarkdown, pagePaths } from "../src/data/skills.js";
import { splitLocalePath } from "../src/locale-paths.js";

const root = new URL("../dist/client/", import.meta.url);
const htmlRoutes = new Map();
let allHtml = "";
for (const path of [...pagePaths, "/404.html", "/ru/404.html"]) {
  const name =
    path === "/"
      ? "index.html"
      : path.endsWith(".html")
        ? path.slice(1)
        : `${path.slice(1)}/index.html`;
  const html = await readFile(new URL(name, root), "utf8");
  htmlRoutes.set(name, path);
  allHtml += html;
}
for (const skill of skills) {
  if (skill.imported) continue;
  await writeFile(
    new URL(`skills/${skill.id}/SKILL.md`, root),
    skillMarkdown(skill),
  );
}
await writeFile(
  new URL("reporadars-assets/favicon.svg", root),
  renderToStaticMarkup(
    createElement(CircleIcon, { size: 32, weight: "fill", color: "#b8de16" }),
  ),
);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};
const files = {};
const release = createHash("sha256").update(allHtml).digest("hex").slice(0, 12);
async function walk(dir, relative = "") {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const name = join(relative, item.name);
    if (item.isDirectory()) await walk(new URL(`${item.name}/`, dir), name);
    else {
      if (!(extname(name) in types))
        throw new Error(`Unexpected public artifact: ${name}`);
      const bytes = await readFile(new URL(item.name, dir));
      const path =
        htmlRoutes.get(name) ||
        `/${name.startsWith("_next/") ? name.split("/").map(encodeURIComponent).join("/") : name}`;
      const compress = [
        ".html",
        ".js",
        ".json",
        ".css",
        ".svg",
        ".txt",
        ".md",
      ].includes(extname(name));
      files[path] = {
        body: (compress ? gzipSync(bytes) : bytes).toString("base64"),
        encoding: compress ? "gzip" : "identity",
        type: types[extname(name)],
        etag: `"${createHash("sha256").update(bytes).digest("hex").slice(0, 24)}"`,
        cache: ["/account", "/admin", "/login"].includes(
          splitLocalePath(path).path,
        )
          ? "private, no-store"
          : extname(name) === ".html"
            ? "public, max-age=0, must-revalidate"
            : path.startsWith("/reporadars-assets/bundled/") ||
                path.startsWith("/_next/static/")
              ? "public, max-age=31536000, immutable"
              : "public, max-age=3600",
        release,
        ...(extname(name) === ".html"
          ? { language: splitLocalePath(path).locale }
          : {}),
        ...(extname(name) === ".md"
          ? { download: `${path.split("/")[2]}-SKILL.md` }
          : {}),
      };
    }
  }
}
await walk(root);
const code = `const securityHeaders=${JSON.stringify(securityHeaders)};\nconst files=${JSON.stringify(files)};\n${createHomepageWorker.toString()}\nexport default createHomepageWorker(files);\n`;
await writeFile(
  new URL("../dist/reporadars.worker.mjs", import.meta.url),
  code,
);
await writeFile(
  new URL("../dist/homepage-manifest.json", import.meta.url),
  JSON.stringify(
    {
      release,
      files: Object.keys(files),
      bytes: Buffer.byteLength(code),
      sha256: createHash("sha256").update(code).digest("hex"),
    },
    null,
    2,
  ),
);
console.log(
  `Homepage release ${release}: ${Object.keys(files).length} resources, ${Math.round(Buffer.byteLength(code) / 1024)} KiB Worker.`,
);
