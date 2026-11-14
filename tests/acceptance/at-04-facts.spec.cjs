// AT-04: the certway evidence card, prerendered and then hydrated. The default mock answers the live read with the
// build values. The context uses a time zone where the fixture instant is already the next day and a locale with
// Persian digits, so the assertions prove the date format is UTC and locale-independent (COPY_AT_STEP_3_DATE_FORMAT, D-025).
const { test, expect } = require('@playwright/test');
const { mockGithub } = require('./github-mock.cjs');
const { BUILD, REPO_URL, hydrated, newContext, prerendered, readFacts } = require('./helpers.cjs');

const ZONE = { timezoneId: 'Pacific/Kiritimati', locale: 'fa-IR' };

test('AT-04 the card is right before and after hydration', async ({ browser, baseURL }) => {
  // Before hydration: the HTML as a context with JavaScript off reads it, on each element (CR1-B5).
  const before = await prerendered(browser, baseURL, '/', ZONE);
  expect(before.facts.tag.text).toBe(BUILD.tag);
  expect(before.facts.tag.href).toBe(BUILD.tagHref);
  expect(before.facts.license.text).toBe(BUILD.license);
  expect(before.facts.stars.text).toBe(BUILD.stars);
  expect(before.facts.pushedAt.text).toBe(BUILD.pushedAt);
  expect(before.noteVisible, 'the live-failure note must be hidden before hydration').toBe(false);
  expect(before.asOfCount).toBe(1);
  expect(before.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);

  // After hydration, in a context with the same zone and locale.
  const context = await newContext(browser, baseURL, ZONE);
  try {
    const page = await context.newPage();
    await mockGithub(page);
    await page.goto('/');
    await expect(page.locator(`a[href="${REPO_URL}"]`).first()).toBeVisible();
    await expect(page.locator('p[data-live-fail]'), 'the live-failure note exists in the card').toHaveCount(1);
    await expect(page.locator('p[data-live-fail]')).toBeHidden();
    await hydrated(page);
    const after = await readFacts(page);
    expect(after.facts, 'each [data-fact] element must keep its text and href after hydration').toEqual(before.facts);
    expect(after.asOfCount).toBe(1);
  } finally {
    await context.close();
  }
});
