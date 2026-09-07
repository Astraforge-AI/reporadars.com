import { useEffect, useMemo, useState } from "react";
import {
  ArrowRightIcon,
  LockKeyIcon,
  MagnifyingGlassIcon,
  CrosshairIcon,
  EyeIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";
import { useLocale } from "../i18n.jsx";
import { journalEntries } from "../data/journal.js";
import { RelatedSkills } from "../components/PageConnections.jsx";
import { SiteFooter, SiteHeader } from "../components/SiteChrome.jsx";

const typeCopy = {
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

export function EditorialHeader({ compact = false }) {
  return <SiteHeader layout="editorial" compact={compact} />;
}

export function LoginPage() {
  const { t, link } = useLocale();
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    setSignup(
      new URLSearchParams(window.location.search).get("mode") === "signup",
    );
  }, []);
  const submit = (event) => {
    event.preventDefault();
    setNotice(
      !email || !/^\S+@\S+\.\S+$/.test(email)
        ? t(
            "Enter a valid email address.",
            "Введите корректный адрес электронной почты.",
          )
        : t(
            "Email sign-in is unavailable: no provider is configured, so no message was sent.",
            "Вход по email недоступен: провайдер не настроен, поэтому сообщение не отправлено.",
          ),
    );
  };
  return (
    <div className="editorial-page editorial-login-page">
      <EditorialHeader compact />
      <main id="main" className="login-main">
        <section className="login-form-panel">
          <h1>
            {signup
              ? t("CREATE A RADAR", "СОЗДАТЬ РАДАР")
              : t("SIGN IN TO YOUR RADAR", "ВОЙТИ В РАДАР")}
            <b>.</b>
          </h1>
          <p className="login-lede">
            {signup
              ? t(
                  "Account creation is not available yet.",
                  "Создание аккаунта пока недоступно.",
                )
              : t(
                  "Save, publish, and review skills you trust.",
                  "Сохраняйте, публикуйте и проверяйте навыки, которым доверяете.",
                )}
          </p>
          <form onSubmit={submit} noValidate>
            <label htmlFor="login-email">
              {t("Email address", "Адрес электронной почты")}
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              aria-describedby="login-notice"
            />
            <button className="editorial-primary" type="submit">
              {t("Continue with email", "Продолжить с email")}
            </button>
            <button
              className="editorial-secondary"
              type="button"
              onClick={() =>
                setNotice(
                  t(
                    "GitHub sign-in is unavailable: no provider is configured.",
                    "Вход через GitHub недоступен: провайдер не настроен.",
                  ),
                )
              }
            >
              {t("Continue with GitHub", "Продолжить через GitHub")}
            </button>
          </form>
          <div className="login-divider" aria-hidden="true">
            <span />
            {t("or", "или")}
            <span />
          </div>
          <p id="login-notice" className="editorial-notice" role="status">
            {notice}
          </p>
          <p className="login-safety">
            <LockKeyIcon size={33} weight="thin" aria-hidden="true" />
            {t(
              "We never install a skill without your explicit command.",
              "Мы никогда не устанавливаем навык без вашей явной команды.",
            )}
          </p>
          <p className="login-switch">
            {signup
              ? t("Already have an account?", "Уже есть аккаунт?")
              : t("New here?", "Впервые здесь?")}{" "}
            <a href={link(signup ? "/login" : "/login?mode=signup")}>
              {signup
                ? t("Sign in", "Войти")
                : t("Create an account", "Создать аккаунт")}
            </a>
          </p>
          {signup && (
            <p className="editorial-unavailable">
              {t(
                "Unavailable until an authentication provider is configured.",
                "Недоступно, пока не будет настроен провайдер аутентификации.",
              )}
            </p>
          )}
          <a className="workspace-link" href={link("/account")}>
            {t(
              "Open local workspace (no sign-in)",
              "Открыть локальное рабочее пространство (без входа)",
            )}{" "}
            <ArrowRightIcon size={20} aria-hidden="true" />
          </a>
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
            {t("SIGNAL LOST", "СИГНАЛ ПОТЕРЯН")}
            <b>.</b>
            <span>404</span>
          </h1>
          <p className="notfound-lede">
            {t(
              "This route is outside our radar.",
              "Этот маршрут вне нашего радара.",
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
    [filter],
  );
  return (
    <div className="editorial-page journal-page">
      <EditorialHeader />
      <main id="main" className="journal-main">
        <div className="journal-hero">
          <h1>
            {t("SIGNAL JOURNAL", "ЖУРНАЛ СИГНАЛОВ")}
            <b>.</b>
          </h1>
          <p className="journal-lede">
            {t("What changed in the field.", "Что нового в мире ИИ.")}
          </p>
          <small>
            {t(
              "Sample editorial — not release history or vetted facts.",
              "Демонстрационная редакция — не история выпусков и не проверенные факты.",
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
      <time dateTime={entry.date}>{formatDate(entry.date, locale)}</time>
      <div className="journal-entry">
        <div className="journal-type">{t(...typeCopy[entry.type])}</div>
        <h2>
          <a href={link(`/journal/${entry.id}`)}>
            {t(entry.title.en, entry.title.ru)}
          </a>
        </h2>
        <p>{t(entry.summary.en, entry.summary.ru)}</p>
        <small>{t("Sample editorial", "Демонстрационная редакция")}</small>
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
          <p className="article-byline">
            {t("Sample editorial desk", "Демонстрационная редакция")} ·{" "}
            {t("6 min sample", "примерно 6 мин")} ·{" "}
            {t("concept, not a release", "концепт, не выпуск")}
          </p>
        </header>
        <div className="article-layout">
          <div className="article-content">
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
            {article.sections.map(([id, enTitle, ruTitle, enBody, ruBody]) => (
              <section className="article-section" id={id} key={id}>
                <h2>
                  {t(enTitle, ruTitle)}
                  <b>.</b>
                </h2>
                <div>
                  <p>{t(enBody, ruBody)}</p>
                  <p>
                    {t(
                      "The useful next move is to record the assumption, make the boundary visible, and ask for a review before expanding scope.",
                      "Полезный следующий шаг — зафиксировать предположение, сделать границу видимой и запросить проверку до расширения области.",
                    )}
                  </p>
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
                {t("Next sample article", "Следующая демонстрационная статья")}{" "}
                →
              </a>
            )}
          </nav>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
