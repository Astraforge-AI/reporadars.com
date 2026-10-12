import { useRef, useState } from "react";
import {
  BookmarkSimpleIcon,
  CheckCircleIcon,
  DownloadSimpleIcon,
  FileTextIcon,
  FloppyDiskIcon,
  ShieldCheckIcon,
  TagIcon,
  UsersIcon,
} from "@phosphor-icons/react";
import {
  CommandBlock,
  PageFooter,
  RadarArtwork,
  SourceMark,
} from "../components/CatalogUI";
import { RelatedReading } from "../components/PageConnections.jsx";
import { peerSkillsFor } from "../data/relations.js";
import { useCatalogSkills } from "../CatalogContext.jsx";
import { useLocale } from "../i18n.jsx";

export function SkillPage({ skill, saved, onToggleSave }) {
  const { locale, t, link } = useLocale();
  const relatedDrafts = peerSkillsFor(skill, useCatalogSkills());
  const [tab, setTab] = useState("readme");
  const tabs = ["readme", "changelog"];
  const tabRefs = useRef([]);
  const moveTab = (event) => {
    const i = tabs.indexOf(tab);
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : event.key === "ArrowRight"
            ? (i + 1) % tabs.length
            : (i + tabs.length - 1) % tabs.length;
    setTab(tabs[next]);
    tabRefs.current[next]?.focus();
  };
  return (
    <>
      <main className="skill-page" id="main">
        <section className="skill-hero" aria-labelledby="skill-title">
          <RadarArtwork className="skill-hero-art" />
          <p className="skill-breadcrumb">
            <a href={link("/skills")}>{t("Library", "Библиотека")}</a>{" "}
            <span>&gt;</span>{" "}
            <a href={link(`/skills?category=${skill.category}`)}>
              {t(
                skill.category,
                {
                  research: "исследование",
                  build: "разработка",
                  review: "проверка",
                  operate: "эксплуатация",
                  protect: "защита",
                }[skill.category],
              )}
            </a>{" "}
            <span>&gt;</span> {skill.title}
          </p>
          <h1 id="skill-title">{skill.title}</h1>
          <p className="skill-deck">
            {skill.summary}
            <i />
          </p>
          <div className="skill-hero-grid">
            <div className="skill-overview">
              <h2>
                {skill.imported
                  ? t("Purpose", "Назначение")
                  : t("Overview", "Обзор")}
              </h2>
              <p>{skill.overview}</p>
              <h2>{t("Referenced source", "Указанный источник")}</h2>
              <SourceMark skill={skill} />
            </div>
            <div className="skill-install">
              <span>
                {skill.imported
                  ? t("Source", "Источник")
                  : t("Install preview", "Предпросмотр установки")}
              </span>
              <CommandBlock skill={skill} />
              <button
                className={`skill-save ${saved ? "is-saved" : ""}`}
                type="button"
                aria-pressed={saved}
                onClick={onToggleSave}
              >
                {saved ? (
                  <CheckCircleIcon size={19} />
                ) : (
                  <BookmarkSimpleIcon size={19} />
                )}{" "}
                {saved
                  ? t("Saved to local list", "Сохранено в локальный список")
                  : t("Save skill", "Сохранить скилл")}
              </button>
              {saved && (
                <a
                  className="skill-saved-link"
                  href={link("/account?tab=saved")}
                >
                  {t("View saved skills", "Открыть сохранённые скиллы")}
                </a>
              )}
              <a
                className="skill-download"
                href={skill.downloadUrl}
                {...(skill.imported
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : { download: true })}
              >
                <DownloadSimpleIcon size={18} />{" "}
                {skill.imported
                  ? skill.pinned === false
                    ? t("Open source", "Открыть источник")
                    : t(
                        "Open pinned source",
                        "Открыть зафиксированный источник",
                      )
                  : t("Download draft", "Скачать English-файл")}
              </a>
            </div>
          </div>
        </section>
        <section
          className="skill-trust"
          aria-label={t("Skill metadata", "Метаданные скилла")}
        >
          <div>
            <CheckCircleIcon />
            <strong>{t("Status", "Статус")}</strong>
            <p>
              {skill.reviewStatus}.{" "}
              {skill.imported
                ? t(
                    "Static metadata review only; this is not runtime vetting or certification.",
                    "Только статическая проверка метаданных; это не тестирование во время выполнения и не сертификация.",
                  )
                : t(
                    "Independent runtime review pending.",
                    "Независимая проверка во время выполнения ожидается.",
                  )}
            </p>
          </div>
          <div>
            <FileTextIcon />
            <strong>{t("Source", "Источник")}</strong>
            <p>
              {skill.imported
                ? t(
                    "Upstream instructions or package; Reporadars publishes metadata only.",
                    "Исходные инструкции или пакет; Reporadars публикует только метаданные.",
                  )
                : t(
                    "Reference linked; draft instructions are original.",
                    "Источник указан; черновые инструкции оригинальны.",
                  )}
            </p>
          </div>
          <div>
            <TagIcon />
            <strong>{t("Version", "Версия")}</strong>
            <p>
              {skill.version},{" "}
              {skill.imported
                ? skill.pinned === false
                  ? t(
                      "catalog revision or source tag commit.",
                      "— редакция каталога или коммит тега источника.",
                    )
                  : t(
                      "is the pinned source commit.",
                      "— зафиксированный коммит источника.",
                    )
                : t("pinned in this draft.", "зафиксирована в этом черновике.")}
            </p>
          </div>
          <div>
            <FloppyDiskIcon />
            <strong>{t("Scope", "Область")}</strong>
            <p>
              {t(
                "Explicit permissions and limits below.",
                "Явные разрешения и ограничения ниже.",
              )}
            </p>
          </div>
          <div>
            <UsersIcon />
            <strong>{t("Agents", "Агенты")}</strong>
            <p>
              {skill.agents.length > 0
                ? skill.agents.join(", ")
                : t("No compatibility claims.", "Совместимость не заявлена.")}
            </p>
          </div>
          <div>
            <ShieldCheckIcon />
            <strong>{t("Permissions", "Разрешения")}</strong>
            <p>{skill.permissions}</p>
          </div>
        </section>
        <section className="skill-content">
          <div className="skill-doc">
            <div
              className="skill-tabs"
              role="tablist"
              aria-label={t("Skill documentation", "Документация скилла")}
            >
              {tabs.map((name, index) => (
                <button
                  key={name}
                  ref={(element) => {
                    tabRefs.current[index] = element;
                  }}
                  id={`skill-${name}-tab`}
                  role="tab"
                  type="button"
                  aria-selected={tab === name}
                  aria-controls={`skill-${name}-panel`}
                  tabIndex={tab === name ? 0 : -1}
                  onKeyDown={moveTab}
                  onClick={() => setTab(name)}
                >
                  {name === "readme" ? "README" : t("Changelog", "Изменения")}
                </button>
              ))}
            </div>
            {tab === "readme" ? (
              <div
                className="skill-readme"
                id="skill-readme-panel"
                role="tabpanel"
                aria-labelledby="skill-readme-tab"
              >
                <div>
                  <h2>{t("Capabilities", "Возможности")}</h2>
                  <ul>
                    {skill.capabilities.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h2>{t("How it works", "Как это работает")}</h2>
                  <ol>
                    {skill.steps.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ol>
                </div>
              </div>
            ) : (
              <div
                className="skill-changelog"
                id="skill-changelog-panel"
                role="tabpanel"
                aria-labelledby="skill-changelog-tab"
              >
                {skill.changelog.map((entry) => (
                  <article key={entry.version}>
                    <h2>
                      {t(`Version ${entry.version}`, `Версия ${entry.version}`)}
                    </h2>
                    <p>
                      {new Intl.DateTimeFormat(
                        locale === "ru" ? "ru-RU" : "en-US",
                        { dateStyle: "long" },
                      ).format(new Date(`${entry.date}T00:00:00Z`))}
                    </p>
                    <ul>
                      {entry.changes.map((change) => (
                        <li key={change}>{change}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            )}
            <p className="skill-fineprint">
              {skill.imported
                ? `${skill.readme} ${skill.reviewNotes}`
                : t(
                    "This is an original Reporadars draft, informed by the linked source. Compatibility has not been independently runtime-tested; inspect the instructions, permissions, and placement for your agent before use.",
                    "Это оригинальный черновик Reporadars, подготовленный с учётом указанного источника. Совместимость не проверялась независимо во время выполнения; перед использованием изучите инструкции, разрешения и размещение для своего агента.",
                  )}
            </p>
          </div>
          {!skill.imported && (
            <aside className="skill-config">
              <h2>
                {t("Configuration", "Конфигурация")}{" "}
                <small>{t("(example)", "(пример)")}</small>
              </h2>
              <pre>{JSON.stringify(skill.configuration, null, 2)}</pre>
              <p>
                {t(
                  "This example is not executed by Reporadars.",
                  "Этот пример не выполняется Reporadars.",
                )}
              </p>
            </aside>
          )}
        </section>
      </main>
      <section
        className="skill-connections"
        aria-label={t("More connections", "Другие связи")}
      >
        <RelatedReading skill={skill} />
        {relatedDrafts.length > 0 && (
          <section
            className="page-connections"
            aria-labelledby="related-drafts-title"
          >
            <div>
              <p className="page-connections-kicker">
                {t("Keep exploring", "Продолжить изучение")}
              </p>
              <h2 id="related-drafts-title">
                {t("More draft skills", "Другие черновики навыков")}
              </h2>
              <p>
                {t(
                  "Drafts in the same category appear first, followed by other catalog samples.",
                  "Сначала показаны черновики той же категории, затем другие образцы каталога.",
                )}
              </p>
            </div>
            <div className="page-connections-list">
              {relatedDrafts.map((relatedSkill) => (
                <a
                  className="page-connection-link"
                  href={link(`/skills/${relatedSkill.id}`)}
                  key={relatedSkill.id}
                >
                  <span>{relatedSkill.title}</span>
                  <span aria-hidden="true">→</span>
                </a>
              ))}
            </div>
          </section>
        )}
      </section>
      <PageFooter />
    </>
  );
}
