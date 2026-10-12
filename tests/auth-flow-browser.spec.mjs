import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  createAuthService,
  migrateAuthDatabase,
} from "../server/auth-service.mjs";

test("real browser request, inert email link, HttpOnly session and logout", async ({
  browser,
}) => {
  const runtime = await mkdtemp(path.join(tmpdir(), "reporadars-auth-flow-"));
  const mails = [];
  let service, preview, api;
  const contexts = [];
  try {
    // Reserve an ephemeral loopback API port, never the public origin.
    api = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const result = await service.handle(
        new Request(`${origin}${request.url}`, {
          method: request.method,
          headers: request.headers,
          body: chunks.length ? Buffer.concat(chunks) : undefined,
        }),
        { ip: request.socket.remoteAddress },
      );
      const headers = Object.fromEntries(result.headers);
      const cookies = result.headers.getSetCookie();
      if (cookies.length) headers["set-cookie"] = cookies;
      response.writeHead(result.status, headers);
      response.end(Buffer.from(await result.arrayBuffer()));
    });
    await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
    const reservation = createServer();
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    const options = {
      baseURL: origin,
      secret: "isolated-browser-test-secret-not-for-production-123",
      databasePath: path.join(runtime, "auth.sqlite"),
      sendMail: async (mail) => {
        mails.push(mail);
      },
    };
    await migrateAuthDatabase(options);
    service = await createAuthService(options);
    preview = spawn(process.execPath, ["scripts/homepage-preview.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        AUTH_PREVIEW_API_ORIGIN: `http://127.0.0.1:${api.address().port}`,
      },
      stdio: "ignore",
    });
    await expect
      .poll(async () => {
        try {
          return (await fetch(`${origin}/login`)).status;
        } catch {
          return 0;
        }
      })
      .toBe(200);

    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    await page.goto(`${origin}/ru/login`);
    await page.getByLabel("Адрес электронной почты").fill("flow@example.test");
    await page.getByRole("button", { name: "Продолжить с email" }).click();
    await expect(page.getByRole("status")).toContainText("Проверьте email");
    expect(mails).toHaveLength(1);
    expect(mails[0].url).toContain("/ru/login#email-token=");

    const scanner = await browser.newContext();
    contexts.push(scanner);
    const scan = await scanner.newPage();
    await scan.goto(mails[0].url);
    await scan.getByRole("button", { name: "Подтвердить вход" }).click();
    await expect(scan.getByRole("status")).toContainText(
      /недействительна|истекла/,
    );

    await page.goto(mails[0].url);
    await expect(page).toHaveURL(`${origin}/ru/login`);
    await expect(
      page.getByRole("button", { name: "Подтвердить вход" }),
    ).toBeVisible();
    expect(
      (await context.cookies()).some((cookie) =>
        cookie.name.includes("session_token"),
      ),
    ).toBe(false);
    await page.getByRole("button", { name: "Подтвердить вход" }).click();
    await expect(
      page.getByText("flow@example.test", { exact: true }),
    ).toBeVisible();
    const session = (await context.cookies()).find((cookie) =>
      cookie.name.includes("session_token"),
    );
    expect(session?.httpOnly).toBe(true);
    expect(await page.evaluate(() => document.cookie)).not.toContain(
      "session_token",
    );
    await page.reload();
    await expect(
      page.getByText("flow@example.test", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Выйти" }).click();
    await expect(page.getByLabel("Адрес электронной почты")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Адрес электронной почты")).toBeVisible();
    expect(
      (await context.cookies()).some((cookie) =>
        cookie.name.includes("session_token"),
      ),
    ).toBe(false);
    expect(
      await page.evaluate(() =>
        JSON.stringify({
          local: { ...localStorage },
          session: { ...sessionStorage },
        }),
      ),
    ).not.toContain("flow@example.test");
  } finally {
    for (const context of contexts) await context.close();
    if (preview && preview.exitCode === null) {
      preview.kill("SIGTERM");
      await new Promise((resolve) => preview.once("exit", resolve));
    }
    if (api) await new Promise((resolve) => api.close(resolve));
    if (service) await service.close();
    await rm(runtime, { recursive: true, force: true });
  }
});
