import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { intakeOrigin } from "../../server/intake-worker.mjs";

const origin = intakeOrigin(process.argv[2]);
const manifest = JSON.parse(
  await readFile("public/reporadars-assets/legacy-v1-manifest.json", "utf8"),
);
let count = 0,
  bytes = 0;
for (const [path, evidence] of Object.entries(manifest.files)) {
  assert.match(path, /^\/reporadars-assets\/[A-Za-z0-9._/-]+$/);
  const response = await fetch(origin + path, {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    headers: {
      "Accept-Encoding": "identity",
      "X-Reporadars-Client-IP": "127.0.0.1",
    },
  });
  assert.equal(response.status, 200, path);
  const content = Buffer.from(await response.arrayBuffer());
  assert.equal(
    createHash("sha256").update(content).digest("hex"),
    evidence.sha256,
    path,
  );
  bytes += content.length;
  assert.ok(bytes <= 32 * 1024 * 1024);
  count++;
}
console.log(
  JSON.stringify({ origin, legacyResources: count, bytes, hashes: "verified" }),
);
