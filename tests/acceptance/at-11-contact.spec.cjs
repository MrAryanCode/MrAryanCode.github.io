// AT-11: the contact links are on every page (D-023), and the links that must not exist are absent.
const { test, expect } = require('@playwright/test');
const { mockGithub } = require('./github-mock.cjs');
const { ROUTES } = require('./helpers.cjs');

const REQUIRED = [
  'mailto:mraryanmiri@gmail.com',
  'https://t.me/aryan_61_04',
  'https://github.com/MrAryanCode',
  'https://t.me/MrAryanCode',
];

for (const route of ROUTES) {
  test(`AT-11 contact links on ${route}`, async ({ page }) => {
    await mockGithub(page);
    await page.goto(route);

    for (const href of REQUIRED) {
      expect(await page.locator(`a[href="${href}"]`).count(), `no link to ${href}`).toBeGreaterThan(0);
    }

    const hrefs = await page.locator('a[href]').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    const cv = hrefs.filter((href) => {
      let path;
      try {
        path = new URL(href, 'https://mraryancode.github.io/').pathname;
      } catch {
        return false;
      }
      return /cv/i.test(path);
    });
    expect(cv, 'no link may point at a CV').toEqual([]);

    const dotGithub = hrefs.filter((href) => /github\.com\/MrAryanCode\/\.github/i.test(href));
    expect(dotGithub, 'no link to the .github repository until T4').toEqual([]);
  });
}
