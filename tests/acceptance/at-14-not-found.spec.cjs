// AT-14: a wrong URL answers 404 with the 404 page; a directory URL without the slash answers 301.
const { test, expect } = require('@playwright/test');
const { mockGithub } = require('./github-mock.cjs');
const { signed } = require('./copy.cjs');
const { hydrated, watchConsole } = require('./helpers.cjs');

// Copy at step 3 (COPY_AT_STEP_3_404_H1).
const COPY_AT_STEP_3_404_H1 = '404';

test('AT-14 a wrong URL answers 404 with the 404 page', async ({ page }) => {
  signed(COPY_AT_STEP_3_404_H1, 'COPY_AT_STEP_3_404_H1');
  await mockGithub(page);
  // The browser prints a `Failed to load resource` line for the 404 status itself; that line is not a page error.
  const logs = watchConsole(page, { ignoreFailedResource: true });

  const response = await page.goto('/no/such/page');
  expect(response.status()).toBe(404);

  await expect(page.locator('main h1')).toHaveText(COPY_AT_STEP_3_404_H1);
  await expect(page.locator('main a[href="/"]').first()).toBeVisible();

  await hydrated(page);
  await expect(page.locator('main h1')).toHaveText(COPY_AT_STEP_3_404_H1);
  expect(logs.errors, 'no console error after hydration').toEqual([]);
  expect(logs.pageErrors, 'no page error after hydration').toEqual([]);
});

test('AT-14 a directory URL without the slash answers 301 to the slash', async ({ request }) => {
  const response = await request.get('/projects/certway', { maxRedirects: 0 });
  expect(response.status()).toBe(301);
  expect(response.headers()['location']).toMatch(/\/projects\/certway\/$/);
});
