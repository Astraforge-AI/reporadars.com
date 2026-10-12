import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { migrateAuthDatabase } from "../../server/auth-service.mjs";
import { migrateAdminDatabase } from "../../server/admin-store.mjs";
import { createAdminService } from "../../server/admin-service.mjs";
import {
  createIntakeService,
  decisionFor,
} from "../../server/intake-service.mjs";
import { readPublicCatalog } from "../../server/public-catalog.mjs";
import { buildCatalog } from "../../src/data/live-catalog.js";
import { resolvePage } from "../../src/data/skills.js";

const origin = "http://localhost:4321",
  token = "test-only-intake-token-with-more-than-forty-characters";
const candidate = {
  id: "fixture-test-skill",
  name: "test-skill",
  description: "A useful skill from an isolated fixture.",
  path: "test-skill/SKILL.md",
  sourceUrl: `https://github.com/fixture/skills/blob/${"a".repeat(40)}/test-skill/SKILL.md`,
  bundleSha256: "b".repeat(64),
  license: "MIT",
  qualityScore: 80,
  status: "needs_review",
  findings: [],
};
const report = {
  schemaVersion: 1,
  repository: { url: "https://github.com/fixture/skills" },
  commit: "a".repeat(40),
  archiveSha256: "c".repeat(64),
  skills: [candidate],
};

test("candidate pagination exposes all matches and retains private review evidence only in detail", async (t) => {
  const { intake } = await fixture(t);
  for (let i = 0; i < 32; i++)
    intake.acceptReport({
      ...report,
      skills: [
        {
          ...candidate,
          id: `fixture-skill-${i}`,
          path: `skill-${i}/SKILL.md`,
          sourceUrl: `https://github.com/fixture/skills/blob/${report.commit}/skill-${i}/SKILL.md`,
          reviewText: "Untrusted upstream instructions.",
          findings: [
            {
              code: "static-fixture",
              severity: "info",
              path: "SKILL.md",
              line: 3,
              message: "Inspect this line.",
            },
          ],
        },
      ],
    });
  const get = async (query = "") =>
    (
      await intake.admin(new Request(`${origin}/api/admin/intake${query}`), {
        id: "fixture-admin",
      })
    ).json();
  const first = await get(),
    second = await get("?offset=25");
  assert.equal(first.total, 32);
  assert.equal(first.items.length, 25);
  assert.equal(second.items.length, 7);
  assert.equal(
    new Set([...first.items, ...second.items].map((x) => x.id)).size,
    32,
  );
  assert.equal(first.items[0].candidate.reviewText, undefined);
  const detail = await get(`/${first.items[0].id}`);
  assert.equal(detail.candidate.reviewText, "Untrusted upstream instructions.");
  assert.equal(detail.candidate.findings[0].line, 3);
  assert.equal((await get("?q=fixture-skill-31")).total, 1);
  assert.equal((await get("?status=blocked")).total, 0);
  assert.equal(
    (
      await intake.admin(new Request(`${origin}/api/admin/intake?limit=999`), {
        id: "fixture-admin",
      })
    ).status,
    400,
  );
});

test("Actions intake requires an approved workflow and exact public run URL", async (t) => {
  const { intake } = await fixture(t);
  const sourceUrl = `${report.repository.url}/actions/runs/21`;
  const artifact = {
    kind: "actions",
    id: 11,
    name: "skills",
    sourceUrl,
    digestVerified: true,
    runId: 21,
    workflowId: 4,
    workflowPath: ".github/workflows/build.yml",
    runAttempt: 1,
  };
  const built = {
    ...report,
    package: artifact,
    skills: [{ ...candidate, sourceUrl }],
  };
  assert.throws(() => intake.acceptReport(built), /package/);
  const response = await intake.admin(
    new Request(`${origin}/api/admin/intake/sources`, {
      method: "POST",
      body: JSON.stringify({
        repository: report.repository.url,
        allowAuto: false,
        workflowId: 4,
      }),
    }),
    { id: "fixture-admin" },
  );
  assert.equal(response.status, 200);
  assert.throws(
    () =>
      intake.acceptReport({
        ...built,
        skills: [{ ...candidate, sourceUrl: sourceUrl + "/fake" }],
      }),
    /candidate/,
  );
  assert.equal(intake.acceptReport(built).added, 1);
  const data = await (
    await intake.admin(new Request(`${origin}/api/admin/intake`), {
      id: "fixture-admin",
    })
  ).json();
  assert.equal(data.items[0].package.runId, 21);
  assert.equal(data.items[0].status, "needs_review");
  assert.equal(
    decisionFor(
      candidate,
      { allow_auto: 1, rights_confirmed: 1, workflow_id: 9 },
      artifact,
    ),
    "needs_review",
  );
});

test("manual run requests are durable, deduplicated, paused and rate limited", async (t) => {
  const { intake } = await fixture(t),
    user = { id: "fixture-admin" };
  const requestRun = (body = {}) =>
    intake.admin(
      new Request(`${origin}/api/admin/intake/run`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
      user,
    );
  assert.equal((await requestRun({ limit: 10000 })).status, 400);
  const first = await requestRun();
  assert.equal(first.status, 202);
  const {
    control: { manualRequest },
  } = await first.json();
  assert.ok(manualRequest.id);
  assert.equal(
    (await (await requestRun()).json()).control.manualRequest.id,
    manualRequest.id,
  );
  await intake.admin(
    new Request(`${origin}/api/admin/intake/control`, {
      method: "POST",
      body: JSON.stringify({ paused: true, intervalHours: 24 }),
    }),
    user,
  );
  assert.equal((await requestRun()).status, 409);
  await intake.admin(
    new Request(`${origin}/api/admin/intake/control`, {
      method: "POST",
      body: JSON.stringify({ paused: false, intervalHours: 24 }),
    }),
    user,
  );
  const run = {
    type: "run",
    schemaVersion: 1,
    id: "11111111-1111-1111-1111-111111111111",
    manualRequestId: manualRequest.id,
    startedAt: Date.now() - 1000,
    finishedAt: Date.now(),
    status: "complete",
    summary: {
      repositories: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      blocked: 0,
    },
    jobs: [],
  };
  const finish = () =>
    intake.worker(
      new Request(`${origin}/api/intake/reports`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(run),
      }),
    );
  assert.equal((await finish()).status, 200);
  assert.equal((await finish()).status, 200);
  assert.equal(
    (
      await (
        await intake.admin(new Request(`${origin}/api/admin/intake`), user)
      ).json()
    ).control.manualRequest,
    null,
  );
  assert.equal((await requestRun()).status, 429);
});

test("pause blocks worker reports while authenticated run summaries remain visible and schedule stays bounded", async (t) => {
  const { intake } = await fixture(t),
    user = { id: "fixture-admin" };
  const control = (paused, intervalHours) =>
    intake.admin(
      new Request(`${origin}/api/admin/intake/control`, {
        method: "POST",
        body: JSON.stringify({ paused, intervalHours }),
      }),
      user,
    );
  assert.equal((await control(true, 12)).status, 200);
  assert.equal((await control(false, 1)).status, 400);
  const request = (body) =>
    new Request(`${origin}/api/intake/reports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  assert.equal((await intake.worker(request(report))).status, 409);
  const run = {
    type: "run",
    schemaVersion: 1,
    id: "11111111-1111-1111-1111-111111111111",
    startedAt: Date.now() - 1000,
    finishedAt: Date.now(),
    status: "complete",
    summary: {
      repositories: 1,
      completed: 1,
      failed: 0,
      skipped: 0,
      blocked: 0,
    },
    jobs: [
      {
        repository: report.repository.url,
        kind: "source",
        state: "complete",
        attempts: 1,
      },
    ],
  };
  assert.equal((await intake.worker(request(run))).status, 200);
  const data = await (
    await intake.admin(new Request(`${origin}/api/admin/intake`), user)
  ).json();
  assert.equal(data.control.paused, true);
  assert.equal(data.control.intervalHours, 12);
  assert.equal(data.runs[0].summary.completed, 1);
  assert.equal((await control(false, 24)).status, 200);
  assert.equal((await intake.worker(request(report))).status, 200);
});

test("scanner report rejects hidden fields, executable paths and publication decisions before saving anything", async (t) => {
  const { intake } = await fixture(t);
  for (const bad of [
    { ...report, rightsConfirmed: true },
    { ...report, skills: [{ ...candidate, path: "../SKILL.md" }] },
    { ...report, skills: [{ ...candidate, status: "published" }] },
    { ...report, skills: [{ ...candidate, actor: "forged-human" }] },
    {
      ...report,
      skills: [
        {
          ...candidate,
          findings: [
            { severity: "info", code: "fixture", hidden: "signed-url" },
          ],
        },
      ],
    },
  ])
    assert.throws(() => intake.acceptReport(bad));
  const data = await (
    await intake.admin(new Request(`${origin}/api/admin/intake`), {
      id: "fixture-admin",
    })
  ).json();
  assert.equal(data.total, 0);
});
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "rr-intake-test-")),
    editorialPath = join(dir, "auth.sqlite");
  await migrateAuthDatabase({
    databasePath: editorialPath,
    baseURL: origin,
    secret: "test-only-auth-secret-with-enough-characters",
  });
  await migrateAdminDatabase({ databasePath: editorialPath });
  const intake = createIntakeService({
    databasePath: join(dir, "intake.sqlite"),
    editorialPath,
    token,
  });
  t.after(async () => {
    intake.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { intake, editorialPath };
}
test("auto policy requires explicit source rights, recognized license, quality, digest and no elevated findings", () => {
  const source = { allow_auto: 1, rights_confirmed: 1 };
  assert.equal(decisionFor(candidate, source), "published");
  assert.equal(decisionFor(candidate, null), "needs_review");
  assert.equal(
    decisionFor({ ...candidate, license: "unknown" }, source),
    "needs_review",
  );
  assert.equal(
    decisionFor(candidate, source, { digestVerified: false }),
    "needs_review",
  );
  assert.equal(
    decisionFor({ ...candidate, findings: [{ severity: "medium" }] }, source),
    "needs_review",
  );
  assert.equal(
    decisionFor({ ...candidate, status: "blocked" }, source),
    "blocked",
  );
});
test("URL aliases preserve the first skill ID and a mirror cannot create another published card", async (t) => {
  const { intake, editorialPath } = await fixture(t);
  const approveSource = async (repository) =>
    intake.admin(
      new Request(`${origin}/api/admin/intake/sources`, {
        method: "POST",
        body: JSON.stringify({
          repository,
          allowAuto: true,
          rightsConfirmed: true,
        }),
      }),
      { id: "fixture-admin" },
    );
  assert.equal(
    (await approveSource("https://github.com/Fixture/Skills.git/")).status,
    200,
  );
  assert.equal(intake.acceptReport(report).published, 1);
  const variant = structuredClone(report);
  variant.repository.url = "https://github.com/FIXTURE/SKILLS";
  variant.skills[0].id = "case-variant-generated-id";
  variant.skills[0].sourceUrl = candidate.sourceUrl.replace(
    "fixture/skills",
    "FIXTURE/SKILLS",
  );
  assert.equal(intake.acceptReport(variant).added, 0);
  const mirror = structuredClone(report);
  mirror.repository.url = "https://github.com/fixture/mirror";
  mirror.skills[0].id = "fixture-mirror-skill";
  mirror.skills[0].sourceUrl = candidate.sourceUrl.replace(
    "fixture/skills",
    "fixture/mirror",
  );
  await approveSource(mirror.repository.url);
  assert.equal(intake.acceptReport(mirror).published, 0);
  const catalog = readPublicCatalog(editorialPath);
  assert.equal(catalog.items.length, 1);
  assert.equal(catalog.items[0].slug, candidate.id);
  const updated = structuredClone(report);
  updated.commit = "d".repeat(40);
  updated.skills[0].name = "Updated skill name";
  updated.skills[0].sourceUrl = candidate.sourceUrl.replace(
    report.commit,
    updated.commit,
  );
  assert.equal(intake.acceptReport(updated).published, 0);
  const pending = await (
    await intake.admin(
      new Request(`${origin}/api/admin/intake?status=needs_review`),
      { id: "fixture-admin" },
    )
  ).json();
  const row = pending.items.find(
    (item) => item.candidate.name === updated.skills[0].name,
  );
  const detail = await (
    await intake.admin(new Request(`${origin}/api/admin/intake/${row.id}`), {
      id: "fixture-admin",
    })
  ).json();
  assert.deepEqual(
    detail.changes.find((change) => change.field === "name"),
    { field: "name", before: candidate.name, after: updated.skills[0].name },
  );
  assert.ok(
    detail.changes.some(
      (change) => change.field === "commit" && change.after === updated.commit,
    ),
  );
});
test("unknown sources enter review; approved sources publish once and immediately resolve in both locales", async (t) => {
  const { intake, editorialPath } = await fixture(t);
  const response = await intake.admin(
    new Request(`${origin}/api/admin/intake/sources`, {
      method: "POST",
      body: JSON.stringify({
        repository: report.repository.url,
        allowAuto: true,
        rightsConfirmed: true,
      }),
    }),
    { id: "fixture-admin" },
  );
  assert.equal(response.status, 200);
  assert.equal(intake.acceptReport(report).added, 1);
  assert.equal(intake.acceptReport(report).added, 0);
  const catalog = readPublicCatalog(editorialPath);
  assert.equal(catalog.items.length, 1);
  assert.equal(catalog.items[0].revision, 1);
  assert.equal(catalog.items[0].provenance.reviewKind, "automated");
  for (const locale of ["en", "ru"]) {
    const list = buildCatalog(locale, catalog);
    assert.equal(
      resolvePage(
        `${locale === "ru" ? "/ru" : ""}/skills/${candidate.id}`,
        list,
      ).type,
      "skill",
    );
  }
  const db = new Database(editorialPath);
  db.prepare(
    "UPDATE reporadars_admin_record SET status='archived',revision=revision+1",
  ).run();
  assert.equal(readPublicCatalog(editorialPath).items.length, 0);
  db.close();
  assert.equal(
    intake.acceptReport({
      ...report,
      commit: "d".repeat(40),
      skills: [
        {
          ...candidate,
          sourceUrl: candidate.sourceUrl.replace(
            "a".repeat(40),
            "d".repeat(40),
          ),
        },
      ],
    }).published,
    0,
  );
  assert.equal(readPublicCatalog(editorialPath).items.length, 0);
});
test("review and blocked candidates cannot leak into public catalog; intake APIs require service token and admin session", async (t) => {
  const { intake, editorialPath } = await fixture(t);
  intake.acceptReport(report);
  assert.equal(readPublicCatalog(editorialPath).items.length, 0);
  const admin = createAdminService({
    databasePath: editorialPath,
    baseURL: origin,
    intakeService: intake,
    authService: { handle: async () => Response.json({ user: null }) },
  });
  t.after(() => admin.close());
  assert.equal(
    (await admin.handle(new Request(`${origin}/api/admin/intake`))).status,
    401,
  );
  assert.equal(
    (
      await admin.handle(
        new Request(`${origin}/api/intake/reports`, {
          method: "POST",
          body: JSON.stringify(report),
        }),
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await intake.worker(
        new Request(`${origin}/api/intake/reports`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: JSON.stringify({
            ...report,
            skills: [
              { ...candidate, sourceUrl: "https://evil.example/secret" },
            ],
          }),
        }),
      )
    ).status,
    400,
  );
  intake.acceptReport({
    ...report,
    skills: [
      {
        ...candidate,
        bundleSha256: "e".repeat(64),
        status: "blocked",
        findings: [{ code: "PROMPT_OVERRIDE", severity: "high" }],
      },
    ],
  });
  const rows = await (
    await intake.admin(new Request(`${origin}/api/admin/intake`), {
      id: "fixture-admin",
    })
  ).json();
  const blocked = rows.items.find((r) => r.status === "blocked");
  assert.equal(
    (
      await intake.admin(
        new Request(`${origin}/api/admin/intake/${blocked.id}`, {
          method: "POST",
          body: JSON.stringify({
            decision: "approve",
            revision: blocked.revision,
            rightsConfirmed: true,
          }),
        }),
        { id: "fixture-admin" },
      )
    ).status,
    403,
  );
  assert.equal(readPublicCatalog(editorialPath).items.length, 0);
});
