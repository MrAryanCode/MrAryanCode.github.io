// AT-03: the first screen at 390x844 and 1366x768, JavaScript on. Every locator is scoped to `main`:
// the header's `Message me` is outside it (design.md DS-01).
const { test, expect } = require('@playwright/test');
const { mockGithub } = require('./github-mock.cjs');
const { signed } = require('./copy.cjs');

// The signed copy of src/content/identity.ts (COPY_AT_STEP_3_ROLE_LINE). It must match /full-stack/i.
const COPY_AT_STEP_3_ROLE_LINE = 'Full-stack developer. I build web products end to end and ship them with tests and CI.';

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1366, height: 768 },
];

function insideViewport(box, viewport) {
  return box !== null && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height;
}

for (const viewport of VIEWPORTS) {
  test(`AT-03 first screen at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    signed(COPY_AT_STEP_3_ROLE_LINE, 'COPY_AT_STEP_3_ROLE_LINE');
    expect(COPY_AT_STEP_3_ROLE_LINE).toMatch(/full-stack/i);
    await mockGithub(page);
    await page.setViewportSize(viewport);
    await page.goto('/');

    const h1 = page.locator('main h1');
    await expect(h1).toContainText('Aryan Miri');

    const role = page.locator('main [data-copy=role]');
    await expect(role).toHaveText(COPY_AT_STEP_3_ROLE_LINE);

    const availability = page.locator('main [data-copy=availability]');
    await expect(availability).toContainText(/remote/i);
    await expect(availability).toContainText(/full-time or contract/i);
    await expect(availability).toContainText('Tehran');
    await expect(availability).toContainText('UTC+03:30');

    // Exactly one Telegram link in the first section of main, and it is fully inside the first viewport.
    const link = page.locator('main > :first-child a[href="https://t.me/aryan_61_04"]');
    await expect(link).toHaveCount(1);

    for (const [name, locator] of [['h1', h1], ['role line', role], ['availability', availability], ['Telegram link', link]]) {
      const box = await locator.first().boundingBox();
      expect(insideViewport(box, viewport), `${name} is not fully inside the first viewport ${JSON.stringify(box)}`).toBe(true);
    }
  });
}
