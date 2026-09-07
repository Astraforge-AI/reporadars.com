import { ArrowRightIcon } from "@phosphor-icons/react";
import { journalEntries } from "../data/journal.js";
import { getLocalizedSkills } from "../data/skills-ru.js";
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
  const articles = articleIdsForSkill(skill.id)
    .map((id) => journalEntries.find((article) => article.id === id))
    .filter(Boolean);

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
            "Sample editorial notes that frame this draft; they are not release records.",
            "Демонстрационные редакционные заметки, поясняющие этот черновик; это не записи о выпусках.",
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
  const skills = getLocalizedSkills(locale);
  const relatedSkills = skillIdsForArticle(article.id)
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
          {t("Related draft skills", "Связанные черновики навыков")}
        </h2>
        <p>
          {t(
            "These original drafts are provided for inspection; check scope and permissions before use.",
            "Эти оригинальные черновики доступны для изучения; перед использованием проверьте область и разрешения.",
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
