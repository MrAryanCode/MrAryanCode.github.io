// Reads the raw gate outputs and writes one quality.json for the report page.
// Usage: node scripts/collect-quality.cjs <reportsDir> <distDir> <outFile>
const fs = require('fs');
const path = require('path');

const [reportsDir, distDir, outFile] = process.argv.slice(2);
const pages = require('../quality/pages.json'); // [{ file, path }]
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const byPath = new Map(pages.map((p) => [p.path, p.file]));

function walkHtml(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walkHtml(p);
    return /\.html?$/.test(e.name) ? [p] : [];
  });
}

// Accessibility: one axe JSON per page, written by tests/a11y.spec.cjs (reports/axe/*.json)
const axePages = pages.map((p) => {
  const r = readJson(path.join(reportsDir, 'axe', p.file.replace(/[\/]/g, '__') + '.json'));
  return {
    file: p.file,
    violations: r.violations.length,
    violationNodes: r.violations.reduce((n, v) => n + v.nodes.length, 0),
    rulesPassed: r.passes.length,
    rulesNeedingReview: r.incomplete.length,
    byImpact: r.violations.reduce((o, v) => ((o[v.impact] = (o[v.impact] || 0) + 1), o), {}),
    engine: `${r.testEngine.name} ${r.testEngine.version}`,
  };
});

// Performance: LHCI filesystem output; the representative (median) run per URL,
// which is the run the median-run assertions judged.
const manifest = readJson(path.join(reportsDir, 'lhci', 'manifest.json'));
const perfPages = manifest
  .filter((m) => m.isRepresentativeRun)
  .map((m) => {
    const lhr = readJson(m.jsonPath);
    const a = lhr.audits;
    return {
      file: byPath.get(new URL(lhr.finalDisplayedUrl).pathname),
      lighthouseVersion: lhr.lighthouseVersion,
      formFactor: lhr.configSettings.formFactor,
      throttlingMethod: lhr.configSettings.throttlingMethod,
      scores: Object.fromEntries(Object.entries(lhr.categories).map(([k, v]) => [k, v.score])),
      metrics: {
        fcpMs: a['first-contentful-paint'].numericValue,
        lcpMs: a['largest-contentful-paint'].numericValue,
        tbtMs: a['total-blocking-time'].numericValue,
        cls: a['cumulative-layout-shift'].numericValue,
        speedIndexMs: a['speed-index'].numericValue,
      },
    };
  });
const lhciAssertions = fs.existsSync('.lighthouseci/assertion-results.json') ? readJson('.lighthouseci/assertion-results.json') : [];

// Links: lychee JSON summary
const ly = readJson(path.join(reportsDir, 'lychee', 'out.json'));
const links = {
  total: ly.total,
  unique: ly.unique,
  checked: ly.successful + ly.errors + ly.timeouts + ly.unknown,
  ok: ly.successful,
  broken: ly.errors,
  timeouts: ly.timeouts,
  excluded: ly.excludes,
};

// HTML validity: vnu JSON has no document count, so count the files here
const vnu = readJson(path.join(reportsDir, 'vnu.json'));
const html = {
  documentsChecked: walkHtml(distDir).length,
  errors: vnu.messages.filter((m) => m.type === 'error').length,
  warnings: vnu.messages.filter((m) => m.type === 'info' && m.subType === 'warning').length,
  checker: 'Nu Html Checker ' + vnu.version,
};

// Test counts from the Playwright JSON reporter
const pw = readJson(path.join(reportsDir, 'playwright.json')).stats;
const tests = { passed: pw.expected, failed: pw.unexpected, flaky: pw.flaky, skipped: pw.skipped };

const out = {
  generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA || null,
  runUrl: process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null,
  accessibility: { pages: axePages, totalViolations: axePages.reduce((n, p) => n + p.violations, 0) },
  performance: {
    pages: perfPages,
    assertions: { total: lhciAssertions.length, passed: lhciAssertions.filter((x) => x.passed).length },
  },
  links,
  html,
  tests,
};
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
