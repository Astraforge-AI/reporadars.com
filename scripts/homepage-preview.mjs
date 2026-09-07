import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { stat } from "node:fs/promises";
let worker, loadedVersion;
const port = Number(process.env.PORT || 4318);
createServer(async (req, res) => {
  try {
    const path = `${process.cwd()}/dist/reporadars.worker.mjs`;
    const version = (await stat(path)).mtimeMs;
    if (!worker || version !== loadedVersion) {
      worker = (await import(`${pathToFileURL(path)}?version=${version}`))
        .default;
      loadedVersion = version;
    }
    const response = await worker.fetch(
      new Request(`https://reporadars.com${req.url}`, {
        method: req.method,
        headers: req.headers,
      }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    res.writeHead(500);
    res.end(String(err));
  }
}).listen(port, "127.0.0.1", () =>
  console.log(`Built homepage preview http://127.0.0.1:${port}`),
);
