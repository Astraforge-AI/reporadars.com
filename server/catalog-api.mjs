import Database from "better-sqlite3";
import { buildCatalog } from "../src/data/live-catalog.js";

const categories = new Set([
  "",
  "research",
  "build",
  "review",
  "operate",
  "protect",
]);
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const project = (row) => ({
  slug: row.slug,
  title: { en: row.title_en, ru: row.title_ru },
  summary: { en: row.summary_en, ru: row.summary_ru },
  body: { en: row.body_en, ru: row.body_ru },
  category: row.category,
  sourceUrl: row.source_url,
  revision: row.revision,
  updatedAt: new Date(row.updated_at).toISOString(),
  provenance: null,
});

export function catalogResponse(request, databasePath) {
  const params = new URL(request.url).searchParams;
  const locale = params.get("locale") || "en",
    q = params.get("q") || "",
    category = params.get("category") || "",
    page = Number(params.get("page") || 1),
    pageSize = Number(params.get("pageSize") || 6),
    ids = params.get("ids")?.split(",");
  const respond = (status, body) =>
    new Response(request.method === "HEAD" ? null : JSON.stringify(body), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  if (
    !["GET", "HEAD"].includes(request.method) ||
    !["en", "ru"].includes(locale) ||
    q.length > 200 ||
    !categories.has(category) ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 1000000 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100 ||
    (ids &&
      (ids.length > 100 ||
        ids.some((id) => id.length > 120 || !slugPattern.test(id)))) ||
    [...params.keys()].some(
      (key) =>
        !["locale", "q", "category", "page", "pageSize", "ids"].includes(key),
    )
  )
    return respond(400, { error: { code: "INVALID_REQUEST" } });
  const db = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    db.pragma("busy_timeout=5000");
    db.function("catalog_contains", { deterministic: true }, (text, needle) =>
      Number(String(text).toLocaleLowerCase().includes(needle)),
    );
    const normalized = q.trim().toLocaleLowerCase();
    const clauses = ["kind='skill'", "status='published'"],
      args = [];
    if (category) {
      clauses.push("category=?");
      args.push(category);
    }
    if (normalized) {
      clauses.push(
        "catalog_contains(title_en||' '||title_ru||' '||summary_en||' '||summary_ru||' '||source_url,?)",
      );
      args.push(normalized);
    }
    if (ids) {
      clauses.push(`slug IN (${ids.map(() => "?").join(",")})`);
      args.push(...ids);
    }
    const where = clauses.join(" AND ");
    const cmsTotal = db
      .prepare(
        `SELECT count(*) AS n FROM reporadars_admin_record WHERE ${where}`,
      )
      .get(...args).n;
    const replacements = new Set(
      db
        .prepare(
          "SELECT slug FROM reporadars_admin_record WHERE kind='skill' AND status IN ('published','archived')",
        )
        .all()
        .map((row) => row.slug),
    );
    const samples = buildCatalog(locale).filter(
      (skill) =>
        !replacements.has(skill.id) &&
        (!category || skill.category === category) &&
        (!ids || ids.includes(skill.id)) &&
        `${skill.title} ${skill.summary} ${skill.source} ${skill.agents.join(" ")} ${skill.searchTerms || ""}`
          .toLocaleLowerCase()
          .includes(normalized),
    );
    const offset = (page - 1) * pageSize;
    const rows = db
      .prepare(
        `SELECT * FROM reporadars_admin_record WHERE ${where} ORDER BY updated_at DESC,id ASC LIMIT ? OFFSET ?`,
      )
      .all(...args, pageSize, offset);
    const raw = rows.map(project);
    if (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='reporadars_intake_receipt'",
        )
        .get()
    ) {
      const receipt = db.prepare(
        "SELECT revision,metadata FROM reporadars_intake_receipt WHERE slug=? ORDER BY created_at DESC LIMIT 1",
      );
      for (const item of raw) {
        const evidence = receipt.get(item.slug);
        if (evidence?.revision === item.revision) {
          const { actor, ...publicEvidence } = JSON.parse(evidence.metadata);
          item.provenance = publicEvidence;
        }
      }
    }
    const items = buildCatalog(locale, { items: raw, archived: [] }).filter(
      (skill) => raw.some((item) => item.slug === skill.id),
    );
    const sampleOffset = Math.max(0, offset - cmsTotal);
    if (items.length < pageSize && offset + items.length >= cmsTotal)
      items.push(
        ...samples.slice(sampleOffset, sampleOffset + pageSize - items.length),
      );
    return respond(200, {
      items,
      total: cmsTotal + samples.length,
      page,
      pageSize,
    });
  } finally {
    db.close();
  }
}
