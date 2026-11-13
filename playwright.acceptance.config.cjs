// @ts-check
// The acceptance tests of plan P-10, run in the three bundled browsers by `npm run test:acceptance`.
// Run it from the repository root: the report path below is relative to the working directory.
const { defineConfig, devices } = require('@playwright/test');

// ACCEPTANCE_SITE_PORT and ACCEPTANCE_API_PORT exist so two runs on one machine do not collide; CI uses the defaults.
const SITE_PORT = Number(process.env.ACCEPTANCE_SITE_PORT || 4612);

module.exports = defineConfig({
  // Resolved against this file's folder (playwright-config-flag-cjs).
  testDir: './tests/acceptance',
  // retries: 0 (P-07 C-6): a test that fails once ends `unexpected`, never `flaky`, so no retry can hide it.
  retries: 0,
  // A committed test.only would silently skip the rest of the suite.
  forbidOnly: true,
  // `list` keeps the console output, `json` feeds scripts/test-counts.cjs.
  // No PLAYWRIGHT_JSON_* environment variable may be set anywhere: it would change this reporter silently.
  reporter: [['list'], ['json', { outputFile: 'reports/tests/acceptance.json' }]],
  use: {
    baseURL: `http://127.0.0.1:${SITE_PORT}`,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  // One command: fixture API, production build, report injection, then the Pages-rules server on dist/.
  // The build takes a while on a cold runner, so the start-up limit is generous.
  webServer: {
    command: 'node tests/acceptance/serve.mjs',
    url: `http://127.0.0.1:${SITE_PORT}/`,
    reuseExistingServer: false,
    timeout: 240000,
  },
});
