// AT-15: the tags of a shared-link card, over every route but the 404 page (t3-web-page-conventions, D-033).
// The expected values are the fields of the route table, src/routes.ts, read by a child process (Node strips its types).
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const { mockGithub } = require('./github-mock.cjs');
const { SITE } = require('./helpers.cjs');

const root = path.join(__dirname, '..', '..');

function readRoutes() {
  const script = 'import(process.argv[1]).then((m) => console.log(JSON.stringify(m.routes)));';
  const out = execFileSync(process.execPath, ['-e', script, pathToFileURL(path.join(root, 'src', 'routes.ts')).href], { encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop());
}

// The width and height of a PNG file, from its IHDR chunk. Returns null when the file is missing or is not a PNG.
function pngSize(file) {
  if (!fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  if (bytes.length < 24 || bytes.toString('latin1', 1, 4) !== 'PNG') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const routes = readRoutes().filter((r) => r.id !== 'notfound');

for (const route of routes) {
  test(`AT-15 link card tags on ${route.path}`, async ({ page }) => {
    await mockGithub(page);
    await page.goto(route.path);

    const meta = (name) => page.locator(`head meta[property="${name}"], head meta[name="${name}"]`);
    const canonical = `${SITE}${route.path}`;

    await expect(page).toHaveTitle(route.title);
    await expect(meta('og:title')).toHaveAttribute('content', route.title);
    await expect(meta('og:description')).toHaveAttribute('content', route.description);
    await expect(meta('og:url')).toHaveAttribute('content', canonical);
    await expect(meta('og:image')).toHaveAttribute('content', `${SITE}/og/${route.ogSlug}.png`);
    await expect(meta('og:image:alt')).toHaveAttribute('content', route.ogAlt);
    await expect(meta('twitter:card')).toHaveAttribute('content', 'summary_large_image');

    const size = pngSize(path.join(root, 'dist', 'og', `${route.ogSlug}.png`));
    expect(size, `dist/og/${route.ogSlug}.png must exist and be a PNG`).not.toBeNull();
    expect(size, `dist/og/${route.ogSlug}.png must be 1200x630`).toEqual({ width: 1200, height: 630 });
  });
}
