import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { localeHref, splitLocalePath } from "./locale-paths.js";

const LocaleContext = createContext({
  locale: "en",
  t: (en) => en,
  link: (path) => path,
});

export function LocaleProvider({ path = "/", children }) {
  const { locale } = splitLocalePath(path);
  const value = useMemo(
    () => ({
      locale,
      path,
      t: (en, ru) => (locale === "ru" ? ru : en),
      link: (href) => localeHref(href, locale),
    }),
    [locale, path],
  );
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}

export function LanguageSwitch() {
  const { locale, path, t } = useLocale();
  const [href, setHref] = useState("");
  useEffect(() => {
    const sync = () =>
      setHref(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      );
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    window.addEventListener("reporadars:navigation", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("reporadars:navigation", sync);
    };
  }, []);
  return (
    <nav className="language-switch" aria-label={t("Language", "Язык")}>
      {["en", "ru"].map((lang) => (
        <a
          key={lang}
          href={localeHref(href || path, lang)}
          hrefLang={lang}
          lang={lang}
          aria-current={locale === lang ? "true" : undefined}
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
            window.location.assign(
              localeHref(
                window.location.pathname +
                  window.location.search +
                  window.location.hash,
                lang,
              ),
            );
          }}
        >
          {lang.toUpperCase()}
        </a>
      ))}
    </nav>
  );
}
