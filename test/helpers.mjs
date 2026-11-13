// Test harness: fixture GitHub API + production build + Pages-like server, started once per test file.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

export const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const API_PORT = 4611;
export const SITE_PORT = 4612;
export const BASE = `http://127.0.0.1:${SITE_PORT}`;
export const dist = (...p) => join(root, "dist", ...p);
export const html = (file) => readFileSync(dist(file), "utf8");

/** A full 40-character commit, for the builds that carry a build stamp. */
export const TEST_SHA = "0123456789abcdef0123456789abcdef01234567";

let children = [];
const start = (script, args) => {
  const child = spawn(process.execPath, [join(root, "tools", script), ...args], { cwd: root, stdio: "ignore" });
  children.push(child);
  return child;
};

/**
 * Build against the fixture API, then serve dist/ with the Pages-like server.
 * `development: true` builds with NODE_ENV=development, which selects Solid's development runtime:
 * only that runtime reports hydration mismatches (the production runtime hydrates a mismatch silently).
 * `githubSha` is set or deleted in the build's environment explicitly, because GITHUB_SHA is always set on
 * Actions: a string builds with a build stamp, null (the default) builds like a local build, with none.
 * `fixturesDir` is the directory the fixture API serves; it defaults to test/fixtures.
 */
export async function buildAndServe({ development = false, githubSha = null, fixturesDir = join(root, "test", "fixtures") } = {}) {
  start("fixture-api.mjs", [fixturesDir, String(API_PORT)]);
  await sleep(500);
  const env = { ...process.env, SITE_GITHUB_API_URL: `http://127.0.0.1:${API_PORT}`, NODE_ENV: development ? "development" : "production" };
  if (githubSha === null) delete env.GITHUB_SHA;
  else env.GITHUB_SHA = githubSha;
  const r = spawnSync(process.execPath, [join(root, "scripts", "build.mjs")], { cwd: root, env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`build failed (${r.status}): ${r.stdout}\n${r.stderr}`);
  if (!existsSync(dist("index.html"))) throw new Error("dist/index.html missing after a successful build");
  start("pages-server.mjs", [dist(), String(SITE_PORT)]);
  await sleep(500);
}

/** Stops the helper processes and waits until they have exited, so a later buildAndServe can reuse the ports. */
export async function stopAll() {
  const running = children;
  children = [];
  await Promise.all(running.map((c) => new Promise((resolve) => {
    if (c.exitCode !== null || c.signalCode !== null) return resolve();
    c.once("exit", resolve);
    c.kill();
  })));
}
