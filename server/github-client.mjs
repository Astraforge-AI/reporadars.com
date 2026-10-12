import { open, constants } from "node:fs/promises";
import { isAbsolute } from "node:path";

export async function readGitHubCredential(filename) {
  if (!filename) return "";
  if (!isAbsolute(filename))
    throw new Error("GitHub credential path must be absolute");
  const file = await open(
    filename,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const meta = await file.stat();
    if (
      !meta.isFile() ||
      meta.size > 4096 ||
      meta.mode & 0o037 ||
      (meta.uid !== 0 && meta.uid !== process.getuid())
    )
      throw new Error("GitHub credential must be private");
    const token = (await file.readFile("utf8")).trim();
    if (token.length < 20 || /\s/.test(token))
      throw new Error("Invalid GitHub credential");
    return token;
  } finally {
    await file.close();
  }
}

export function createGitHubClient({
  token = "",
  readCooldown = () => 0,
  saveCooldown = () => {},
  fetcher = fetch,
  clock = Date.now,
} = {}) {
  return async (path, optional = false) => {
    if (!path.startsWith("/") || path.startsWith("//") || /[\r\n]/.test(path))
      throw new Error("Invalid GitHub API path");
    if (readCooldown() > clock()) throw new Error("GitHub API cooldown active");
    const response = await fetcher(`https://api.github.com${path}`, {
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Reporadars-intake/1",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (
      response.status === 429 ||
      (response.status === 403 &&
        (response.headers.get("x-ratelimit-remaining") === "0" ||
          response.headers.has("retry-after")))
    ) {
      const retry = response.headers.get("retry-after");
      const retryAt = /^\d+$/.test(retry || "")
        ? clock() + Number(retry) * 1000
        : Date.parse(retry);
      const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
      const until = Math.min(
        clock() + 86400000,
        Math.max(
          clock() + 60000,
          Number.isFinite(retryAt) ? retryAt : 0,
          reset || 0,
        ),
      );
      saveCooldown(until);
      await response.body?.cancel();
      throw new Error("GitHub API rate limited; cooldown saved");
    }
    if (optional && (response.status === 404 || response.status === 410)) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`GitHub HTTP ${response.status}`);
    }
    if (Number(response.headers.get("content-length")) > 2 * 1024 * 1024) {
      await response.body?.cancel();
      throw new Error("GitHub response too large");
    }
    const reader = response.body.getReader(),
      parts = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 2 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("GitHub response too large");
      }
      parts.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(parts).toString());
  };
}
