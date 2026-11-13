// Start-up of the acceptance run, used as the webServer command of playwright.acceptance.config.cjs.
// 1. the fixture GitHub API (tools/fixture-api.mjs) serves the saved certway fixtures;
// 2. a production build reads those fixtures into dist/ (the same build the deploy makes);
// 3. test/fixtures/quality.json is injected into dist/report/index.html, so the report page has numbers;
// 4. tools/pages-server.mjs serves dist/ with the GitHub Pages path rules.
// Everything runs in this one process (the two tools read their arguments from process.argv when imported),
// so stopping this process stops all of it. The build is a child process and runs asynchronously,
// because the fixture API in this process must answer the build's requests meanwhile.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const API_PORT = Number(process.env.ACCEPTANCE_API_PORT || 4611);
const SITE_PORT = Number(process.env.ACCEPTANCE_SITE_PORT || 4612);

// The environment the report page's links are built from (AT-09). It matches test/fixtures/quality.json.
const env = {
  ...process.env,
  NODE_ENV: 'production',
  SITE_GITHUB_API_URL: `http://127.0.0.1:${API_PORT}`,
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_REPOSITORY: 'MrAryanCode/MrAryanCode.github.io',
  GITHUB_RUN_ID: '1',
  GITHUB_SHA: 'a'.repeat(40),
};
delete env.SITE_GITHUB_TOKEN;

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`node ${args.join(' ')} exited ${code}`))));
  });
}

process.argv = [process.argv[0], process.argv[1], join(root, 'test', 'fixtures'), String(API_PORT)];
await import('../../tools/fixture-api.mjs');

await run([join(root, 'scripts', 'build.mjs')]);
await run([join(root, 'scripts', 'inject-report.cjs'), join(root, 'test', 'fixtures', 'quality.json'), join(root, 'dist', 'report', 'index.html')]);

process.argv = [process.argv[0], process.argv[1], join(root, 'dist'), String(SITE_PORT)];
await import('../../tools/pages-server.mjs');
