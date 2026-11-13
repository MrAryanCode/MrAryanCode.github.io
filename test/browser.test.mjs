// Browser checks (headless Chromium): text with JavaScript off, clean hydration with it on, worker, WebGPU fallbacks.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { chromium, firefox, webkit } from "playwright";
import { mockGithub } from "../tests/acceptance/github-mock.cjs";
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
      await page.goto(BASE + "/", { waitUntil: "load" });
      if (reduce) return { ctx, page, requests, errors };
      await page.waitForFunction(() => document.documentElement.dataset.tier === "2");
      const chunk = requests.find((r) => /\/assets\/tier2-[^/]*\.js$/.test(r));
      assert.ok(chunk, `the tier2 chunk was requested: ${requests.join(" ")}`);
      await page.evaluate(async (url) => {
        const tier2 = await import(url);
        const seen = { frames: 0, maxTrail: 0, last: null, empties: 0, afterEmpty: 0 };
        tier2.onOutput((out) => {
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

    // Measured 2026-11-12: Chromium stamps a sample up to 0.2 ms after the rAF timestamp of the frame that delivers it, and
    // Firefox up to 0.6 ms before the previous one (its event stamps are rounded to 1 ms). Both are one clock; a 2 ms
    // allowance (a tenth of a tick) absorbs that, and a different clock (epoch time, say) would miss by far more.
    test("A-5 (f) a pointer sample's timeStamp lies between the surrounding rAF timestamps, to 2 ms", async () => {
      const { ctx, page } = await openTier2();
      await page.evaluate(() => {
        const rafs = { last: 0, pending: [], checked: 0, bad: [] };
        window.__stamps = rafs;
        const tick = (ts) => {
          for (const p of rafs.pending) {
            rafs.checked += 1;
            if (!(p.before - 2 <= p.stamp && p.stamp <= ts + 2)) rafs.bad.push({ before: p.before, stamp: p.stamp, after: ts });
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
