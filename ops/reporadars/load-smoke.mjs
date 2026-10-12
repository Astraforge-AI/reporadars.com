import http from "node:http";
import https from "node:https";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { intakeOrigin } from "../../server/intake-worker.mjs";

const { values } = parseArgs({
  options: {
    origin: { type: "string" },
    ca: { type: "string" },
    concurrency: { type: "string", default: "20" },
    requests: { type: "string", default: "120" },
    output: { type: "string" },
  },
});
const origin = intakeOrigin(values.origin),
  concurrency = Number(values.concurrency),
  count = Number(values.requests);
if (
  !Number.isInteger(concurrency) ||
  concurrency < 1 ||
  concurrency > 50 ||
  !Number.isInteger(count) ||
  count < concurrency ||
  count > 1000
)
  throw new Error(
    "Load smoke is bounded to 1..50 concurrent requests and at most 1000 requests",
  );
const ca = values.ca ? await readFile(values.ca) : undefined;
const paths = ["/skills", "/ru/skills", "/api/catalog?pageSize=6"],
  results = [];
const agent = origin.startsWith("https:")
  ? new https.Agent({ keepAlive: true, maxSockets: concurrency, ca })
  : new http.Agent({ keepAlive: true, maxSockets: concurrency });
const request = (path) =>
  new Promise((done, reject) => {
    const start = performance.now();
    const client = origin.startsWith("https:") ? https : http;
    const req = client.get(
      origin + path,
      {
        agent,
        timeout: 10000,
        headers: { "X-Reporadars-Client-IP": "127.0.0.1" },
      },
      (response) => {
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024)
            req.destroy(new Error("Response exceeds load budget"));
        });
        response.on("end", () =>
          done({
            path,
            status: response.statusCode,
            durationMs: performance.now() - start,
            bytes,
          }),
        );
        response.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Load request timed out")));
    req.on("error", reject);
  });
try {
  for (const path of paths) await request(path);
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < count) {
        const index = next++;
        results.push(await request(paths[index % paths.length]));
      }
    }),
  );
  const byPath = paths.map((path) => {
    const group = results.filter((item) => item.path === path),
      durations = group.map((item) => item.durationMs).sort((a, b) => a - b);
    const p95Ms = Math.round(durations[Math.ceil(durations.length * 0.95) - 1]),
      errors = group.filter((item) => item.status !== 200).length;
    return {
      path,
      requests: group.length,
      errors,
      p95Ms,
      maxBytes: Math.max(...group.map((item) => item.bytes)),
      targetMs: path.startsWith("/api/") ? 500 : 1000,
    };
  });
  const report = {
    createdAt: new Date().toISOString(),
    origin,
    concurrency,
    count,
    passed: byPath.every((item) => !item.errors && item.p95Ms <= item.targetMs),
    byPath,
  };
  if (values.output)
    await writeFile(values.output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
  if (!report.passed) process.exitCode = 1;
} finally {
  agent.destroy();
}
