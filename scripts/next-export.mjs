import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { pagePaths } from "../src/data/skills.js";

const root = new URL("../", import.meta.url);
const output = new URL("dist/client/", root);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(new URL("out/", root), output, { recursive: true });
for (const path of pagePaths.filter((path) => path !== "/")) {
  const source = path === "/404" ? "404.html" : `${path.slice(1)}.html`;
  const html = await readFile(new URL(`out/${source}`, root));
  const destination = new URL(`${path.slice(1)}/index.html`, output);
  await mkdir(new URL(".", destination), { recursive: true });
  await writeFile(destination, html);
  if (path === "/ru/404") await writeFile(new URL("ru/404.html", output), html);
}
console.log("Prepared Next.js static export in dist/client/.");
