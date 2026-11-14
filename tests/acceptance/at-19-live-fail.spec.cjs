// AT-19: the live read fails in the browser (B-10, D-019, D-025). One test, so one context, per mock mode.
// For every mode the build values stay, the note shows, and nothing throws. After the rate-limited 403 the page makes no
// further API request, not even on a second page in the same tab (sessionStorage `gh-api-rate-reset`, epoch seconds).
const { test, expect } = require('@playwright/test');
const { mockGithub } = require('./github-mock.cjs');
const { signed } = require('./copy.cjs');
const { BUILD, FACT_NAMES, hydrated, newContext, prerendered, readFacts, watchConsole } = require('./helpers.cjs');

// Copy at step 3 (COPY_AT_STEP_3_LIVE_FAIL_NOTE, D-025).
const COPY_AT_STEP_3_LIVE_FAIL_NOTE = 'Live facts could not be read. Showing the facts from when this page was built.';

const MODES = ['500', '403', 'abort', 'not-json', 'private', 'hang'];
const API_PATHS = ['/repos/MrAryanCode/certway', '/repos/MrAryanCode/certway/releases/latest'];

for (const mode of MODES) {
  test(`AT-19 live read fails: ${mode}`, async ({ page, browser, baseURL }, testInfo) => {
    test.setTimeout(60000);
    signed(COPY_AT_STEP_3_LIVE_FAIL_NOTE, 'COPY_AT_STEP_3_LIVE_FAIL_NOTE');
    const built = await prerendered(browser, baseURL);
    expect(built.noteVisible, 'with JavaScript off the note is not visible').toBe(false);

    const seen = await mockGithub(page, mode);
    const logs = watchConsole(page);
    const startedAt = Date.now();
    await page.goto('/');
    await hydrated(page);

    // The note shows by the 8 s timeout of the hang mode; every mode is checked 10 s after load.
    const note = page.locator('p[data-live-fail]');
    await expect(note).toBeVisible({ timeout: 12000 });
    await expect(note).toHaveText(COPY_AT_STEP_3_LIVE_FAIL_NOTE);
    const wait = 10000 - (Date.now() - startedAt);
    if (wait > 0) await page.waitForTimeout(wait);

    const now = await readFacts(page);
    for (const name of FACT_NAMES) {
      expect(now.facts[name], `[data-fact=${name}] keeps the build value`).toEqual(built.facts[name]);
    }
    expect(now.facts.tag.text).toBe(BUILD.tag);
    expect(now.asOf, 'time[data-as-of] keeps the prerendered datetime').toBe(built.asOf);
    expect(now.asOfSentence, 'the as-of sentence keeps its build wording').toBe(built.asOfSentence);
    await expect(note).toBeVisible();

    expect(logs.pageErrors, 'no pageerror event').toEqual([]);
    expect(logs.errors, 'no console error except entries about api.github.com').toEqual([]);
    await testInfo.attach(`api-console-${testInfo.project.name}-${mode}`, {
      body: JSON.stringify(logs.apiEntries, null, 2),
      contentType: 'application/json',
    });

    if (mode === '403') {
      expect(seen.filter((r) => r.method === 'GET').length, 'no third API request in the page view after the rate limit').toBeLessThanOrEqual(2);
      const before = seen.length;
      // A second page in the same tab, then the home page again: no API request at all.
      await page.goto('/report/');
      await page.goto('/');
      await hydrated(page);
      await page.waitForTimeout(2000);
      expect(seen.length, 'the rate limit carries to the next page of the tab: no API request').toBe(before);
    }
  });
}

// A reset time in the past, or a value that is not a number, does not block the live read.
for (const stored of ['past', 'garbage']) {
  test(`AT-19 a stored rate-limit value of ${stored} still makes both requests`, async ({ browser, baseURL }) => {
    const context = await newContext(browser, baseURL);
    try {
      const value = stored === 'past' ? String(Math.floor(Date.now() / 1000) - 3600) : 'garbage';
      await context.addInitScript((v) => window.sessionStorage.setItem('gh-api-rate-reset', v), value);
      const page = await context.newPage();
      const seen = await mockGithub(page);
      await page.goto('/');
      await hydrated(page);
      await expect.poll(() => seen.filter((r) => r.method === 'GET').map((r) => r.path).sort(), {
        message: 'both API requests are made',
      }).toEqual(API_PATHS);
    } finally {
      await context.close();
    }
  });
}
