// AT-01: JavaScript disabled, open `/`. The prerendered HTML alone carries the page and the certway facts.
const { test, expect } = require('@playwright/test');
const { mockGithub } = require('./github-mock.cjs');
const { BUILD } = require('./helpers.cjs');

test.use({ javaScriptEnabled: false });

test('AT-01 the home page is complete with JavaScript off', async ({ page }) => {
  const seen = await mockGithub(page);
  const apiRequests = [];
  page.on('request', (req) => {
    if (new URL(req.url()).hostname === 'api.github.com') apiRequests.push(req.url());
  });

  await page.goto('/');

  await expect(page.locator('body')).toContainText('Aryan Miri');
  await expect(page.locator('body')).toContainText('MrAryanCode');

  // Each fact sits on its own element and is checked there (CR1-B5).
  await expect(page.locator('[data-fact=tag]')).toHaveText(BUILD.tag);
  await expect(page.locator('[data-fact=license]')).toHaveText(BUILD.license);
  await expect(page.locator('[data-fact=stars]')).toHaveText(BUILD.stars);
  await expect(page.locator('[data-fact=pushedAt]')).toContainText(BUILD.pushedAt);

  await expect(page.locator('time[data-as-of]')).toHaveCount(1);
  await expect(page.locator('time[data-as-of]')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);

  // Every home section has visible text.
  const sections = page.locator('main > section');
  expect(await sections.count(), 'the home page has no section directly inside main').toBeGreaterThan(0);
  for (const section of await sections.all()) {
    await expect(section).toBeVisible();
    const text = ((await section.innerText()) || '').trim();
    expect(text.length, 'a home section has no visible text').toBeGreaterThan(0);
  }

  expect(apiRequests, 'no request may reach api.github.com with JavaScript off').toEqual([]);
  expect(seen, 'the mock must not have seen a request').toEqual([]);
});
