import { useEffect, useMemo, useState } from "react";
import {
  ArrowRightIcon,
  MagnifyingGlassIcon,
  CrosshairIcon,
  EyeIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";
import { useLocale } from "../i18n.jsx";
import { useCatalogContent } from "../CatalogContext.jsx";
import { RelatedSkills } from "../components/PageConnections.jsx";
import { SiteFooter, SiteHeader } from "../components/SiteChrome.jsx";
import { EmailAuthPanel } from "../auth/EmailAuthPanel.jsx";

const typeCopy = {
  article: ["Article", "Статья"],
  new: ["New signal", "Новый сигнал"],
  review: ["Review", "Обзор"],
  retired: ["Retired", "В архиве"],
  release: ["Release", "Выпуск"],
};
const formatDate = (date, locale) =>
  new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));

export function EditorialHeader() {
  return <SiteHeader />;
}

export function LoginPage() {
  return (
    <div className="editorial-page editorial-login-page">
      <EditorialHeader />
      <main id="main" className="login-main">
        <section className="login-form-panel">
          <EmailAuthPanel />
        </section>
        <div className="login-art" aria-hidden="true" />
      </main>
      <SiteFooter />
    </div>
  );
}

export function NotFoundPage() {
  const { t, link } = useLocale();
  const [query, setQuery] = useState("");
  const submit = (e) => {
    e.preventDefault();
    window.location.assign(link(`/skills?q=${encodeURIComponent(query)}`));
  };
  return (
    <div className="editorial-page editorial-404-page">
      <EditorialHeader compact />
      <main id="main" className="notfound-main">
        <section>
          <h1>
            {t("Page not found", "Страница не найдена")}
            <b>.</b>
            <span>404</span>
          </h1>
          <p className="notfound-lede">
            {t(
              "Try searching the catalog or return to the homepage.",
              "Попробуйте поиск в каталоге или вернитесь на главную.",
            )}
          </p>
          <form className="notfound-search" onSubmit={submit}>
            <label className="sr-only" htmlFor="notfound-search">
              {t("Search trusted skills", "Поиск проверенных навыков")}
            </label>
            <MagnifyingGlassIcon size={27} weight="thin" aria-hidden="true" />
            <input
              id="notfound-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(
                "Search trusted skills",
                "Поиск проверенных навыков",
              )}
            />
            <button className="editorial-primary">
              {t("Explore catalog", "Открыть каталог")}
            </button>
          </form>
          <div className="suggested-signals">
            <p>{t("Suggested signals", "Рекомендуемые сигналы")}</p>
            {[
              ["SEO Audit", "SEO-аудит", "seo-audit"],
              ["Security Review", "Проверка безопасности", "security-review"],
              ["Browser Testing", "Тестирование браузера", "browser-testing"],
            ].map(([name, ru, id]) => (
              <a href={link(`/skills/${id}`)} key={name}>
                <ArrowRightIcon size={27} weight="thin" aria-hidden="true" />
                {t(name, ru)}
              </a>
            ))}
          </div>
          <details className="notfound-help">
            <summary>{t("Need help?", "Нужна помощь?")}</summary>
            <p>
              {t(
                "Try the catalog search or return to the journal. This prototype has no contact channel configured.",
                "Попробуйте поиск в каталоге или вернитесь в журнал. В этом прототипе не настроен канал связи.",
              )}
            </p>
            <a href={link("/journal")}>
              {t("Open signal journal", "Открыть журнал сигналов")}
            </a>
          </details>
        </section>
        <div className="notfound-art" aria-hidden="true" />
      </main>
      <SiteFooter />
    </div>
  );
}

export function JournalPage() {
  const { t, locale, link } = useLocale();
  const { articles: journalEntries } = useCatalogContent();
  const [filter, setFilter] = useState("all");
  const filterValues = ["all", "new", "review", "release", "retired"];
  useEffect(() => {
    const value =
      new URLSearchParams(window.location.search).get("type") || "all";
    setFilter(filterValues.includes(value) ? value : "all");
  }, []);
  const filters = [
    ["all", "All updates", "Все обновления"],
    ["new", "New signals", "Новые сигналы"],
    ["review", "Reviews", "Обзоры"],
    ["release", "Releases", "Выпуски"],
    ["retired", "Retired", "В архиве"],
  ];
  const shown = useMemo(
    () =>
      journalEntries.filter(
        (entry) => filter === "all" || entry.type === filter,
      ),
    [filter, journalEntries],
  );
  return (
    <div className="editorial-page journal-page">
      <EditorialHeader />
      <main id="main" className="journal-main">
        <div className="journal-hero">
          <h1>
            {t("Journal", "Журнал")}
            <b>.</b>
          </h1>
          <p className="journal-lede">
            {t("What changed in the field.", "Что нового в мире ИИ.")}
          </p>
          <small>
            {t(
              "Editorial notes. Sample articles are marked individually.",
              "Редакционные заметки. Демонстрационные статьи отмечены отдельно.",
            )}
          </small>
        </div>
        <nav
          className="journal-filters"
          aria-label={t("Journal categories", "Категории журнала")}
        >
          {filters.map(([value, en, ru]) => (
            <a
              key={value}
              href={link(
                value === "all" ? "/journal" : `/journal?type=${value}`,
              )}
              aria-current={filter === value ? "page" : undefined}
              onClick={(event) => {
                if (
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey ||
                  event.button !== 0
                )
                  return;
                event.preventDefault();
                setFilter(value);
                const target = link(
                  value === "all" ? "/journal" : `/journal?type=${value}`,
                );
                window.history.replaceState(
                  {},
                  "",
                  `${target}${window.location.hash}`,
                );
                window.dispatchEvent(new Event("reporadars:navigation"));
              }}
            >
              {t(en, ru)}
            </a>
          ))}
        </nav>
        <div className="journal-list">
          {shown.map((entry, index) => (
            <JournalRow
              entry={entry}
              featured={index === 0 && filter === "all"}
              key={entry.id}
              locale={locale}
              t={t}
              link={link}
            />
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function JournalRow({ entry, featured, locale, t, link }) {
  return (
    <article
      className={`journal-row ${featured ? "journal-row--featured" : ""}`}
    >
      <time dateTime={entry.date}>
        {!entry.sample && <small>{t("Updated", "Обновлено")} </small>}
        {formatDate(entry.date, locale)}
      </time>
      <div className="journal-entry">
        <div className="journal-type">{t(...typeCopy[entry.type])}</div>
        <h2>
          <a href={link(`/journal/${entry.id}`)}>
            {t(entry.title.en, entry.title.ru)}
          </a>
        </h2>
        <p>{t(entry.summary.en, entry.summary.ru)}</p>
        {entry.sample && (
          <small>{t("Sample editorial", "Демонстрационная редакция")}</small>
        )}
      </div>
      <a
        className="journal-arrow"
        href={link(`/journal/${entry.id}`)}
        aria-label={t(`Read ${entry.title.en}`, `Открыть: ${entry.title.ru}`)}
      >
        <ArrowRightIcon size={39} weight="thin" aria-hidden="true" />
      </a>
    </article>
  );
}

export function ArticlePage({ article }) {
  const { t, locale, link } = useLocale();
  const { articles: journalEntries } = useCatalogContent();
  const [active, setActive] = useState(article.sections[0]?.[0]);
  const featureIcons = [CrosshairIcon, EyeIcon, SquaresFourIcon];
  useEffect(() => {
    const handler = () => {
      const closest = article.sections
        .map((s) => document.getElementById(s[0]))
        .filter(Boolean)
        .map((node) => ({
          id: node.id,
          top: Math.abs(node.getBoundingClientRect().top - 130),
        }))
        .sort((a, b) => a.top - b.top)[0];
      if (closest) setActive(closest.id);
    };
    window.addEventListener("scroll", handler, { passive: true });
    handler();
    return () => window.removeEventListener("scroll", handler);
  }, [article]);
  return (
    <div className="editorial-page article-page">
      <EditorialHeader />
      <main id="main" className="article-main">
        <header className="article-hero">
          <p className="editorial-kicker">
            <a href={link("/journal")}>
              {t("Signal journal", "Журнал сигналов")}
            </a>
          </p>
          <p className="article-date">
            {t(...typeCopy[article.type])} · {formatDate(article.date, locale)}
          </p>
          <h1>
            {t(article.title.en, article.title.ru)}
            <b>.</b>
          </h1>
          <p className="article-summary">
            {t(article.summary.en, article.summary.ru)}
          </p>
          {article.sample ? (
            <p className="article-byline">
              {t("Sample editorial desk", "Демонстрационная редакция")} ·{" "}
              {t("6 min sample", "примерно 6 мин")} ·{" "}
              {t("concept, not a release", "концепт, не выпуск")}
            </p>
          ) : (
            <p className="article-byline">
              {t("Updated", "Обновлено")}: {formatDate(article.date, locale)}
              {article.sourceUrl && (
                <>
                  {" "}
                  ·{" "}
                  <a
                    href={article.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("Source", "Источник")}
                  </a>
                </>
              )}
            </p>
          )}
        </header>
        <div className="article-layout">
          <div className="article-content">
            {article.feature && (
              <section className="article-feature-panel">
                <div className="article-feature-main">
                  <div className="article-before-after">
                    {[article.feature.before, article.feature.after].map(
                      ([enTitle, ruTitle, enBody, ruBody]) => (
                        <section key={enTitle}>
                          <h2>{t(enTitle, ruTitle)}</h2>
                          <p>{t(enBody, ruBody)}</p>
                        </section>
                      ),
                    )}
                  </div>
                  <figure className="article-code-example">
                    <figcaption>{t(...article.feature.caption)}</figcaption>
                    <pre>
                      <code>{article.feature.code}</code>
                    </pre>
                  </figure>
                </div>
                <div className="article-feature-checks">
                  {article.feature.checks.map(
                    ([enTitle, ruTitle, enBody, ruBody], index) => {
                      const Icon = featureIcons[index];
                      return (
                        <section key={enTitle}>
                          <Icon size={37} weight="thin" aria-hidden="true" />
                          <div>
                            <h2>{t(enTitle, ruTitle)}</h2>
                            <p>{t(enBody, ruBody)}</p>
                          </div>
                        </section>
                      );
                    },
                  )}
                </div>
              </section>
            )}
            {article.sections.map(([id, enTitle, ruTitle, enBody, ruBody]) => (
              <section className="article-section" id={id} key={id}>
                <h2>
                  {t(enTitle, ruTitle)}
                  <b>.</b>
                </h2>
                <div>
                  <p className="article-body-text">{t(enBody, ruBody)}</p>
                  {article.sample && (
                    <p>
                      {t(
                        "The useful next move is to record the assumption, make the boundary visible, and ask for a review before expanding scope.",
                        "Полезный следующий шаг — зафиксировать предположение, сделать границу видимой и запросить проверку до расширения области.",
                      )}
                    </p>
                  )}
                </div>
              </section>
            ))}
          </div>
          <aside
            className="article-toc"
            aria-label={t("On this page", "На этой странице")}
          >
            <p>{t("On this page", "На этой странице")}</p>
            <ol>
              {article.sections.map(([id, en, ru]) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    aria-current={active === id ? "location" : undefined}
                  >
                    {t(en, ru)}
                  </a>
                </li>
              ))}
            </ol>
          </aside>
        </div>
        <div className="article-connections">
          <RelatedSkills article={article} />
          <nav
            className="article-navigation"
            aria-label={t("Article navigation", "Навигация по статьям")}
          >
            <a href={link("/journal")}>
              {t("Back to journal", "Вернуться к журналу")}
            </a>
            {journalEntries[
              journalEntries.findIndex((entry) => entry.id === article.id) + 1
            ] && (
              <a
                href={link(
                  `/journal/${journalEntries[journalEntries.findIndex((entry) => entry.id === article.id) + 1].id}`,
                )}
              >
                {t("Next article", "Следующая статья")} →
              </a>
            )}
          </nav>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
