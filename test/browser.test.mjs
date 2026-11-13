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

// Underline draw (D-051, P-12): the resting underline draws to full width in 0.42 s on hover or focus and retracts in 0.42 s;
// it is instant under reduced motion and under html[data-motion="paused"]; and the step-down level does not change it.
async function underlineRuns(page, how) {
  const link = page.locator('a[href="/report/"]').first();
  // Chromium does not start a transition on the first link hover of a page that runs script (pages without script do),
  // so hover once and wait for the line to settle before measuring.
  await link.hover();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(600);
  if (how === "focus") {
    for (let i = 0; i < 40 && !(await link.evaluate((el) => el.matches(":focus-visible"))); i++) await page.keyboard.press("Tab");
  } else {
    await link.hover();
  }
  const draw = await link.evaluate((el) => ({
    ms: el.getAnimations().filter((a) => a.transitionProperty === "background-size").map((a) => a.effect.getTiming().duration),
    from: getComputedStyle(el).backgroundPositionX.split(",")[0].trim(),
  }));
  let retract = null;
  if (how === "hover") {
    // Let the draw finish: leaving mid-draw reverses the transition with a shortened duration.
    await page.waitForTimeout(600);
    await page.mouse.move(0, 0);
    retract = await link.evaluate((el) => ({
      ms: el.getAnimations().filter((a) => a.transitionProperty === "background-size").map((a) => a.effect.getTiming().duration),
      from: getComputedStyle(el).backgroundPositionX.split(",")[0].trim(),
    }));
  }
  return { draw, retract };
}

for (const c of [
  { name: "present", ctx: {}, init: [], ms: [420] },
  { name: "reduced motion", ctx: { reducedMotion: "reduce" }, init: [], ms: [] },
  { name: "paused", ctx: {}, init: [() => document.addEventListener("DOMContentLoaded", () => { document.documentElement.dataset.motion = "paused"; })], ms: [] },
  { name: "motion-level-pin 7", ctx: {}, init: [() => sessionStorage.setItem("motion-level-pin", "7")], ms: [420] },
]) {
  test(`underline draw: ${c.name}`, async () => {
    const ctx = await browser.newContext(c.ctx);
    const page = await ctx.newPage();
    for (const s of c.init) await page.addInitScript(s);
    await page.goto(BASE + "/", { waitUntil: "load" });
    for (const how of ["hover", "focus"]) {
      const { draw, retract } = await underlineRuns(page, how);
      assert.deepEqual(draw.ms, c.ms, `${how}: transition durations in ms`);
      assert.match(draw.from, /^0(px|%)$/, `${how}: the drawn line is anchored left while drawing`);
      if (retract) {
        assert.deepEqual(retract.ms, c.ms, "leave: transition durations in ms");
        assert.equal(retract.from, "100%", "leave: the drawn line is anchored right while it retracts");
      }
    }
    await ctx.close();
  });
}
