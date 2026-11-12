const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('fs');
const pages = require('../quality/pages.json');

fs.mkdirSync('reports/axe', { recursive: true });

for (const p of pages) {
  test(`axe ${p.file}`, async ({ page }) => {
    await page.goto(p.path);
    await page.waitForFunction(() => window.__hydrated === true);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    // one file per page, keyed by the dist-relative file name
    fs.writeFileSync(`reports/axe/${p.file.replace(/[\/]/g, '__')}.json`, JSON.stringify({ file: p.file, ...results }));
    expect(results.violations, `${p.file}: ${results.violations.map((v) => v.id).join(', ')}`).toEqual([]);
  });
}
