import { useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import {
  PageFooter,
  RadarArtwork,
  SkillIcon,
  SourceMark,
} from "../components/CatalogUI";
import { useLocale } from "../i18n.jsx";
import { useCatalogLive } from "../CatalogContext.jsx";

const categories = ["research", "build", "review", "operate", "protect"];
const labels = {
  research: "Research",
  build: "Build",
  review: "Review",
  operate: "Operate",
  protect: "Protect",
};

export function LibraryPage({ skills }) {
  const { t, link, locale } = useLocale();
  const live = useCatalogLive();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [filtersReady, setFiltersReady] = useState(false);
  const [page, setPage] = useState(0);
  const [remote, setRemote] = useState(null);
  const [retry, setRetry] = useState(0);
  const remoteKey = JSON.stringify([query, category, page, locale, retry]);
  useEffect(() => {
    if (!live || !filtersReady) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          locale,
          q: query,
          category,
          page: String(page + 1),
        });
        const response = await fetch(`/api/catalog?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Search unavailable");
        const data = await response.json();
        if (!controller.signal.aborted) setRemote({ key: remoteKey, ...data });
      } catch {
        if (!controller.signal.aborted)
          setRemote({ key: remoteKey, error: true });
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [live, filtersReady, remoteKey]);
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
  const loading = live && remote?.key !== remoteKey;
  const error = live && !loading && remote?.error;
  const shown = live
    ? loading || error
      ? []
      : remote.items
    : filtered.slice(page * 6, page * 6 + 6);
  const pages = Math.ceil((live ? remote?.total || 0 : filtered.length) / 6);
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
            {t("Skills catalog", "Каталог скиллов")}
            <span>.</span>
          </h1>
          <p className="catalog-lede">
            {t(
              "Find instructions for your task. Check the source before using them.",
              "Найдите инструкции для своей задачи. Изучите источник перед использованием.",
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
          {loading && <p role="status">{t("Searching…", "Ищем…")}</p>}
          {error && (
            <p role="alert">
              {t(
                "Search is temporarily unavailable.",
                "Поиск временно недоступен.",
              )}{" "}
              <button
                type="button"
                onClick={() => setRetry((value) => value + 1)}
              >
                {t("Retry", "Повторить")}
              </button>
            </p>
          )}
          <table className="catalog-table">
            <thead>
              <tr>
                <th>{t("Skill", "Скилл")}</th>
                <th>{t("Description", "Описание")}</th>
                <th>{t("Reference", "Источник")}</th>
                <th>{t("Status", "Статус")}</th>
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
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !error && !shown.length && (
            <div className="catalog-empty">
              <p>{t("No skills found.", "Скиллы не найдены.")}</p>
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
                disabled={page === 0 || loading}
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
                disabled={page >= pages - 1 || loading}
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
