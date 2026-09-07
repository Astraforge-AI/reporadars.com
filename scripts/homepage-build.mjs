import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { extname, join } from "node:path";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToString, renderToStaticMarkup } from "react-dom/server";
import { CircleIcon } from "@phosphor-icons/react";
import { securityHeaders, createHomepageWorker } from "./homepage-worker.mjs";
import {
  skills,
  skillMarkdown,
  pagePaths,
  resolvePage,
} from "../src/data/skills.js";
import { getLocalizedSkills } from "../src/data/skills-ru.js";
import { splitLocalePath, localeHref } from "../src/locale-paths.js";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true, include: [] },
});
const pageMarkup = {};
try {
  const { App } = await vite.ssrLoadModule("/src/App.jsx");
  for (const path of [...pagePaths, "/404.html", "/ru/404.html"])
    pageMarkup[path] = renderToString(createElement(App, { path }));
} finally {
  await vite.close();
}
const root = new URL("../dist/client/", import.meta.url);
let template = await readFile(new URL("index.html", root), "utf8");
const fontFiles = (
  await readdir(new URL("reporadars-assets/bundled/", root))
).filter((name) => /^(six-caps|ibm-plex-mono).*\.woff2$/.test(name));
template = template.replace(
  "</head>",
  fontFiles
    .map(
      (name) =>
        `<link rel="preload" href="/reporadars-assets/bundled/${name}" as="font" type="font/woff2" crossorigin />`,
    )
    .join("") + "</head>",
);
const escape = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const htmlRoutes = new Map();
let allHtml = "";
for (const [path, markup] of Object.entries(pageMarkup)) {
  const page = resolvePage(path);
  let html = template.replace(
    '<div id="root"></div>',
    `<div id="root">${markup}</div>`,
  );
  {
    const { locale } = splitLocalePath(path);
    const ru = locale === "ru";
    const localizedSkill =
      page.skill &&
      getLocalizedSkills(locale).find((s) => s.id === page.skill.id);
    const titles = {
      home: ru
        ? "Reporadars — скиллы для ИИ-агентов"
        : "Reporadars — Only the signals worth giving your agent",
      library: ru
        ? "Библиотека скиллов — Reporadars"
        : "AI Skills Library — Reporadars",
      collections: ru
        ? "Коллекции скиллов — Reporadars"
        : "Skill Collections — Reporadars",
      account: ru
        ? "Личный кабинет — Reporadars"
        : "Your Workspace — Reporadars",
      login: ru ? "Вход — Reporadars" : "Sign in — Reporadars",
      journal: ru ? "Журнал — Reporadars" : "Signal Journal — Reporadars",
      "not-found": ru
        ? "Сигнал потерян — Reporadars"
        : "Signal lost — Reporadars",
    };
    const title = localizedSkill
      ? `${localizedSkill.title} — Reporadars`
      : page.article
        ? `${ru ? "Пример" : "Sample"}: ${page.article.title[locale]} — Reporadars`
        : titles[page.type];
    const description =
      localizedSkill?.summary ||
      page.article?.summary[locale] ||
      (page.type === "account"
        ? ru
          ? "Локальный кабинет Reporadars. Сохраняйте скиллы и настраивайте профиль в этом браузере."
          : "Your local Reporadars workspace. Save skills and personalize this browser."
        : ru
          ? "Отобранные скиллы для ИИ: открытые источники, скачиваемые инструкции и понятные границы работы."
          : "Explore original draft AI skills with transparent sources, downloadable instructions, and explicit scope.");
    const canonical = `https://reporadars.com${path}`;
    html = html
      .replace(/<html lang="[^"]*">/, `<html lang="${locale}">`)
      .replace(/<title>[^<]*<\/title>/, `<title>${escape(title)}</title>`)
      .replace(
        /(<meta\s+name="description"\s+content=")[^"]*(")/,
        `$1${escape(description)}$2`,
      )
      .replace(
        /(<meta\s+property="og:title"\s+content=")[^"]*(")/,
        `$1${escape(title)}$2`,
      )
      .replace(
        /(<meta\s+property="og:description"\s+content=")[^"]*(")/,
        `$1${escape(description)}$2`,
      )
      .replace(
        /(<meta\s+property="og:url"\s+content=")[^"]*(")/,
        `$1${canonical}$2`,
      )
      .replace(
        /(<link\s+rel="canonical"\s+href=")[^"]*(")/,
        `$1${canonical}$2`,
      );
    html = html.replace(
      "</head>",
      `<link rel="alternate" hreflang="en" href="https://reporadars.com${localeHref(path, "en")}" /><link rel="alternate" hreflang="ru" href="https://reporadars.com${localeHref(path, "ru")}" /><link rel="alternate" hreflang="x-default" href="https://reporadars.com${localeHref(path, "en")}" /></head>`,
    );
    if (
      ["account", "login", "not-found", "journal", "article"].includes(
        page.type,
      )
    )
      html = html.replace(
        "</head>",
        '<meta name="robots" content="noindex, nofollow" /></head>',
      );
  }
  const name =
    path === "/"
      ? "index.html"
      : path.endsWith(".html")
        ? path.slice(1)
        : `${path.slice(1)}/index.html`;
  const file = new URL(name, root);
  await mkdir(new URL(".", file), { recursive: true });
  await writeFile(file, html);
  htmlRoutes.set(name, path);
  allHtml += html;
}
for (const skill of skills) {
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
      const path = htmlRoutes.get(name) || `/${name}`;
      const compress = [".html", ".js", ".css", ".svg", ".txt", ".md"].includes(
        extname(name),
      );
      files[path] = {
        body: (compress ? gzipSync(bytes) : bytes).toString("base64"),
        encoding: compress ? "gzip" : "identity",
        type: types[extname(name)],
        etag: `"${createHash("sha256").update(bytes).digest("hex").slice(0, 24)}"`,
        cache: ["/account", "/login"].includes(splitLocalePath(path).path)
          ? "private, no-store"
          : extname(name) === ".html"
            ? "public, max-age=0, must-revalidate"
            : path.startsWith("/reporadars-assets/bundled/")
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
