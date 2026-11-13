// The enhancement loader and the pause control (T-019; P-06.5, D-023, D-051), in headless Chromium on the production build.
// The tier modules are stubs that decline, so these checks see the loader, the button and the page, not the tiers.
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

async function open(path, { init = [], route } = {}) {
  const ctx = await browser.newContext();
  const requests = [];
  const logs = [];
  ctx.on("request", (r) => requests.push(new URL(r.url()).pathname));
  const page = await ctx.newPage();
  page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  for (const s of init) await page.addInitScript(s);
  if (route) await route(page);
  await page.goto(BASE + path, { waitUntil: "load" });
  await page.waitForFunction(() => window.__hydrated === true);
  return { ctx, page, requests, logs };
}

// With tier 2 started, the loader probes for WebGPU (src/enhance.ts) and a headless browser without a GPU logs this
// warning of its own for the probe. It is the browser's message, not the page's, so the log checks below set it aside.
const logged = (logs) => logs.filter((l) => l !== "warning: No available adapters.");
const tier1Requests = (requests) => requests.filter((r) => /\/assets\/tier1-.*\.js$/.test(r));
const state = (page) => page.evaluate(() => {
  const button = document.querySelector("button.pause");
  return {
    label: button?.textContent ?? null,
    pressed: button?.getAttribute("aria-pressed") ?? null,
    motion: document.documentElement.dataset.motion ?? null,
    tier: document.documentElement.dataset.tier ?? null,
    stored: (() => { try { return sessionStorage.getItem("motion-paused"); } catch { return "blocked"; } })(),
  };
});

// GPU stub cases (moved from test/browser.test.mjs): the page stays readable and the tier stays below 3.
// The tier modules decline, so the loader never reaches tier 3; the probe layer's own status is checked as before.
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
    assert.ok((await page.locator("main h1").innerText()).length > 0, "the page is readable");
    await page.waitForFunction(() => document.documentElement.dataset.tier);
    const { tier } = await state(page);
    assert.ok(Number(tier) < 3, `dataset.tier is ${tier}`);
    await ctx.close();
  });
}

test("the loader starts tier 1 and creates the pause button before Message me", async () => {
  const { ctx, page, requests, logs } = await open("/", {
    init: [() => document.addEventListener("DOMContentLoaded", () => {
      const slot = document.querySelector(".pause-slot");
      window.__slotAtParse = { empty: !slot.firstChild, ...slot.getBoundingClientRect().toJSON() };
    })],
  });
  await page.waitForSelector("button.pause");
  await page.waitForFunction(() => document.documentElement.dataset.tier === "2");
  assert.equal(tier1Requests(requests).length, 1, `tier 1 requested: ${requests.join(" ")}`);
  assert.deepEqual(await state(page), { label: "Pause motion", pressed: "false", motion: null, tier: "2", stored: null });
  const order = await page.evaluate(() => [...document.querySelectorAll("header a, header button")].map((el) => el.textContent.trim()));
  assert.deepEqual(order.slice(-2), ["Pause motion", "Message me"]);
  assert.deepEqual(logged(logs), []);
  // The slot holds the button's space from first paint, so the button's arrival moves nothing (DS-01).
  const [parsed, box] = await page.evaluate(() => [window.__slotAtParse, document.querySelector("button.pause").getBoundingClientRect().toJSON()]);
  assert.ok(parsed.empty, "the slot was empty at parse time");
  assert.ok(Math.abs(parsed.width - box.width) <= 1 && Math.abs(parsed.height - box.height) <= 1, `slot ${parsed.width}x${parsed.height}, button ${box.width}x${box.height}`);
  await ctx.close();
});

test("Pause toggles the label and aria-pressed, aborts the signal once and writes the key; Play removes the key and restarts the loader", async () => {
  const { ctx, page } = await open("/", {
    init: [() => {
      window.__aborts = 0;
      window.__tierWrites = 0;
      const abort = AbortController.prototype.abort;
      AbortController.prototype.abort = function (...args) { window.__aborts += 1; return abort.apply(this, args); };
      new MutationObserver(() => { window.__tierWrites += 1; })
        .observe(document, { attributes: true, subtree: true, attributeFilter: ["data-tier"] });
    }],
  });
  const button = page.locator("button.pause");
  await button.waitFor();
  await page.waitForFunction(() => window.__tierWrites >= 1);
  const abortsBefore = await page.evaluate(() => window.__aborts);
  await button.click();
  assert.deepEqual(await state(page), { label: "Play motion", pressed: "true", motion: "paused", tier: "0", stored: "1" });
  assert.equal(await page.evaluate(() => window.__aborts), abortsBefore + 1, "Pause aborts the signal once");

  const writesBefore = await page.evaluate(() => window.__tierWrites);
  await button.click();
  const { tier: _playTier, ...played } = await state(page);
  assert.deepEqual(played, { label: "Pause motion", pressed: "false", motion: null, stored: null });
  await page.waitForFunction((n) => window.__tierWrites > n, writesBefore);
  await page.waitForFunction(() => document.documentElement.dataset.tier === "2");
  assert.equal((await state(page)).tier, "2", "Play starts tier 2");
  assert.equal(await page.evaluate(() => window.__aborts), abortsBefore + 1, "Play aborts nothing");
  await ctx.close();
});

test("motion-paused = 1 starts no tier and creates the button as Play motion; Play removes the key", async () => {
  const { ctx, page, requests, logs } = await open("/", { init: [() => sessionStorage.setItem("motion-paused", "1")] });
  await page.waitForSelector("button.pause");
  await page.waitForTimeout(500);
  assert.deepEqual(tier1Requests(requests), [], `a tier started: ${requests.join(" ")}`);
  assert.deepEqual(await state(page), { label: "Play motion", pressed: "true", motion: "paused", tier: "0", stored: "1" });
  assert.deepEqual(logs, []);
  // Play on such a page starts the loader from tier 1.
  await page.locator("button.pause").click();
  const { tier: _playTier, ...played } = await state(page);
  assert.deepEqual(played, { label: "Pause motion", pressed: "false", motion: null, stored: null });
  await page.waitForFunction(() => document.documentElement.dataset.tier === "2");
  assert.equal((await state(page)).tier, "2", "Play starts tier 2");
  await page.waitForTimeout(500);
  assert.equal(tier1Requests(requests).length, 1, "Play requested tier 1");
  await ctx.close();
});

test("blocked sessionStorage: the page reads, the button works for the page view, nothing is logged", async () => {
  const { ctx, page, logs } = await open("/", {
    init: [() => Object.defineProperty(window, "sessionStorage", { configurable: true, get() { throw new DOMException("denied", "SecurityError"); } })],
  });
  const button = page.locator("button.pause");
  await button.waitFor();
  assert.ok((await page.locator("main h1").innerText()).length > 0, "the page is readable");
  assert.equal(await button.textContent(), "Pause motion");
  await button.click();
  assert.deepEqual(await state(page), { label: "Play motion", pressed: "true", motion: "paused", tier: "0", stored: "blocked" });
  await button.click();
  const { tier: _playTier, ...played } = await state(page);
  assert.deepEqual(played, { label: "Pause motion", pressed: "false", motion: null, stored: "blocked" });
  await page.waitForFunction(() => document.documentElement.dataset.tier === "2");
  assert.equal((await state(page)).tier, "2", "Play starts tier 2");
  assert.deepEqual(logged(logs), [], "no console message and no page error");
  await ctx.close();
});

test("the icon morphs by WAAPI on two clip-path polygons in 0.36 s, on Pause and on Play", async () => {
  const { ctx, page } = await open("/");
  const button = page.locator("button.pause");
  await button.waitFor();
  const morph = () => page.evaluate(() => document.querySelector("button.pause").getAnimations({ subtree: true })
    .filter((a) => a.playState === "running")
    .map((a) => ({
      ms: a.effect.getTiming().duration,
      easing: a.effect.getTiming().easing,
      props: Object.keys(a.effect.getKeyframes()[0]).filter((k) => !["offset", "easing", "composite", "computedOffset"].includes(k)),
    })));
  assert.deepEqual(await morph(), [], "nothing runs before a press");
  const running = { ms: 360, easing: "ease-in-out", props: ["clipPath"] };
  await button.click();
  assert.deepEqual(await morph(), [running, running], "Pause: one animation per polygon");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.motion), "paused");
  await page.waitForTimeout(500);
  assert.deepEqual(await morph(), [], "the morph ends");
  await button.click();
  assert.deepEqual(await morph(), [running, running], "Play: one animation per polygon");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.motion), undefined);
  await ctx.close();
});

test("reduced motion: tier 0, no button, no tier requested", async () => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const requests = [];
  ctx.on("request", (r) => requests.push(new URL(r.url()).pathname));
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForFunction(() => document.documentElement.dataset.tier === "0");
  assert.equal(await page.locator("button.pause").count(), 0);
  assert.deepEqual(tier1Requests(requests), []);
  await ctx.close();
});
