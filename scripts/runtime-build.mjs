import { cp, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

await mkdir("runtime-web/public", { recursive: true });
await cp("public", "runtime-web/public", { recursive: true });
const result = spawnSync(
  process.execPath,
  ["node_modules/next/dist/bin/next", "build", "runtime-web", "--webpack"],
  { stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
