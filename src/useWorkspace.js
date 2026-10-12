import { useEffect, useState } from "react";
import {
  emptyWorkspace,
  normalizeWorkspace,
  readWorkspace,
  writeWorkspace,
  WORKSPACE_KEY,
} from "./workspace-store.js";
import { useCatalogSkills, useCatalogLive } from "./CatalogContext.jsx";

export function useWorkspace() {
  const ids = useCatalogSkills().map((skill) => skill.id);
  const live = useCatalogLive();
  const catalogKey = ids.join(",");
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(null);
  useEffect(() => {
    let loaded;
    try {
      loaded = readWorkspace(window.localStorage, ids, live);
    } catch {
      loaded = {
        value: structuredClone(emptyWorkspace),
        error:
          "Browser storage is unavailable. Changes will last only for this visit.",
      };
    }
    setWorkspace(loaded.value);
    setStorageError(loaded.error);
    setReady(true);
    const sync = (event) => {
      if (event.key !== WORKSPACE_KEY && event.key !== null) return;
      try {
        setWorkspace(
          normalizeWorkspace(
            event.newValue ? JSON.parse(event.newValue) : null,
            ids,
            live,
          ),
        );
      } catch {
        setStorageError(
          "Could not read the updated workspace from another tab.",
        );
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [catalogKey, live]);
  function update(next) {
    if (!ready) return;
    let result;
    try {
      result = writeWorkspace(window.localStorage, next, ids, live);
    } catch {
      result = {
        value: normalizeWorkspace(next, ids, live),
        error:
          "Browser storage is unavailable. Changes will last only for this visit.",
      };
    }
    setWorkspace(result.value);
    setStorageError(result.error);
    return result;
  }
  return {
    workspace,
    ready,
    storageError,
    saveProfile: (profile) => update({ ...workspace, profile }),
    toggleSaved: (id) =>
      update({
        ...workspace,
        savedIds: workspace.savedIds.includes(id)
          ? workspace.savedIds.filter((value) => value !== id)
          : [id, ...workspace.savedIds],
      }),
    reset: () => update(structuredClone(emptyWorkspace)),
  };
}
