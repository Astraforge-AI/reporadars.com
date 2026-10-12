import { createContext, useContext, useMemo, useState, useEffect } from "react";
import { useLocale } from "./i18n.jsx";
import { buildCatalog } from "./data/live-catalog.js";
import { buildEditorialContent } from "./data/live-editorial.js";
import { WORKSPACE_KEY, readWorkspace } from "./workspace-store.js";

const CatalogContext = createContext(null);
const ContentContext = createContext(null);
const LiveContext = createContext(false);
export function CatalogProvider({ catalog, children }) {
  const { locale } = useLocale();
  const [saved, setSaved] = useState(null);
  useEffect(() => {
    if (!catalog) return;
    let controller;
    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      const ids = readWorkspace(window.localStorage, [], true).value.savedIds;
      try {
        const chunks = [];
        for (let i = 0; i < ids.length; i += 100)
          chunks.push(ids.slice(i, i + 100));
        const responses = await Promise.all(
          chunks.map(async (chunk) => {
            const params = new URLSearchParams({
              locale,
              ids: chunk.join(","),
              pageSize: "100",
            });
            const response = await fetch(`/api/catalog?${params}`, { signal });
            if (!response.ok)
              throw new Error("Saved skills lookup unavailable");
            return (await response.json()).items;
          }),
        );
        if (!signal.aborted)
          setSaved({ catalog, locale, items: responses.flat() });
      } catch {
        /* Preserve saved IDs if lookup is temporarily unavailable. */
      }
    };
    void load();
    const sync = (event) => {
      if (event.key === WORKSPACE_KEY || event.key === null) void load();
    };
    window.addEventListener("storage", sync);
    return () => {
      controller?.abort();
      window.removeEventListener("storage", sync);
    };
  }, [catalog, locale]);
  const skills = useMemo(() => {
    const base = buildCatalog(locale, catalog);
    const ids = new Set(base.map((skill) => skill.id));
    return [
      ...base,
      ...(saved?.catalog === catalog && saved.locale === locale
        ? saved.items.filter((skill) => !ids.has(skill.id))
        : []),
    ];
  }, [locale, catalog, saved]);
  const content = useMemo(() => buildEditorialContent(catalog), [catalog]);
  return (
    <LiveContext.Provider value={Boolean(catalog)}>
      <CatalogContext.Provider value={skills}>
        <ContentContext.Provider value={content}>
          {children}
        </ContentContext.Provider>
      </CatalogContext.Provider>
    </LiveContext.Provider>
  );
}
export function useCatalogLive() {
  return useContext(LiveContext);
}
export function useCatalogContent() {
  const content = useContext(ContentContext);
  if (!content) throw new Error("CatalogProvider is required");
  return content;
}
export function useCatalogSkills() {
  const skills = useContext(CatalogContext);
  if (!skills) throw new Error("CatalogProvider is required");
  return skills;
}
