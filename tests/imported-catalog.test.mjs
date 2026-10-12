import assert from "node:assert/strict";
import test from "node:test";
import { convertEntries, pinnedSourceUrl, validateCatalogEntries } from "../src/data/imported-skills.js";
import { getLocalizedSkills } from "../src/data/skills-ru.js";

const commit = "0123456789abcdef0123456789abcdef01234567";
const entry = {
  id: "upstream-review", repository: "https://github.com/example/skills", commit,
  path: "skills/review/SKILL.md", sourceUrl: `https://github.com/example/skills/blob/${commit}/skills/review/SKILL.md`,
  bundleSha256: "a".repeat(64), license: "MIT", category: "review", reviewedAt: "2026-09-07T00:00:00.000Z",
  reviewer: "catalog-reviewer", qualityScore: 87, reviewNotes: "Metadata fields and pinned source were checked.",
  en: { title: "Upstream Review", summary: "Review a bounded change.", purpose: "Provide a review workflow from published metadata.", capabilities: ["Inspect changed files"], steps: ["Open the pinned source"], permissions: "Read the approved repository." },
  ru: { title: "Проверка источника", summary: "Проверяет ограниченное изменение.", purpose: "Описывает проверку по опубликованным метаданным.", capabilities: ["Проверять изменённые файлы"], steps: ["Открыть зафиксированный источник"], permissions: "Читайте согласованный репозиторий." },
};

test("strictly validates a pinned metadata-only catalog entry", () => {
  assert.deepEqual(validateCatalogEntries([entry]), [entry]);
  assert.throws(() => validateCatalogEntries([{ ...entry, sourceUrl: entry.repository }]), /exactly pin/);
  assert.throws(() => validateCatalogEntries([{ ...entry, executable: "untrusted" }]), /exactly the public CatalogEntry fields/);
});

test("accepts root and Unicode paths with Go-compatible escaped source URLs", () => {
  const root = { ...entry, id: "root-skill", path: "SKILL.md", sourceUrl: `https://github.com/example/skills/blob/${commit}/SKILL.md`, reviewedAt: "2026-09-07T00:00:00.123456789Z" };
  assert.deepEqual(validateCatalogEntries([root]), [root]);
  const path = "папка с пробелом/子/SKILL.md";
  const sourceUrl = `https://github.com/example/skills/blob/${commit}/%D0%BF%D0%B0%D0%BF%D0%BA%D0%B0%20%D1%81%20%D0%BF%D1%80%D0%BE%D0%B1%D0%B5%D0%BB%D0%BE%D0%BC/%E5%AD%90/SKILL.md`;
  assert.equal(pinnedSourceUrl(entry.repository, commit, path), sourceUrl);
  assert.deepEqual(validateCatalogEntries([{ ...entry, id: "unicode-path", path, sourceUrl }])[0].path, path);
});

test("rejects duplicates and malformed publication metadata", () => {
  assert.throws(() => validateCatalogEntries([entry], { staticIds: [entry.id] }), /duplicates/);
  assert.throws(() => validateCatalogEntries([{ ...entry, bundleSha256: "not-a-digest" }]), /SHA-256/);
  assert.throws(() => validateCatalogEntries([{ ...entry, path: "one//SKILL.md" }]), /safe repository-relative/);
  assert.throws(() => validateCatalogEntries([{ ...entry, path: "../SKILL.md" }]), /safe repository-relative/);
  assert.throws(() => validateCatalogEntries([{ ...entry, reviewer: "a".repeat(161) }]), /160/);
});

test("converts reviewed metadata without fabricated installation or compatibility", () => {
  const [skill] = convertEntries([entry]);
  assert.equal(skill.imported, true);
  assert.equal(skill.version, commit.slice(0, 7));
  assert.equal(skill.reviewStatus, "Reviewed (static)");
  assert.deepEqual(skill.agents, []);
  assert.equal(skill.downloadUrl, entry.sourceUrl);
  assert.match(skill.readme, /neither copies nor executes/);
});

test("uses imported Russian descriptions rather than draft localization", () => {
  const [skill] = convertEntries([entry], { locale: "ru" });
  assert.equal(skill.title, entry.ru.title);
  assert.equal(skill.purpose, entry.ru.purpose);
  assert.equal(skill.reviewStatus, "Проверено статически");
  assert.match(skill.readme, /проверенные метаданные/);
  assert.ok(getLocalizedSkills("ru").every((item) => !item.imported));
});
