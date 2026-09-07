import { ArrowRightIcon } from "@phosphor-icons/react";
import {
  PageFooter,
  RadarArtwork,
  SkillIcon,
} from "../components/CatalogUI.jsx";
import { collections } from "../data/collections.js";
import { useLocale } from "../i18n.jsx";

export function CollectionsPage({ skills }) {
  const { locale, t, link } = useLocale();
  const skillsById = new Map(skills.map((skill) => [skill.id, skill]));

  return (
    <>
      <main className="collections-page" id="main">
        <section
          className="collections-hero"
          aria-labelledby="collections-title"
        >
          <RadarArtwork className="collections-hero-art" />
          <p className="collections-kicker">
            {t("Browse by working context", "Выберите по рабочему контексту")}
          </p>
          <h1 id="collections-title">
            {t("SKILL COLLECTIONS", "КОЛЛЕКЦИИ СКИЛЛОВ")}
            <span>.</span>
          </h1>
          <p className="collections-lede">
            {t(
              "A practical route through the skills in this library, grouped by the work they support.",
              "Практический маршрут по скиллам библиотеки, сгруппированным по задачам, которые они поддерживают.",
            )}
          </p>
          <nav
            className="collections-jump-links"
            aria-label={t("Collection sections", "Разделы коллекций")}
          >
            {collections.map((collection) => (
              <a
                key={collection.id}
                href={link(`/collections#${collection.id}`)}
              >
                <span>{collection.number}</span>
                {collection.title[locale]}
              </a>
            ))}
          </nav>
        </section>

        <div className="collections-list">
          {collections.map((collection) => {
            const collectionSkills = collection.skillIds
              .map((id) => skillsById.get(id))
              .filter(Boolean);
            return (
              <section
                className="skill-collection"
                id={collection.id}
                key={collection.id}
                aria-labelledby={`${collection.id}-title`}
              >
                <header className="collections-group-heading">
                  <p className="collections-group-number">
                    {collection.number}
                  </p>
                  <div>
                    <p className="collections-group-count">
                      {t(
                        `${collectionSkills.length} skills`,
                        `Скиллов: ${collectionSkills.length}`,
                      )}
                    </p>
                    <h2 id={`${collection.id}-title`}>
                      {collection.title[locale]}
                    </h2>
                    <p className="collections-group-deck">
                      {collection.description[locale]}
                    </p>
                  </div>
                </header>
                <div className="collections-skill-list">
                  {collectionSkills.map((skill, index) => (
                    <a
                      className="collection-skill-link"
                      href={link(`/skills/${skill.id}`)}
                      key={skill.id}
                    >
                      <span className="collections-skill-index">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="collections-skill-icon">
                        <SkillIcon id={skill.id} size={27} />
                      </span>
                      <span className="collections-skill-copy">
                        <strong>{skill.title}</strong>
                        <small>{skill.summary}</small>
                      </span>
                      <ArrowRightIcon
                        className="collections-skill-arrow"
                        size={23}
                        weight="thin"
                        aria-hidden="true"
                      />
                    </a>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </main>
      <PageFooter />
    </>
  );
}
