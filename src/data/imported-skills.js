import catalogEntries from "./imported-skills.json" with { type: "json" };

const MAX_ENTRIES = 2000;
const MAX_LIST_ITEMS = 20;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const GITHUB_REPOSITORY = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;
const CATEGORIES = new Set(["research", "build", "review", "operate", "protect"]);
const DESCRIPTION_KEYS = ["title", "summary", "purpose", "capabilities", "steps", "permissions"];
const ENTRY_KEYS = ["id", "repository", "commit", "path", "sourceUrl", "bundleSha256", "license", "category", "reviewedAt", "reviewer", "qualityScore", "reviewNotes", "en", "ru"];

const ownKeysAre = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const text = (value, name, { allowEmpty = false, max = 4_000 } = {}) => {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && value.trim().length === 0)) throw new TypeError(`${name} must be a non-empty string of at most ${max} characters`);
  return value;
};

function validateDescription(description, name) {
  if (!ownKeysAre(description, DESCRIPTION_KEYS)) throw new TypeError(`${name} must contain exactly the public description fields`);
  text(description.title, `${name}.title`, { max: 160 });
  text(description.summary, `${name}.summary`, { max: 600 });
  text(description.purpose, `${name}.purpose`, { max: 4_000 });
  text(description.permissions, `${name}.permissions`, { max: 2_000 });
  for (const key of ["capabilities", "steps"]) {
    if (!Array.isArray(description[key]) || description[key].length === 0 || description[key].length > MAX_LIST_ITEMS) throw new TypeError(`${name}.${key} must be a non-empty list of at most ${MAX_LIST_ITEMS} strings`);
    description[key].forEach((item, index) => text(item, `${name}.${key}[${index}]`, { max: 500 }));
  }
}

// Go's url.PathEscape uses encodePathSegment: $&+:=@ remain literal, while
// encodeURIComponent leaves !'()* literal. Mirror that byte-level contract.
const goPathEscape = (segment) =>
  encodeURIComponent(segment)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%24/g, "$")
    .replace(/%26/g, "&")
    .replace(/%2B/g, "+")
    .replace(/%3A/g, ":")
    .replace(/%3D/g, "=")
    .replace(/%40/g, "@");

export const pinnedSourceUrl = (repository, commit, path) =>
  `${repository}/blob/${commit}/${path.split("/").map(goPathEscape).join("/")}`;

/** Validate the metadata-only Go CatalogEntry publication contract. */
export function validateCatalogEntries(entries, { staticIds = [] } = {}) {
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) throw new TypeError(`catalog must be an array with at most ${MAX_ENTRIES} entries`);
  const ids = new Set(staticIds);
  for (const [index, entry] of entries.entries()) {
    const name = `catalog[${index}]`;
    if (!ownKeysAre(entry, ENTRY_KEYS)) throw new TypeError(`${name} must contain exactly the public CatalogEntry fields`);
    if (typeof entry.id !== "string" || !ID.test(entry.id)) throw new TypeError(`${name}.id must be a lowercase slug`);
    if (ids.has(entry.id)) throw new TypeError(`${name}.id duplicates a static or imported skill id`);
    ids.add(entry.id);
    const repository = text(entry.repository, `${name}.repository`);
    if (!GITHUB_REPOSITORY.test(repository)) throw new TypeError(`${name}.repository must be a canonical GitHub repository URL`);
    if (typeof entry.commit !== "string" || !COMMIT.test(entry.commit)) throw new TypeError(`${name}.commit must be a lowercase 40-character Git commit`);
    if (typeof entry.path !== "string" || entry.path.length === 0 || entry.path.length > 512 || !entry.path.endsWith("SKILL.md") || entry.path.startsWith("/") || /[\\\u0000-\u001F\u007F]/.test(entry.path) || entry.path.split("/").some((segment) => !segment || segment === "." || segment === "..")) throw new TypeError(`${name}.path must be a safe repository-relative SKILL.md path`);
    if (entry.sourceUrl !== pinnedSourceUrl(repository, entry.commit, entry.path)) throw new TypeError(`${name}.sourceUrl must exactly pin repository, commit, and path`);
    if (typeof entry.bundleSha256 !== "string" || !SHA256.test(entry.bundleSha256)) throw new TypeError(`${name}.bundleSha256 must be a lowercase SHA-256 hex digest`);
    text(entry.license, `${name}.license`);
    if (!CATEGORIES.has(entry.category)) throw new TypeError(`${name}.category is not a supported catalog category`);
    const reviewedAt = new Date(entry.reviewedAt);
    if (typeof entry.reviewedAt !== "string" || !ISO_UTC.test(entry.reviewedAt) || Number.isNaN(reviewedAt.valueOf())) throw new TypeError(`${name}.reviewedAt must be an ISO UTC timestamp`);
    text(entry.reviewer, `${name}.reviewer`, { max: 160 });
    if (!Number.isInteger(entry.qualityScore) || entry.qualityScore < 0 || entry.qualityScore > 100) throw new TypeError(`${name}.qualityScore must be an integer from 0 to 100`);
    text(entry.reviewNotes, `${name}.reviewNotes`, { allowEmpty: true, max: 2_000 });
    validateDescription(entry.en, `${name}.en`);
    validateDescription(entry.ru, `${name}.ru`);
  }
  return entries;
}

const sourceLabel = (locale) => locale === "ru" ? "Зафиксированный источник GitHub" : "Pinned GitHub source";

export function convertEntries(entries, { locale = "en", staticIds = [] } = {}) {
  validateCatalogEntries(entries, { staticIds });
  if (locale !== "en" && locale !== "ru") throw new TypeError("locale must be en or ru");
  return entries.map((entry) => {
    const description = entry[locale];
    const isRu = locale === "ru";
    return {
      id: entry.id, title: description.title, category: entry.category, summary: description.summary,
      overview: description.purpose, purpose: description.purpose,
      source: entry.repository.replace("https://github.com/", "GitHub: "), sourceLabel: sourceLabel(locale), sourceUrl: entry.sourceUrl,
      permissions: description.permissions, capabilities: description.capabilities, steps: description.steps,
      searchTerms: `${entry.id} ${description.title} ${description.summary} ${entry.repository}`,
      version: entry.commit.slice(0, 7), reviewStatus: isRu ? "Проверено статически" : "Reviewed (static)",
      reviewNotes: entry.reviewNotes, reviewedAt: entry.reviewedAt, reviewer: entry.reviewer, qualityScore: entry.qualityScore,
      license: entry.license, repository: entry.repository, commit: entry.commit, path: entry.path, bundleSha256: entry.bundleSha256,
      imported: true, agents: [], downloadUrl: entry.sourceUrl,
      readme: isRu ? "Опубликованы только проверенные метаданные. Исходный SKILL.md остаётся у первоначального автора по зафиксированной ссылке; Reporadars не копирует и не исполняет его." : "Only reviewed metadata is published here. The upstream SKILL.md remains with its original author at the pinned source; Reporadars neither copies nor executes it.",
      changelog: [{ version: entry.commit.slice(0, 7), date: entry.reviewedAt.slice(0, 10), changes: [isRu ? "Опубликованы проверенные статические метаданные и зафиксированная ссылка на источник." : "Published reviewed static metadata and a pinned upstream source link."] }],
    };
  });
}

export const importedCatalog = validateCatalogEntries(catalogEntries);
export const importedSkills = convertEntries(importedCatalog);
