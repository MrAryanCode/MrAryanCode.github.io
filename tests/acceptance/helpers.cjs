// Shared helpers of the acceptance specs. Not a spec file: Playwright only runs *.spec.cjs from here.
const { expect } = require('@playwright/test');
const pages = require('../../quality/pages.json');

// Every page of the site, as quality/pages.json lists it (the route table, P-04). The last entry is the 404 file.
const ROUTES = pages.map((p) => p.path);
const SITE = 'https://mraryancode.github.io';
const REPO_URL = 'https://github.com/MrAryanCode/certway';

// What the page shows when the live read returns the build fixtures (test/fixtures), and the live fixtures (test/fixtures/live).
const BUILD = { tag: 'v1.0.1', tagHref: `${REPO_URL}/releases/tag/v1.0.1`, license: 'MIT', stars: '3', pushedAt: '2026-11-07' };
const LIVE = { tag: 'v1.0.2', tagHref: `${REPO_URL}/releases/tag/v1.0.2`, license: 'MIT', stars: '5', pushedAt: '2026-11-09' };

const FACT_NAMES = ['tag', 'license', 'stars', 'pushedAt'];

// Waits for the client to finish hydrating. An assertion, so a page that never hydrates fails with this message.
async function hydrated(page) {
  await expect
    .poll(() => page.evaluate(() => window.__hydrated === true), { message: 'window.__hydrated never became true', timeout: 10000 })
    .toBe(true);
}

// Collects console errors and page errors. Entries about api.github.com are kept apart (P-06.4a): each browser
// words a failed live read differently, and AT-19 records them. `ignoreFailedResource` also drops the browser's own
// `Failed to load resource` line, which a 404 page always causes (AT-14).
function watchConsole(page, { ignoreFailedResource = false } = {}) {
  const errors = [];
  const apiEntries = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    const url = msg.location().url || '';
    if (url.startsWith('https://api.github.com/') || text.includes('https://api.github.com/')) {
      apiEntries.push(text);
      return;
    }
    if (ignoreFailedResource && /Failed to load resource/i.test(text)) return;
    errors.push(`${text} (${url})`);
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  return { errors, apiEntries, pageErrors };
}

// Reads the four facts, the as-of line and the live-failure note from the current document.
async function readFacts(page) {
  const data = await page.evaluate((names) => {
    const facts = {};
    for (const name of names) {
      const el = document.querySelector(`[data-fact="${name}"]`);
      facts[name] = el ? { text: (el.textContent || '').trim(), href: el.getAttribute('href') } : { text: null, href: null };
    }
    const time = document.querySelector('time[data-as-of]');
    return {
      facts,
      asOfCount: document.querySelectorAll('time[data-as-of]').length,
      asOf: time ? time.getAttribute('datetime') : null,
      asOfSentence: time && time.parentElement ? (time.parentElement.textContent || '').replace(/\s+/g, ' ').trim() : null,
    };
  }, FACT_NAMES);
  data.noteVisible = await page.locator('p[data-live-fail]').first().isVisible();
  return data;
}

// A new context. A context made with browser.newContext() does not inherit the `use` options of the config.
function newContext(browser, baseURL, options = {}) {
  return browser.newContext({ baseURL, ...options });
}

// What the HTML says before any script runs: a context with JavaScript off opens `path`.
async function prerendered(browser, baseURL, path = '/', options = {}) {
  const context = await newContext(browser, baseURL, { javaScriptEnabled: false, ...options });
  try {
    const page = await context.newPage();
    await page.goto(path);
    return await readFacts(page);
  } finally {
    await context.close();
  }
}

module.exports = { ROUTES, SITE, REPO_URL, BUILD, LIVE, FACT_NAMES, hydrated, watchConsole, readFacts, newContext, prerendered };
