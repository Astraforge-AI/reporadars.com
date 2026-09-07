import { useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import {
  CommandBlock,
  PageFooter,
  RadarArtwork,
  SkillIcon,
  SourceMark,
} from "../components/CatalogUI";
import { useLocale } from "../i18n.jsx";

const categories = ["research", "build", "review", "operate", "protect"];
const labels = {
  research: "Research",
  build: "Build",
  review: "Review",
  operate: "Operate",
  protect: "Protect",
};

export function LibraryPage({ skills }) {
  const { t, link } = useLocale();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [filtersReady, setFiltersReady] = useState(false);
  const [page, setPage] = useState(0);
  const input = useRef(null);
  useEffect(() => {
    const onKey = (event) => {
      if (
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !/input|textarea/i.test(document.activeElement?.tagName || "")
      ) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const incomingCategory = params.get("category") || "";
    setQuery(params.get("q") || "");
    setCategory(categories.includes(incomingCategory) ? incomingCategory : "");
    setFiltersReady(true);
  }, []);
  useEffect(() => {
    if (!filtersReady) return;
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (category) params.set("category", category);
    const tail = params.toString();
    window.history.replaceState(
      {},
      "",
      `${link("/skills")}${tail ? `?${tail}` : ""}${window.location.hash}`,
    );
    window.dispatchEvent(new Event("reporadars:navigation"));
    setPage(0);
  }, [query, category, filtersReady]);
  const filtered = useMemo(
    () =>
      skills.filter((skill) => {
        const matchesQuery =
          `${skill.title} ${skill.summary} ${skill.source} ${skill.agents.join(" ")} ${skill.searchTerms || ""}`
            .toLowerCase()
            .includes(query.toLowerCase());
        return matchesQuery && (!category || skill.category === category);
      }),
    [skills, query, category],
  );
  const shown = filtered.slice(page * 6, page * 6 + 6);
  const pages = Math.ceil(filtered.length / 6);
  const clear = () => {
    setQuery("");
    setCategory("");
  };
  return (
    <>
      <main className="catalog-page" id="main">
        <section className="catalog-hero" aria-labelledby="library-title">
          <RadarArtwork className="catalog-hero-art" />
          <h1 id="library-title">
            {t("Explore curated signals", "Исследуйте отобранные сигналы")}
            <span>.</span>
          </h1>
          <p className="catalog-lede">
            {t(
              "Discover practical AI skills, with clear sources and permissions.",
              "Откройте практичные AI-скиллы с понятными источниками и разрешениями.",
            )}
          </p>
          <label className="catalog-search">
            <MagnifyingGlassIcon size={28} weight="thin" aria-hidden="true" />
            <input
              ref={input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(
                "Search by task, source, or agent",
                "Поиск по задаче, источнику или агенту",
              )}
              type="search"
              aria-label={t("Search skills", "Поиск скиллов")}
            />
            <kbd>/</kbd>
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label={t("Clear search", "Очистить поиск")}
              >
                <XIcon size={17} />
              </button>
            )}
          </label>
          <div
            className="catalog-filters"
            aria-label={t("Filter by category", "Фильтр по категории")}
          >
            <button
              className={!category ? "is-active" : ""}
              type="button"
              onClick={() => setCategory("")}
            >
              {t("All skills", "Все скиллы")}
            </button>
            {categories.map((item) => (
              <button
                type="button"
                key={item}
                className={category === item ? "is-active" : ""}
                onClick={() => setCategory(category === item ? "" : item)}
              >
                <SkillIcon
                  id={
                    item === "protect"
                      ? "security-review"
                      : item === "build"
                        ? "api-contract"
                        : item === "review"
                          ? "browser-testing"
                          : item === "operate"
                            ? "release-readiness"
                            : "seo-audit"
                  }
                  size={19}
                />
                {t(
                  labels[item],
                  {
                    research: "Исследование",
                    build: "Разработка",
                    review: "Проверка",
                    operate: "Эксплуатация",
                    protect: "Защита",
                  }[item],
                )}
              </button>
            ))}
          </div>
        </section>
        <section
          className="catalog-table-wrap"
          aria-label={t("Skills library", "Библиотека скиллов")}
        >
          <table className="catalog-table">
            <thead>
              <tr>
                <th>{t("Skill", "Скилл")}</th>
                <th>{t("Description", "Описание")}</th>
                <th>{t("Reference", "Источник")}</th>
                <th>{t("Status", "Статус")}</th>
                <th>{t("Format", "Формат")}</th>
                <th>
                  {t(
                    "Add command — preview",
                    "Команда добавления — предпросмотр",
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((skill) => (
                <tr key={skill.id}>
                  <td>
                    <a
                      className="catalog-skill"
                      href={link(`/skills/${skill.id}`)}
                    >
                      <span>
                        <SkillIcon id={skill.id} size={28} />
                      </span>
                      <strong>{skill.title}</strong>
                    </a>
                  </td>
                  <td className="catalog-summary">{skill.summary}</td>
                  <td>
                    <SourceMark skill={skill} />
                  </td>
                  <td>
                    <span className="catalog-status">
                      <i />
                      {skill.reviewStatus}
                    </span>
                  </td>
                  <td>
                    <span className="catalog-format">SKILL.md</span>
                  </td>
                  <td>
                    <CommandBlock skill={skill} compact />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!shown.length && (
            <div className="catalog-empty">
              <p>
                {t(
                  "No draft skills match that signal.",
                  "Нет черновых скиллов, соответствующих этому сигналу.",
                )}
              </p>
              <button type="button" onClick={clear}>
                {t("Clear search and filters", "Очистить поиск и фильтры")}
              </button>
            </div>
          )}
          {pages > 1 && (
            <nav
              className="catalog-pagination"
              aria-label={t("Library pages", "Страницы библиотеки")}
            >
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                {t("Previous", "Назад")}
              </button>
              <span>
                {t(
                  `Page ${page + 1} of ${pages}`,
                  `Страница ${page + 1} из ${pages}`,
                )}
              </span>
              <button
                type="button"
                disabled={page >= pages - 1}
                onClick={() => setPage(page + 1)}
              >
                {t("Next", "Далее")}
              </button>
            </nav>
          )}
        </section>
      </main>
      <PageFooter />
    </>
  );
}
