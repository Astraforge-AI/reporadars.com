export class AdminApiError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: options.body
        ? { "Content-Type": "application/json" }
        : undefined,
      signal: controller.signal,
      ...options,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok)
      throw new AdminApiError(
        payload?.error?.code || "UNAVAILABLE",
        response.status,
      );
    if (!payload || typeof payload !== "object")
      throw new AdminApiError("UNAVAILABLE", response.status);
    return payload;
  } catch (error) {
    if (error instanceof AdminApiError) throw error;
    throw new AdminApiError("UNAVAILABLE", 0);
  } finally {
    clearTimeout(timeout);
  }
}

const query = (path, params = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== "" && value != null) search.set(key, String(value));
  });
  return `${path}${search.size ? `?${search}` : ""}`;
};

export const adminClient = {
  session: async () => {
    const payload = await request("/api/admin/session");
    if (payload.role !== "admin" || !payload.user?.id || !payload.user?.email)
      throw new AdminApiError("FORBIDDEN", 403);
    return payload;
  },
  signOut: () =>
    request("/api/auth/sign-out", { method: "POST", body: JSON.stringify({}) }),
  overview: () => request("/api/admin/overview"),
  records: (params) => request(query("/api/admin/records", params)),
  createRecord: (body) =>
    request("/api/admin/records", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateRecord: (id, body) =>
    request(`/api/admin/records/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  setRecordStatus: (id, body) =>
    request(`/api/admin/records/${encodeURIComponent(id)}/status`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  users: (params) => request(query("/api/admin/users", params)),
  audit: (params) => request(query("/api/admin/audit", params)),
  submissions: (params) => request(query("/api/admin/submissions", params)),
  updateSubmission: (id, body) =>
    request(`/api/admin/submissions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};
