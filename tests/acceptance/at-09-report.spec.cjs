// AT-09: the engineering report with the fixture quality.json injected (design.md DS-09, D-031).
// The build runs with GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID and GITHUB_SHA set to the values that
// tests/acceptance/serve.mjs sets, which match test/fixtures/quality.json.
const { test, expect } = require('@playwright/test');
const { mockGithub } = require('./github-mock.cjs');
const { signed } = require('./copy.cjs');
const { hydrated } = require('./helpers.cjs');
const quality = require('../../test/fixtures/quality.json');
const pages = require('../../quality/pages.json');

// Copy at step 3. When these are amended, keep the shapes below:
//   The order of COPY_AT_STEP_3_SITE_CHECKS is the order of the report sections: unit tests, acceptance tests,
//   accessibility, performance, HTML validation, links (design.md DS-09).
//   COPY_AT_STEP_3_REPORT_LABELS: the dt labels { passed, skipped, flaky, pagesChecked, violations, assertionsPassed,
//     documentsChecked, errors, warnings, linksFound, unique, checked, ok, broken, timedOut, excluded }.
const COPY_AT_STEP_3_REPORT_TITLE = 'Engineering report';
const COPY_AT_STEP_3_REPORT_LEAD = 'How this site is built: the checks every deploy must pass, with the numbers from the build you are reading.';
// The signed COPY_AT_STEP_3_SITE_CHECKS of src/content/identity.ts (text and file; the marker is not asserted here).
const COPY_AT_STEP_3_SITE_CHECKS = [
  { text: 'Unit tests', file: '.github/workflows/pages.yml' },
  { text: 'Acceptance tests in Chromium, Firefox and WebKit', file: 'package.json' },
  { text: 'Accessibility check on every page (axe-core)', file: 'package.json' },
  { text: 'Performance check (Lighthouse)', file: 'lighthouserc.cjs' },
  { text: 'HTML validation (Nu Html Checker)', file: 'package.json' },
  { text: 'Link check (lychee)', file: '.github/workflows/pages.yml' },
];
const COPY_AT_STEP_3_REPORT_LABELS = null;

const REPO = 'https://github.com/MrAryanCode/MrAryanCode.github.io';
const sha = quality.commit;
const sha7 = sha.slice(0, 7);

// Number formats of design.md DS-09: scores times 100 rounded, milliseconds with a comma, CLS with three decimals.
const group = (n) => n.toLocaleString('en-US');
const score = (s) => String(Math.round(s * 100));
const ms = (n) => group(Math.round(n));

// The page column of the Lighthouse table: the route path, and `404 page` for the 404 file.
const pageName = (entry) => (entry.file === '404.html' ? '404 page' : entry.path);

async function checkReport(page) {
  const labels = COPY_AT_STEP_3_REPORT_LABELS;
  const checks = COPY_AT_STEP_3_SITE_CHECKS;

  await expect(page.locator('main h1')).toHaveText(COPY_AT_STEP_3_REPORT_TITLE);
  await expect(page.locator('main')).toContainText(COPY_AT_STEP_3_REPORT_LEAD);
  await expect(page.locator('main h2')).toHaveText(checks.map((c) => c.text));

  // The run line: the run link equals the fixture runUrl, the commit link points at the fixture commit.
  await expect(page.locator(`main a[href="${quality.runUrl}"]`)).toHaveCount(1);
  const commitLink = page.locator(`main a[href="${REPO}/commit/${sha}"]`);
  await expect(commitLink).toHaveCount(1);
  await expect(commitLink).toHaveText(sha7);

  const section = (i) => page.locator('main h2').nth(i).locator('xpath=ancestor::section[1]');
  for (const i of checks.keys()) await expect(section(i), `each check h2 sits inside a section (${i})`).toHaveCount(1);
  // The value of the dd that follows the dt with this label, inside one section.
  const valueOf = (i, label) =>
    section(i).evaluate((el, text) => {
      const dt = [...el.querySelectorAll('dt')].find((d) => d.textContent.trim() === text);
      return dt && dt.nextElementSibling ? dt.nextElementSibling.textContent.trim() : null;
    }, label);

  const u = quality.unitTests;
  expect(await valueOf(0, labels.passed), 'unit tests: passed').toMatch(new RegExp(`^${group(u.passed)} of ${group(u.total)}\\b`));
  expect(await valueOf(0, labels.skipped), 'unit tests: skipped').toBe(group(u.skipped));

  const a = quality.acceptanceTests;
  expect(await valueOf(1, labels.passed), 'acceptance tests: passed').toMatch(new RegExp(`^${group(a.passed)} of ${group(a.total)}\\b`));
  expect(await valueOf(1, labels.flaky), 'acceptance tests: flaky').toBe(group(a.flaky));
  expect(await valueOf(1, labels.skipped), 'acceptance tests: skipped').toBe(group(a.skipped));
  await expect(section(1)).toContainText(/browser/i); // the note that each test runs once per browser, so the counts are runs

  // The axe numbers sit under the accessibility check, and are never called tests.
  expect(await valueOf(2, labels.pagesChecked), 'accessibility: pages checked').toBe(group(quality.accessibility.pages.length));
  expect(await valueOf(2, labels.violations), 'accessibility: violations').toBe(group(quality.accessibility.totalViolations));
  expect(((await section(2).innerText()) || '').replace(/Defined in[\s\S]*$/, ''), 'the accessibility numbers are page checks, never tests').not.toMatch(/\btests?\b/i);

  const perf = quality.performance;
  expect(await valueOf(3, labels.assertionsPassed), 'performance: assertions passed').toMatch(new RegExp(`^${group(perf.assertions.passed)} of ${group(perf.assertions.total)}\\b`));
  const rows = section(3).locator('table tbody tr');
  await expect(rows).toHaveCount(pages.length);
  for (const [i, entry] of pages.entries()) {
    const lh = perf.pages.find((p) => p.file === entry.file);
    const cells = (await rows.nth(i).locator('th, td').allInnerTexts()).map((t) => t.trim());
    expect(cells.slice(0, 6), `Lighthouse table row ${i} (${entry.file})`).toEqual([
      pageName(entry),
      score(lh.scores.performance),
      score(lh.scores.accessibility),
      ms(lh.metrics.lcpMs),
      ms(lh.metrics.tbtMs),
      lh.metrics.cls.toFixed(3),
    ]);
  }

  const h = quality.html;
  expect(await valueOf(4, labels.documentsChecked), 'html: documents checked').toBe(group(h.documentsChecked));
  expect(await valueOf(4, labels.errors), 'html: errors').toBe(group(h.errors));
  expect(await valueOf(4, labels.warnings), 'html: warnings').toBe(group(h.warnings));

  const l = quality.links;
  const linksText = ((await section(5).innerText()) || '').replace(/\s+/g, ' ');
  for (const [key, value] of [['linksFound', l.total], ['unique', l.unique], ['checked', l.checked], ['ok', l.ok], ['broken', l.broken], ['timedOut', l.timeouts], ['excluded', l.excluded]]) {
    expect(linksText, `links: ${key}`).toMatch(new RegExp(`${labels[key].replace(/[()]/g, '\\$&')}\\W*${group(value)}\\b`));
  }

  // Each section's `Defined in` link points to the build commit's copy of the file of the same check.
  for (const [i, check] of checks.entries()) {
    const link = section(i).locator(`a[href="${REPO}/blob/${sha}/${check.file}"]`);
    await expect(link, `Defined in link of section ${i}`).toHaveCount(1);
    await expect(link).toHaveText(check.file);
  }

  const text = (await page.locator('body').innerText()) || '';
  expect(text, 'no failed count is shown').not.toMatch(/\bfailed\b/i);
  expect(text, 'no __ placeholder is left').not.toContain('__');
}

test('AT-09 the report shows the fixture numbers before and after hydration', async ({ browser, baseURL }) => {
  signed(COPY_AT_STEP_3_REPORT_TITLE, 'COPY_AT_STEP_3_REPORT_TITLE');
  signed(COPY_AT_STEP_3_REPORT_LEAD, 'COPY_AT_STEP_3_REPORT_LEAD');
  signed(COPY_AT_STEP_3_SITE_CHECKS, 'COPY_AT_STEP_3_SITE_CHECKS');
  signed(COPY_AT_STEP_3_REPORT_LABELS, 'COPY_AT_STEP_3_REPORT_LABELS');

  // Before hydration: a context with JavaScript off reads the prerendered HTML.
  const plain = await browser.newContext({ baseURL, javaScriptEnabled: false });
  let before;
  try {
    const page = await plain.newPage();
    await page.goto('/report/');
    await checkReport(page);
    before = await page.locator('main').innerText();
  } finally {
    await plain.close();
  }

  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    await mockGithub(page);
    await page.goto('/report/');
    await hydrated(page);
    await checkReport(page);
    expect(await page.locator('main').innerText(), 'hydration must not change the report').toBe(before);
  } finally {
    await context.close();
  }
});
