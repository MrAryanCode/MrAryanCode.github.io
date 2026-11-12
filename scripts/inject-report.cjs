// Replaces the placeholders in the built report page with numbers from quality.json.
// Usage: node scripts/inject-report.cjs <quality.json> <report page html>
const fs = require('fs');
const [qFile, pageFile] = process.argv.slice(2);
const q = JSON.parse(fs.readFileSync(qFile, 'utf8'));
const values = {
  __A11Y_VIOLATIONS__: q.accessibility.totalViolations,
  __LINKS_CHECKED__: q.links.checked,
  __LINKS_BROKEN__: q.links.broken,
};
let html = fs.readFileSync(pageFile, 'utf8');
for (const [k, v] of Object.entries(values)) {
  if (!html.includes(k)) throw new Error('placeholder missing: ' + k);
  html = html.split(k).join(String(v));
}
if (/__[A-Z0-9_]+__/.test(html)) throw new Error('unreplaced placeholder left in ' + pageFile);
fs.writeFileSync(pageFile, html);
