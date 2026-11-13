// AT-20: the certway facts update live after hydration (D-019). The mock answers with the live fixtures.
const { test, expect } = require('@playwright/test');
const { mockGithub } = require('./github-mock.cjs');
const { LIVE, hydrated, prerendered } = require('./helpers.cjs');

test('AT-20 the facts change to the live values after hydration', async ({ page, browser, baseURL }) => {
  const built = await prerendered(browser, baseURL);
  const seen = await mockGithub(page, 'live');
  await page.goto('/');
  await hydrated(page);

  await expect(page.locator('[data-fact=tag]')).toHaveText(LIVE.tag);
  await expect(page.locator('[data-fact=tag]')).toHaveAttribute('href', LIVE.tagHref);
  await expect(page.locator('[data-fact=stars]')).toHaveText(LIVE.stars);
  await expect(page.locator('[data-fact=pushedAt]')).toContainText(LIVE.pushedAt);
  await expect(page.locator('[data-fact=license]')).toHaveText(LIVE.license);

  const asOf = await page.locator('time[data-as-of]').getAttribute('datetime');
  expect(Date.parse(asOf), 'the as-of datetime must be later than the prerendered one').toBeGreaterThan(Date.parse(built.asOf));

  // No third call arrives later.
  await page.waitForTimeout(1000);
  expect(seen.filter((r) => r.method === 'GET').map((r) => r.path).sort()).toEqual([
    '/repos/MrAryanCode/certway',
    '/repos/MrAryanCode/certway/releases/latest',
  ]);
});
