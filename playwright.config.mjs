import { defineConfig } from '@playwright/test';

const port = Number(process.env.API_PREVIEW_PORT ?? 3101);

export default defineConfig({
  testDir: 'test/browser',
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: 'chromium',
    channel: process.env.CI ? undefined : 'chrome',
  },
  webServer: {
    command: 'node scripts/docs/preview-api.mjs',
    url: `http://127.0.0.1:${port}/`,
    env: { API_PREVIEW_PORT: String(port) },
    reuseExistingServer: !process.env.CI,
  },
});
