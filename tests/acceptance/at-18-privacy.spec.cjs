// AT-18: the only third-party request is the live read, and there are no cookies (D-014, D-019, D-022).
const { test, expect } = require('@playwright/test');
const { mockGithub, REPO_PATH, RELEASE_PATH } = require('./github-mock.cjs');
const { ROUTES, hydrated } = require('./helpers.cjs');

const API = 'https://api.github.com';
const API_URLS = [`${API}${REPO_PATH}`, `${API}${RELEASE_PATH}`];

for (const route of ROUTES) {
  test(`AT-18 requests and cookies on ${route}`, async ({ page, context, baseURL }) => {
    const seen = await mockGithub(page);
    const origin = new URL(baseURL).origin;
    const requests = [];
    page.on('request', (req) => {
      if (/^(data|blob|about):/.test(req.url())) return;
      requests.push({ method: req.method(), url: req.url() });
    });

    await page.goto(route);
    await hydrated(page);
    await page.waitForTimeout(3000);

    const hasFacts = (await page.locator('[data-fact]').count()) > 0;
    if (route === '/') expect(hasFacts, 'the home page holds the [data-fact] elements, so the live read is asserted').toBe(true);
    const foreign = requests.filter((r) => new URL(r.url).origin !== origin);

    if (hasFacts) {
      // Exactly two GET requests to the two API URLs; an OPTIONS preflight, if reported, goes only to those URLs.
      const gets = foreign.filter((r) => r.method === 'GET').map((r) => r.url).sort();
      expect(gets, 'the only GET requests to another origin are the two live reads').toEqual([...API_URLS].sort());
      for (const r of foreign.filter((x) => x.method === 'OPTIONS')) {
        expect(API_URLS, `a preflight went to ${r.url}`).toContain(r.url);
      }
      expect(foreign.filter((r) => !['GET', 'OPTIONS'].includes(r.method)), 'no other method leaves the origin').toEqual([]);

      expect(seen.length, 'the mock saw the two live reads').toBeGreaterThanOrEqual(2);
      for (const r of seen.filter((x) => x.method === 'GET')) {
        expect(r.headers['x-github-api-version'], `X-GitHub-Api-Version on ${r.url}`).toBe('2026-03-10');
        expect(r.headers['authorization'], `no Authorization header on ${r.url}`).toBeUndefined();
        expect(r.headers['cookie'], `no Cookie header on ${r.url}`).toBeUndefined();
      }
      expect(await page.locator('time[data-as-of]').count(), 'exactly one time[data-as-of]').toBe(1);
    } else {
      expect(foreign, 'a page without live facts makes no request to another origin').toEqual([]);
    }

    expect(await context.cookies(), 'no cookie is set').toEqual([]);
  });
}
