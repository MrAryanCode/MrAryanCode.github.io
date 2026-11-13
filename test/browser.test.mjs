// Browser checks (headless Chromium): text with JavaScript off, clean hydration with it on, worker, WebGPU fallbacks.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { chromium, firefox, webkit } from "playwright";
import sharp from "sharp";
import { mockGithub } from "../tests/acceptance/github-mock.cjs";
import { BASE, buildAndServe, stopAll, tier3Site } from "./helpers.mjs";
import { assertLayout } from "./layout-check.mjs";

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
  await mockGithub(page); // the live read (T-027) is answered by the fixtures, never by the real API
  page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  for (const s of init) await page.addInitScript(s);
  if (route) await route(page);
  const res = await page.goto(BASE + path, { waitUntil: "load" });
  return { ctx, page, res, requests, logs };
}

test("JavaScript off: every route reads", async () => {
  const want = { "/": ["Aryan Miri", "v1.0.1", "MIT"], "/projects/certway/": ["certway"], "/report/": ["Engineering report", "How this site is built"], "/nope/x": ["404", "This page does not exist. These are the pages on this site:", "Home page", "Engineering report"] };
  for (const [path, texts] of Object.entries(want)) {
    const { ctx, page, res } = await open(path, { js: false });
    assert.equal(res.status(), path === "/nope/x" ? 404 : 200, path);
    const body = await page.locator("body").innerText();
    for (const t of texts) assert.ok(body.includes(t), `${path} lacks "${t}"`);
    await ctx.close();
  }
});

// Tier 2 (A-5, T-017), in the three engines. The cases read the worker's output at the tier-2 interface, `onOutput` of
// src/workers/tier2.ts: the page imports the hashed tier2 chunk by the URL it was requested from, which returns the module
// instance the loader started. No GPU context is needed, so no case here skips.
const ENGINES = { chromium, firefox, webkit };

/** Wraps Worker so the page can reach every worker it creates and count what each one posts back. */
const trackWorkers = () => {
  const Native = window.Worker;
  window.__workers = [];
  window.Worker = class extends Native {
    constructor(...args) {
      super(...args);
      this.received = 0;
      this.addEventListener("message", () => { this.received += 1; });
      window.__workers.push(this);
    }
  };
};
const pinLevel = (level) => `try { sessionStorage.setItem("motion-level-pin", ${JSON.stringify(String(level))}); } catch {}`;

for (const [engine, type] of Object.entries(ENGINES)) {
  describe(`tier 2 in ${engine}`, () => {
    let own;
    before(async () => {
      own = await type.launch({ headless: true, executablePath: engine === "chromium" ? process.env.CHROMIUM_PATH || undefined : undefined });
    });
    after(async () => { await own?.close(); });

    /** Opens the home page with `level` pinned and, unless `reduce`, waits for tier 2 and collects its output. */
    async function openTier2({ level = 0, reduce = false } = {}) {
      const ctx = await own.newContext({ reducedMotion: reduce ? "reduce" : "no-preference" });
      const page = await ctx.newPage();
      const requests = [];
      const errors = [];
      page.on("request", (r) => requests.push(new URL(r.url()).pathname));
      page.on("pageerror", (e) => errors.push(e.message));
      await mockGithub(page);
      await page.addInitScript(pinLevel(level));
      await page.addInitScript(trackWorkers);
      // These cases are about tier 2. Tier 3 would add main-thread work of its own where it draws in software without being
      // able to say so (WebKit on a runner names its renderer "Apple GPU", so D-063's decline cannot see it), and that work
      // delays pointer events; the tier 3 cases below are the ones that load it. The loader leaves the page at tier 2.
      await page.route(/\/assets\/tier3-[^/]*\.js$/, (r) => r.abort());
      await page.goto(BASE + "/", { waitUntil: "load" });
      if (reduce) return { ctx, page, requests, errors };
      // Tier 3 loads after tier 2 where the page has a GPU context, so "reached tier 2" is a level of 2 or more.
      await page.waitForFunction(() => Number(document.documentElement.dataset.tier) >= 2);
      const chunk = requests.find((r) => /\/assets\/tier2-[^/]*\.js$/.test(r));
      assert.ok(chunk, `the tier2 chunk was requested: ${requests.join(" ")}`);
      await page.evaluate(async (url) => {
        const ns = await import(url);
        // tier3 imports tier2, so the chunk's exports are mangled: onOutput is the one export that is not an async function.
        const onOutput = Object.values(ns).find((v) => typeof v === "function" && v.constructor.name !== "AsyncFunction");
        const seen = { frames: 0, maxTrail: 0, last: null, empties: 0, afterEmpty: 0 };
        onOutput((out) => {
          seen.frames += 1;
          seen.last = Array.from(out.subarray(0, 4));
          seen.maxTrail = Math.max(seen.maxTrail, out[2]);
          if (out[0] === 0 && out[2] === 0 && out[3] === 0) seen.empties += 1;
          else if (seen.empties > 0) seen.afterEmpty += 1;
        });
        window.__seen = seen;
      }, chunk);
      return { ctx, page, requests, errors };
    }

    /** Moves the mouse round a circle fast enough for the head to push a point on every tick. */
    async function circle(page, steps = 90) {
      for (let i = 0; i < steps; i++) {
        const a = i / 8;
        await page.mouse.move(400 + 150 * Math.cos(a), 300 + 150 * Math.sin(a));
        await page.waitForTimeout(16);
      }
    }

    test("the loader reaches tier 2, the worker chunk is fetched and frames arrive", async () => {
      const { ctx, page, requests, errors } = await openTier2();
      await page.waitForFunction(() => window.__seen.frames >= 3);
      assert.ok(requests.some((r) => /\/assets\/input\.worker-[^/]*\.js$/.test(r)), `the worker chunk: ${requests.join(" ")}`);
      assert.equal(await page.evaluate(() => window.__workers.length), 1);
      assert.deepEqual(errors, []);
      await ctx.close();
    });

    // Measured: the engines do not stamp a sample strictly between the two rAF timestamps around its delivery. Chromium
    // stamps it up to 0.2 ms after the frame's rAF timestamp, Firefox up to 0.6 ms before the previous one and, on the CI
    // runner, 2 ms after the next one. What A-5 relies on is one clock, so the bound is one tick (16.7 ms) either side: a
    // different clock (epoch time, or seconds) misses by far more. A sample that arrives before the first frame is skipped.
    test("A-5 (f) a pointer sample's timeStamp lies between the surrounding rAF timestamps, to one tick", async () => {
      const { ctx, page } = await openTier2();
      await page.evaluate(() => {
        const rafs = { last: 0, pending: [], checked: 0, bad: [] };
        window.__stamps = rafs;
        const tick = (ts) => {
          for (const p of rafs.pending) {
            if (p.before === 0) continue;
            rafs.checked += 1;
            if (!(p.before - 1000 / 60 <= p.stamp && p.stamp <= ts + 1000 / 60)) rafs.bad.push({ before: p.before, stamp: p.stamp, after: ts });
          }
          rafs.pending = [];
          rafs.last = ts;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        document.addEventListener("pointermove", (e) => { rafs.pending.push({ before: rafs.last, stamp: e.timeStamp }); }, { passive: true });
      });
      await circle(page, 60);
      await page.waitForFunction(() => window.__stamps.checked >= 30);
      assert.deepEqual(await page.evaluate(() => window.__stamps.bad), []);
      await ctx.close();
    });

    test("A-5 (g) after a worker fault the field gets an empty trail at once and no worker message follows", async () => {
      const { ctx, page } = await openTier2();
      await circle(page, 40);
      await page.waitForFunction(() => window.__seen.maxTrail > 0);
      // Not a whole number of Float64 slots: the worker's typed-array view throws and it reports one fault.
      await page.evaluate(() => window.__workers[0].postMessage({ type: "frame", buf: new ArrayBuffer(4) }));
      await page.waitForFunction(() => window.__seen.empties === 1, undefined, { timeout: 2000 });
      const atEmpty = await page.evaluate(() => ({ received: window.__workers[0].received, frames: window.__seen.frames, last: window.__seen.last }));
      assert.deepEqual(atEmpty.last.slice(2), [0, 0], "the last frame the field received has no trail and no ripple");
      await page.waitForTimeout(600);
      const later = await page.evaluate(() => ({ received: window.__workers[0].received, frames: window.__seen.frames, empties: window.__seen.empties, afterEmpty: window.__seen.afterEmpty }));
      assert.equal(later.received, atEmpty.received, "no worker message arrived after the fault");
      assert.equal(later.frames, atEmpty.frames, "the field received nothing after the empty frame");
      assert.equal(later.empties, 1);
      assert.equal(later.afterEmpty, 0);
      await ctx.close();
    });

    test("A-5 (h) with reduced motion no worker is created", async () => {
      const { ctx, page } = await openTier2({ reduce: true });
      await page.waitForFunction(() => document.documentElement.dataset.tier === "0");
      await page.waitForTimeout(1000);
      assert.equal(page.workers().length, 0);
      assert.equal(await page.evaluate(() => window.__workers.length), 0, "no Worker was constructed");
      await ctx.close();
    });

    // P-12 rows pointer wake and tap ripple, rank 2: the level pinned at load reaches the worker through budget.ts level().
    for (const [level, kept] of [[0, 16], [1, 16], [2, 6], [7, 6]]) {
      test(`P-12 rank 2: at pinned level ${level} the wake keeps ${kept} trail points`, async () => {
        const { ctx, page } = await openTier2({ level });
        await circle(page);
        await page.waitForFunction(() => window.__seen.maxTrail > 0);
        await circle(page, 30);
        assert.equal(await page.evaluate(() => window.__seen.maxTrail), kept);
        await ctx.close();
      });
    }

    // The 2 s watchdog: a worker that stops answering (terminated here) gets exactly one empty frame from tier 2, about 2 s
    // after its last output, and nothing after it. The clock is the page's own performance.now().
    test("the 2 s watchdog posts exactly one empty frame when the worker stalls", async () => {
      const { ctx, page } = await openTier2();
      await circle(page, 30);
      await page.waitForFunction(() => window.__seen.frames >= 3);
      await page.evaluate(() => {
        window.__lastFrameAt = performance.now();
        window.__emptyAt = [];
        const chunkFrames = window.__seen;
        const poll = () => {
          if (chunkFrames.empties > window.__emptyAt.length) window.__emptyAt.push(performance.now());
          else if (chunkFrames.empties === 0 && chunkFrames.frames !== (window.__lastCount ?? -1)) { window.__lastCount = chunkFrames.frames; window.__lastFrameAt = performance.now(); }
          requestAnimationFrame(poll);
        };
        poll();
        window.__workers[0].terminate();
      });
      await page.waitForFunction(() => window.__emptyAt.length >= 1, undefined, { timeout: 6000 });
      await page.waitForTimeout(2500);
      const wd = await page.evaluate(() => ({ empties: window.__seen.empties, afterEmpty: window.__seen.afterEmpty, gap: window.__emptyAt[0] - window.__lastFrameAt }));
      assert.equal(wd.empties, 1, "exactly one empty frame");
      assert.equal(wd.afterEmpty, 0, "no frame after the empty one");
      assert.ok(wd.gap >= 1700 && wd.gap <= 3500, `the empty frame came ${wd.gap.toFixed(0)} ms after the last output (watchdog 2 s)`);
      await ctx.close();
    });

    // A-1 (e), D-051, D-053 item 4: no text moves independently of the document, outside the two exceptions.
    for (const [name, path] of [["home", "/"], ["certway", "/projects/certway/"], ["report", "/report/"], ["404", "/nope/x"]]) {
      test(`A-1 (e) layout check: ${name}`, async () => {
        const ctx = await own.newContext({ viewport: { width: 1366, height: 768 } });
        const page = await ctx.newPage();
        await mockGithub(page);
        await page.goto(BASE + path, { waitUntil: "load" });
        await page.waitForFunction(() => Number(document.documentElement.dataset.tier) >= 2);
        await assertLayout(page, `${engine} ${path}`);
        await ctx.close();
      });
    }
  });
}

// ---- Tier 3 (A-1, A-2, A-3, T-018), in the three engines, on the production build (no hook) ----
// Tier 3 is detected from html[data-tier] ("3" once the field has drawn), never from the console, whose WebGL warnings the
// other suites filter. Firefox on a runner has no WebGL context: its GPU cases skip with the message below.

/** Records every rise of the stored step-down level with the page's own clock (onLevel is not reachable by name: the shared
 *  chunks' exports are mangled), so the timeline cases compare timestamps taken in the page, never read from Node. */
const trackSteps = () => {
  window.__steps = [];
  let seen = 0;
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (k === "motion-level") {
      let level = null;
      try { level = JSON.parse(v).level; } catch { /* not ours */ }
      if (typeof level === "number" && level > seen) { seen = level; window.__steps.push({ at: performance.now(), level }); }
    }
    return set.call(this, k, v);
  };
};
const CANVAS = "body > div[aria-hidden='true'] canvas";
const TRACE = "trace:20fps";
// The centre-row brightness change the tracer makes in the left rail, in 0-255 units. Measured: -5.1 (Chromium) and -5.2
// (Firefox) with the tracer drawn; -0.04 and -0.21 with its term 0 (pinned at rank 5).
const TRACER_MIN = 3;

/** The left rail's mean brightness (the strip 16 to 150 px outside the reading column, where kind 5 draws the tracer) on the
 *  viewport's centre rows minus on rows 70 to 120 px above and below: the reading tracer (a band 18 px either side of the
 *  viewport's centre) is the only thing that changes the centre rows (the light theme, the default here, makes them darker,
 *  so the sign differs by theme and the cases compare the magnitude). Mean of three screenshots. */
async function tracerExcess(page) {
  const colL = await page.evaluate(() => {
    const el = document.querySelector(".reading");
    return el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft);
  });
  const x0 = Math.max(0, Math.round(colL - 150));
  const width = Math.round(colL - 16) - x0;
  const lum = async () => {
    const { data, info } = await sharp(await page.screenshot({ clip: { x: x0, y: 0, width, height: 768 } })).raw().toBuffer({ resolveWithObject: true });
    const row = (y) => { let sum = 0; for (let x = 0; x < info.width; x++) { const o = (y * info.width + x) * info.channels; sum += data[o] + data[o + 1] + data[o + 2]; } return sum / (3 * info.width); };
    const range = (a, b) => Array.from({ length: b - a }, (_, k) => a + k);
    const mean = (ys) => ys.reduce((a, y) => a + row(y), 0) / ys.length;
    return mean(range(375, 394)) - mean([...range(384 - 120, 384 - 70), ...range(384 + 70, 384 + 120)]);
  };
  let sum = 0;
  for (let k = 0; k < 3; k++) { sum += await lum(); await page.waitForTimeout(150); }
  return sum / 3;
}

for (const [engine, type] of Object.entries(ENGINES)) {
  describe(`tier 3 in ${engine}`, () => {
    let own;
    let skipReason = null;
    let site = { base: BASE, init: "" };
    before(async () => {
      own = await type.launch({ headless: true, executablePath: engine === "chromium" ? process.env.CHROMIUM_PATH || undefined : undefined });
      // Firefox on a runner has no WebGL context. The loader starts tier 3 only where an OffscreenCanvas gives WebGL2, so a
      // WebKit build without one (the Windows build Playwright ships) never starts it: both are skips with their own message.
      const page = await own.newPage();
      const probe = await page.evaluate(() => ({
        gl: !!document.createElement("canvas").getContext("webgl2"),
        offscreen: typeof OffscreenCanvas !== "undefined" && new OffscreenCanvas(1, 1).getContext("webgl2") !== null,
      }));
      await page.close();
      if (engine === "firefox" && !probe.gl) skipReason = "no WebGL2 context: firefox";
      else if (engine === "webkit" && !probe.offscreen) skipReason = "no OffscreenCanvas WebGL2: webkit";
      // Tier 3 declines where WebGL2 renders in software (D-063; CI's runner): these cases then open the test build with the
      // decline switched off. The decline itself is checked on the production build, in the describe below.
      else site = await tier3Site(own);
    });
    after(async () => { await own?.close(); });

    /** A case that needs the field loop: skipped in Firefox when the browser has no WebGL2 context. */
    const gpuTest = (name, fn) => test(`${name} (${engine})`, async (t) => {
      if (skipReason) return t.skip(skipReason);
      await fn(t);
    });

    /** `pin` is the motion-level-pin value (undefined: none). `field()` waits for tier 3 and explains a failure. */
    async function openField({ pin, route = "/", reduce = false } = {}) {
      const ctx = await own.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: reduce ? "reduce" : "no-preference" });
      if (site.init) await ctx.addInitScript(site.init);
      const page = await ctx.newPage();
      const errors = [];
      const requests = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => requests.push(new URL(r.url()).pathname));
      await mockGithub(page);
      if (pin !== undefined) await page.addInitScript(pinLevel(pin));
      await page.addInitScript(trackSteps);
      await page.goto(site.base + route, { waitUntil: "load" });
      const field = async () => {
        try {
          await page.waitForFunction(() => document.documentElement.dataset.tier === "3", undefined, { timeout: 25000 });
        } catch {
          throw new Error(`tier 3 did not start: html[data-tier] is "${await page.evaluate(() => document.documentElement.dataset.tier)}"; page errors: ${errors.join("; ")}`);
        }
      };
      return { ctx, page, errors, requests, field };
    }

    gpuTest("the loader reaches tier 3: the canvas draws, the still texture is hidden", async () => {
      const { ctx, page, errors, field } = await openField({ pin: 0 });
      await field();
      assert.equal(await page.evaluate(() => document.documentElement.dataset.field), "on");
      assert.equal(await page.evaluate((c) => getComputedStyle(document.querySelector(c)).visibility, CANVAS), "visible");
      assert.equal(await page.evaluate(() => getComputedStyle(document.body, "::before").display), "none", "the still look is off while the field draws");
      assert.deepEqual(errors, []);
      await ctx.close();
    });

    // A-3 (e): the step-down to rank 7 removes the field for the visit.
    gpuTest("A-3 (e) unpinned at trace:20fps the canvas is removed after rank 7 and the next navigation has no field", async () => {
      const { ctx, page, field } = await openField({ pin: TRACE });
      await field();
      assert.equal(await page.evaluate((c) => document.querySelector(c) !== null, CANVAS), true);
      await page.waitForFunction((c) => document.querySelector(c) === null, CANVAS, { timeout: 90000 });
      assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem("motion-level")).level), 7, "motion-level 7 is stored");
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.body, "::before").display), "none", "the still texture is shown");
      assert.equal(await page.evaluate(() => window.__steps.at(-1).level), 7);
      // The same tab, a page that would play a formation: no canvas, no field flag, no second intro.
      await page.goto(site.base + "/nope/x", { waitUntil: "load" });
      await page.waitForFunction(() => Number(document.documentElement.dataset.tier) >= 2);
      await page.waitForTimeout(1500);
      assert.equal(await page.evaluate((c) => document.querySelector(c), CANVAS), null, "no canvas on the next navigation");
      assert.equal(await page.evaluate(() => document.documentElement.dataset.field), undefined);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.tier), "2");
      await ctx.close();
    });

    // A-3 (f): a hidden-then-visible tab, and pause then play, cause no step. Timeline (CR10-O3): wait for a step, 1.5 s
    // after it hide (or pause), 1 s later show (or play); no step may fall between the hide and 2 s after the show. All times
    // are the page's performance.now(); the controller steps every 2.5 s at trace:20fps, so a missed reset steps inside the window.
    for (const kind of ["hidden", "paused"]) {
      gpuTest(`A-3 (f) ${kind === "hidden" ? "a hidden then visible tab" : "pause then play"} causes no step`, async () => {
        const { ctx, page, field } = await openField({ pin: TRACE });
        await field();
        await page.waitForFunction(() => window.__steps.length >= 1, undefined, { timeout: 15000 });
        const run = await page.evaluate(async (kind) => {
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          const firstStep = window.__steps[window.__steps.length - 1].at;
          const visibility = (state) => {
            Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
            Object.defineProperty(document, "hidden", { configurable: true, get: () => state === "hidden" });
            document.dispatchEvent(new Event("visibilitychange"));
          };
          await wait(Math.max(0, firstStep + 1500 - performance.now()));
          const off = performance.now();
          if (kind === "hidden") visibility("hidden"); else document.querySelector(".pause").click();
          await wait(1000);
          const on = performance.now();
          if (kind === "hidden") visibility("visible"); else document.querySelector(".pause").click();
          await wait(on + 4800 - performance.now());
          return { off, on, steps: window.__steps.map((s) => s.at) };
        }, kind);
        const inside = run.steps.filter((at) => at > run.off && at <= run.on + 2000);
        const shown = run.steps.map((a) => a.toFixed(0));
        assert.deepEqual(inside, [], `no step between the ${kind === "hidden" ? "hide" : "pause"} (${run.off.toFixed(0)}) and 2 s after the ${kind === "hidden" ? "visible" : "play"} moment (${run.on.toFixed(0)}): steps ${shown}`);
        assert.ok(run.steps.some((at) => at > run.on + 2000), `the controller steps again after the reset: steps ${shown}, back at ${run.on.toFixed(0)}`);
        assert.ok(run.steps.length < 7, "the case ends before rank 7");
        await ctx.close();
      });
    }

    // Moved from T-017 (CR5-O4): the wake keeps 16 trail points below level 2 and 6 from level 2, the change arriving
    // through onLevel while the field loop feeds the controller.
    gpuTest("the pointer wake drops from 16 to 6 trail points when the level steps to 2 (trace:20fps)", async () => {
      const { ctx, page, requests, field } = await openField({ pin: TRACE });
      await field();
      const chunk = requests.find((r) => /\/assets\/tier2-[^/]*\.js$/.test(r));
      assert.ok(chunk, "the tier2 chunk was requested");
      await page.evaluate(async (url) => {
        const ns = await import(url);
        const onOutput = Object.values(ns).find((v) => typeof v === "function" && v.constructor.name !== "AsyncFunction");
        window.__trails = [];
        onOutput((out) => { window.__trails.push({ at: performance.now(), n: out[2] }); });
      }, chunk);
      for (let i = 0; i < 2400; i++) {
        const a = i / 8;
        await page.mouse.move(683 + 250 * Math.cos(a), 400 + 200 * Math.sin(a));
        await page.waitForTimeout(16);
        const done = await page.evaluate(() => { const s = window.__steps.find((x) => x.level >= 2); return !!s && performance.now() > s.at + 1500; });
        if (done) break;
      }
      const r = await page.evaluate(() => {
        const lv2 = window.__steps.find((s) => s.level >= 2).at;
        const before = window.__trails.filter((f) => f.at < lv2 - 100).map((f) => f.n);
        const after = window.__trails.filter((f) => f.at > lv2 + 500).map((f) => f.n);
        return { before: Math.max(0, ...before), after: Math.max(0, ...after), levels: window.__steps.map((s) => s.level) };
      });
      assert.equal(r.before, 16, `below level 2 the wake reaches 16 points (steps ${r.levels})`);
      assert.equal(r.after, 6, "from level 2 the wake keeps 6");
      await ctx.close();
    });

    // A-2 (b): no canvas and no key under reduced motion, and at level 7.
    test(`reduced motion and pinned level 7: no canvas, no intro key (${engine})`, async () => {
      {
        const { ctx, page } = await openField({ reduce: true });
        await page.waitForFunction(() => document.documentElement.dataset.tier === "0");
        await page.waitForTimeout(800);
        assert.equal(await page.evaluate((c) => document.querySelector(c), CANVAS), null);
        assert.equal(await page.evaluate(() => sessionStorage.getItem("motion-intro")), null);
        await ctx.close();
      }
      {
        const { ctx, page } = await openField({ pin: 7 });
        await page.waitForFunction(() => Number(document.documentElement.dataset.tier) >= 2);
        await page.waitForTimeout(800);
        assert.equal(await page.evaluate((c) => document.querySelector(c), CANVAS), null);
        assert.equal(await page.evaluate(() => sessionStorage.getItem("motion-intro")), null);
        assert.equal(await page.evaluate(() => document.documentElement.dataset.tier), "2");
        await ctx.close();
      }
    });

    // Pause hides the field and brings the still texture back; Play returns the field (the data-field flag too).
    gpuTest("pause hides the field and play brings it back", async () => {
      const { ctx, page, field } = await openField({ pin: 0 });
      await field();
      await page.evaluate(() => document.querySelector(".pause").click());
      await page.waitForFunction(() => document.documentElement.dataset.field === undefined);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.tier), "0");
      assert.equal(await page.evaluate((c) => getComputedStyle(document.querySelector(c).parentElement).display, CANVAS), "none");
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.body, "::before").display), "none", "the still texture is back");
      await page.evaluate(() => document.querySelector(".pause").click());
      await field();
      await page.waitForFunction(() => document.documentElement.dataset.field === "on");
      assert.equal(await page.evaluate((c) => getComputedStyle(document.querySelector(c).parentElement).display, CANVAS), "block");
      await ctx.close();
    });

    // P-12 / DV-02.5: the reading tracer sits at the centre of the viewport in the case study's margins.
    describe("the reading tracer", () => {
      /** Scrolls the case study with the wheel until the centre row is inside the reading column. */
      async function scrollIntoReading(page) {
        const top = await page.evaluate(() => document.querySelector(".reading").getBoundingClientRect().top + scrollY);
        await page.mouse.move(683, 400);
        for (let k = 0; k < 20 && (await page.evaluate(() => scrollY)) < top + 500; k++) {
          await page.mouse.wheel(0, 400);
          await page.waitForTimeout(120);
        }
        await page.waitForTimeout(500);
      }

      gpuTest("is drawn while scrolling", async () => {
        const { ctx, page, field } = await openField({ pin: 0, route: "/projects/certway/" });
        await field();
        await scrollIntoReading(page);
        const on = await tracerExcess(page);
        console.log(`  tracer ${engine}: centre-row excess ${on.toFixed(2)}`);
        assert.ok(Math.abs(on) > TRACER_MIN, `the tracer changes the centre rows by ${on.toFixed(2)}`);
        await ctx.close();
      });

      gpuTest("its term is 0 from rank 5 (pinned)", async () => {
        const { ctx, page, field } = await openField({ pin: 5, route: "/projects/certway/" });
        await field();
        await scrollIntoReading(page);
        const off = await tracerExcess(page);
        console.log(`  tracer ${engine} pinned 5: centre-row excess ${off.toFixed(2)}`);
        assert.ok(Math.abs(off) < TRACER_MIN / 3, `no tracer at rank 5: excess ${off.toFixed(2)}`);
        await ctx.close();
      });

      gpuTest("is absent while paused", async () => {
        const { ctx, page, field } = await openField({ pin: 0, route: "/projects/certway/" });
        await field();
        await scrollIntoReading(page);
        await page.evaluate(() => document.querySelector(".pause").click());
        await page.waitForFunction(() => document.documentElement.dataset.field === undefined);
        const off = await tracerExcess(page);
        assert.ok(Math.abs(off) < TRACER_MIN / 3, `no tracer while paused: excess ${off.toFixed(2)}`);
        await ctx.close();
      });

      test(`is absent under reduced motion (${engine})`, async () => {
        const { ctx, page } = await openField({ reduce: true, route: "/projects/certway/" });
        await page.waitForFunction(() => document.documentElement.dataset.tier === "0");
        await scrollIntoReading(page);
        const off = await tracerExcess(page);
        assert.ok(Math.abs(off) < TRACER_MIN / 3, `no tracer under reduced motion: excess ${off.toFixed(2)}`);
        await ctx.close();
      });
    });
  });
}

// ---- Tier 3 declines on a software renderer (D-063), on the production build ----
// A browser whose WebGL2 renders in SwiftShader (CI's runner, or the headless shell with --disable-gpu) passes the loader's
// OffscreenCanvas gate, so tier 3 loads, finds the software renderer and leaves the page on tier 2. The test fails before it
// can pass for another reason: it needs a launch whose OffscreenCanvas WebGL2 names SwiftShader.
describe("tier 3 declines on a software renderer", () => {
  let soft = null;
  before(async () => {
    for (const args of [[], ["--disable-gpu"]]) {
      const b = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args });
      const page = await b.newPage();
      const renderer = await page.evaluate(() => {
        const gl = typeof OffscreenCanvas === "undefined" ? null : new OffscreenCanvas(1, 1).getContext("webgl2");
        const info = gl?.getExtension("WEBGL_debug_renderer_info");
        return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
      });
      await page.close();
      if (renderer.includes("SwiftShader")) {
        soft = { browser: b, renderer };
        return;
      }
      await b.close();
    }
  });
  after(async () => { await soft?.browser.close(); });

  test("the production build stays on tier 2 and makes no canvas", async () => {
    assert.ok(soft, "no launch of this Chromium gave an OffscreenCanvas WebGL2 context whose renderer says SwiftShader");
    const ctx = await soft.browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await ctx.newPage();
    const errors = [];
    const requests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => requests.push(new URL(r.url()).pathname));
    await mockGithub(page);
    await page.addInitScript(pinLevel(0));
    await page.goto(BASE + "/", { waitUntil: "load" });
    await page.waitForFunction(() => Number(document.documentElement.dataset.tier) >= 2);
    // Tier 3 must have been loaded and run its start: a page that never got that far proves nothing about the decline.
    for (let i = 0; i < 100 && !requests.some((r) => /\/assets\/tier3-.*\.js$/.test(r)); i++) await page.waitForTimeout(100);
    assert.ok(requests.some((r) => /\/assets\/tier3-.*\.js$/.test(r)), `the tier 3 module was requested: ${requests.join(" ")}`);
    await page.waitForTimeout(3000);
    const state = await page.evaluate((c) => ({
      tier: document.documentElement.dataset.tier,
      field: document.documentElement.dataset.field ?? null,
      canvases: document.querySelectorAll(c).length,
    }), CANVAS);
    assert.deepEqual(state, { tier: "2", field: null, canvases: 0 }, `on ${soft.renderer}`);
    assert.deepEqual(errors, []);
    await ctx.close();
  });

  // A WebGPU adapter that is software (adapter.info.isFallbackAdapter, or architecture "swiftshader") never loads the WebGPU
  // layer chunk; the control adapter, a hardware one, does, so the case can see the request it is asserting the absence of.
  for (const [name, info, chunk] of [
    ["isFallbackAdapter", { vendor: "google", architecture: "other", isFallbackAdapter: true }, false],
    ["architecture swiftshader", { vendor: "google", architecture: "swiftshader", isFallbackAdapter: false }, false],
    ["a hardware adapter (control)", { vendor: "nvidia", architecture: "ampere", isFallbackAdapter: false }, true],
  ]) {
    test(`a WebGPU adapter with ${name} ${chunk ? "loads" : "does not load"} the WebGPU layer`, async () => {
      assert.ok(soft, "no launch of this Chromium gave an OffscreenCanvas WebGL2 context whose renderer says SwiftShader");
      const ctx = await soft.browser.newContext();
      const page = await ctx.newPage();
      const requests = [];
      page.on("request", (r) => requests.push(new URL(r.url()).pathname));
      await mockGithub(page);
      await page.addInitScript((i) => {
        Object.defineProperty(navigator, "gpu", { value: { requestAdapter: async () => ({ info: i, requestDevice: async () => ({}) }) }, configurable: true });
      }, info);
      await page.goto(BASE + "/", { waitUntil: "load" });
      await page.waitForFunction(() => Number(document.documentElement.dataset.tier) >= 2);
      for (let i = 0; i < 100 && !requests.some((r) => /\/assets\/tier3-.*\.js$/.test(r)); i++) await page.waitForTimeout(100);
      await page.waitForTimeout(chunk ? 2000 : 3000);
      assert.equal(requests.some((r) => /\/assets\/layer-.*\.js$/.test(r)), chunk, `requests: ${requests.join(" ")}`);
      await ctx.close();
    });
  }
});

// Underline draw (D-051, P-12): the resting underline draws to full width in 0.42 s on hover or focus and retracts in 0.42 s;
// it is instant under reduced motion and under html[data-motion="paused"]; and the step-down level does not change it.
async function underlineRuns(page, how) {
  const link = page.locator('a[href="/report/"]').first();
  // The page records each underline transition when it starts (transitionrun), with its duration and the line's anchor at
  // that moment, so a main thread kept busy by the field cannot make a later read miss a transition that already ended.
  await link.evaluate((el) => {
    window.__ul = [];
    el.addEventListener("transitionrun", (e) => {
      if (e.propertyName !== "background-size") return;
      window.__ul.push({
        ms: el.getAnimations().filter((a) => a.transitionProperty === "background-size").map((a) => a.effect.getTiming().duration),
        from: getComputedStyle(el).backgroundPositionX.split(",")[0].trim(),
      });
    });
  });
  const take = async () => {
    await page.waitForTimeout(500);
    const runs = await page.evaluate(() => window.__ul.splice(0));
    // No transition started (reduced motion, paused): the line is instant and its anchor is read as it stands.
    return runs[0] ?? { ms: [], from: await link.evaluate((el) => getComputedStyle(el).backgroundPositionX.split(",")[0].trim()) };
  };
  // Chromium does not start a transition on the first link hover of a page that runs script (pages without script do),
  // so hover once and wait for the line to settle before measuring.
  await link.hover();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__ul.splice(0));
  if (how === "focus") {
    for (let i = 0; i < 40 && !(await link.evaluate((el) => el.matches(":focus-visible"))); i++) await page.keyboard.press("Tab");
  } else {
    await link.hover();
  }
  const draw = await take();
  let retract = null;
  if (how === "hover") {
    // Let the draw finish: leaving mid-draw reverses the transition with a shortened duration.
    await page.waitForTimeout(600);
    await page.mouse.move(0, 0);
    retract = await take();
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
    await mockGithub(page);
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
