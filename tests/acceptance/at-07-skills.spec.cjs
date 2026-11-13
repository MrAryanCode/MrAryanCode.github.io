// AT-07: skills on two levels (design.md DS-05, D-027).
const { test, expect } = require('@playwright/test');
const { mockGithub } = require('./github-mock.cjs');
const { signed } = require('./copy.cjs');

const COPY_AT_STEP_3_SKILLS_SHIPPED_HEADING = 'Shipped in public';
const COPY_AT_STEP_3_SKILLS_ALSO_HEADING = 'Also worked with';
// The entries of COPY_AT_STEP_3_SKILLS_SHIPPED in src/content/skills.ts (by label): one list item per entry.
const COPY_AT_STEP_3_SKILLS_SHIPPED = ['certway', 'This site', 'GitHub profile'];

test('AT-07 skills have two levels after the Work section', async ({ page }) => {
  signed(COPY_AT_STEP_3_SKILLS_SHIPPED, 'COPY_AT_STEP_3_SKILLS_SHIPPED');
  await mockGithub(page);
  await page.goto('/');

  const skills = page.locator('section#skills');
  await expect(skills).toHaveCount(1);

  const order = await page.evaluate(() => {
    const work = document.querySelector('h2#work');
    const skillsSection = document.querySelector('section#skills');
    return work && skillsSection ? work.compareDocumentPosition(skillsSection) & Node.DOCUMENT_POSITION_FOLLOWING : 0;
  });
  expect(order, 'section#skills must come after the Work section').toBeGreaterThan(0);

  const headings = skills.locator('h3');
  await expect(headings).toHaveText([COPY_AT_STEP_3_SKILLS_SHIPPED_HEADING, COPY_AT_STEP_3_SKILLS_ALSO_HEADING]);

  const items = skills.locator('ul').first().locator('li');
  await expect(items).toHaveCount(COPY_AT_STEP_3_SKILLS_SHIPPED.length);
  for (const item of await items.all()) {
    const href = await item.locator('a').first().getAttribute('href');
    expect(href, 'each item of the first list links to a repository of MrAryanCode').toMatch(/^https:\/\/github\.com\/MrAryanCode\//);
  }
});
