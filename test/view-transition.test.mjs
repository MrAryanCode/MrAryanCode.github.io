// The cross-document transition (T-032; D-041, design.md DV-02.5): the card-to-page morph from home to the certway
// and "This site" pages, the 0.25 s crossfade on every other same-origin navigation, and an instant cut under reduced
// motion and while paused. The head script lives inline in index.html and inserts the opt-in as a <style> while the head
// is parsed (D-061); the ::view-transition-* rules are in src/style.css.
// Cases (a) to (f) read the transition's state and run in Chromium only; Firefox and WebKit run case (g), so each case is
// registered only for the browsers it runs in and none skips (CR10-B2).
// D-061 asks for proof that the script-inserted opt-in is reliable: the Back case and case (d) are registered REPEATS times
// more in Chromium, named "[repeat n/REPEATS]", and all of them must pass within one run.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { chromium, firefox, webkit } from "playwright";
import { mockGithub } from "../tests/acceptance/github-mock.cjs";
import { readFileSync } from "node:fs";
import { BASE, buildAndServe, dist, html, stopAll } from "./helpers.mjs";

before(async () => { await buildAndServe(); });
after(async () => { await stopAll(); });

const REPEATS = 20;
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
    vt.ready.then(() => {
      log({
        ev: "ready",
        names: names(),
        animations: document.getAnimations()
          .filter((a) => a.effect && a.effect.pseudoElement)
          .map((a) => ({ pseudo: a.effect.pseudoElement, duration: a.effect.getTiming().duration })),
      });
      // Test-only: freeze the transition at t = 0 so the pseudo-element tree can be read over CDP.
      if (sessionStorage.getItem("__pause") === "1") {
        for (const a of document.getAnimations()) a.pause();
        window.__vtPaused = true;
      }
    }, () => log({ ev: "ready-rejected" }));
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

async function open(browser, { reduce = false, paused = false, shift = false, start = "/", viewport = undefined } = {}) {
  const ctx = await browser.newContext({ reducedMotion: reduce ? "reduce" : "no-preference", viewport });
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

/**
 * Waits until the arriving page is hydrated and its transition (if it has one) has finished, then returns the log.
 * A page restored from the back-forward cache fires no load event, so that case passes "commit".
 */
async function settle(page, url, waitUntil = "load") {
  await page.waitForURL((u) => u.pathname === url, { waitUntil });
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

/** The three pairs of the morph (T-037), in document order: the box, the title, the summary. */
const PAIRS = ["case-card", "case-title", "case-summary"];
const PAIR_RE = /\((case-card|case-title|case-summary)\)/;
/** The names each side carries, in the probe's `name@id|class|TAG` form. */
const swapNames = (card) => [`case-card@${card}`, `case-title@${card}-h`, "case-summary@card-summary"];
const REVEAL_NAMES = ["case-card@band", "case-title@H1", "case-summary@lead"];

/** The view-transition pseudo-element tree of the page, one indented line per pseudo-element, read over CDP. */
async function pseudoTree(page) {
  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  await cdp.detach();
  const lines = [];
  const walk = (node, depth) => {
    for (const p of node.pseudoElements || []) {
      if (!p.pseudoType.startsWith("view-transition")) continue;
      lines.push("  ".repeat(depth) + p.pseudoType + (p.pseudoIdentifier ? `(${p.pseudoIdentifier})` : ""));
      walk(p, depth + 1);
    }
  };
  walk(root.children.find((n) => n.nodeName === "HTML"), 0);
  return lines;
}

/** Flat rendering: every group is a child of ::view-transition and has both an old and a new image. */
const FLAT_TREE = ["view-transition", ...["root", ...PAIRS].flatMap((n) => [
  `  view-transition-group(${n})`,
  `    view-transition-image-pair(${n})`,
  `      view-transition-old(${n})`,
  `      view-transition-new(${n})`,
])];

/**
 * The href of every <link> in the markup that loads a stylesheet (G-69): rel holds the token "stylesheet", so
 * rel="alternate stylesheet" counts, and the href may be double-quoted, single-quoted or unquoted.
 */
const stylesheetHrefs = (markup) => [...markup.matchAll(/<link\b[^>]*>/g)].map((m) => m[0])
  .filter((tag) => /\brel=(?:"[^"]*\bstylesheet\b[^"]*"|'[^']*\bstylesheet\b[^']*'|stylesheet\b)/i.test(tag))
  .map((tag) => tag.match(/\bhref=(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i))
  .filter(Boolean)
  .map((m) => m[1] ?? m[2] ?? m[3]);

/** Goes from home to the certway page by its card and waits until that page is quiet, so that Back has a page to return to. */
async function visitCertway(page) {
  await page.click(MORPHS[0].link);
  await page.waitForURL((u) => u.pathname === MORPHS[0].url);
  await page.waitForFunction(() => window.__hydrated === true);
  await loaderIdle(page);
  await page.waitForTimeout(1000); // past the 0.76 s morph
}

/** Goes home to certway by its card, then Back to home, and waits until home is quiet, so that Forward has a page to return to. */
async function visitCertwayAndBack(page) {
  await visitCertway(page);
  await page.goBack();
  await page.waitForURL((u) => u.pathname === "/");
  await page.waitForFunction(() => window.__hydrated === true);
  await loaderIdle(page);
  await page.waitForTimeout(1000); // past the Back crossfade, so its `finished` is not read as the next navigation's
}

/** The navigations that are not the morph: header links, a script navigation, the 404 link list. */
const OTHERS = [
  { label: "certway to home (header link)", start: "/projects/certway/", go: (p) => p.click('header a[href="/"]'), url: "/" },
  { label: "report to home (header link)", start: "/report/", go: (p) => p.click('header a[href="/"]'), url: "/" },
  { label: "certway to home (Back)", start: "/", prepare: visitCertway, go: (p) => p.goBack(), url: "/" },
  // G-68: the morph follows a click on the card in that page's lifetime; Forward and a script-set location.href to a target do not.
  { label: "home to certway (Forward)", start: "/", prepare: visitCertwayAndBack, go: (p) => p.goForward(), url: "/projects/certway/" },
  { label: "home to certway (script)", start: "/", go: (p) => p.evaluate(() => { location.href = "/projects/certway/"; }), url: "/projects/certway/" },
  { label: "home to the report (footer link)", start: "/", go: (p) => p.click('footer a[href="/report/"]'), url: "/report/" },
  { label: "certway to the report (script)", start: "/projects/certway/", go: (p) => p.evaluate(() => { location.href = "/report/"; }), url: "/report/" },
  { label: "home to a missing page (script)", start: "/", go: (p) => p.evaluate(() => { location.href = "/nope/x"; }), url: "/nope/x" },
  { label: "404 to home (link list)", start: "/nope/x", go: (p) => p.click('main a[href="/"]'), url: "/" },
];

describe("cross-document transition in chromium", () => {
  let browser;
  before(async () => { browser = await launch("chromium"); });
  after(async () => { await browser?.close(); });

  // (a) The morphs: old and new snapshots carry the same three names; each group runs 0.76 s.
  for (const m of MORPHS) {
    test(`(a) ${m.label}: box, title and summary each carry one name on both pages`, async () => {
      const { ctx, page, problems } = await open(browser);
      await page.click(m.link);
      const s = summary(await settle(page, m.url));
      assert.deepEqual(s.swap, { ev: "pageswap", vt: true, names: swapNames(m.card) });
      assert.equal(s.reveal.vt, true, "the new page received a transition");
      assert.deepEqual(s.ready.names, REVEAL_NAMES);
      for (const n of PAIRS) {
        for (const part of ["group", "old", "new"]) {
          assert.ok(s.pseudos.includes(`::view-transition-${part}(${n})`), `::view-transition-${part}(${n}) animates: ${s.pseudos.join(" ")}`);
        }
        assert.equal(s.duration(`::view-transition-group(${n})`), 760);
      }
      assert.equal(s.duration("::view-transition-group(root)"), 250);
      assert.deepEqual(await page.evaluate(() => window.__names()), [], "the names are removed when the transition finished");
      assert.deepEqual(problems, []);
      await ctx.close();
    });

    test(`(a) ${m.label}: the pseudo-element tree pairs an old and a new image for each name`, async () => {
      const { ctx, page, problems } = await open(browser);
      await page.evaluate(() => sessionStorage.setItem("__pause", "1"));
      await page.click(m.link);
      await page.waitForURL((u) => u.pathname === m.url);
      // Paused at ready, or no transition at all: fail at once instead of timing out.
      await page.waitForFunction(() => window.__vtPaused === true
        || JSON.parse(sessionStorage.getItem("__vt") || "[]").some((e) => e.ev === "pagereveal" && !e.vt));
      assert.equal(await page.evaluate(() => window.__vtPaused === true), true, "the transition became ready and paused");
      assert.deepEqual(await pseudoTree(page), FLAT_TREE);
      const easing = await page.evaluate((pairs) => pairs.map((n) =>
        getComputedStyle(document.documentElement, `::view-transition-group(${n})`).animationTimingFunction), PAIRS);
      assert.deepEqual(easing, PAIRS.map(() => "cubic-bezier(0.2, 0, 0, 1)"));
      await page.evaluate(() => { sessionStorage.removeItem("__pause"); for (const a of document.getAnimations()) a.play(); });
      await settle(page, m.url);
      assert.deepEqual(problems, []);
      await ctx.close();
    });
  }

  // (a) The title is legible mid-morph (T-037, G-69; reference cross-document-view-transitions-text-morphs section 3): paused at
  // ready, the glyphs of the old h3 image and of the new h1 image are the same size. The old image shows the h3's whole line
  // box, 1.25 x its font size, so its glyph height is its height / 1.25; the new image shows all of the h1's lines, one font size
  // each, so its glyph height is its height / lines. Without src/style.css's title rules the two images are scaled to the group's
  // width and differ about 2x (the reference measured 1 line at 1280 px; 2 lines at 390 px). The reference gives no numeric
  // tolerance: it measured 69.1 px against 69.1 px, so 2 % leaves room for rounding and stays far from the 2x defect.
  const H3_LINE_HEIGHT = 1.25;
  const GLYPH_TOLERANCE = 0.02;
  const TITLE_VIEWPORTS = [{ label: "1280 px wide", viewport: { width: 1280, height: 800 } }, { label: "390 px wide", viewport: { width: 390, height: 844 } }];
  for (const m of MORPHS) {
    for (const v of TITLE_VIEWPORTS) {
      test(`(a) ${m.label} at ${v.label}: paused at ready, the old and new title images carry glyphs of one size`, async () => {
        const { ctx, page, problems } = await open(browser, { viewport: v.viewport });
        await page.evaluate(() => sessionStorage.setItem("__pause", "1"));
        await page.click(m.link);
        await page.waitForURL((u) => u.pathname === m.url);
        await page.waitForFunction(() => window.__vtPaused === true
          || JSON.parse(sessionStorage.getItem("__vt") || "[]").some((e) => e.ev === "pagereveal" && !e.vt));
        assert.equal(await page.evaluate(() => window.__vtPaused === true), true, "the transition became ready and paused");
        const t = await page.evaluate(() => {
          const px = (pseudo, prop) => parseFloat(getComputedStyle(document.documentElement, pseudo)[prop]);
          const h1 = document.querySelector(".band > h1");
          return {
            lines: Math.max(1, Math.round(h1.getBoundingClientRect().height / parseFloat(getComputedStyle(h1).lineHeight))),
            oldHeight: px("::view-transition-old(case-title)", "height"),
            newHeight: px("::view-transition-new(case-title)", "height"),
          };
        });
        assert.ok(t.oldHeight > 0 && t.newHeight > 0, `both title images have a height: ${JSON.stringify(t)}`);
        const oldGlyph = t.oldHeight / H3_LINE_HEIGHT, newGlyph = t.newHeight / t.lines;
        assert.ok(Math.abs(oldGlyph / newGlyph - 1) <= GLYPH_TOLERANCE,
          `glyph height of the old image ${oldGlyph.toFixed(2)} px against the new ${newGlyph.toFixed(2)} px (${t.lines} line(s)): ${JSON.stringify(t)}`);
        await page.evaluate(() => { sessionStorage.removeItem("__pause"); for (const a of document.getAnimations()) a.play(); });
        await settle(page, m.url);
        assert.deepEqual(problems, []);
        await ctx.close();
      });
    }
  }

  // (b) Every other navigation: the 0.25 s root crossfade and no name on any element.
  const crossfade = async (o) => {
    const { ctx, page, problems } = await open(browser, { start: o.start });
    if (o.prepare) {
      await o.prepare(page);
      await page.evaluate(() => sessionStorage.removeItem("__vt"));
    }
    await o.go(page);
    const s = summary(await settle(page, o.url));
    assert.deepEqual(s.swap, { ev: "pageswap", vt: true, names: [] });
    assert.equal(s.reveal.vt, true, "the new page received a transition");
    assert.deepEqual(s.ready.names, []);
    assert.ok(s.pseudos.includes("::view-transition-old(root)") && s.pseudos.includes("::view-transition-new(root)"), `the root crossfade runs: ${s.pseudos.join(" ")}`);
    assert.ok(!s.pseudos.some((p) => PAIR_RE.test(p)), `no morph group: ${s.pseudos.join(" ")}`);
    assert.equal(s.duration("::view-transition-old(root)"), 250);
    assert.equal(s.duration("::view-transition-new(root)"), 250);
    assert.deepEqual(problems, []);
    await ctx.close();
  };
  for (const o of OTHERS) test(`(b) ${o.label}: crossfade, no morph name`, () => crossfade(o));

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
  const oneNamePerSnapshot = async () => {
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
    assert.ok(snapshots.every((names) => names.length === 0 || names.length === 3), "a snapshot names none or all three parts");
    assert.deepEqual(problems, [], "no duplicate-name error reached the console");
    await ctx.close();
  };
  test("(d) no two elements carry one name at a snapshot, through a forward, back and forward sequence", oneNamePerSnapshot);

  // D-061: the Back case and (d) again, each REPEATS times in this run, with 0 failures allowed.
  const back = OTHERS.find((o) => o.label === "certway to home (Back)");
  for (let n = 1; n <= REPEATS; n++) {
    test(`(b) certway to home (Back): crossfade, no morph name [repeat ${n}/${REPEATS}]`, () => crossfade(back));
    test(`(d) no two elements carry one name at a snapshot, through a forward, back and forward sequence [repeat ${n}/${REPEATS}]`, oneNamePerSnapshot);
  }

  // G-68: a ctrl-click on the card opens a tab and leaves this page where it is; a script navigation that follows it is not a card click.
  test("(b) home to certway (script after a ctrl-click on the card): crossfade, no morph name", () => crossfade({
    start: "/",
    go: async (p) => {
      await p.click(MORPHS[0].link, { modifiers: ["Control"] });
      await p.evaluate(() => { location.href = "/projects/certway/"; });
    },
    url: "/projects/certway/",
  }));

  // Without JavaScript there is no opt-in and no names: a click on a card and on a header link is an instant cut.
  test("(h) without JavaScript: navigations complete with no console error and no static opt-in exists", async () => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    const problems = [];
    page.on("console", (m) => { if (isProblem(m)) problems.push(`${m.type()}: ${m.text()}`); });
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    await page.goto(BASE + "/", { waitUntil: "load" });
    await page.click(MORPHS[0].link);
    await page.waitForURL((u) => u.pathname === MORPHS[0].url);
    assert.ok((await page.locator("h1").first().innerText()).length > 0, "the certway page is readable");
    await page.click('header a[href="/"]');
    await page.waitForURL((u) => u.pathname === "/");
    assert.ok((await page.locator("h1").first().innerText()).length > 0, "home is readable");
    assert.deepEqual(problems, []);
    await ctx.close();
    // All four pages: no <style> in the markup holds the opt-in and no linked stylesheet does either; only the script inserts it.
    for (const file of ["index.html", "projects/certway/index.html", "report/index.html", "404.html"]) {
      const page = html(file);
      const sheets = stylesheetHrefs(page);
      assert.ok(sheets.length > 0, `${file} links its stylesheet`);
      assert.ok(!/<style[^>]*>[^<]*@view-transition/.test(page), `${file}: no <style> of the markup holds the opt-in`);
      for (const href of sheets) assert.ok(!/@view-transition/.test(readFileSync(dist(href.replace(/^\//, "")), "utf8")), `${file}: ${href} holds no opt-in`);
    }
  });

  // G-69: case (h)'s stylesheet filter must not miss a stylesheet that could carry the opt-in. The first two fixtures are
  // ones the earlier filter (rel="?stylesheet"? and a double-quoted href only) returned nothing for.
  test("(h) the stylesheet filter catches an unquoted href", () => {
    assert.deepEqual(stylesheetHrefs('<link rel="stylesheet" href=/assets/unquoted.css>'), ["/assets/unquoted.css"]);
  });
  test("(h) the stylesheet filter catches rel=\"alternate stylesheet\"", () => {
    assert.deepEqual(stylesheetHrefs('<link rel="alternate stylesheet" href="/assets/alternate.css" title="alt">'), ["/assets/alternate.css"]);
  });
  test("(h) the stylesheet filter keeps a quoted stylesheet and skips other links", () => {
    assert.deepEqual(stylesheetHrefs('<link rel="stylesheet" crossorigin href="/assets/quoted.css"><link rel="icon" href="/favicon.ico">'), ["/assets/quoted.css"]);
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

// G-68 with the back-forward cache on: the headless shell the other cases run in has no cache, so this one launches full Chromium
// (CHROMIUM_FULL_PATH on a machine whose installed revision is not the pinned one; CI leaves it unset) with the cache enabled.
// Home is left by a card click and restored by Back from the cache, as in a real browser; the card click of its first lifetime
// must not make the Forward navigation that follows a morph (the head script's pageshow reset).
describe("cross-document transition in chromium with the back-forward cache", () => {
  let browser;
  before(async () => {
    browser = await chromium.launch({
      headless: true,
      channel: "chromium",
      executablePath: process.env.CHROMIUM_FULL_PATH || undefined,
      ignoreDefaultArgs: ["--disable-back-forward-cache"],
    });
  });
  after(async () => { await browser?.close(); });

  test("(b) home to certway (Forward, home restored from the cache): crossfade, no morph name", async () => {
    const { ctx, page, problems } = await open(browser);
    await page.evaluate(() => { window.__marker = "home"; }); // survives only if home is restored from the cache
    await visitCertway(page);
    await page.goBack({ waitUntil: "commit" }); // a restore from the cache fires no load event
    await page.waitForURL((u) => u.pathname === "/", { waitUntil: "commit" });
    await page.waitForTimeout(1000); // past the Back crossfade, so its `finished` is not read as the next navigation's
    assert.equal(await page.evaluate(() => window.__marker), "home", "home was restored from the back-forward cache");
    await page.evaluate(() => sessionStorage.removeItem("__vt"));
    await page.goForward({ waitUntil: "commit" });
    const s = summary(await settle(page, MORPHS[0].url, "commit"));
    assert.deepEqual(s.swap, { ev: "pageswap", vt: true, names: [] });
    assert.equal(s.reveal.vt, true, "the new page received a transition");
    assert.deepEqual(s.ready.names, []);
    assert.ok(s.pseudos.includes("::view-transition-old(root)"), `the root crossfade runs: ${s.pseudos.join(" ")}`);
    assert.ok(!s.pseudos.some((p) => PAIR_RE.test(p)), `no morph group: ${s.pseudos.join(" ")}`);
    assert.deepEqual(problems, []);
    await ctx.close();
  });
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
        if (n.prepare) await n.prepare(page);
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
