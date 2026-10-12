import { collections as samples } from "./collections.js";
import { journalEntries } from "./journal.js";

export function buildEditorialContent(catalog = null) {
  const publishedCollections = catalog?.collections || [],
    publishedArticles = catalog?.articles || [];
  const collectionIds = new Set([
    ...publishedCollections.map((x) => x.slug),
    ...(catalog?.archivedCollections || []),
  ]);
  const articleIds = new Set([
    ...publishedArticles.map((x) => x.slug),
    ...(catalog?.archivedArticles || []),
  ]);
  return {
    collections: [
      ...publishedCollections.map((item, index) => ({
        id: item.slug,
        number: String(index + 1).padStart(2, "0"),
        title: item.title,
        description: item.summary,
        skillIds: item.skillIds,
        sample: false,
      })),
      ...samples
        .filter((item) => !collectionIds.has(item.id))
        .map((item, index) => ({
          ...item,
          number: String(publishedCollections.length + index + 1).padStart(
            2,
            "0",
          ),
          sample: true,
        })),
    ],
    articles: [
      ...publishedArticles.map((item) => ({
        id: item.slug,
        type: "article",
        date: item.updatedAt.slice(0, 10),
        title: item.title,
        summary: item.summary,
        sourceUrl: item.sourceUrl,
        relatedSkills: item.skillIds,
        skillIds: item.skillIds,
        sample: false,
        feature: null,
        sections: [
          ["content", "Article", "Статья", item.body.en, item.body.ru],
        ],
      })),
      ...journalEntries
        .filter((item) => !articleIds.has(item.id))
        .map((item) => ({ ...item, sample: true })),
    ],
  };
}
