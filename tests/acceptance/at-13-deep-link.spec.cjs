// AT-13: a deep link to a detail page shows the header: the identity line, the contact action and a link to `/`.
const { test, expect } = require('@playwright/test');
const { mockGithub } = require('./github-mock.cjs');

for (const route of ['/projects/certway/', '/report/']) {
  test(`AT-13 header on ${route}`, async ({ page }) => {
    await mockGithub(page);
    await page.goto(route);

    const header = page.locator('header');
    const identity = header.locator('a[href="/"]');
    await expect(identity.first()).toBeVisible();
    await expect(identity.first()).toContainText('Aryan Miri');
    await expect(identity.first()).toContainText('MrAryanCode');

    const contact = header.getByRole('link', { name: 'Message me' });
    await expect(contact).toBeVisible();
    await expect(contact).toHaveAttribute('href', 'https://t.me/aryan_61_04');
  });
}
