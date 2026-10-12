export const discoveryQueries = [
  "topic:agent-skills archived:false",
  "topic:claude-code-skills archived:false",
  '"SKILL.md" in:readme archived:false',
];
export function repositoryLinks(readme, limit = 100) {
  if (typeof readme !== "string" || Buffer.byteLength(readme) > 512 * 1024)
    throw new Error("README exceeds discovery budget");
  const seen = new Set(),
    result = [];
  for (const match of readme.matchAll(
    /https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9_.-]{0,99})\/([A-Za-z0-9][A-Za-z0-9_.-]{0,99})/g,
  )) {
    const owner = match[1],
      name = match[2].replace(/\.git$/i, "");
    if (
      ["topics", "collections", "marketplace", "sponsors", "settings"].includes(
        owner.toLowerCase(),
      ) ||
      !name
    )
      continue;
    const repo = `https://github.com/${owner}/${name}`,
      key = repo.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(repo);
    }
    if (result.length >= limit) break;
  }
  return result;
}
