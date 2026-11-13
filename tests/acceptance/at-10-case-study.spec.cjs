// AT-10: case-study permalinks (design.md DS-08, D-030). One statement is one `li[data-statement]` with one link.
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { mockGithub } = require('./github-mock.cjs');

const PERMALINK = /^https:\/\/github\.com\/MrAryanCode\/certway\/blob\/[0-9a-f]{40}\//;

// The number of statements in src/content/case-study.ts. The module's export names are not fixed by the plan, so this
// counts every plain object in the exports that has the string fields `section`, `statement` and `permalink` (the
// entry shape of the data row "Case-study statements" in P-04 and of DS-08).
// Node strips the types of the .ts file itself, so a child process can import it.
function countStatements() {
  const file = path.join(__dirname, '..', '..', 'src', 'content', 'case-study.ts');
  const script = `
    import(process.argv[1]).then((mod) => {
      let count = 0;
      const seen = new Set();
      const walk = (value) => {
        if (value === null || typeof value !== 'object' || seen.has(value)) return;
        seen.add(value);
        if (!Array.isArray(value) && ['section', 'statement', 'permalink'].every((key) => typeof value[key] === 'string')) count += 1;
        for (const child of Object.values(value)) walk(child);
      };
      walk({ ...mod });
      console.log(JSON.stringify({ count }));
    });`;
  try {
    const out = execFileSync(process.execPath, ['-e', script, pathToFileURL(file).href], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, count: JSON.parse(out.trim().split('\n').pop()).count, error: '' };
  } catch (error) {
    return { ok: false, count: 0, error: String(error.message).split('\n')[0] };
  }
}

test('AT-10 every statement has one commit-pinned permalink', async ({ page }) => {
  await mockGithub(page);
  await page.goto('/projects/certway/');

  const statements = page.locator('li[data-statement]');
  const total = await statements.count();
  expect(total, 'the case study holds at least one statement').toBeGreaterThan(0);

  for (const statement of await statements.all()) {
    const links = statement.locator('a');
    await expect(links).toHaveCount(1);
    await expect(links).toHaveAttribute('href', PERMALINK);
  }

  const source = countStatements();
  expect(source.ok, `src/content/case-study.ts could not be read: ${source.error}`).toBe(true);
  expect(source.count, 'src/content/case-study.ts holds no statement (objects with the string fields section, statement and permalink)').toBeGreaterThan(0);
  expect(total, 'the page must show one statement element per entry of src/content/case-study.ts').toBe(source.count);

  // No section heading without a statement under it.
  const emptyHeadings = await page.evaluate(() => {
    const empty = [];
    for (const h2 of document.querySelectorAll('main h2')) {
      const section = h2.closest('section');
      let has;
      if (section && section.querySelectorAll('h2').length === 1) {
        has = section.querySelector('[data-statement]') !== null;
      } else {
        has = false;
        for (let el = h2.nextElementSibling; el && el.tagName !== 'H2'; el = el.nextElementSibling) {
          if (el.matches('[data-statement]') || el.querySelector('[data-statement]')) has = true;
        }
      }
      if (!has) empty.push(h2.textContent.trim());
    }
    return empty;
  });
  expect(emptyHeadings, 'a heading has no statement under it').toEqual([]);
});
