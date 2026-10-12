import { readFile, mkdir, writeFile, lstat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";

// Reads the generated public resource table as JSON; never executes old code.
const source = process.argv[2];
if (!source)
  throw new Error("Pass the previously deployed generated Worker file");
const raw = await readFile(source, "utf8");
if (raw.length > 16 * 1024 * 1024)
  throw new Error("Legacy Worker exceeds limit");
const start = raw.indexOf("const files=");
const end = raw.indexOf(";\n", start);
if (start < 0 || end < 0) throw new Error("Unknown generated Worker format");
const files = JSON.parse(raw.slice(start + 12, end));
const root = resolve("public"),
  manifest = {
    version: 1,
    sourceSha256: createHash("sha256").update(raw).digest("hex"),
    files: {},
  };
let total = 0;
for (const [url, file] of Object.entries(files)) {
  if (!url.startsWith("/reporadars-assets/") && !url.startsWith("/assets/"))
    continue;
  if (
    /[\\\x00%:]/.test(url) ||
    url.split("/").some((part) => part === "." || part === "..") ||
    file.type.startsWith("text/html")
  )
    throw new Error("Unsafe legacy asset");
  let body = Buffer.from(file.body, "base64");
  if (file.encoding === "gzip")
    body = gunzipSync(body, { maxOutputLength: 8 * 1024 * 1024 });
  else if (file.encoding !== "identity")
    throw new Error("Unsupported legacy encoding");
  total += body.length;
  if (total > 32 * 1024 * 1024) throw new Error("Legacy asset budget exceeded");
  const target = resolve(root, `.${url}`);
  if (!target.startsWith(root + "/"))
    throw new Error("Asset is outside public directory");
  const exists = await lstat(target).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (exists) {
    if (exists.isSymbolicLink() || !exists.isFile())
      throw new Error(`Conflicting legacy asset: ${url}`);
    const current=await readFile(target);
    if(!current.equals(body)) {
      if(file.cache.includes("immutable"))throw new Error(`Conflicting immutable legacy asset: ${url}`);
      manifest.files[url]={sha256:createHash("sha256").update(current).digest("hex"),bytes:current.length,type:file.type,sharedCurrent:true};
      continue;
    }
  } else {
    await mkdir(dirname(target), { recursive: true, mode: 0o755 });
    await writeFile(target, body, { flag: "wx", mode: 0o644 });
  }
  manifest.files[url] = {
    sha256: createHash("sha256").update(body).digest("hex"),
    bytes: body.length,
    type: file.type,
  };
}
await writeFile(
  resolve(root, "reporadars-assets/legacy-v1-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
  { flag: "wx", mode: 0o644 },
);
console.log(
  JSON.stringify({
    assets: Object.keys(manifest.files).length,
    bytes: total,
    oldReleaseRetained: true,
  }),
);
