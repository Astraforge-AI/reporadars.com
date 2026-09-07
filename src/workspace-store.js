export const WORKSPACE_KEY = "reporadars.workspace.v1";
export const emptyWorkspace = {
  version: 1,
  profile: {
    name: "Your workspace",
    role: "Skill curator",
    bio: "Curating reliable tools for developers and agents.",
    avatar: "radar",
  },
  savedIds: [],
};

const text = (value, fallback, max) =>
  typeof value === "string" ? value.trim().slice(0, max) || fallback : fallback;

export function normalizeWorkspace(value, allowedIds) {
  if (!value || typeof value !== "object" || value.version !== 1)
    return structuredClone(emptyWorkspace);
  const p =
    value.profile && typeof value.profile === "object" ? value.profile : {};
  const allowed = new Set(allowedIds);
  return {
    version: 1,
    profile: {
      name: text(p.name, emptyWorkspace.profile.name, 40),
      role: text(p.role, emptyWorkspace.profile.role, 50),
      bio: text(p.bio, emptyWorkspace.profile.bio, 180),
      avatar: p.avatar === "portrait" ? "portrait" : "radar",
    },
    savedIds: [
      ...new Set(
        Array.isArray(value.savedIds)
          ? value.savedIds.filter(
              (id) => typeof id === "string" && allowed.has(id),
            )
          : [],
      ),
    ].slice(0, allowed.size),
  };
}

export function readWorkspace(storage, allowedIds) {
  try {
    const raw = storage.getItem(WORKSPACE_KEY);
    return {
      value: normalizeWorkspace(raw ? JSON.parse(raw) : null, allowedIds),
      error: null,
    };
  } catch {
    return {
      value: structuredClone(emptyWorkspace),
      error:
        "Browser storage is unavailable or unreadable. Changes will last only for this visit.",
    };
  }
}

export function writeWorkspace(storage, value, allowedIds) {
  const normalized = normalizeWorkspace(value, allowedIds);
  try {
    storage.setItem(WORKSPACE_KEY, JSON.stringify(normalized));
    return { value: normalized, error: null };
  } catch {
    return {
      value: normalized,
      error:
        "Could not save to this browser. Changes will last only for this visit.",
    };
  }
}
