const AUTH_TIMEOUT_MS = 12_000;

export class AuthRequestError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function isUser(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    typeof value.email === "string"
  );
}

function isExpectedSuccess(path, response, payload) {
  if (path === "request-link")
    return response.status === 202 && payload?.ok === true;
  if (path === "confirm")
    return (
      response.status === 200 && payload?.ok === true && isUser(payload.user)
    );
  if (path === "session")
    return (
      response.status === 200 &&
      (payload?.user === null || isUser(payload?.user))
    );
  if (path === "sign-out")
    return response.status === 200 && payload?.ok === true;
  return false;
}

async function authRequest(path, options = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  try {
    const response = await fetch(`/api/auth/${path}`, {
      ...options,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // Do not expose untrusted response bodies in the interface.
    }
    if (!response.ok) {
      throw new AuthRequestError(payload?.error?.code || "UNAVAILABLE");
    }
    if (!isExpectedSuccess(path, response, payload)) {
      throw new AuthRequestError("UNAVAILABLE");
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") throw new AuthRequestError("TIMEOUT");
    if (error instanceof AuthRequestError) throw error;
    throw new AuthRequestError("NETWORK");
  } finally {
    window.clearTimeout(timer);
  }
}

export const getSession = () => authRequest("session");

export const requestEmailLink = (email, locale) =>
  authRequest("request-link", {
    method: "POST",
    body: JSON.stringify({ email, locale }),
  });

export const confirmEmailToken = (token) =>
  authRequest("confirm", {
    method: "POST",
    body: JSON.stringify({ token }),
  });

export const signOut = () =>
  authRequest("sign-out", { method: "POST", body: JSON.stringify({}) });
