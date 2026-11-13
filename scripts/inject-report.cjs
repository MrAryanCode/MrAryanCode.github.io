// Replaces the placeholders in the built report page with numbers from quality.json (design.md DS-09).
// Usage: node scripts/inject-report.cjs <quality.json> <report page html>
// Throws when the page lacks a placeholder this script fills, or still holds any `__NAME__` after the replacement,
// so a published report page never shows a placeholder or misses a number.
const fs = require('fs');
const path = require('path');

// Counts as plain integers, with a comma thousands separator from 1,000. No Intl: the output must not depend on the ICU data of the runner.
const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const score = (s) => String(Math.round(s * 100));
const ms = (n) => group(Math.round(n));

const [qFile, pageFile] = process.argv.slice(2);
const q = JSON.parse(fs.readFileSync(qFile, 'utf8'));
// One Lighthouse table row per entry of quality/pages.json, in that order: row N of the template is entry N - 1.
const pages = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'quality', 'pages.json'), 'utf8'));

const values = {
  __UNIT_PASSED__: group(q.unitTests.passed),
  __UNIT_TOTAL__: group(q.unitTests.total),
  __UNIT_SKIPPED__: group(q.unitTests.skipped),
  __ACCEPTANCE_PASSED__: group(q.acceptanceTests.passed),
  __ACCEPTANCE_TOTAL__: group(q.acceptanceTests.total),
  __ACCEPTANCE_FLAKY__: group(q.acceptanceTests.flaky),
  __ACCEPTANCE_SKIPPED__: group(q.acceptanceTests.skipped),
  __A11Y_PAGES__: group(q.accessibility.pages.length),
  __A11Y_VIOLATIONS__: group(q.accessibility.totalViolations),
  __PERF_ASSERTIONS_PASSED__: group(q.performance.assertions.passed),
  __PERF_ASSERTIONS_TOTAL__: group(q.performance.assertions.total),
  __HTML_DOCUMENTS__: group(q.html.documentsChecked),
  __HTML_ERRORS__: group(q.html.errors),
  __HTML_WARNINGS__: group(q.html.warnings),
  __LINKS_TOTAL__: group(q.links.total),
  __LINKS_UNIQUE__: group(q.links.unique),
  __LINKS_CHECKED__: group(q.links.checked),
  __LINKS_OK__: group(q.links.ok),
  __LINKS_BROKEN__: group(q.links.broken),
  __LINKS_TIMEOUTS__: group(q.links.timeouts),
  __LINKS_EXCLUDED__: group(q.links.excluded),
};
pages.forEach((entry, i) => {
  const lh = q.performance.pages.find((p) => p.file === entry.file);
  if (!lh) throw new Error('no Lighthouse result for ' + entry.file + ' in ' + qFile);
  const n = i + 1;
  values['__LH_' + n + '_PERFORMANCE__'] = score(lh.scores.performance);
  values['__LH_' + n + '_ACCESSIBILITY__'] = score(lh.scores.accessibility);
  values['__LH_' + n + '_LCP__'] = ms(lh.metrics.lcpMs);
  values['__LH_' + n + '_TBT__'] = ms(lh.metrics.tbtMs);
  values['__LH_' + n + '_CLS__'] = lh.metrics.cls.toFixed(3);
});

let html = fs.readFileSync(pageFile, 'utf8');
for (const [k, v] of Object.entries(values)) {
  if (!html.includes(k)) throw new Error('placeholder missing: ' + k);
  html = html.split(k).join(String(v));
}
if (/__[A-Z0-9_]+__/.test(html)) throw new Error('unreplaced placeholder left in ' + pageFile);
fs.writeFileSync(pageFile, html);
