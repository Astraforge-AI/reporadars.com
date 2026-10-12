import Database from "better-sqlite3";

const origin = "https://reporadars.com",
  perPage = 10000;
const xmlEscape = (s) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );

export function sitemapDocument(databasePath, pathname) {
  const db = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    db.pragma("busy_timeout=5000");
    const total = db
      .prepare(
        "SELECT count(*) AS n FROM reporadars_admin_record WHERE kind IN ('skill','article') AND status='published'",
      )
      .get().n;
    const journal = db
      .prepare(
        "SELECT 1 FROM reporadars_admin_record WHERE kind='article' AND status='published' LIMIT 1",
      )
      .get();
    const core = [
      "/",
      "/skills",
      "/collections",
      ...(journal ? ["/journal"] : []),
    ].map((path) => ({ path }));
    const pages = Math.ceil((total + core.length) / perPage);
    if (pathname === "/sitemap.xml" && pages > 1)
      return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Array.from({ length: pages }, (_, i) => `<sitemap><loc>${origin}/sitemap-${i + 1}.xml</loc></sitemap>`).join("")}</sitemapindex>`;
    const page =
      pathname === "/sitemap.xml"
        ? 1
        : Number(pathname.match(/^\/sitemap-([1-9][0-9]*)\.xml$/)?.[1]);
    if (!Number.isSafeInteger(page) || page < 1 || page > pages) return null;
    const offset = (page - 1) * perPage;
    const coreItems = page === 1 ? core : [];
    const rows = db
      .prepare(
        "SELECT kind,slug,updated_at FROM reporadars_admin_record WHERE kind IN ('skill','article') AND status='published' ORDER BY kind,slug LIMIT ? OFFSET ?",
      )
      .all(perPage - coreItems.length, Math.max(0, offset - core.length));
    const paths = [
      ...coreItems,
      ...rows.map((row) => ({
        path: `/${row.kind === "skill" ? "skills" : "journal"}/${row.slug}`,
        updatedAt: new Date(row.updated_at).toISOString(),
      })),
    ];
    const entries = paths.flatMap(({ path, updatedAt }) =>
      ["en", "ru"].map((locale) => {
        const en = `${origin}${path}`,
          ru = `${origin}/ru${path === "/" ? "" : path}`;
        return `<url><loc>${xmlEscape(locale === "ru" ? ru : en)}</loc>${updatedAt ? `<lastmod>${xmlEscape(updatedAt)}</lastmod>` : ""}<xhtml:link rel="alternate" hreflang="en" href="${xmlEscape(en)}"/><xhtml:link rel="alternate" hreflang="ru" href="${xmlEscape(ru)}"/><xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(en)}"/></url>`;
      }),
    );
    return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${entries.join("")}</urlset>`;
  } finally {
    db.close();
  }
}
