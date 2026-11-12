// Browser checks (headless Chromium): text with JavaScript off, clean hydration with it on, worker, WebGPU fallbacks.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { BASE, buildAndServe, stopAll } from "./helpers.mjs";

let browser;
before(async () => {
  await buildAndServe();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
});
after(async () => {
  await browser?.close();
  await stopAll();
});

async function open(path, { js = true, init = [], route } = {}) {
  const ctx = await browser.newContext({ javaScriptEnabled: js });
  const requests = [];
  const logs = [];
  ctx.on("request", (r) => requests.push(new URL(r.url()).pathname + (new URL(r.url()).port === "4611" ? " [GITHUB-FIXTURE]" : "")));
  const page = await ctx.newPage();
  page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  for (const s of init) await page.addInitScript(s);
  if (route) await route(page);
  const res = await page.goto(BASE + path, { waitUntil: "load" });
  return { ctx, page, res, requests, logs };
}

test("JavaScript off: every route reads", async () => {
  const want = { "/": ["Aryan Miri", "v1.0.1", "MIT"], "/projects/certway/": ["certway case study", "v1.0.1", "Facts read from GitHub at"], "/report/": ["Engineering report", "reads with JavaScript disabled"], "/nope/x": ["Page not found"] };
  for (const [path, texts] of Object.entries(want)) {
    const { ctx, page, res } = await open(path, { js: false });
    assert.equal(res.status(), path === "/nope/x" ? 404 : 200, path);
    const body = await page.locator("body").innerText();
    for (const t of texts) assert.ok(body.includes(t), `${path} lacks "${t}"`);
    await ctx.close();
  }
});

test("worker runs on the client and its chunk is fetched", async () => {
  const { ctx, page, requests } = await open("/projects/certway/");
  await page.waitForFunction(() => /Primes below 2,000,000: 148933/.test(document.querySelector("[data-worker-result]").textContent));
  assert.ok(requests.some((r) => /\/assets\/checksum\.worker-.*\.js$/.test(r)));
  await ctx.close();
});

const stubAdapter = () => {
  Object.defineProperty(navigator, "gpu", { value: { requestAdapter: async () => ({ requestDevice: async () => ({}) }) }, configurable: true });
  HTMLCanvasElement.prototype.getContext = () => ({});
};
const gpuCases = [
  { name: "no navigator.gpu", init: [() => Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true })], text: /No WebGPU/, chunk: false },
  { name: "adapter is null", init: [() => Object.defineProperty(navigator, "gpu", { value: { requestAdapter: async () => null }, configurable: true })], text: /no adapter/, chunk: false },
  { name: "requestAdapter rejects", init: [() => Object.defineProperty(navigator, "gpu", { value: { requestAdapter: async () => { throw new Error("boom"); } }, configurable: true })], text: /failed \(boom\)/, chunk: false },
  { name: "chunk import fails", init: [stubAdapter], route: (p) => p.route(/\/assets\/layer-.*\.js$/, (r) => r.abort()), text: /layer failed/, chunk: true },
  { name: "all checks pass", init: [stubAdapter], text: /WebGPU layer running/, chunk: true },
];
for (const c of gpuCases) {
  test(`GPU layer: ${c.name}`, async () => {
    const { ctx, page, requests } = await open("/projects/certway/", { init: c.init, route: c.route });
    await page.waitForFunction((src) => new RegExp(src).test(document.querySelector("[data-gpu-status]").textContent), c.text.source);
    assert.equal(requests.some((r) => /\/assets\/layer-.*\.js$/.test(r)), c.chunk, `layer chunk requested: ${requests.join(" ")}`);
    await ctx.close();
  });
}
