// AT-17: light and dark. axe `color-contrast` passes in both, and the root background differs between the two.
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { mockGithub } = require('./github-mock.cjs');
const { ROUTES, hydrated } = require('./helpers.cjs');

async function contrastViolations(page) {
  const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

const rootBackground = (page) => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);

for (const route of ROUTES) {
  test(`AT-17 light and dark on ${route}`, async ({ page }) => {
    await mockGithub(page);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(route);
    await hydrated(page);
    expect(await contrastViolations(page), 'colour contrast in the light scheme').toEqual([]);
    const light = await rootBackground(page);

    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await contrastViolations(page), 'colour contrast in the dark scheme').toEqual([]);
    const dark = await rootBackground(page);

    expect(dark, 'the root background must differ between light and dark').not.toBe(light);
  });
}
