// The cross-document transition (T-032; D-041, design.md DV-02.5): the card-to-page morph from home to the certway
// and "This site" pages, the 0.25 s crossfade on every other same-origin navigation, and an instant cut under reduced
// motion and while paused. The head script and style live inline in index.html.
// Cases (a) to (f) read the transition's state and run in Chromium only; Firefox and WebKit run case (g), so each case is
// registered only for the browsers it runs in and none skips (CR10-B2).
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { chromium, firefox, webkit } from "playwright";
import { mockGithub } from "../tests/acceptance/github-mock.cjs";
import { BASE, buildAndServe, stopAll } from "./helpers.mjs";

before(async () => { await buildAndServe(); });
after(async () => { await stopAll(); });

const ENGINES = { chromium, firefox, webkit };
const launch = (engine) => ENGINES[engine].launch({ headless: true, executablePath: engine === "chromium" ? process.env.CHROMIUM_PATH || undefined : undefined });

// Runs in every document before its own scripts. It logs what each document sees into sessionStorage (which survives
// the navigation) under `__vt`: the names carried at `pageswap`, the transition state at `pagereveal`, the names and
// the pseudo-element animations when the transition is ready, every skipTransition() call, and every unhandled rejection.
// The listeners that read names are registered after the head script's own, so they see the names it set.
const probe = () => {
  const log = (entry) => {
    try {
      const all = JSON.parse(sessionStorage.getItem("__vt") || "[]");
      all.push(entry);
      sessionStorage.setItem("__vt", JSON.stringify(all));
    } catch {}
  };
  // The root element always reports its own name `root` (the crossfade), so it is not a morph name.
  const names = () => [...document.querySelectorAll("body, body *")]
    .map((el) => [getComputedStyle(el).viewTransitionName, el.id || String(el.className).split(" ")[0] || el.tagName])
    .filter(([name]) => name !== "none")
    .map(([name, where]) => `${name}@${where}`);
  window.__names = names;
  const skip = ViewTransition.prototype.skipTransition;
  ViewTransition.prototype.skipTransition = function () {
    log({ ev: "skip" });
    return skip.apply(this, arguments);
  };
  addEventListener("unhandledrejection", (e) => log({ ev: "unhandled", reason: String(e.reason) }));
  addEventListener("DOMContentLoaded", () => addEventListener("pageswap", (e) => log({ ev: "pageswap", vt: !!e.viewTransition, names: names() })));
  addEventListener("pagereveal", (e) => {
    const vt = e.viewTransition;
    log({ ev: "pagereveal", vt: !!vt });
    if (!vt) return;
    vt.ready.then(() => log({
      ev: "ready",
      names: names(),
      animations: document.getAnimations()
        .filter((a) => a.effect && a.effect.pseudoElement)
        .map((a) => ({ pseudo: a.effect.pseudoElement, duration: a.effect.getTiming().duration })),
    }), () => log({ ev: "ready-rejected" }));
    vt.finished.then(() => log({ ev: "finished" }), () => log({ ev: "finished-rejected" }));
  });
};

// Layout shift, summed from the start of the document (shifts right after an input do not count, as in CLS).
const trackShift = () => {
  window.__cls = 0;
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
  }).observe({ type: "layout-shift", buffered: true });
};

// The 404 page's own status makes the browser log "Failed to load resource ... 404"; that is the browser's notice, not the page's.
const isProblem = (m) => m.type() === "error" && !/Failed to load resource.*404/.test(m.text());

/**
 * Waits until the loader has started tier 2 (its input worker), so that the navigation that follows does not cut a worker
 * script load short: WebKit reports that as a pageerror of its own. Not for reduced motion or the pause: those stop at tier 0.
 */
const loaderIdle = (page) => page.waitForFunction(() => Number(document.documentElement.dataset.tier) >= 2);

const pausePreset = () => { try { sessionStorage.setItem("motion-paused", "1"); } catch {} };

/** The navigations that start from home and morph: the card's link, then the page it reaches. */
const MORPHS = [
  { label: "home to certway", link: '#certway a[href="/projects/certway/"]', url: "/projects/certway/", card: "certway" },
  { label: 'home to "This site" (the report)', link: '#this-site a[href="/report/"]', url: "/report/", card: "this-site" },
];

async function open(browser, { reduce = false, paused = false, shift = false, start = "/" } = {}) {
  const ctx = await browser.newContext({ reducedMotion: reduce ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  const problems = [];
  page.on("console", (m) => { if (isProblem(m)) problems.push(`${m.type()}: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  await mockGithub(page); // the live read (T-027) is answered by the fixtures, never by the real API
  await page.addInitScript(probe);
  if (shift) await page.addInitScript(trackShift);
  if (paused) await page.addInitScript(pausePreset);
  await page.goto(BASE + start, { waitUntil: "load" });
  await page.waitForFunction(() => window.__hydrated === true);
  if (!reduce && !paused) await loaderIdle(page);
  await page.evaluate(() => sessionStorage.removeItem("__vt")); // the first load's own pagereveal is not a navigation
  return { ctx, page, problems };
}

const readLog = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("__vt") || "[]"));

/** Waits until the arriving page is hydrated and its transition (if it has one) has finished, then returns the log. */
async function settle(page, url) {
  await page.waitForURL((u) => u.pathname === url);
  await page.waitForFunction(() => window.__hydrated === true);
  await page.waitForFunction(() => {
    const log = JSON.parse(sessionStorage.getItem("__vt") || "[]");
    const reveal = log.find((e) => e.ev === "pagereveal");
    return !!reveal && (!reveal.vt || log.some((e) => e.ev === "finished" || e.ev === "finished-rejected"));
  });
  return readLog(page);
}

/** What one navigation logged, flattened to the parts the cases compare. */
function summary(log) {
  const swap = log.find((e) => e.ev === "pageswap");
  const reveal = log.find((e) => e.ev === "pagereveal");
  const ready = log.find((e) => e.ev === "ready");
  return {
    swap,
    reveal,
    ready,
    skips: log.filter((e) => e.ev === "skip").length,
    unhandled: log.filter((e) => e.ev === "unhandled"),
    pseudos: ready ? ready.animations.map((a) => a.pseudo) : [],
    duration: (pseudo) => ready?.animations.find((a) => a.pseudo === pseudo)?.duration,
  };
}

const unique = (names) => new Set(names.map((n) => n.split("@")[0])).size === names.length;

/** The navigations that are not the morph: header links, a script navigation, the 404 link list. */
const OTHERS = [
  { label: "certway to home (header link)", start: "/projects/certway/", go: (p) => p.click('header a[href="/"]'), url: "/" },
  { label: "report to home (header link)", start: "/report/", go: (p) => p.click('header a[href="/"]'), url: "/" },
  { label: "certway to the report (script)", start: "/projects/certway/", go: (p) => p.evaluate(() => { location.href = "/report/"; }), url: "/report/" },
  { label: "home to a missing page (script)", start: "/", go: (p) => p.evaluate(() => { location.href = "/nope/x"; }), url: "/nope/x" },
  { label: "404 to home (link list)", start: "/nope/x", go: (p) => p.click('main a[href="/"]'), url: "/" },
];

describe("cross-document transition in chromium", () => {
  let browser;
  before(async () => { browser = await launch("chromium"); });
  after(async () => { await browser?.close(); });

  // (a) The two morphs: old and new snapshots carry the same name, on the card and on the band.
  for (const m of MORPHS) {
    test(`(a) ${m.label}: the card and the band carry one name and the group runs 0.76 s`, async () => {
      const { ctx, page, problems } = await open(browser);
      await page.click(m.link);
      const s = summary(await settle(page, m.url));
      assert.deepEqual(s.swap, { ev: "pageswap", vt: true, names: [`case-card@${m.card}`] });
      assert.equal(s.reveal.vt, true, "the new page received a transition");
      assert.deepEqual(s.ready.names, ["case-card@band"]);
      for (const part of ["group", "image-pair", "old", "new"]) {
        assert.ok(s.pseudos.includes(`::view-transition-${part}(case-card)`), `::view-transition-${part}(case-card) animates: ${s.pseudos.join(" ")}`);
      }
      assert.equal(s.duration("::view-transition-group(case-card)"), 760);
      assert.deepEqual(await page.evaluate(() => window.__names()), [], "the names are removed when the transition finished");
      assert.deepEqual(problems, []);
      await ctx.close();
    });
  }

  // (b) Every other navigation: the 0.25 s root crossfade and no name on any element.
  for (const o of OTHERS) {
    test(`(b) ${o.label}: crossfade, no morph name`, async () => {
      const { ctx, page, problems } = await open(browser, { start: o.start });
      await o.go(page);
      const s = summary(await settle(page, o.url));
      assert.deepEqual(s.swap, { ev: "pageswap", vt: true, names: [] });
      assert.equal(s.reveal.vt, true, "the new page received a transition");
      assert.deepEqual(s.ready.names, []);
      assert.ok(s.pseudos.includes("::view-transition-old(root)") && s.pseudos.includes("::view-transition-new(root)"), `the root crossfade runs: ${s.pseudos.join(" ")}`);
      assert.ok(!s.pseudos.some((p) => p.includes("case-card")), `no morph group: ${s.pseudos.join(" ")}`);
      assert.equal(s.duration("::view-transition-old(root)"), 250);
      assert.equal(s.duration("::view-transition-new(root)"), 250);
      assert.deepEqual(problems, []);
      await ctx.close();
    });
  }

  // (c) Reduced motion and the pause (motion-paused = 1) run no transition, for the morph and for a crossfade.
  for (const mode of [{ label: "reduced motion emulated", opts: { reduce: true } }, { label: "motion-paused = 1", opts: { paused: true } }]) {
    test(`(c) ${mode.label}: no transition on either kind of navigation`, async () => {
      const runs = [
        { start: "/", go: (p) => p.click(MORPHS[0].link), url: MORPHS[0].url },
        { start: "/", go: (p) => p.click(MORPHS[1].link), url: MORPHS[1].url },
        { start: "/projects/certway/", go: (p) => p.click('header a[href="/"]'), url: "/" },
      ];
      for (const r of runs) {
        const { ctx, page, problems } = await open(browser, { ...mode.opts, start: r.start });
        await r.go(page);
        const log = await settle(page, r.url);
        const s = summary(log);
        assert.equal(s.reveal.vt, false, `${r.start} to ${r.url}: the new page received no transition`);
        assert.equal(s.ready, undefined, "the transition never became ready");
        assert.deepEqual(await page.evaluate(() => window.__names()), []);
        assert.deepEqual(problems, []);
        if (mode.opts.paused) assert.ok(s.skips >= 1, "the pause skipped the transition");
        await ctx.close();
      }
    });
  }

  // (d) One name per page at every snapshot, through forward, back and forward again.
  test("(d) no two elements carry one name at a snapshot, through a forward, back and forward sequence", async () => {
    const { ctx, page, problems } = await open(browser);
    const snapshots = [];
    const step = async (act, url) => {
      await page.evaluate(() => sessionStorage.removeItem("__vt"));
      await act();
      const s = summary(await settle(page, url));
      if (s.swap) snapshots.push(s.swap.names);
      if (s.ready) snapshots.push(s.ready.names);
      return s;
    };
    await step(() => page.click(MORPHS[0].link), MORPHS[0].url);
    await step(() => page.goBack(), "/");
    await step(() => page.click(MORPHS[1].link), MORPHS[1].url);
    await step(() => page.goBack(), "/");
    await step(() => page.click(MORPHS[0].link), MORPHS[0].url);
    assert.ok(snapshots.length >= 8, `snapshots taken: ${snapshots.length}`);
    for (const names of snapshots) assert.ok(unique(names), `names at a snapshot: ${names.join(" ")}`);
    assert.ok(snapshots.every((names) => names.length <= 1), "at most one element is named at a snapshot");
    assert.deepEqual(problems, [], "no duplicate-name error reached the console");
    await ctx.close();
  });

  // (e) skipTransition() is followed by a handled ready rejection: no unhandled rejection and no console error.
  test("(e) every skipTransition() leaves no unhandled rejection", async () => {
    const targets = [
      { start: "/", go: (p) => p.click(MORPHS[0].link), url: MORPHS[0].url },
      { start: "/", go: (p) => p.click(MORPHS[1].link), url: MORPHS[1].url },
      { start: "/projects/certway/", go: (p) => p.click('header a[href="/"]'), url: "/" },
    ];
    let skips = 0;
    for (let round = 0; round < 3; round++) {
      for (const t of targets) {
        const { ctx, page, problems } = await open(browser, { paused: true, start: t.start });
        await t.go(page);
        const s = summary(await settle(page, t.url));
        skips += s.skips;
        assert.deepEqual(s.unhandled, [], `${t.start} to ${t.url}: unhandled rejections`);
        assert.deepEqual(problems, [], `${t.start} to ${t.url}: console`);
        await ctx.close();
      }
    }
    assert.ok(skips >= 9, `skipTransition() was called on every paused navigation (${skips} calls)`);
  });

  // (f) CLS on the target page, hydration done, after the transition.
  for (const m of MORPHS) {
    test(`(f) ${m.label}: CLS on the target page stays below 0.1`, async () => {
      const { ctx, page } = await open(browser, { shift: true });
      await page.click(m.link);
      await settle(page, m.url);
      await page.waitForTimeout(500);
      const cls = await page.evaluate(() => window.__cls);
      assert.ok(cls < 0.1, `CLS ${cls}`);
      await ctx.close();
    });
  }
});

// (g) Firefox and WebKit: the same navigations complete, with no console error.
for (const engine of ["firefox", "webkit"]) {
  describe(`cross-document navigations in ${engine}`, () => {
    let browser;
    before(async () => { browser = await launch(engine); });
    after(async () => { await browser?.close(); });

    const all = [
      ...MORPHS.map((m) => ({ label: m.label, start: "/", go: (p) => p.click(m.link), url: m.url })),
      ...OTHERS,
    ];
    for (const n of all) {
      test(`(g) ${n.label}: completes with no console error`, async () => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        const problems = [];
        page.on("console", (m) => { if (isProblem(m)) problems.push(`${m.type()}: ${m.text()}`); });
        page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
        await mockGithub(page);
        await page.goto(BASE + n.start, { waitUntil: "load" });
        await page.waitForFunction(() => window.__hydrated === true);
        await loaderIdle(page);
        await n.go(page);
        await page.waitForURL((u) => u.pathname === n.url);
        await page.waitForFunction(() => window.__hydrated === true);
        assert.ok((await page.locator("h1").first().innerText()).length > 0, "the page is readable");
        await page.waitForTimeout(1000); // past the 0.76 s morph where the engine runs one
        assert.deepEqual(problems, []);
        await ctx.close();
      });
    }
  });
}
