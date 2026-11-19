import { readdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const list = async (folder) => (await readdir(new URL(`../${folder}/`, import.meta.url)))
  .filter((name) => name.endsWith('.test.html'))
  .map((name) => `/test/${folder}/${name}`);

// the shared header/footer page also runs without the API template and with metadata overrides
const variants = { '/test/docs/api-chrome.test.html': ['', '?non-api', '?override'] };
const pages = (await list('docs'))
  .flatMap((path) => (variants[path] ?? ['']).map((query) => `${path}${query}`));
const widths = [300, 600, 900, 1200];

pages.forEach((path) => {
  widths.forEach((width) => {
    test(`${path} at ${width}px`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      const results = page.locator('#results');
      await expect(results, `${path} at ${width}px did not report a result`)
        .toHaveAttribute('data-status', /^(passed|failed)$/, { timeout: 15000 });
      const report = [
        `${path} at ${width}px`,
        await results.textContent(),
        ...errors.map((error) => `Page error: ${error}`),
      ].join('\n');
      expect(await results.getAttribute('data-status'), report).toBe('passed');
    });
  });
});
