import { defineConfig } from '@playwright/test';

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:4318';

export default defineConfig({
  testDir: './tests',
  testMatch: /.*-browser\.spec\.mjs/,
  timeout: 20_000,
  use: {
    baseURL,
    browserName: 'chromium',
    headless: true,
    launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium' },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: process.env.BASE_URL ? undefined : {
    command: 'node scripts/homepage-preview.mjs',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
