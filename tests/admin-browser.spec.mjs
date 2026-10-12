import { expect, test } from "@playwright/test";

const record = {
  id: "skill-1",
  kind: "skill",
  slug: "research-radar",
  title: { en: "Research radar", ru: "Исследовательский радар" },
  summary: { en: "A concise signal.", ru: "Краткий сигнал." },
  body: { en: "# Notes", ru: "# Заметки" },
  sourceUrl: "https://example.test/source",
  category: "research",
  skillIds: [],
  status: "draft",
  revision: 1,
  createdAt: "2026-09-07T00:00:00.000Z",
  updatedAt: "2026-09-07T00:00:00.000Z",
};

async function adminApi(page, { role = "admin", conflict = false } = {}) {
  await page.route("**/api/admin/session", (route) =>
    route.fulfill({
      status: role === "anonymous" ? 401 : role === "forbidden" ? 403 : 200,
      json:
        role === "admin"
          ? { user: { id: "admin-1", email: "editor@example.test" }, role }
          : { error: { code: "FORBIDDEN" } },
    }),
  );
  await page.route("**/api/admin/overview", (route) =>
    route.fulfill({
      json: {
        counts: {
          skills: 8,
          collections: 2,
          articles: 3,
          submissionsPending: 1,
          users: 9,
          published: 6,
        },
        recentActivity: [],
        publicationTarget: "editorial-store",
      },
    }),
  );
  await page.route("**/api/admin/records?*", (route) =>
    route.fulfill({
      json: {
        items: [record],
        total: 21,
        page: 1,
        pageSize: 20,
      },
    }),
  );
  await page.route("**/api/admin/records/skill-1", (route) => {
    if (route.request().method() === "PATCH" && conflict) {
      return route.fulfill({
        status: 409,
        json: { error: { code: "CONFLICT" } },
      });
    }
    return route.fulfill({ json: { item: record } });
  });
  await page.route("**/api/admin/users?*", (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } }),
  );
  await page.route("**/api/admin/audit?*", (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } }),
  );
  await page.route("**/api/admin/submissions?*", (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } }),
  );
}

test("forbidden people receive an admin gate without overview requests", async ({
  page,
}) => {
  await adminApi(page, { role: "forbidden" });
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Admin access required" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "/login",
  );
});

test("shows publication guidance and pages through server-backed records", async ({
  page,
}) => {
  await adminApi(page);
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Editorial desk" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "appear in the catalog immediately",
  );
  await page.getByRole("link", { name: "Content", exact: true }).click();
  await expect(page.getByText("Research radar", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("Page 2")).toBeVisible();
});

test("keeps a stale draft open for review instead of overwriting edits", async ({
  page,
}) => {
  await adminApi(page, { conflict: true });
  await page.goto("/admin");
  await page.getByRole("link", { name: "Content", exact: true }).click();
  await page.getByRole("button", { name: "Edit Research radar" }).click();
  const title = page.getByLabel("English title");
  await title.fill("Edited locally");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.locator("#root").getByRole("alert")).toContainText(
    "changed on the server",
  );
  await expect(title).toHaveValue("Edited locally");
});

test("Russian admin UI is readable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await adminApi(page);
  await page.goto("/ru/admin");
  await expect(
    page.getByRole("heading", { name: "Редакционный стол" }),
  ).toBeVisible();
  await expect(page.locator(".admin-sidebar")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Контент", exact: true }),
  ).toBeVisible();
});

test("uses the shared header geometry without logo overlap", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await adminApi(page);
  await page.goto("/admin");
  const header = page.locator(".unified-header");
  const logo = header.locator(".wordmark");
  await expect(logo).toBeVisible();
  await expect(header).toHaveJSProperty(
    "scrollWidth",
    await header.evaluate((element) => element.clientWidth),
  );
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
});

test("creates a collection with the required general category and selected skill ids", async ({
  page,
}) => {
  await adminApi(page);
  let posted;
  await page.route("**/api/admin/records", async (route) => {
    posted = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      json: { item: { ...record, ...posted, id: "collection-1" } },
    });
  });
  await page.goto("/admin");
  await page.getByRole("button", { name: "New record" }).click();
  await page.getByLabel("Kind").selectOption("collection");
  await page.getByLabel("Slug").fill("research-collection");
  await page.getByLabel("English title").fill("Collection");
  await page.getByLabel("Russian title").fill("Коллекция");
  await page.getByLabel("English summary").fill("Summary");
  await page.getByLabel("Russian summary").fill("Аннотация");
  await page.getByLabel("English body").fill("Body");
  await page.getByLabel("Russian body").fill("Текст");
  await page.getByRole("checkbox", { name: "Research radar" }).check();
  await page.getByRole("button", { name: "Save draft" }).click();
  expect(posted.category).toBe("general");
  expect(posted.skillIds).toEqual(["skill-1"]);
});

test("uses server rows for users, submissions and audit, including moderation revision", async ({
  page,
}) => {
  await adminApi(page);
  let patchBody;
  await page.route("**/api/admin/users?*", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "u1",
            email: "reader@example.test",
            name: "Reader",
            role: "user",
            adminState: null,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    }),
  );
  await page.route("**/api/admin/submissions?*", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "sub-1",
            title: "A submission",
            sourceUrl: "https://example.test",
            status: "pending",
            revision: 4,
            note: "",
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    }),
  );
  await page.route("**/api/admin/submissions/sub-1", async (route) => {
    patchBody = route.request().postDataJSON();
    await route.fulfill({
      json: {
        item: {
          id: "sub-1",
          title: "A submission",
          revision: 5,
          status: "accepted",
        },
      },
    });
  });
  await page.route("**/api/admin/audit?*", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "a1",
            action: "record.published",
            entityType: "record",
            entityId: "skill-1",
            revision: 2,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    }),
  );
  await page.goto("/admin");
  await page.getByRole("link", { name: "Users", exact: true }).click();
  await expect(
    page.getByText("reader@example.test", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Moderation", exact: true }).click();
  await expect(page.getByText("A submission", { exact: true })).toBeVisible();
  await page.getByLabel("Moderation note").fill("Relevant source");
  await expect(page.getByLabel("Moderation note")).toHaveValue(
    "Relevant source",
  );
  await page.getByRole("button", { name: "Accept" }).click();
  expect(patchBody).toEqual({
    revision: 4,
    status: "accepted",
    note: "Relevant source",
  });
  await page.getByRole("link", { name: "Audit", exact: true }).click();
  await expect(
    page.getByText("record.published", { exact: true }),
  ).toBeVisible();
});

test("fails closed when a session endpoint returns HTML with HTTP 200", async ({
  page,
}) => {
  await adminApi(page);
  await page.route("**/api/admin/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<h1>fallback</h1>",
    }),
  );
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", {
      name: "The editorial service is unavailable.",
    }),
  ).toBeVisible();
});

test("retains the admin session when sign-out fails", async ({ page }) => {
  await adminApi(page);
  await page.route("**/api/auth/sign-out", (route) =>
    route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE" } } }),
  );
  await page.goto("/admin");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator("#root").getByRole("alert")).toContainText(
    "Could not sign out",
  );
  await expect(page.locator(".admin-identity")).toContainText(
    "editor@example.test",
  );
});

test("publishes then opens the resulting record and moves it back to draft", async ({
  page,
}) => {
  await adminApi(page);
  const transitions = [];
  await page.route("**/api/admin/records/skill-1/status", async (route) => {
    const body = route.request().postDataJSON();
    transitions.push(body);
    await route.fulfill({
      json: {
        item: { ...record, status: body.status, revision: body.revision + 1 },
      },
    });
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/admin");
  await page.getByRole("link", { name: "Content", exact: true }).click();
  await page.getByRole("button", { name: "Edit Research radar" }).click();
  await page.getByRole("button", { name: "Publish" }).click();
  await page.getByRole("button", { name: "Move to draft" }).click();
  expect(transitions).toEqual([
    { revision: 1, status: "published" },
    { revision: 2, status: "draft" },
  ]);
});

test("requires saving edited text before publishing with the new revision", async ({
  page,
}) => {
  await adminApi(page);
  let stored = structuredClone(record);
  const transitions = [];
  await page.route("**/api/admin/records/skill-1", async (route) => {
    const body = route.request().postDataJSON();
    stored = { ...stored, ...body, revision: stored.revision + 1 };
    await route.fulfill({ json: { item: stored } });
  });
  await page.route("**/api/admin/records/skill-1/status", async (route) => {
    transitions.push(route.request().postDataJSON());
    stored = { ...stored, status: "published", revision: stored.revision + 1 };
    await route.fulfill({ json: { item: stored } });
  });
  await page.goto("/admin");
  await page.getByRole("link", { name: "Content", exact: true }).click();
  await page.getByRole("button", { name: "Edit Research radar" }).click();
  await page.getByLabel("English body").fill("New reviewed content");
  await expect(
    page.getByRole("button", { name: "Publish", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Save the draft before changing publication status.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(transitions).toEqual([]);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(
    page.getByRole("button", { name: "Publish", exact: true }),
  ).toBeEnabled();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByLabel("English body")).toHaveValue(
    "New reviewed content",
  );
  expect(transitions).toEqual([{ revision: 2, status: "published" }]);
});

test("resets content filters and page before opening moderation", async ({
  page,
}) => {
  await adminApi(page);
  const requests = [];
  await page.route("**/api/admin/submissions?*", async (route) => {
    requests.push(new URL(route.request().url()));
    await route.fulfill({
      json: { items: [], total: 0, page: 1, pageSize: 20 },
    });
  });
  await page.goto("/admin");
  await page.getByRole("link", { name: "Content", exact: true }).click();
  await page.getByLabel("Status", { exact: true }).selectOption("draft");
  await page.getByLabel("Search content").fill("review");
  await page.getByRole("button", { name: "Next page" }).click();
  await page.getByRole("link", { name: "Moderation", exact: true }).click();
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(
    requests.every(
      (url) =>
        !url.searchParams.has("status") &&
        !url.searchParams.has("q") &&
        url.searchParams.get("page") === "1",
    ),
  ).toBe(true);
  await expect(page.getByText("Page 1", { exact: true })).toBeVisible();
});

test("late users responses cannot replace audit rows or pagination", async ({
  page,
}) => {
  await adminApi(page);
  let releaseUsers;
  const held = new Promise((resolve) => {
    releaseUsers = resolve;
  });
  let requested = false;
  await page.route("**/api/admin/users?*", async (route) => {
    requested = true;
    await held;
    await route.fulfill({
      json: {
        items: [{ id: "old-user", email: "stale@example.test", role: "user" }],
        total: 99,
        page: 1,
        pageSize: 20,
      },
    });
  });
  await page.route("**/api/admin/audit?*", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "audit-fresh",
            action: "record.created",
            entityType: "record",
            entityId: "fresh",
            revision: 1,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    }),
  );
  await page.goto("/admin");
  await page.getByRole("link", { name: "Users", exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await page.getByRole("link", { name: "Audit", exact: true }).click();
  await expect(page.getByText("record.created", { exact: true })).toBeVisible();
  const response = page.waitForResponse((url) =>
    url.url().includes("/api/admin/users?"),
  );
  releaseUsers();
  await response;
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await expect(page.getByText("record.created", { exact: true })).toBeVisible();
  await expect(
    page.getByText("stale@example.test", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
});

test("Russian editing and moderation use translated controls", async ({
  page,
}) => {
  await adminApi(page);
  await page.route("**/api/admin/submissions?*", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "sub-ru",
            title: "Источник",
            sourceUrl: "https://example.test",
            status: "pending",
            revision: 1,
            note: "",
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    }),
  );
  await page.goto("/ru/admin");
  await page.getByRole("button", { name: "Новая запись" }).click();
  await expect(page.getByLabel("Тип записи", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Английская аннотация")).toBeVisible();
  await expect(page.getByLabel("Русский текст")).toBeVisible();
  await expect(
    page.getByText("Поля EN и RU сохраняются вместе", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Модерация", exact: true }).click();
  await expect(page.getByLabel("Заметка модератора")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Принять", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Отклонить", exact: true }),
  ).toBeVisible();
});
