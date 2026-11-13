// Tier 3 through the test-only seek hook (src/gpu/seek-hook.ts, built into dist-test/ only): determinism, the variant
// override, the parity readback against the CPU model (A-1 (b)), the quiet-zone and palette checks (A-1 (c), (d)), the mask
// cases of A-2 (c) and the frame-time budget (A-1 (g)). The cases that do not call the hook are in test/browser.test.mjs.
//
// Every case runs in four engines: Chromium on WebGPU (full Chromium, --enable-unsafe-webgpu, one relaunch on a null
// adapter, a null adapter after that is a failure), Chromium on WebGL2 (the default headless shell with navigator.gpu
// removed), Firefox and WebKit on WebGL2. The WebGPU path is tested in Chromium only; no WebGPU case skips. Firefox on a
// runner has no WebGL context, so there a case that needs a GPU context skips with 'no WebGL2 context: firefox'.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { chromium, firefox, webkit } from "playwright";
import { mockGithub } from "../tests/acceptance/github-mock.cjs";
import * as core from "../src/gpu/core.ts";
import * as cpu from "./cpu-field.mjs";
import { buildAndServe, launchFullChromium, stopAll, TEST_BASE } from "./helpers.mjs";

const PAL = {
  dark: ["#08090B", "#15191E", "#1C2128", "#4A6122", "#C6F432"],
  light: ["#F1F1EC", "#E0E2D9", "#D8DBD1", "#2B3036", "#5E8F00"],
};
const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const PAL_RGB = { dark: PAL.dark.map(rgb), light: PAL.light.map(rgb) };

const PAGES = { home: "/", certway: "/projects/certway/", report: "/report/", "404": "/nope/x" };
const SIZES = { "390x844@3": [390, 844, 3], "320x568@2": [320, 568, 2], "1366x768@1": [1366, 768, 1], "759x844@3": [759, 844, 3], "760x844@3": [760, 844, 3] };
const THEMES = ["dark", "light"];

before(async () => {
  await buildAndServe({ mode: "test" });
});
after(async () => {
  await stopAll();
});

const noGpu = () => { Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined }); };
const logDeviceLoss = () => {
  const request = GPUAdapter.prototype.requestDevice;
  GPUAdapter.prototype.requestDevice = async function (...args) {
    const device = await request.apply(this, args);
    device.lost.then((info) => console.log(`T3 DEVICE LOST reason=${info.reason} message=${info.message}`));
    const destroy = device.destroy.bind(device);
    device.destroy = () => {
      console.log(`T3 DEVICE DESTROY called from ${new Error().stack.split("\n").slice(2, 7).map((l) => l.trim()).join(" | ")}`);
      return destroy();
    };
    return device;
  };
};
// Tier 3 declines on a software renderer (D-063); CI's runner has only SwiftShader, so every context of the test build switches that off.
const allowSoftwareRenderer = (browser) => {
  const make = browser.newContext.bind(browser);
  browser.newContext = async (...args) => {
    const ctx = await make(...args);
    await ctx.addInitScript(() => { globalThis.T3_ALLOW_SOFTWARE = true; });
    return ctx;
  };
  return browser;
};
const pinLevel = (level) => `try { sessionStorage.setItem("motion-level-pin", ${JSON.stringify(String(level))}); } catch {}`;

/** Full Chromium with a WebGPU adapter: one relaunch when requestAdapter() resolves null, a failure after that. */
async function launchWebGpu() {
  for (let attempt = 0; attempt < 2; attempt++) {
    const b = await launchFullChromium({ webgpu: true });
    const page = await b.newPage();
    await page.goto(TEST_BASE + "/", { waitUntil: "domcontentloaded" });
    const has = await page.evaluate(async () => !!navigator.gpu && (await navigator.gpu.requestAdapter()) !== null);
    await page.close();
    if (has) {
      // CI's WebGPU adapter is SwiftShader, and from the second page on the browser destroyed each page's device within
      // 400 ms (run 43512767925: "T3 DEVICE LOST reason=destroyed" with no destroy() call from the page, or "A valid external
      // Instance reference no longer exists"). A page that holds one device for the whole run keeps the browser's instance
      // alive between pages: an attempt to find out whether the last page's teardown is what ends the next page's device.
      const anchor = await b.newPage();
      await anchor.route("**/anchor-blank", (r) => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>anchor</title>" }));
      await anchor.goto(TEST_BASE + "/anchor-blank");
      await anchor.evaluate(async () => { window.__anchor = await (await navigator.gpu.requestAdapter()).requestDevice(); });
      return b;
    }
    await b.close();
  }
  throw new Error("WebGPU: requestAdapter() resolved null twice in full Chromium with --enable-unsafe-webgpu");
}

const ENGINES = [
  { name: "chromium webgpu", api: "webgpu", launch: launchWebGpu, removeGpu: false },
  { name: "chromium webgl2", api: "webgl2", launch: () => chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined }), removeGpu: true },
  { name: "firefox", api: "webgl2", launch: () => firefox.launch({ headless: true }), removeGpu: true, needsGl: "firefox" },
  { name: "webkit", api: "webgl2", launch: () => webkit.launch({ headless: true }), removeGpu: true, needsOffscreen: "webkit" },
];

/** Why a GPU case cannot run in this browser, or null. Firefox on a runner has no WebGL context. The loader (src/enhance.ts)
 *  starts tier 3 only where a WebGL2 context exists on an OffscreenCanvas, and a WebKit build without one (the Windows build
 *  Playwright ships) never starts it, so the hook's `ready` would never settle: that is a skip with its own message. */
async function gpuSkipReason(E, browser) {
  if (!E.needsGl && !E.needsOffscreen) return null;
  const page = await browser.newPage();
  const probe = await page.evaluate(() => ({
    gl: !!document.createElement("canvas").getContext("webgl2"),
    offscreen: typeof OffscreenCanvas !== "undefined" && new OffscreenCanvas(1, 1).getContext("webgl2") !== null,
  }));
  await page.close();
  if (E.needsGl && !probe.gl) return `no WebGL2 context: ${E.needsGl}`;
  if (E.needsOffscreen && !probe.offscreen) return `no OffscreenCanvas WebGL2: ${E.needsOffscreen}`;
  return null;
}

/** The cross-engine numbers the last describe compares. */
const maskCounts = {};

// ---- In-page functions (serialised by Playwright: no closure, everything arrives in the argument) ----

/** Reads cell rows [0, r1) at (t, tf, scrollY), and checks the palette and every cell a text zone covers. */
async function sample(a) {
  const H = globalThis.__T3_SEEK__;
  const r1 = a.maxY ? Math.ceil(a.maxY / 3.5) + 8 : 1e9;
  const b64 = await H.raw(a.t, a.tf, a.scrollY, 0, r1, a.input);
  const lay = H.layout();
  const bin = atob(b64);
  const px = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) px[i] = bin.charCodeAt(i);
  const W = lay.cellsW, D = lay.D, dpr = lay.dpr, rows = px.length / 4 / W;
  const pal = a.pal;
  const idxAt = (cx, cy) => {
    const o = 4 * (cy * W + cx);
    for (let k = 0; k < 5; k++) if (pal[k][0] === px[o] && pal[k][1] === px[o + 1] && pal[k][2] === px[o + 2]) return k;
    return -1;
  };
  let offPalette = 0;
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < W; cx++) if (idxAt(cx, cy) < 0) offPalette++;
  // The text zones: each text node's client rects plus 10 CSS px, floored and ceiled to device px.
  const zones = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.data.trim() === "" || n.parentElement?.closest("script,style,noscript")) continue;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      if (r.width <= 0 || r.height <= 0) continue;
      zones.push([Math.floor((r.left + scrollX - 10) * dpr), Math.floor((r.top + scrollY - 10) * dpr), Math.ceil((r.right + scrollX + 10) * dpr), Math.ceil((r.bottom + scrollY + 10) * dpr)]);
    }
  }
  const q = a.pal[2];
  let bad = 0, zoneCells = 0;
  const badAt = [];
  const seen = new Set();
  for (const [x0, y0, x1, y1] of zones) {
    for (let cy = Math.max(0, Math.floor(y0 / D)); cy <= Math.ceil(y1 / D) - 1 && cy < rows; cy++) {
      for (let cx = Math.max(0, Math.floor(x0 / D)); cx <= Math.ceil(x1 / D) - 1 && cx < W; cx++) {
        if (seen.has(cy * W + cx)) continue;
        seen.add(cy * W + cx);
        zoneCells++;
        const o = 4 * (cy * W + cx);
        const over = a.theme === "dark" ? px[o] > q[0] || px[o + 1] > q[1] || px[o + 2] > q[2] : px[o] < q[0] || px[o + 1] < q[1] || px[o + 2] < q[2];
        if (over) {
          bad++;
          if (badAt.length < 3) badAt.push({ cx, cy, rgb: [px[o], px[o + 1], px[o + 2]], zone: [x0, y0, x1, y1] });
        }
      }
    }
  }
  return { bad, badAt, offPalette, zoneCells, zones: zones.length, D, cellsW: W, rows };
}

/** Reads cell rows as palette indices, with the uniform block's mask rectangle and the cell kinds (for the parity and mask cases). */
async function grab(a) {
  const H = globalThis.__T3_SEEK__;
  const b64 = await H.raw(a.t, a.tf, a.scrollY, 0, a.r1 ?? 1e9, a.input);
  const blk = H.block(a.t, a.tf, a.scrollY, a.input);
  const lay = H.layout();
  const kinds64 = a.kinds ? await H.kinds(0, a.r1 ?? 1e9) : null;
  return { b64, blk, kinds64, lay };
}

const unb64 = (s) => Uint8Array.from(Buffer.from(s, "base64"));
const idxOfPixels = (px, theme) => {
  const out = new Int8Array(px.length / 4);
  for (let k = 0; k < out.length; k++) out[k] = cpu.indexOf(PAL[theme], px[4 * k], px[4 * k + 1], px[4 * k + 2]);
  return out;
};

/** 16 trails and 3 ripples spread over the viewport at scrollY, in page CSS px. */
const pointerInput = (w, h, scrollY) => ({
  trails: Array.from({ length: 16 }, (_, k) => ({ x: w * (0.08 + 0.055 * k), y: scrollY + h * (0.1 + 0.052 * k), a: 0.05 + 0.05 * (k % 8) })),
  ripples: Array.from({ length: 3 }, (_, k) => ({ x: w * (0.25 + 0.25 * k), y: scrollY + h * (0.3 + 0.2 * k), age: 0.2 + 0.3 * k })),
});

for (const E of ENGINES) {
  describe(`seek hook in ${E.name}`, () => {
    let browser;
    let skipReason = null;
    before(async () => {
      browser = allowSoftwareRenderer(await E.launch());
      skipReason = await gpuSkipReason(E, browser);
    });
    after(async () => { await browser?.close(); });

    /** A GPU case: skips in Firefox when there is no WebGL2 context. */
    const gpuTest = (name, fn) =>
      test(`${name} (${E.name})`, async (t) => {
        if (skipReason) return t.skip(skipReason);
        await fn(t);
      });

    /** Opens `route` of the test build with the hook ready. Returns { ctx, page, errors, logs }. */
    async function openHook(route, { size = "1366x768@1", theme = "dark", level = 0, fx = "", init = [], reduce = false } = {}) {
      const [w, h, dpr] = SIZES[size];
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, colorScheme: theme, reducedMotion: reduce ? "reduce" : "no-preference" });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await mockGithub(page);
      if (E.removeGpu) await page.addInitScript(noGpu);
      if (E.api === "webgpu") {
        // A lost device ends tier 3 for the page: print why, so a CI failure of this engine says which loss it was.
        await page.addInitScript(logDeviceLoss);
        page.on("console", (m) => { if (m.text().startsWith("T3 DEVICE")) console.log(`  ${route} ${m.text()}`); });
      }
      await page.addInitScript(pinLevel(level));
      for (const s of init) await page.addInitScript(s);
      await page.goto(`${TEST_BASE}${route}${fx ? `?fx=${fx}` : ""}`, { waitUntil: "load" });
      await page.waitForFunction(() => globalThis.__T3_SEEK__ !== undefined, undefined, { timeout: 20000 });
      const ok = await page.evaluate(() => globalThis.__T3_SEEK__.ready);
      assert.equal(ok, true, `tier 3 started on ${route}: ${errors.join("; ")}`);
      return { ctx, page, errors, w, h, dpr };
    }
    const layout = (page) => page.evaluate(() => globalThis.__T3_SEEK__.layout());

    gpuTest("layout(): the renderer, the sections, the CTA and the column", async () => {
      const { ctx, page, errors } = await openHook("/");
      const lay = await layout(page);
      assert.equal(lay.renderer.api, E.api);
      assert.equal(typeof lay.renderer.name, "string");
      assert.ok(lay.renderer.name.length > 0);
      console.log(`  renderer ${E.name}: ${lay.renderer.api} ${lay.renderer.name}`);
      const want = { home: [0, 1, 2, 3, 4], certway: [5, 7], report: [6, 7], "404": [0] };
      for (const [name, kinds] of Object.entries(want)) {
        const p = name === "home" ? page : await ctx.newPage();
        if (name !== "home") {
          await mockGithub(p);
          await p.addInitScript(noGpu);
          await p.goto(TEST_BASE + PAGES[name], { waitUntil: "load" });
          await p.waitForFunction(() => globalThis.__T3_SEEK__ !== undefined);
          await p.evaluate(() => globalThis.__T3_SEEK__.ready);
        }
        const l = await layout(p);
        const got = new Set(l.sections.map((s) => s.kind));
        for (const k of kinds) assert.ok(got.has(k), `${name} has a band of kind ${k}: ${[...got]}`);
        assert.ok(l.sections.length <= 8, `${name}: at most 8 bands`);
        for (let i = 1; i < l.sections.length; i++) assert.ok(l.sections[i].y0 >= l.sections[i - 1].y0, `${name}: bands in page order`);
        if (name === "home") assert.ok(l.cta[1] > 0 && l.cta[0] > 0, "the CTA centre is in page coordinates");
        if (name === "certway") assert.ok(l.col[1] > l.col[0], "the reading column has width");
      }
      assert.deepEqual(errors, []);
      await ctx.close();
    });

    gpuTest("raw: two calls with the same arguments return identical bytes", async () => {
      const { ctx, page } = await openHook("/");
      for (const [t, tf, scrollY] of [[0, 0, 0], [1.5, 1.5, 0], [7.3, 99, 900]]) {
        const a = await page.evaluate(([t, tf, y]) => globalThis.__T3_SEEK__.raw(t, tf, y, 0, 400), [t, tf, scrollY]);
        const b = await page.evaluate(([t, tf, y]) => globalThis.__T3_SEEK__.raw(t, tf, y, 0, 400), [t, tf, scrollY]);
        assert.ok(a.length > 1000);
        assert.equal(a, b, `raw(${t}, ${tf}, ${scrollY}) is deterministic`);
      }
      await ctx.close();
    });

    // k3:hsoft holds the ring phase (rate 0) at the soft amplitude. Kind 3 cells are compared at t = 0 and t = 25,600 s,
    // which wraps every other clock (the noise drift and the twinkle) but moves the full ring phase by 46,080 rad.
    gpuTest("k3:hsoft holds the ring phase at the soft amplitude; k3:full moves it", async () => {
      const grabKind3 = async (fx, t) => {
        const { ctx, page } = await openHook("/", { fx });
        const g = await page.evaluate(grab, { t, tf: 99, scrollY: 0, kinds: true });
        await ctx.close();
        return { px: unb64(g.b64), kinds: unb64(g.kinds64) };
      };
      const sumOver = (a, kinds) => {
        let sum = 0, n = 0;
        for (let k = 0; k < kinds.length; k++) if (kinds[k] === 3) { sum += a.px[4 * k] + a.px[4 * k + 1] + a.px[4 * k + 2]; n++; }
        return { sum, n };
      };
      const diffOver = (a, b, kinds) => {
        let d = 0, n = 0;
        for (let k = 0; k < kinds.length; k++) if (kinds[k] === 3) { n++; if (a.px[4 * k] !== b.px[4 * k] || a.px[4 * k + 1] !== b.px[4 * k + 1] || a.px[4 * k + 2] !== b.px[4 * k + 2]) d++; }
        return { d, n };
      };
      const hs0 = await grabKind3("k3:hsoft", 0), hs1 = await grabKind3("k3:hsoft", 25600);
      const hf0 = await grabKind3("k3:hfull", 0);
      const f0 = await grabKind3("k3:full", 0), f1 = await grabKind3("k3:full", 25600);
      const n3 = hs0.kinds.filter((k) => k === 3).length;
      assert.ok(n3 > 500, `the home page has kind 3 cells: ${n3}`);
      assert.equal(diffOver(hs0, hs1, hs0.kinds).d, 0, "k3:hsoft: the same kind 3 cells at t = 0 and t = 25,600");
      assert.ok(diffOver(f0, f1, f0.kinds).d > n3 / 50, "k3:full (the control): the kind 3 cells move with t");
      assert.ok(sumOver(hs0, hs0.kinds).sum < sumOver(hf0, hf0.kinds).sum, "the soft amplitude is lower than the full amplitude at the same phase");
    });

    gpuTest("a bad fx token raises T3_FX_OVERRIDE", async () => {
      const [w, h, dpr] = SIZES["1366x768@1"];
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await mockGithub(page);
      if (E.removeGpu) await page.addInitScript(noGpu);
      await page.goto(`${TEST_BASE}/?fx=k3:bogus`, { waitUntil: "load" });
      await page.waitForTimeout(1500);
      assert.ok(errors.some((m) => m.includes("T3_FX_OVERRIDE: bad token")), `errors: ${errors.join("; ")}`);
      await ctx.close();
    });

    // A-1 (b). Kinds 0 and 4 with no pointer input, outside the mask, take no float part, so the readback equals the CPU
    // pass cell for cell; the capped cells (a zone's) are compared too wherever the CPU cell is also of kind 0 or 4.
    for (const [page, size] of [["home", "1366x768@1"], ["404", "390x844@3"], ["certway", "1366x768@1"]]) {
      gpuTest(`parity: the readback equals the CPU cell pass on kind 0 and 4 cells, ${page} at ${size}`, async () => {
        for (const theme of THEMES) {
          const { ctx, page: pg } = await openHook(PAGES[page], { size, theme });
          let compared = 0;
          for (const [t, tf] of [[0, 3.2], [1.5, 3.2], [5120.5, 99], [6399.5, 99], [8533.8, 99]]) {
            const g = await pg.evaluate(grab, { t, tf, scrollY: 0 });
            const px = unb64(g.b64);
            const idx = idxOfPixels(px, theme);
            const blk = unb64(g.blk).buffer;
            const I = new Int32Array(blk);
            const maskR = [I[12], I[13], I[14], I[15]];
            const W = g.lay.cellsW;
            const rows = idx.length / W;
            let diff = 0;
            for (let cy = 0; cy < rows; cy++) {
              for (let cx = 0; cx < W; cx++) {
                if (cx >= maskR[0] && cx < maskR[0] + maskR[2] && cy >= maskR[1] && cy < maskR[1] + maskR[3]) continue;
                const c = cpu.cell(blk, cx, cy, null);
                if (c.kind !== 0 && c.kind !== 4) continue;
                compared++;
                if (c.idx !== idx[cy * W + cx]) {
                  diff++;
                  if (diff <= 3) console.log(`  parity miss ${page} ${theme} t ${t}: cell ${cx},${cy} gpu ${idx[cy * W + cx]} cpu ${c.idx} (kind ${c.kind}, vd ${c.vd}, vh ${c.vh}, bayer ${c.bayer}, cap ${c.cap})`);
                }
              }
            }
            assert.equal(diff, 0, `${page} ${theme} t ${t}: cells that differ from the CPU pass`);
          }
          assert.ok(compared > 20000, `${compared} cells compared`);
          await ctx.close();
        }
      });
    }

    // A-1 (c): no zone cell brighter than the quiet colour (dark) or darker (light) over static and scrolled positions,
    // with 16 trails and 3 rings, both themes, levels 0 and 4, every page kind. The palette check (d) rides on the same
    // readbacks: every cell is one of the theme's five colours.
    for (const [name, route] of Object.entries(PAGES)) {
      for (const size of ["390x844@3", "1366x768@1"]) {
        gpuTest(`quiet zones and palette: ${name} at ${size}, both themes, levels 0 and 4, scrolled, with pointer input`, async () => {
          for (const theme of THEMES) {
            for (const level of [0, 4]) {
              const { ctx, page, w, h } = await openHook(route, { size, theme, level });
              const lay = await layout(page);
              const stops = [0, 1, 333.5, Math.floor(lay.maxScroll / 2), lay.maxScroll].filter((y, k, all) => y <= lay.maxScroll && all.indexOf(y) === k);
              let zoneCells = 0, zones = 0;
              for (const [k, scrollY] of stops.entries()) {
                const r = await page.evaluate(sample, { t: 7.3 + k, tf: 99, scrollY, input: pointerInput(w, h, scrollY), pal: PAL_RGB[theme], theme });
                assert.equal(r.bad, 0, `${name} ${size} ${theme} level ${level} scrollY ${scrollY}: ${JSON.stringify(r.badAt)}`);
                assert.equal(r.offPalette, 0, `${name} ${size} ${theme} level ${level} scrollY ${scrollY}: cells off the palette`);
                assert.equal(r.D, Math.round((level === 4 ? (w < 760 ? 7 : 6) : w < 760 ? 5 : 4) * (await page.evaluate(() => devicePixelRatio))), "the cell size of the pinned level");
                zoneCells += r.zoneCells;
                zones = Math.max(zones, r.zones);
              }
              assert.ok(zoneCells > 100, `${zoneCells} zone cells were checked`);
              console.log(`  quiet ${E.name} ${name} ${size} ${theme} L${level}: ${stops.length} scroll stops, ${zones} text rects, ${zoneCells} zone cells, 0 bad`);
              await ctx.close();
            }
          }
        });
      }
    }

    // A-2 (c) and the T-018 (a, b) 404 and home formation: tf 0 to 8.2 s in 0.1 s steps, no zone cell past the quiet colour.
    for (const page of ["404", "home"]) {
      for (const size of ["390x844@3", "320x568@2", "1366x768@1"]) {
        if (page === "home" && size === "320x568@2") continue;
        gpuTest(`formation: no zone cell past the quiet colour, tf 0 to 8.2 s every 0.1 s, ${page} at ${size}`, async () => {
          for (const theme of THEMES) {
            for (const level of size === "320x568@2" ? [0] : [0, 4]) {
              const { ctx, page: pg, h } = await openHook(PAGES[page], { size, theme, level });
              let samples = 0;
              for (let step = 0; step <= 82; step++) {
                const tf = step / 10;
                const r = await pg.evaluate(sample, { t: tf, tf, scrollY: 0, maxY: h * 1.6, pal: PAL_RGB[theme], theme });
                assert.equal(r.bad, 0, `${page} ${size} ${theme} L${level} tf ${tf}: ${JSON.stringify(r.badAt)}`);
                assert.equal(r.offPalette, 0, `${page} ${size} ${theme} L${level} tf ${tf}: cells off the palette`);
                samples++;
              }
              console.log(`  formation ${E.name} ${page} ${size} ${theme} L${level}: ${samples} samples, 0 bad`);
              await ctx.close();
            }
          }
        });
      }
    }

    // A-2 (c): the mask. Letter cells at tf 4 (hold) are the lit cells inside the block's mask rectangle; they must agree
    // across engines (the last describe compares) and at tf 2.55 on level 4 the share of the brightest cells is at most 3/16.
    for (const [page, size] of [["home", "1366x768@1"], ["home", "390x844@3"], ["404", "1366x768@1"], ["404", "390x844@3"]]) {
      gpuTest(`mask: ${page} at ${size}, letter cells and the lock bound`, async () => {
        const { ctx, page: pg } = await openHook(PAGES[page], { size, theme: "dark" });
        const counts = async (tf, theme) => {
          const g = await pg.evaluate(grab, { t: tf, tf, scrollY: 0 });
          const idx = idxOfPixels(unb64(g.b64), theme);
          const I = new Int32Array(unb64(g.blk).buffer);
          const [mx, my, mw, mh] = [I[12], I[13], I[14], I[15]];
          const W = g.lay.cellsW;
          let lit = 0, spark = 0;
          for (let cy = my; cy < my + mh && cy * W < idx.length; cy++) for (let cx = mx; cx < mx + mw && cx < W; cx++) {
            const i = idx[cy * W + cx];
            if (i >= 3) lit++;
            if (i === 4) spark++;
          }
          return { lit, spark, mask: mw * mh, D: g.lay.D };
        };
        const held = await counts(4, "dark");
        assert.ok(held.mask > 0 && held.lit > 0.03 * held.mask, `${page} ${size}: ${held.lit} letter cells in a ${held.mask} cell mask`);
        (maskCounts[`${page} ${size}`] ??= {})[E.name] = held;
        const { ctx: ctx4, page: pg4 } = await openHook(PAGES[page], { size, theme: "dark", level: 4 });
        const g = await pg4.evaluate(grab, { t: 2.55, tf: 2.55, scrollY: 0 });
        const idx = idxOfPixels(unb64(g.b64), "dark");
        const I = new Int32Array(unb64(g.blk).buffer);
        const W = g.lay.cellsW;
        let lit = 0, spark = 0;
        for (let cy = I[13]; cy < I[13] + I[15] && cy * W < idx.length; cy++) for (let cx = I[12]; cx < I[12] + I[14] && cx < W; cx++) {
          const i = idx[cy * W + cx];
          if (i >= 3) lit++;
          if (i === 4) spark++;
        }
        assert.ok(lit > 0, "letter cells draw at tf 2.55");
        assert.ok(spark / lit <= 3 / 16, `${page} ${size} level 4 tf 2.55: ${spark} of ${lit} letter cells at the top level, more than 3/16`);
        await ctx4.close();
        await ctx.close();
      });
    }

    // A-2 (c): on the 404 phone no zone cell passes level 2 and the G7 half pattern is present: a letter cell inside a zone
    // draws level 0 where its Bayer value is under 32 and level 2 where it is 32 or more, so a level 2 cell with a Bayer value
    // under 32 would mean the pattern is absent. Level 2 itself cannot come from anything but a capped letter inside a zone.
    gpuTest("404 phone: the G7 half pattern inside the zones, nothing past level 2", async () => {
      const { ctx, page } = await openHook("/nope/x", { size: "390x844@3", theme: "dark" });
      const g = await page.evaluate(grab, { t: 4, tf: 4, scrollY: 0 });
      const idx = idxOfPixels(unb64(g.b64), "dark");
      const I = new Int32Array(unb64(g.blk).buffer);
      assert.equal(I[3] & 16, 16, "the block carries the G7 flag");
      const r = await page.evaluate(sample, { t: 4, tf: 4, scrollY: 0, pal: PAL_RGB.dark, theme: "dark" });
      assert.equal(r.bad, 0);
      // Zone cells inside the mask: the ones at level 2 all have a Bayer value of 32 or more; level 0 cells exist there too.
      const zones = await page.evaluate(() => {
        const out = [];
        const range = document.createRange();
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (n.data.trim() === "" || n.parentElement?.closest("script,style")) continue;
          range.selectNodeContents(n);
          for (const rc of range.getClientRects()) if (rc.width > 0 && rc.height > 0) out.push([Math.floor((rc.left + scrollX - 10) * devicePixelRatio), Math.floor((rc.top + scrollY - 10) * devicePixelRatio), Math.ceil((rc.right + scrollX + 10) * devicePixelRatio), Math.ceil((rc.bottom + scrollY + 10) * devicePixelRatio)]);
        }
        return out;
      });
      const W = g.lay.cellsW, D = g.lay.D;
      const rows = idx.length / W;
      let two = 0, twoLow = 0, zero = 0;
      const seen = new Set();
      for (const [x0, y0, x1, y1] of zones) {
        for (let cy = Math.max(0, Math.floor(y0 / D)); cy <= Math.ceil(y1 / D) - 1 && cy < rows; cy++) {
          for (let cx = Math.max(0, Math.floor(x0 / D)); cx <= Math.ceil(x1 / D) - 1 && cx < W; cx++) {
            if (cx < I[12] || cx >= I[12] + I[14] || cy < I[13] || cy >= I[13] + I[15] || seen.has(cy * W + cx)) continue;
            seen.add(cy * W + cx);
            const i = idx[cy * W + cx];
            if (i === 2) { two++; if (cpu.bayer8(cx, cy) < 32) twoLow++; }
            if (i === 0) zero++;
          }
        }
      }
      assert.ok(two > 20, `level 2 letter cells in the zones: ${two}`);
      assert.ok(zero > 20, `level 0 cells in the zones: ${zero}`);
      assert.equal(twoLow, 0, "no level 2 cell where the Bayer value is under 32");
      await ctx.close();
    });

    // T-018 (a, b): the 404 mask follows the phone rule below 760 px and the laptop rule from 760 px.
    gpuTest("404 mask placement: the phone formula at 759 px, the laptop formula at 760 px", async () => {
      const seen = {};
      for (const size of ["759x844@3", "760x844@3"]) {
        const { ctx, page, w, h, dpr } = await openHook("/nope/x", { size });
        const g = await page.evaluate(grab, { t: 4, tf: 4, scrollY: 0 });
        const I = new Int32Array(unb64(g.blk).buffer);
        const dom = await page.evaluate(() => {
          const top = (el) => el.getBoundingClientRect().top + scrollY;
          const h1 = document.querySelector(".not-found h1"), lead = document.querySelector(".not-found .role");
          return { hdr: document.querySelector("header")?.getBoundingClientRect().height ?? 0, top: top(h1), bottom: lead.getBoundingClientRect().bottom + scrollY };
        });
        const D = I[2];
        const want = core.maskCells(core.maskRect("404", w, h, dom.hdr, { top: dom.top, height: dom.bottom - dom.top }), dpr, D);
        assert.deepEqual({ x0: I[12], y0: I[13], w: I[14], h: I[15] }, want, `${size}: the mask rectangle is the 404 formula's`);
        seen[size] = { x0: I[12], w: I[14], D, g7: (I[3] & 16) !== 0, phone: (I[3] & 32) !== 0 };
        await ctx.close();
      }
      const a = seen["759x844@3"], b = seen["760x844@3"];
      assert.ok(a.g7 && a.phone, "759 px is a phone with G7");
      assert.ok(!b.g7 && !b.phone, "760 px is a laptop without G7");
      assert.ok(Math.abs((a.x0 * a.D) / 3 - 0.16 * 759) <= a.D, "the phone mask starts at 0.16 vw");
      assert.ok(b.x0 * b.D / 3 > 0.16 * 760 + 100, "the laptop mask starts well right of the phone's 0.16 vw");
    });

    // A-2 (b): the intro state. startTf() is 0 when the formation plays and 3.2 when it is over.
    gpuTest("A-2 (b) intro: home plays once per tab, the 404 on every load, pause then play skips it", async () => {
      const startTf = (page) => page.evaluate(() => globalThis.__T3_SEEK__.startTf());
      const reload = async (page) => {
        await page.reload({ waitUntil: "load" });
        await page.waitForFunction(() => globalThis.__T3_SEEK__ !== undefined);
        assert.equal(await page.evaluate(() => globalThis.__T3_SEEK__.ready), true);
      };
      const pausePlay = async (page) => {
        await page.evaluate(() => document.querySelector(".pause").click());
        await page.waitForFunction(() => document.documentElement.dataset.field === undefined);
        await page.evaluate(() => document.querySelector(".pause").click());
        await page.waitForFunction(() => document.documentElement.dataset.field === "on");
      };
      {
        const { ctx, page } = await openHook("/");
        assert.equal(await startTf(page), 0, "home, first load: plays from tf 0");
        assert.equal(await page.evaluate(() => sessionStorage.getItem("motion-intro")), "1", "the key is written at the first drawn frame");
        await reload(page);
        assert.equal(await startTf(page), core.FORMATION_END, "home, reload: starts at tf 3.2");
        await ctx.close();
      }
      {
        const { ctx, page } = await openHook("/");
        await pausePlay(page);
        assert.equal(await startTf(page), core.FORMATION_END, "home, pause during the intro then play: tf 3.2");
        await ctx.close();
      }
      {
        const { ctx, page } = await openHook("/nope/x");
        assert.equal(await startTf(page), 0, "404, first load: plays from tf 0");
        await reload(page);
        assert.equal(await startTf(page), 0, "404, reload: plays from tf 0 again");
        await pausePlay(page);
        assert.equal(await startTf(page), core.FORMATION_END, "404, play after pause: tf 3.2");
        await ctx.close();
      }
    });

    gpuTest("at(): the tracer row follows the scroll position", async () => {
      const { ctx, page } = await openHook("/projects/certway/");
      for (const y of [0, 500, 1200]) {
        const r = await page.evaluate((y) => globalThis.__T3_SEEK__.at(7, 99, y), y);
        assert.equal(r.tracerY, y + 384, `scrollY ${y}`);
      }
      await ctx.close();
    });

    gpuTest("the canvas is not visible before the first draw, and a lost context or device does no harm", async () => {
      const [w, h, dpr] = SIZES["1366x768@1"];
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await mockGithub(page);
      if (E.removeGpu) await page.addInitScript(noGpu);
      // Polls every frame from the first script: a canvas that is visible while html[data-field] is not set is a breach.
      await page.addInitScript(() => {
        window.__early = { checks: 0, visibleBeforeDraw: 0, sawCanvas: false };
        const tick = () => {
          const c = document.querySelector("body > div[aria-hidden='true'] canvas");
          if (c) {
            window.__early.sawCanvas = true;
            window.__early.checks++;
            if (!document.documentElement.dataset.field && getComputedStyle(c).visibility !== "hidden") window.__early.visibleBeforeDraw++;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await page.goto(`${TEST_BASE}/`, { waitUntil: "load" });
      await page.waitForFunction(() => globalThis.__T3_SEEK__ !== undefined);
      assert.equal(await page.evaluate(() => globalThis.__T3_SEEK__.ready), true);
      const early = await page.evaluate(() => window.__early);
      assert.equal(early.visibleBeforeDraw, 0, `the canvas was visible before its first draw (${early.checks} checks)`);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.field), "on");
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("body > div[aria-hidden='true'] canvas")).visibility), "visible");
      // Force the loss. WebGPU: the device is destroyed and the page stays at tier 2. WebGL2: the context is lost; the
      // frame loop must not throw and the page keeps its text.
      await page.evaluate(() => globalThis.__T3_SEEK__.lose());
      if (E.api === "webgpu") {
        await page.waitForFunction(() => document.documentElement.dataset.tier === "2", undefined, { timeout: 5000 });
        assert.equal(await page.evaluate(() => document.querySelector("body > div[aria-hidden='true'] canvas")), null, "the canvas is gone after a lost device");
      } else {
        await page.waitForTimeout(500);
      }
      assert.ok(await page.locator("h1").first().isVisible(), "the page still reads");
      assert.deepEqual(errors, []);
      await ctx.close();
    });
  });
}

// ---- A-1 (g): the frame-time budget, asserted on the user's machine only ----

for (const E of ENGINES.filter((e) => e.name !== "chromium webgpu")) {
  describe(`frame-time budget in ${E.name === "chromium webgl2" ? "chromium" : E.name}`, () => {
    let browser;
    before(async () => {
      if (process.platform === "linux") return; // the platform check comes first, so a Linux run launches nothing
      browser = allowSoftwareRenderer(E.name === "chromium webgl2" ? await launchFullChromium({ webgpu: false }) : await E.launch());
    });
    after(async () => { await browser?.close(); });

    test(`A-1 (g) the worst-case scene costs under 4 ms a frame at 1366 x 768 @1 on WebGL2 (${E.name === "chromium webgl2" ? "chromium" : E.name})`, async (t) => {
      if (process.platform === "linux") return t.skip("frame-time budget is local-only: linux runner");
      const open = async (route) => {
        const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
        const page = await ctx.newPage();
        await mockGithub(page);
        await page.addInitScript(noGpu);
        await page.addInitScript(pinLevel(0));
        await page.goto(TEST_BASE + route, { waitUntil: "load" });
        await page.waitForFunction(() => globalThis.__T3_SEEK__ !== undefined);
        return { ctx, page };
      };
      const reason = await gpuSkipReason(E, browser);
      if (reason) return t.skip(reason);
      // The tallest built page: the page heights are logged, the measurement runs on the tallest.
      const heights = {};
      for (const [name, route] of Object.entries(PAGES)) {
        const { ctx, page } = await open(route);
        await page.evaluate(() => globalThis.__T3_SEEK__.ready);
        heights[name] = await page.evaluate(() => document.documentElement.scrollHeight);
        await ctx.close();
      }
      const tallest = Object.keys(heights).reduce((a, b) => (heights[b] > heights[a] ? b : a));
      const { ctx, page } = await open(PAGES[tallest]);
      assert.equal(await page.evaluate(() => globalThis.__T3_SEEK__.ready), true);
      const lay = await layout(page);
      assert.equal(lay.renderer.api, "webgl2", "the frame time is measured on WebGL2");
      const runs = [];
      for (let k = 0; k < 3; k++) runs.push((await page.evaluate(() => globalThis.__T3_SEEK__.bench(300, 2.0, 2.0))).perFrameMs);
      runs.sort((a, b) => a - b);
      const median = runs[1];
      console.log(`  A-1 (g) ${E.name}: page ${tallest} height ${heights[tallest]} px at 1366 (all: ${JSON.stringify(heights)}), renderer ${lay.renderer.name}, runs ${runs.map((r) => r.toFixed(3)).join(" ")} ms, median ${median.toFixed(3)} ms per frame`);
      assert.ok(median < 4, `frame time ${median.toFixed(3)} ms on ${tallest} (${heights[tallest]} px at 1366), over the 4 ms budget`);
      await ctx.close();
    });
    const layout = (page) => page.evaluate(() => globalThis.__T3_SEEK__.layout());
  });
}

// ---- Cross-engine comparisons ----

describe("seek hook across engines", () => {
  test("A-2 (c): the letter cell counts of the masks agree within 5 % across the engines that ran", () => {
    for (const [key, byEngine] of Object.entries(maskCounts)) {
      const engines = Object.keys(byEngine);
      const lits = engines.map((e) => byEngine[e].lit);
      const lo = Math.min(...lits), hi = Math.max(...lits);
      console.log(`  mask ${key}: ${engines.map((e) => `${e} ${byEngine[e].lit}`).join(", ")}`);
      assert.ok(hi <= lo * 1.05, `${key}: letter cells ${JSON.stringify(lits)} differ by more than 5 %`);
    }
  });
});
