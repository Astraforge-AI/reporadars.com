import test from "node:test";
import assert from "node:assert/strict";
import { createAdminHttpServer } from "../../server/admin-http.mjs";

test("request diagnostics correlate intake jobs without recording queries, cookies or credentials", async () => {
  const events = [],
    server = createAdminHttpServer({
      baseURL: "http://localhost:4321",
      service: { handle: async () => Response.json({ ok: true }) },
      logRequest: (event) => events.push(event),
    });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(
      origin + "/api/intake/reports?token=private-query-value",
      {
        headers: {
          "X-Reporadars-Job-ID": "a".repeat(64),
          Cookie: "private-cookie-value",
          Authorization: "Bearer private-credential-value",
        },
      },
    );
    assert.match(response.headers.get("x-request-id"), /^[a-f0-9-]{36}$/);
    await response.text();
    assert.equal(events[0].id, response.headers.get("x-request-id"));
    assert.equal(events[0].job, "a".repeat(64));
    assert.equal(events[0].route, "intake");
    assert.equal(JSON.stringify(events).includes("private-"), false);
    await (
      await fetch(origin + "/api/auth/session?email=secret@example.test")
    ).text();
    assert.equal(events[1].route, "auth");
    assert.equal(JSON.stringify(events).includes("example.test"), false);
  } finally {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
});
