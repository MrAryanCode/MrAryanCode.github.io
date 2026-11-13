// Test harness: fixture GitHub API + production build + Pages-like server, started once per test file.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

export const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const API_PORT = 4611;
export const SITE_PORT = 4612;
export const BASE = `http://127.0.0.1:${SITE_PORT}`;
// The test-hook variant (scripts/build.mjs --mode test) is served on its own port, so it never shadows dist/.
export const TEST_SITE_PORT = 4613;
export const TEST_BASE = `http://127.0.0.1:${TEST_SITE_PORT}`;
export const dist = (...p) => join(root, "dist", ...p);
export const distTest = (...p) => join(root, "dist-test", ...p);
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
 * `mode: "test"` runs scripts/build.mjs --mode test (the seek-hook variant, dist-test/) and serves dist-test/ on
 * TEST_SITE_PORT; the default "production" builds and serves dist/ as before. Returns the base URL of the site it serves.
 */
export async function buildAndServe({ development = false, githubSha = null, fixturesDir = join(root, "test", "fixtures"), mode = "production" } = {}) {
  const isTest = mode === "test";
  const out = isTest ? distTest : dist, port = isTest ? TEST_SITE_PORT : SITE_PORT;
  start("fixture-api.mjs", [fixturesDir, String(API_PORT)]);
  await sleep(500);
  const env = { ...process.env, SITE_GITHUB_API_URL: `http://127.0.0.1:${API_PORT}`, NODE_ENV: development ? "development" : "production" };
  if (githubSha === null) delete env.GITHUB_SHA;
  else env.GITHUB_SHA = githubSha;
  const r = spawnSync(process.execPath, [join(root, "scripts", "build.mjs"), ...(isTest ? ["--mode", "test"] : [])], { cwd: root, env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`build failed (${r.status}): ${r.stdout}\n${r.stderr}`);
  if (!existsSync(out("index.html"))) throw new Error(`${isTest ? "dist-test" : "dist"}/index.html missing after a successful build`);
  start("pages-server.mjs", [out(), String(port)]);
  await sleep(500);
  return isTest ? TEST_BASE : BASE;
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

/**
 * Launches full Chromium (channel "chromium", new headless mode), the build that gives WebGPU an adapter and draws WebGL2
 * through ANGLE on a hardware GPU. `webgpu` adds --enable-unsafe-webgpu; without it the build has no WebGPU adapter at the
 * flag's default and tier 3 draws WebGL2. CHROMIUM_FULL_PATH, when set, names the executable (a local machine whose installed
 * Chromium revision is not the one Playwright pins); CI leaves it unset.
 */
export const launchFullChromium = ({ webgpu = false } = {}) =>
  chromium.launch({
    headless: true,
    channel: "chromium",
    executablePath: process.env.CHROMIUM_FULL_PATH || undefined,
    args: webgpu ? ["--enable-unsafe-webgpu"] : [],
  });

let softwareSite = null;
/**
 * Where a test that needs tier 3 drawing opens its pages. Tier 3 declines on a software renderer (D-063: the unmasked WebGL2
 * renderer says SwiftShader), so on CI's runner the production build stays on tier 2. There this serves the test build
 * (dist-test/, built once per process) and returns the script that switches the decline off in it; on a GPU it returns the
 * production site and an empty script. `init` must be added to every context the test opens. Returns { base, init, software }.
 */
export async function tier3Site(browser) {
  const page = await browser.newPage();
  const renderer = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
  });
  await page.close();
  if (!renderer.includes("SwiftShader")) return { base: BASE, init: "", software: false };
  softwareSite ??= buildAndServe({ mode: "test" });
  await softwareSite;
  return { base: TEST_BASE, init: "globalThis.T3_ALLOW_SOFTWARE = true;", software: true };
}
