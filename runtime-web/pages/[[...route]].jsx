import { readPublicCatalog } from "../../server/public-catalog.mjs";
import { resolvePage } from "../../src/data/skills.js";
import { buildCatalog } from "../../src/data/live-catalog.js";
import { buildEditorialContent } from "../../src/data/live-editorial.js";
export { default } from "../../src/NextPage.jsx";

export function getServerSideProps({ params, res }) {
  const path = `/${(params?.route || []).join("/")}`;
  const requestedSlug = path.match(/^\/(?:ru\/)?skills\/([a-z0-9-]+)$/)?.[1];
  const catalog = readPublicCatalog(process.env.REPORADARS_DATABASE_PATH, requestedSlug);
  res.setHeader("Cache-Control", "private, no-store");
  if (
    resolvePage(
      path,
      buildCatalog("en", catalog),
      buildEditorialContent(catalog).articles,
    ).type === "not-found"
  )
    res.statusCode = 404;
  return { props: { path, catalog } };
}
