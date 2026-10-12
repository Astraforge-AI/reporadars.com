import Database from "better-sqlite3";

function publicProvenance(metadata) {
  const { actor, ...provenance } = JSON.parse(metadata);
  return provenance;
}

export function readPublicCatalog(databasePath, requestedSlug = null) {
  const db = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    db.pragma("busy_timeout = 5000");
    const rows = db
      .prepare(
        "SELECT * FROM reporadars_admin_record WHERE kind = 'skill' AND status = 'published' ORDER BY updated_at DESC, id ASC LIMIT 100",
      )
      .all();
    if (requestedSlug && !rows.some((row) => row.slug === requestedSlug)) {
      const row = db.prepare("SELECT * FROM reporadars_admin_record WHERE kind='skill' AND status='published' AND slug=?").get(requestedSlug);
      if (row) rows.push(row);
    }
    const receipts = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE name='reporadars_intake_receipt'",
      )
      .get()
      ? db
          .prepare(
            "SELECT slug,revision,metadata FROM reporadars_intake_receipt ORDER BY created_at ASC",
          )
          .all()
      : [];
    const provenance = new Map(receipts.map((row) => [row.slug, row]));
    const editorial = db
      .prepare(
        "SELECT * FROM reporadars_admin_record WHERE kind IN ('collection','article') AND status='published' ORDER BY updated_at DESC,id ASC LIMIT 2000",
      )
      .all();
    const hidden = db
      .prepare(
        "SELECT kind,slug FROM reporadars_admin_record WHERE kind IN ('collection','article') AND status='archived'",
      )
      .all();
    const skillSlugs = new Map(db.prepare("SELECT id,slug FROM reporadars_admin_record WHERE kind='skill' AND status='published'").all().map((row) => [row.id, row.slug]));
    const project = (row) => ({
      slug: row.slug,
      title: { en: row.title_en, ru: row.title_ru },
      summary: { en: row.summary_en, ru: row.summary_ru },
      body: { en: row.body_en, ru: row.body_ru },
      sourceUrl: row.source_url,
      skillIds: JSON.parse(row.skill_ids)
        .map((id) => skillSlugs.get(id))
        .filter(Boolean),
      updatedAt: new Date(row.updated_at).toISOString(),
      revision: row.revision,
    });
    return {
      collections: editorial
        .filter((row) => row.kind === "collection")
        .map(project),
      articles: editorial.filter((row) => row.kind === "article").map(project),
      archivedCollections: hidden
        .filter((row) => row.kind === "collection")
        .map((row) => row.slug),
      archivedArticles: hidden
        .filter((row) => row.kind === "article")
        .map((row) => row.slug),
      items: rows.map((row) => ({
        slug: row.slug,
        title: { en: row.title_en, ru: row.title_ru },
        summary: { en: row.summary_en, ru: row.summary_ru },
        body: { en: row.body_en, ru: row.body_ru },
        sourceUrl: row.source_url,
        category: row.category,
        revision: row.revision,
        updatedAt: new Date(row.updated_at).toISOString(),
        provenance:
          provenance.get(row.slug)?.revision === row.revision
            ? publicProvenance(provenance.get(row.slug).metadata)
            : null,
      })),
      archived: db
        .prepare(
          "SELECT slug FROM reporadars_admin_record WHERE kind = 'skill' AND status = 'archived'",
        )
        .all()
        .map((row) => row.slug),
    };
  } finally {
    db.close();
  }
}
