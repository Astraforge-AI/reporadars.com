import { useEffect, useRef, useState } from "react";
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  CheckIcon,
  XIcon,
  MagnifyingGlassIcon,
  CircleIcon,
  BookOpenIcon,
  DatabaseIcon,
  ChartLineIcon,
} from "@phosphor-icons/react";
import { resolvePage } from "./data/skills.js";
import { getLocalizedSkills } from "./data/skills-ru.js";
import { LocaleProvider, useLocale } from "./i18n.jsx";
import { homeCopy } from "./home-copy.js";
import {
  LoginPage,
  NotFoundPage,
  JournalPage,
  ArticlePage,
} from "./pages/EditorialPages.jsx";
import { LibraryPage } from "./pages/LibraryPage.jsx";
import { SkillPage } from "./pages/SkillPage.jsx";
import { AccountPage } from "./pages/AccountPage.jsx";
import { CollectionsPage } from "./pages/CollectionsPage.jsx";
import { WorkspaceProvider, useWorkspaceContext } from "./WorkspaceContext.jsx";
import { SiteHeader, SiteFooter } from "./components/SiteChrome.jsx";

const signals = [
  {
    id: "seo-audit",
    number: "01",
    title: "SEO Audit",
    lines: ["SEO Audit"],
    summary: "Technical analysis of on-page, off-page, and content signals.",
    source: "Google Search Central",
    sourceType: "SEO fundamentals",
    url: "https://developers.google.com/search/docs/fundamentals/seo-starter-guide",
    icon: BookOpenIcon,
    group: "Discoverability",
    detail:
      "Start with the fundamentals of search: clear site structure, crawlable pages, useful content, and understandable metadata. This selected reading is the foundation for our forthcoming SEO Audit skill.",
  },
  {
    id: "vector-store-hygiene",
    number: "02",
    title: "Vector Store Hygiene",
    lines: ["Vector Store", "Hygiene"],
    summary: "Best practices for clean, reliable embeddings at scale.",
    source: "Qdrant Documentation",
    sourceType: "Collections & vector storage",
    url: "https://qdrant.tech/documentation/manage-data/collections/",
    icon: DatabaseIcon,
    group: "Data & retrieval",
    detail:
      "Understand how vector collections are structured and configured before building retrieval workflows. Explore the source documentation while the installable skill is being prepared.",
  },
  {
    id: "evaluation-frameworks",
    number: "03",
    title: "Evaluation Frameworks",
    lines: ["Evaluation", "Frameworks"],
    summary: "Measuring what matters in LLM applications.",
    source: "OpenAI Evals",
    sourceType: "Open-source evaluation framework",
    url: "https://github.com/openai/evals",
    icon: ChartLineIcon,
    group: "Quality & evaluation",
    detail:
      "Explore an open-source framework for evaluating language models and systems. Turn real product scenarios into repeatable evaluations, and learn from the benchmark registry.",
  },
];
const Arrow = ({ size = 24 }) => (
  <ArrowRightIcon size={size} weight="thin" aria-hidden="true" />
);

function SignalCard({ signal }) {
  const { locale, link } = useLocale();
  const t = (text) => homeCopy(text, locale);
  const Icon = signal.icon;
  return (
    <article className="signal-card">
      <div className="card-meta">
        <span>{signal.number}</span>
        <span className="curated">
          <CheckIcon size={15} weight="light" aria-hidden="true" />{" "}
          {t("Curated")}
        </span>
      </div>
      <h2 className="card-heading">
        <a
          className="card-title-button"
          href={link(`/skills/${signal.id}`)}
          aria-label={`${t("View")} ${signal.title}`}
        >
          <span className="card-title">
            {signal.lines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </span>
        </a>
      </h2>
      <p className="card-description">{signal.summary}</p>
      <div className="source-block">
        <span className="source-label">{t("Reading source")}</span>
        <a
          href={signal.url}
          target="_blank"
          rel="noopener noreferrer"
          className="source-link"
        >
          <span className="source-icon">
            <Icon size={24} weight="light" aria-hidden="true" />
          </span>
          <span>
            <strong>{signal.source}</strong>
            <small>{signal.sourceType}</small>
          </span>
        </a>
      </div>
      <a className="text-link card-action" href={link(`/skills/${signal.id}`)}>
        {t("View signal")} <Arrow size={21} />
      </a>
    </article>
  );
}

export function App({
  path = typeof window === "undefined" ? "/" : window.location.pathname,
}) {
  return (
    <LocaleProvider path={path}>
      <WorkspaceProvider>
        <AppContent path={path} />
      </WorkspaceProvider>
    </LocaleProvider>
  );
}

function AppContent({ path }) {
  const page = resolvePage(path);
  if (page.type === "home") return <HomePage />;
  if (page.type === "login") return <LoginPage />;
  if (page.type === "journal") return <JournalPage />;
  if (page.type === "article") return <ArticlePage article={page.article} />;
  if (page.type === "not-found") return <NotFoundPage />;
  return <CatalogApp page={page} />;
}

function CatalogApp({ page }) {
  const store = useWorkspaceContext();
  const { locale, t, link } = useLocale();
  const skills = getLocalizedSkills(locale);
  const skill = page.skill && skills.find((s) => s.id === page.skill.id);
  return (
    <>
      <div className="page-shell catalog-shell">
        <SiteHeader />
        {store.storageError && page.type !== "account" && (
          <p className="account-warning" role="alert">
            {locale === "ru"
              ? "Не удалось сохранить данные в браузере. Изменения доступны только до закрытия страницы."
              : store.storageError}
          </p>
        )}
        {page.type === "library" && <LibraryPage skills={skills} />}
        {page.type === "collections" && <CollectionsPage skills={skills} />}
        {page.type === "skill" && (
          <SkillPage
            skill={skill}
            saved={store.workspace.savedIds.includes(page.skill.id)}
            onToggleSave={() => store.toggleSaved(page.skill.id)}
          />
        )}
        {page.type === "account" && (
          <>
            <div className="account-login-note">
              <a href={link("/login")}>
                {t("Sign in options", "Способы входа")} <Arrow size={18} />
              </a>
            </div>
            <AccountPage skills={skills} {...store} />
          </>
        )}
      </div>
    </>
  );
}

function HomePage() {
  const { locale, link } = useLocale();
  const t = (text) => homeCopy(text, locale);
  const localizedSignals = signals.map((signal) => ({
    ...signal,
    title: t(signal.title),
    lines: signal.lines.map(t),
    summary: t(signal.summary),
    sourceType: t(signal.sourceType),
    group: t(signal.group),
    detail: t(signal.detail),
  }));
  const [panel, setPanel] = useState(null),
    [query, setQuery] = useState(""),
    [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState(false);
  const dialog = useRef(null),
    artwork = useRef(null),
    previousFocus = useRef(null),
    copyTimer = useRef(null);
  const selected = localizedSignals.find((s) => s.id === panel);
  const syncPanelUrl = (value) => {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set("panel", value);
    else url.searchParams.delete("panel");
    const next = url.pathname + url.search + url.hash;
    if (
      next !==
      window.location.pathname + window.location.search + window.location.hash
    ) {
      window.history[value ? "pushState" : "replaceState"]({}, "", next);
      window.dispatchEvent(new Event("reporadars:navigation"));
    }
  };
  const open = (value) => {
    previousFocus.current = document.activeElement;
    syncPanelUrl(value);
    setPanel(value);
    setQuery("");
    setCopied(false);
    setCopyError(false);
  };
  const close = () => {
    dialog.current?.close();
    syncPanelUrl(null);
    setPanel(null);
    previousFocus.current?.focus();
  };
  useEffect(() => {
    if (panel && !dialog.current.open) dialog.current.showModal();
    if (!panel && dialog.current.open) dialog.current.close();
    if (panel) dialog.current.querySelector(".close-button")?.focus();
    document.body.classList.toggle("modal-open", Boolean(panel));
    return () => document.body.classList.remove("modal-open");
  }, [panel]);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  useEffect(() => {
    const sync = () => {
      const value = new URLSearchParams(window.location.search).get("panel");
      const valid = [
        "collections",
        "about",
        "install",
        "all",
        ...signals.map((s) => s.id),
      ].includes(value);
      setPanel(valid ? value : null);
      setQuery("");
      setCopied(false);
      setCopyError(false);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  useEffect(() => {
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !window.matchMedia("(pointer: fine)").matches
    )
      return;
    let raf;
    const move = (e) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        artwork.current?.style.setProperty(
          "--pointer-x",
          `${(e.clientX / window.innerWidth - 0.5) * 8}px`,
        );
        artwork.current?.style.setProperty(
          "--pointer-y",
          `${(e.clientY / window.innerHeight - 0.5) * 5}px`,
        );
      });
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      cancelAnimationFrame(raf);
    };
  }, []);
  async function copyPreview() {
    try {
      await navigator.clipboard.writeText("npx reporadars add seo-audit");
      setCopied(true);
      setCopyError(false);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopyError(true);
    }
  }
  const panelTitle =
    selected?.title ||
    ({
      collections: t("A small, useful collection."),
      about: t("We scan the noise."),
      install: t("One command. Coming soon."),
      all: t("Find your next signal."),
    }[panel] ??
      "Reporadars");
  const filtered = localizedSignals.filter((s) =>
    `${s.title} ${s.source} ${s.group}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="page-shell">
        <SiteHeader />
        <main id="main">
          <section className="hero" aria-labelledby="hero-title">
            <div className="hero-art" ref={artwork} aria-hidden="true">
              <img
                src="/reporadars-assets/radar-paper.webp"
                width="1254"
                height="1254"
                alt=""
                fetchPriority="high"
              />
              <div className="art-caption">
                <p>
                  {t("A world of sources.")}
                  <br />
                  {t("One signal at a time.")}
                </p>
                <span />
              </div>
            </div>
            <div className="hero-editorial">
              <p className="eyebrow">
                {t("Curated")} <span>&gt;</span> {t("Vetted")} <span>&gt;</span>{" "}
                {t("Useful")}
              </p>
              <h1 id="hero-title">
                <span className="headline-line">{t("Only the signals")}</span>
                <span className="headline-line second-line">
                  {t("worth giving your agent")}
                  <span className="headline-period">.</span>
                </span>
              </h1>
              <div className="hero-bottom">
                <div className="manifesto">
                  <h2>
                    {t("We scan the noise.")}
                    <br />
                    {t("You get the signal.")}
                  </h2>
                  <p>
                    {t(
                      "Reporadars is a growing radar for AI skills that matter. Explore original sources while we prepare a carefully reviewed, installable catalog.",
                    )}
                  </p>
                </div>
                <div className="install">
                  <span className="install-label">{t("Install a signal")}</span>
                  <button
                    className="command-button"
                    onClick={() => open("install")}
                    aria-label={t(
                      "Learn about the Reporadars installation command",
                    )}
                  >
                    <code>npx reporadars add seo-audit</code>
                    <span className="command-arrow">
                      <Arrow size={29} />
                    </span>
                  </button>
                  <p className="install-caption">
                    {t("One command, in your workflow.")}
                    <span className="launch-note">{t("CLI coming soon")}</span>
                  </p>
                </div>
              </div>
            </div>
          </section>
          <section
            className="signals-section"
            id="signals"
            aria-label={t("Latest curated signals")}
          >
            <div className="signals-intro">
              <h2>
                {t("Latest")}
                <br />
                {t("curated signals")}
              </h2>
              <p>
                {t("From the community.")}
                <br />
                {t("For the community.")}
              </p>
              <a className="text-link" href={link("/skills")}>
                {t("View all signals")} <Arrow size={22} />
              </a>
            </div>
            {localizedSignals.map((signal) => (
              <SignalCard signal={signal} onOpen={open} key={signal.id} />
            ))}
            <div className="side-rail">
              <a href="#main" aria-label={t("Back to top")}>
                reporadars.com{" "}
                <CircleIcon size={13} weight="fill" aria-hidden="true" />
              </a>
            </div>
          </section>
        </main>
        <SiteFooter />
      </div>
      <dialog
        ref={dialog}
        className="detail-dialog"
        aria-labelledby="dialog-title"
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          const items = [
            ...e.currentTarget.querySelectorAll(
              "button:not(:disabled), a[href], input:not(:disabled)",
            ),
          ].filter((el) => el.getClientRects().length > 0);
          const first = items[0],
            last = items.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClick={(e) => {
          if (e.target === dialog.current) {
            const r = e.currentTarget.getBoundingClientRect();
            if (
              e.clientX < r.left ||
              e.clientX > r.right ||
              e.clientY < r.top ||
              e.clientY > r.bottom
            )
              close();
          }
        }}
      >
        <div className="dialog-top">
          <span className="eyebrow">
            Reporadars / {selected ? t("Selected reading") : t("Field notes")}
          </span>
          <button
            className="close-button"
            onClick={close}
            aria-label={t("Close dialog")}
          >
            <XIcon size={25} weight="light" />
          </button>
        </div>
        <h2 id="dialog-title">{panelTitle}</h2>
        {selected && (
          <>
            <p className="dialog-deck">{selected.detail}</p>
            <dl className="signal-facts">
              <div>
                <dt>{t("Collection")}</dt>
                <dd>{selected.group}</dd>
              </div>
              <div>
                <dt>{t("Status")}</dt>
                <dd>{t("Selected reading · skill in preparation")}</dd>
              </div>
              <div>
                <dt>{t("Reading source")}</dt>
                <dd>{selected.source}</dd>
              </div>
            </dl>
            <a
              className="primary-link"
              href={selected.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("Read the original source")}{" "}
              <ArrowUpRightIcon size={22} weight="light" />
            </a>
            <p className="fine-print">
              {t(
                "Source authors are credited for their materials. Inclusion does not imply endorsement of Reporadars.",
              )}
            </p>
          </>
        )}
        {panel === "install" && (
          <>
            <p className="dialog-deck">
              {t(
                "We’re building a simple way to add curated skills to your agent. The installer has not been published yet; this is a preview of the planned command.",
              )}
            </p>
            <div className="dialog-command">
              <code>npx reporadars add seo-audit</code>
              <button onClick={copyPreview}>
                {copied ? t("Copied") : t("Copy preview")}
                <CheckIcon size={16} weight="light" aria-hidden="true" />
              </button>
            </div>
            <p role="status" className="copy-status">
              {copyError
                ? t(
                    "Clipboard unavailable. You can select and copy the command above.",
                  )
                : copied
                  ? t("Preview copied. The command is not ready to run yet.")
                  : t(
                      "Not ready to run. Explore the original reading sources today.",
                    )}
            </p>
            <a className="primary-link" href={link("/skills")}>
              {t("Explore the signals")} <Arrow />
            </a>
          </>
        )}
        {panel === "about" && (
          <>
            <p className="dialog-deck">
              {t(
                "Only the signals worth giving your agent. Our standard is simple: a clear source, a useful purpose, and an understandable scope.",
              )}
            </p>
            <ol className="standards">
              <li>
                <span>01 / {t("Curated")}</span>
                <p>
                  {t(
                    "Start with a real task. Select material with a clear source and practical value.",
                  )}
                </p>
              </li>
              <li>
                <span>02 / {t("Vetted")}</span>
                <p>
                  {t(
                    "Before a skill becomes installable, review its instructions, dependencies, permissions, and pinned version.",
                  )}
                </p>
              </li>
              <li>
                <span>03 / {t("Useful")}</span>
                <p>
                  {t(
                    "Keep the details visible so you can decide what belongs in your workflow.",
                  )}
                </p>
              </li>
            </ol>
            <p className="fine-print">
              {t(
                "Browse draft instructions, check their sources, and save useful skills to your local workspace. The CLI is still in preparation.",
              )}
            </p>
            <a className="primary-link" href={link("/skills")}>
              {t("Explore the signals")} <Arrow />
            </a>
          </>
        )}
        {(panel === "all" || panel === "collections") && (
          <>
            <p className="dialog-deck">
              {panel === "collections"
                ? t(
                    "Three starting points for thoughtful agent workflows: discoverability, retrieval, and evaluation.",
                  )
                : t("Explore the launch selection and its original sources.")}
            </p>
            {panel === "all" && (
              <label className="search-field">
                <MagnifyingGlassIcon
                  size={23}
                  weight="light"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("Search by task or source")}
                  aria-label={t("Search signals")}
                />
              </label>
            )}
            <div className="collection-list">
              {filtered.map((s) => (
                <a key={s.id} href={link(`/skills/${s.id}`)}>
                  <span className="collection-number">{s.number}</span>
                  <span>
                    <small>{s.group}</small>
                    <strong>{s.title}</strong>
                  </span>
                  <Arrow />
                </a>
              ))}
              {filtered.length === 0 && (
                <div className="empty-results">
                  <p>{t("No signals on that frequency.")}</p>
                  <button className="text-link" onClick={() => setQuery("")}>
                    {t("Clear search")} <Arrow />
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
