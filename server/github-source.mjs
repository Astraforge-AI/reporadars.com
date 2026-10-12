export function normalizeRepository(value) {
  if (typeof value !== "string" || value.length > 512)
    throw new Error("Invalid repository");
  if (
    !/^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*\/?$/i.test(
      value,
    )
  )
    throw new Error("Invalid repository URL");
  const url = new URL(value),
    parts = url.pathname.replace(/\/$/, "").split("/");
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    parts.length !== 3 ||
    parts[0] ||
    parts.slice(1).some((part) => !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(part))
  )
    throw new Error("Repository must be a public GitHub HTTPS owner/repo URL");
  const name = parts[2].replace(/\.git$/i, "");
  if (!name) throw new Error("Invalid repository name");
  return `https://github.com/${parts[1].toLowerCase()}/${name.toLowerCase()}`;
}
export function normalizeSourceURL(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid GitHub provenance URL");
  const parts = url.pathname.split("/");
  return (
    normalizeRepository(`https://github.com/${parts[1]}/${parts[2]}`) +
    parts
      .slice(3)
      .map((part) => `/${part}`)
      .join("")
  );
}
