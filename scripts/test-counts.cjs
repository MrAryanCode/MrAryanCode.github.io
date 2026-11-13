// Reads the two test reports written by the `test` job and prints one line of JSON with the counts.
// Usage: node scripts/test-counts.cjs <testsDir>
//   <testsDir>/unit.json        written by tools/test-summary-reporter.mjs (node:test)
//   <testsDir>/acceptance.json  written by the Playwright JSON reporter
// When GITHUB_OUTPUT is set it also appends "counts=<the line>" there (a step output).
// Throws on anything that could make a count wrong: a missing file, a Playwright error, a total of 0,
// or counts that do not add up.
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) throw new Error('usage: node scripts/test-counts.cjs <testsDir>');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const count = (label, n) => {
  if (!Number.isInteger(n) || n < 0) throw new Error(`${label} is not a count: ${n}`);
  return n;
};

// node:test: the reporter already mapped failed = fail + cancelled and skipped = skipped + todo.
const u = readJson('unit.json');
const unit = {
  passed: count('unit.passed', u.passed),
  failed: count('unit.failed', u.failed),
  skipped: count('unit.skipped', u.skipped),
  total: count('unit.total', u.total),
};
if (unit.total === 0) throw new Error('unit.json: no tests ran');
if (unit.passed + unit.failed + unit.skipped !== unit.total) {
  throw new Error(`unit.json: ${unit.passed}+${unit.failed}+${unit.skipped} != ${unit.total}`);
}

// Playwright: one count per test per project (three browsers = three times the tests).
const pw = readJson('acceptance.json');
if (Array.isArray(pw.errors) && pw.errors.length > 0) {
  throw new Error('acceptance.json: Playwright reported errors: ' + pw.errors.map((e) => e.message).join(' | '));
}
const s = pw.stats;
const acceptance = {
  passed: count('stats.expected', s.expected),
  failed: count('stats.unexpected', s.unexpected),
  flaky: count('stats.flaky', s.flaky),
  skipped: count('stats.skipped', s.skipped),
};
acceptance.total = acceptance.passed + acceptance.failed + acceptance.flaky + acceptance.skipped;
if (acceptance.total === 0) throw new Error('acceptance.json: no tests ran');
const walk = (suite) =>
  (suite.specs || []).reduce((n, spec) => n + spec.tests.length, 0) +
  (suite.suites || []).reduce((n, child) => n + walk(child), 0);
const listed = pw.suites.reduce((n, suite) => n + walk(suite), 0);
if (listed !== acceptance.total) throw new Error(`acceptance.json: stats add up to ${acceptance.total}, the test list holds ${listed}`);

const line = JSON.stringify({ unit, acceptance });
console.log(line);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `counts=${line}\n`);
