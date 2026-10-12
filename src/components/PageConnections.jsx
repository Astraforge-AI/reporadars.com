import { ArrowRightIcon } from "@phosphor-icons/react";
import { useCatalogSkills, useCatalogContent } from "../CatalogContext.jsx";
import { articleIdsForSkill, skillIdsForArticle } from "../data/relations.js";
import { useLocale } from "../i18n.jsx";
import { SkillIcon } from "./CatalogUI.jsx";

function ConnectionLink({ href, children }) {
  return (
    <a className="page-connection-link" href={href}>
      <span>{children}</span>
      <ArrowRightIcon size={18} weight="thin" aria-hidden="true" />
    </a>
  );
}

export function RelatedReading({ skill }) {
  const { locale, t, link } = useLocale();
  const { articles: journalEntries } = useCatalogContent();
  const ids = articleIdsForSkill(skill.id);
  const articles = journalEntries.filter(
    (article) =>
      ids.includes(article.id) || article.skillIds?.includes(skill.id),
  );

  if (!articles.length) return null;

  return (
    <section
      className="page-connections"
      aria-labelledby="related-reading-title"
    >
      <div>
        <p className="page-connections-kicker">{t("Context", "Контекст")}</p>
        <h2 id="related-reading-title">
          {t("Related reading", "Связанные материалы")}
        </h2>
        <p>
          {t(
            "Articles about this skill. Sample notes are marked on their pages.",
            "Материалы об этом скилле. Примеры отмечены на своих страницах.",
          )}
        </p>
      </div>
      <div className="page-connections-list">
        {articles.map((article) => (
          <ConnectionLink
            key={article.id}
            href={link(`/journal/${article.id}`)}
          >
            {article.title[locale]}
          </ConnectionLink>
        ))}
      </div>
    </section>
  );
}

export function RelatedSkills({ article }) {
  const { locale, t, link } = useLocale();
  const skills = useCatalogSkills();
  const relatedSkills = (article.skillIds || skillIdsForArticle(article.id))
    .map((id) => skills.find((skill) => skill.id === id))
    .filter(Boolean);

  if (!relatedSkills.length) return null;

  return (
    <section
      className="page-connections"
      aria-labelledby="related-skills-title"
    >
      <div>
        <p className="page-connections-kicker">{t("Explore", "Исследуйте")}</p>
        <h2 id="related-skills-title">
          {article.sample
            ? t("Related draft skills", "Связанные черновики навыков")
            : t("Related skills", "Связанные скиллы")}
        </h2>
        <p>
          {t(
            "Review scope and permissions before using these skills.",
            "Проверьте область работы и разрешения перед использованием скиллов.",
          )}
        </p>
      </div>
      <div className="page-connections-list">
        {relatedSkills.map((skill) => (
          <ConnectionLink key={skill.id} href={link(`/skills/${skill.id}`)}>
            <SkillIcon id={skill.id} size={18} /> {skill.title}
          </ConnectionLink>
        ))}
      </div>
    </section>
  );
}
