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

// Axe gate statistics from the Playwright JSON reporter of this job: one check per page.
const pw = readJson(path.join(reportsDir, 'playwright.json')).stats;
const axeChecks = { passed: pw.expected, failed: pw.unexpected, flaky: pw.flaky, skipped: pw.skipped };

// Unit and acceptance counts published by the test job (scripts/test-counts.cjs), saved as reports/tests/counts.json.
const counts = readJson(path.join(reportsDir, 'tests', 'counts.json'));
function checkCounts(group, keys) {
  const g = counts[group];
  if (!g) throw new Error(`reports/tests/counts.json has no ${group}`);
  for (const k of [...keys, 'total']) {
    if (!Number.isInteger(g[k]) || g[k] < 0) throw new Error(`counts.${group}.${k} is not a count: ${g[k]}`);
  }
  if (g.total === 0) throw new Error(`counts.${group}.total is 0`);
  if (keys.reduce((n, k) => n + g[k], 0) !== g.total) throw new Error(`counts.${group} does not add up to its total`);
  return Object.fromEntries([...keys, 'total'].map((k) => [k, g[k]]));
}
const unitTests = checkCounts('unit', ['passed', 'failed', 'skipped']);
const acceptanceTests = checkCounts('acceptance', ['passed', 'failed', 'flaky', 'skipped']);

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
  axeChecks,
  unitTests,
  acceptanceTests,
};
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
