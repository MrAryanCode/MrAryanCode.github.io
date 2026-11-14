// AT-06: the site is the second project on the home page (design.md DS-04, D-026).
const { test, expect } = require('@playwright/test');
const { mockGithub } = require('./github-mock.cjs');
const { signed } = require('./copy.cjs');

// Copy at step 3 (COPY_AT_STEP_3_SITE_LINKS): the text of the link to the engineering report.
const COPY_AT_STEP_3_SITE_LINKS_REPORT_LABEL = 'How this site is built';

test('AT-06 the site is the second project, after certway', async ({ page }) => {
  signed(COPY_AT_STEP_3_SITE_LINKS_REPORT_LABEL, 'COPY_AT_STEP_3_SITE_LINKS (report label)');
  await mockGithub(page);
  await page.goto('/');

  await expect(page.locator('article#certway')).toHaveCount(1);
  await expect(page.locator('article#this-site')).toHaveCount(1);

  const order = await page.evaluate(() => {
    const certway = document.querySelector('article#certway');
    const site = document.querySelector('article#this-site');
    return certway && site ? certway.compareDocumentPosition(site) & Node.DOCUMENT_POSITION_FOLLOWING : 0;
  });
  expect(order, 'article#this-site must come after article#certway').toBeGreaterThan(0);

  const report = page.locator('article#this-site a[href="/report/"]');
  await expect(report).toHaveCount(1);
  await expect(report).toHaveText(COPY_AT_STEP_3_SITE_LINKS_REPORT_LABEL);
  await expect(page.locator('article#this-site a[href="https://github.com/MrAryanCode/MrAryanCode.github.io"]')).toHaveCount(1);
});
