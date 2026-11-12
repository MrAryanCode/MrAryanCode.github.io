const pages = require('./quality/pages.json');
const median = { aggregationMethod: 'median-run' };
module.exports = {
  ci: {
    collect: {
      staticDistDir: './dist',
      url: pages.map((p) => `http://localhost${p.path}`),
      numberOfRuns: 3,
      settings: process.env.LHCI_NO_SANDBOX ? { chromeFlags: '--no-sandbox' } : {},
    },
    assert: {
      includePassedAssertions: true,
      assertions: {
        'categories:performance': ['error', { minScore: 0.9, ...median }],
        'categories:accessibility': ['error', { minScore: 1, ...median }],
        'largest-contentful-paint': ['error', { maxNumericValue: 2500, ...median }],
        'total-blocking-time': ['error', { maxNumericValue: 300, ...median }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1, ...median }],
      },
    },
    upload: { target: 'filesystem', outputDir: './reports/lhci' },
  },
};
