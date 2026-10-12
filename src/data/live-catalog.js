import { getLocalizedSkills } from "./skills-ru.js";

// Public CMS projection only. Repository contents are never rendered as HTML.
export function buildCatalog(locale, catalog = null) {
  const base = getLocalizedSkills(locale);
  if (!catalog) return base;
  const replacements = new Set(catalog.items.map((item) => item.slug));
  const hidden = new Set(catalog.archived || []);
  const ru = locale === "ru";
  return [
    ...catalog.items.map((item) => ({
      id: item.slug,
      title: item.title[locale],
      summary: item.summary[locale],
      overview: item.body[locale],
      category: item.category,
      source: item.sourceUrl ? new URL(item.sourceUrl).hostname : "Reporadars",
      sourceLabel: ru ? "Источник" : "Source",
      sourceUrl: item.sourceUrl || "https://reporadars.com/skills",
      downloadUrl: item.sourceUrl || "https://reporadars.com/skills",
      imported: true,
      pinned: Boolean(item.provenance) && !item.provenance.package,
      agents: [],
      version: item.provenance?.commit?.slice(0, 7) || String(item.revision),
      reviewStatus:
        item.provenance?.reviewKind === "automated"
          ? ru
            ? "Автопроверка"
            : "Automated checks"
          : ru
            ? "Опубликовано редактором"
            : "Editor published",
      reviewNotes: ru
        ? "Проверки не подтверждают безопасность выполнения."
        : "Checks do not certify execution safety.",
      permissions: ru
        ? "Изучите исходные инструкции и необходимые разрешения перед использованием."
        : "Review the original instructions and required permissions before use.",
      capabilities: [],
      steps: [],
      configuration: {},
      readme: item.body[locale],
      changelog: [
        {
          version: String(item.revision),
          date: item.updatedAt.slice(0, 10),
          changes: [
            ru ? "Обновлены метаданные каталога." : "Catalog metadata updated.",
          ],
        },
      ],
    })),
    ...base.filter(
      (skill) => !replacements.has(skill.id) && !hidden.has(skill.id),
    ),
  ];
}
