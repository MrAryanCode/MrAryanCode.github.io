// AT-08: how Aryan works (design.md DS-06, D-028). Availability and time zone are asserted by AT-03, not here.
const { test, expect } = require('@playwright/test');
const { mockGithub } = require('./github-mock.cjs');
const { signed } = require('./copy.cjs');

// The signed copy of src/content/working.ts.
const COPY_AT_STEP_3_WORKING_HEADING = 'Working with me';
const COPY_AT_STEP_3_WORKING_START =
  'Telegram is the fastest way to reach me. Send the role and what your team is building.';

test('AT-08 the working section follows the skills section', async ({ page }) => {
  signed(COPY_AT_STEP_3_WORKING_HEADING, 'COPY_AT_STEP_3_WORKING_HEADING');
  signed(COPY_AT_STEP_3_WORKING_START, 'COPY_AT_STEP_3_WORKING_START');
  await mockGithub(page);
  await page.goto('/');

  const working = page.locator('section#working');
  await expect(working).toHaveCount(1);

  const order = await page.evaluate(() => {
    const skills = document.querySelector('section#skills');
    const workingSection = document.querySelector('section#working');
    return skills && workingSection ? skills.compareDocumentPosition(workingSection) & Node.DOCUMENT_POSITION_FOLLOWING : 0;
  });
  expect(order, 'section#working must come after section#skills').toBeGreaterThan(0);

  await expect(working.locator('h2')).toHaveText(COPY_AT_STEP_3_WORKING_HEADING);
  await expect(working).toContainText(COPY_AT_STEP_3_WORKING_START);
  await expect(working.locator('a[href="https://t.me/aryan_61_04"]')).not.toHaveCount(0);
  await expect(working.locator('a[href="mailto:mraryanmiri@gmail.com"]')).not.toHaveCount(0);
});
