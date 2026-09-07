import { useEffect, useState } from "react";
import {
  emptyWorkspace,
  normalizeWorkspace,
  readWorkspace,
  writeWorkspace,
  WORKSPACE_KEY,
} from "./workspace-store.js";
import { skills } from "./data/skills.js";
const ids = skills.map((skill) => skill.id);

export function useWorkspace() {
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(null);
  useEffect(() => {
    let loaded;
    try {
      loaded = readWorkspace(window.localStorage, ids);
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
  }, []);
  function update(next) {
    if (!ready) return;
    let result;
    try {
      result = writeWorkspace(window.localStorage, next, ids);
    } catch {
      result = {
        value: normalizeWorkspace(next, ids),
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
