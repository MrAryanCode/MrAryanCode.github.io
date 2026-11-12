// @ts-check
const { defineConfig } = require('@playwright/test');

const python = process.platform === 'win32' ? 'python' : 'python3';

module.exports = defineConfig({
  testDir: './tests',
  // A testMatch string matches anywhere below testDir, so the acceptance specs are excluded by path:
  // plain `playwright test` (the axe gate) must never run them.
  testIgnore: ['**/tests/acceptance/**'],
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'reports/playwright.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    // On the GitHub-hosted Ubuntu runner Google Chrome is preinstalled, so
    // PW_CHANNEL=chrome avoids the browser download. Locally CHROME_PATH may point at any Chrome.
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
  },
  webServer: {
    command: `${python} -m http.server 4173 --bind 127.0.0.1 --directory dist`,
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
