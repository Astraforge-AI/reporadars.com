import { expect, test } from "@playwright/test";

const email = "person@example.test";

async function mockSession(page, user = null) {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { user } }),
  );
}

async function expectNoAuthDataInBrowserStorage(page) {
  const values = await page.evaluate(() =>
    [localStorage, sessionStorage].flatMap((storage) =>
      Array.from({ length: storage.length }, (_, index) => [
        storage.key(index),
        storage.getItem(storage.key(index)),
      ]),
    ),
  );
  expect(JSON.stringify(values)).not.toContain(email);
  expect(JSON.stringify(values)).not.toContain("email-token");
}

test("requests an English email link through the same-origin API without storing identity", async ({
  page,
}) => {
  await mockSession(page);
  let request;
  await page.route("**/api/auth/request-link", async (route) => {
    request = route.request();
    await route.fulfill({ status: 202, json: { ok: true } });
  });

  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();

  await expect(page.getByRole("status")).toContainText("Check your email");
  const pageOrigin = new URL(page.url()).origin;
  expect(new URL(request.url()).origin).toBe(pageOrigin);
  expect(request.method()).toBe("POST");
  expect(request.postDataJSON()).toEqual({ email, locale: "en" });
  expect(request.headers()["content-type"]).toContain("application/json");
  expect(request.headers().origin).toBe(pageOrigin);
  expect(request.headers()).not.toHaveProperty("authorization");
  await expectNoAuthDataInBrowserStorage(page);
});

test("shows a truthful rate-limit response and leaves the form usable", async ({
  page,
}) => {
  await mockSession(page);
  await page.route("**/api/auth/request-link", (route) =>
    route.fulfill({
      status: 429,
      json: { error: { code: "RATE_LIMITED" } },
    }),
  );

  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();

  await expect(page.getByRole("status")).toContainText("Please wait");
  await expect(
    page.getByRole("button", { name: "Continue with email" }),
  ).toBeEnabled();
});

test("does not claim an email link was sent after a malformed successful response", async ({
  page,
}) => {
  await mockSession(page);
  await page.route("**/api/auth/request-link", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<main>static fallback</main>",
    }),
  );

  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();

  await expect(page.getByRole("status")).toContainText(
    "could not confirm email delivery",
  );
  await expect(page.getByRole("status")).not.toContainText("Check your email");
});

test("uses the Russian locale for a Russian email-link request", async ({
  page,
}) => {
  await mockSession(page);
  let request;
  await page.route("**/api/auth/request-link", async (route) => {
    request = route.request();
    await route.fulfill({ status: 202, json: { ok: true } });
  });

  await page.goto("/ru/login?mode=signup");
  await page.getByLabel("Адрес электронной почты").fill(email);
  await page.getByRole("button", { name: "Продолжить с email" }).click();

  expect(request.postDataJSON()).toEqual({ email, locale: "ru" });
  await expect(page.getByRole("status")).toContainText("Проверьте email");
});

test("shows an uncertain outcome after a timed-out link request and restores the submit control", async ({
  page,
}) => {
  await mockSession(page);
  await page.route("**/api/auth/request-link", () => new Promise(() => {}));

  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();

  await expect(page.getByRole("status")).toContainText("timed out", {
    timeout: 14_000,
  });
  await expect(
    page.getByRole("button", { name: "Continue with email" }),
  ).toBeEnabled();
});

test("does not confirm a fragment token until the person explicitly confirms", async ({
  page,
}) => {
  await mockSession(page);
  let confirmations = 0;
  await page.route("**/api/auth/confirm", async (route) => {
    confirmations += 1;
    expect(route.request().postDataJSON()).toEqual({ token: "test-token" });
    await route.fulfill({
      json: { ok: true, user: { id: "user-1", email } },
    });
  });

  await page.goto("/login#email-token=test-token");
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("button", { name: "Confirm sign-in" }),
  ).toBeVisible();
  expect(confirmations).toBe(0);

  await page.getByRole("button", { name: "Confirm sign-in" }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  expect(confirmations).toBe(1);
  await expectNoAuthDataInBrowserStorage(page);
});

test("captures and clears an email token added after the Russian login page loads", async ({
  page,
}) => {
  await mockSession(page);
  let confirmations = 0;
  await page.route("**/api/auth/confirm", () => {
    confirmations += 1;
  });

  await page.goto("/ru/login");
  await page.goto("/ru/login#email-token=same-document-token");

  await expect(page).toHaveURL(/\/ru\/login$/);
  await expect(
    page.getByRole("button", { name: "Подтвердить вход" }),
  ).toBeVisible();
  expect(confirmations).toBe(0);
  await expectNoAuthDataInBrowserStorage(page);
});

test("lets a person request a new link after an invalid confirmation token", async ({
  page,
}) => {
  await mockSession(page);
  await page.route("**/api/auth/confirm", (route) =>
    route.fulfill({
      status: 400,
      json: { error: { code: "INVALID_LINK" } },
    }),
  );

  await page.goto("/login#email-token=expired-token");
  await page.getByRole("button", { name: "Confirm sign-in" }).click();
  await expect(page.getByRole("status")).toContainText(
    "invalid or has expired",
  );
  await page.getByRole("button", { name: "Request a new link" }).click();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expectNoAuthDataInBrowserStorage(page);
});

test("renders an existing session and signs out without changing local workspace data", async ({
  page,
}) => {
  await mockSession(page, { id: "user-1", email });
  let signOuts = 0;
  await page.route("**/api/auth/sign-out", async (route) => {
    signOuts += 1;
    expect(route.request().postDataJSON()).toEqual({});
    await route.fulfill({ json: { ok: true } });
  });

  await page.goto("/login");
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Email address")).toBeVisible();
  expect(signOuts).toBe(1);
  await expectNoAuthDataInBrowserStorage(page);
});
