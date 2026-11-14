// T-031: the pointer motion rows (P-12, DV-01.1 motion table, DV-02.4, DV-02.5, A-4, A-1 (e)) in three browsers.
// One clause per row: card tilt + glare (rank 1), card depth parallax (rank 5), pointer ring (rank 6), magnetic primary
// buttons (rank 6) and the 404 link-row arrow (stays). Each asserts present, paused, reduced motion and rank, with every
// run pinned through sessionStorage `motion-level-pin` (a pinned run never steps, so the rank clauses check both sides of
// the rank: the pin below it shows the row, the pin at it does not). Paused and reduced motion start with the effect
// running and then switch, because a page that starts paused or reduced passes with an empty effect.
// Also here: A-4's arrow retarget check, the A-1 (e) layout check (test/layout-check.mjs) while each motion runs, and the
// guards that tier 1 starts the effects.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { chromium, firefox, webkit } from "playwright";
import { mockGithub } from "../tests/acceptance/github-mock.cjs";
import { BASE, buildAndServe, root, stopAll, tier3Site } from "./helpers.mjs";
import { assertLayout } from "./layout-check.mjs";

before(async () => { await buildAndServe(); });
after(async () => { await stopAll(); });

const ENGINES = { chromium, firefox, webkit };
const launch = (engine) => ENGINES[engine].launch({ headless: true, executablePath: engine === "chromium" ? process.env.CHROMIUM_PATH || undefined : undefined });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Opens a page of the built site with the level pinned and the GitHub API routed to the fixtures. */
async function open(browser, path, { pin = 0, reduced = false, base = BASE, init = "" } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: reduced ? "reduce" : "no-preference" });
  await context.addInitScript((level) => sessionStorage.setItem("motion-level-pin", String(level)), pin);
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  await mockGithub(page);
  await page.goto(base + path);
  await page.waitForFunction(() => window.__hydrated === true);
  if (reduced) await page.waitForFunction(() => document.documentElement.dataset.tier === "0");
  else await page.waitForFunction(() => Number(document.documentElement.dataset.tier) >= 1);
  return { context, page };
}

// The running animations on the elements these rows move (the pause icon's morph and the CSS transitions of other rows
// are not theirs). AT-16 holds the whole-document count.
const running = (page) => page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && (!(a instanceof CSSTransition) || ["transform", "translate", "opacity", "border-radius"].includes(a.transitionProperty)) && a.effect?.target?.matches?.("[data-fx~=tilt], [data-fx~=parallax], [data-fx~=magnet], [data-fx~=arrow], [data-fx=ring], [data-fx=glare]")).length);
const press = async (page) => { await page.focus(".pause"); await page.keyboard.press("Enter"); };
const pause = async (page) => { await press(page); await page.waitForFunction(() => document.documentElement.dataset.motion === "paused"); };
const play = async (page) => {
  await press(page);
  await page.waitForFunction(() => !document.documentElement.dataset.motion && Number(document.documentElement.dataset.tier) >= 1);
};
/** A point inside the first element matching `selector`, `fx` and `fy` being fractions of its box. */
async function pointIn(page, selector, fx, fy) {
  const box = await page.evaluate(([s]) => {
    const el = document.querySelector(s);
    el.scrollIntoView({ block: "center", behavior: "instant" });
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, [selector]);
  return { x: box.x + box.w * fx, y: box.y + box.h * fy };
}
/** A viewport point with no link or button under it, away from the page's text. */
const emptyPoint = (page) => page.evaluate(() => {
  for (let y = 120; y < innerHeight; y += 40) {
    for (let x = innerWidth - 60; x > innerWidth / 2; x -= 40) {
      const el = document.elementFromPoint(x, y);
      if (el && !el.closest("a, button, [data-fx~=tilt], [data-fx~=magnet]")) return { x, y };
    }
  }
  throw new Error("no empty point");
});
const away = (page) => page.mouse.move(2, 2, { steps: 2 });
const matrixX = (page, selector) => page.evaluate((s) => {
  const m = /^matrix\(([^)]*)\)$/.exec(getComputedStyle(document.querySelector(s)).transform);
  return m ? Number(m[1].split(",")[4]) : 0;
}, selector);

// Each row: where it lives, how to trigger it, how to tell it is running (`act`, runs in the page) and how to tell it has
// been undone (`rest`, runs in the page), and `poke`, which would restart it if it were still listening.
const rows = [
  {
    name: "card tilt and glare", rank: 1, path: "/",
    async hover(page) {
      const p = await pointIn(page, "[data-fx~=tilt]", 0.8, 0.2);
      await sleep(1100); // the scroll above also moves the parallax; let it catch up before the card is measured
      await page.mouse.move(p.x, p.y, { steps: 4 });
    },
    act: () => { const el = document.querySelector("[data-fx~=tilt]"); return el.style.transform.includes("rotateY") && !!el.querySelector(":scope > [data-fx=glare]"); },
    rest: () => { const el = document.querySelector("[data-fx~=tilt]"); return el.style.transform === "" && !el.querySelector(":scope > [data-fx=glare]"); },
    async poke(page) { await away(page); const p = await pointIn(page, "[data-fx~=tilt]", 0.3, 0.6); await page.mouse.move(p.x, p.y, { steps: 4 }); },
  },
  {
    name: "card depth parallax", rank: 5, path: "/",
    async hover(page) { await page.evaluate(() => scrollTo({ top: 40, behavior: "instant" })); }, // nothing moves until the page scrolls
    act: () => { const t = getComputedStyle(document.querySelector("[data-fx~=parallax]")).translate; return t !== "none" && Math.abs(parseFloat(t.split(" ")[1])) > 0.3; },
    rest: () => { const el = document.querySelector("[data-fx~=parallax]"); return el.style.translate === "" && getComputedStyle(el).translate === "none"; },
    async poke(page) { await page.evaluate(() => scrollTo({ top: scrollY + 300, behavior: "instant" })); },
  },
  {
    name: "pointer ring", rank: 6, path: "/",
    async hover(page) { const p = await emptyPoint(page); await page.mouse.move(p.x, p.y, { steps: 3 }); },
    act: () => { const r = document.querySelector("[data-fx=ring]"); return !!r && r.style.opacity === "1"; },
    rest: () => !document.querySelector("[data-fx=ring]"),
    async poke(page) { const p = await emptyPoint(page); await page.mouse.move(p.x - 30, p.y, { steps: 3 }); },
  },
  {
    name: "magnetic primary button", rank: 6, path: "/",
    async hover(page) { const p = await pointIn(page, "[data-fx~=magnet]", 0.9, 0.5); await page.mouse.move(p.x, p.y, { steps: 4 }); },
    act: () => { const el = document.querySelector("[data-fx~=magnet]"); const t = getComputedStyle(el).translate; return t !== "none" && Math.abs(parseFloat(t)) > 0.5; },
    rest: () => { const el = document.querySelector("[data-fx~=magnet]"); return el.style.translate === "" && el.style.backgroundImage === "" && !el.getAnimations().some((a) => a.effect.getKeyframes().some((k) => k.translate !== undefined)); },
    async poke(page) { await away(page); const p = await pointIn(page, "[data-fx~=magnet]", 0.1, 0.5); await page.mouse.move(p.x, p.y, { steps: 4 }); },
  },
  {
    name: "404 link-row arrow", rank: null, path: "/404.html",
    async hover(page) { const p = await pointIn(page, ".row", 0.5, 0.5); await page.mouse.move(p.x, p.y, { steps: 4 }); },
    act: () => { const m = /^matrix\(([^)]*)\)$/.exec(getComputedStyle(document.querySelector("[data-fx~=arrow]")).transform); return !!m && Number(m[1].split(",")[4]) > 0.5; },
    // Away from the row the arrow is at rest with no animation; over the row, with Pause or reduced motion, it is at 4 px at once
    // with no animation either (DV-02.5, A-4 "becomes instant": the CSS rule in style.css), which is `still`.
    rest: () => { const el = document.querySelector("[data-fx~=arrow]"); return el.getAnimations().length === 0 && getComputedStyle(el).transform === "none"; },
    still: () => { const el = document.querySelector("[data-fx~=arrow]"); const m = /^matrix\(([^)]*)\)$/.exec(getComputedStyle(el).transform); return el.getAnimations().length === 0 && !!m && Math.abs(Number(m[1].split(",")[4]) - 4) < 0.01; },
    async poke(page) { await away(page); const p = await pointIn(page, ".row", 0.4, 0.5); await page.mouse.move(p.x, p.y, { steps: 4 }); },
  },
];

for (const engine of Object.keys(ENGINES)) {
  describe(engine, () => {
    let browser;
    before(async () => { browser = await launch(engine); });
    after(async () => { await browser?.close(); });

    /** Runs `fn(page)` on a fresh page and always closes its context. */
    const withPage = async (path, options, fn) => {
      const { context, page } = await open(browser, path, options);
      try { await fn(page); } finally { await context.close(); }
    };

    for (const row of rows) {
      const on = row.rank === null ? 0 : row.rank - 1;

      test(`${row.name}: present at level ${on}`, () => withPage(row.path, { pin: on }, async (page) => {
        await row.hover(page);
        await page.waitForFunction(row.act);
      }));

      test(`${row.name}: rank ${row.rank ?? "stays"}`, async () => {
        if (row.rank === null) {
          // The arrow stays at every level (DV-02.5).
          for (const pin of [1, 5, 6, 7]) {
            await withPage(row.path, { pin }, async (page) => {
              await row.hover(page);
              await page.waitForFunction(row.act);
            });
          }
          return;
        }
        await withPage(row.path, { pin: row.rank }, async (page) => {
          await row.hover(page);
          await row.poke(page);
          await sleep(700);
          assert.equal(await page.evaluate(row.act), false, `${row.name} still runs at level ${row.rank}`);
          assert.equal(await page.evaluate(row.rest), true, `${row.name} left marks at level ${row.rank}`);
        });
      });

      test(`${row.name}: paused`, () => withPage(row.path, { pin: on }, async (page) => {
        await row.hover(page);
        await page.waitForFunction(row.act);
        await pause(page);
        const off = row.still ?? row.rest; // the arrow is "undone" as its instant 4 px while the pointer is over it
        if (row.still) await row.hover(page); // focusing the pause button can scroll the row from under the pointer
        assert.equal(await page.evaluate(off), true, `${row.name} is not undone at once by Pause`);
        assert.equal(await running(page), 0, "no animation runs after Pause");
        await row.poke(page);
        await sleep(400);
        assert.equal(await page.evaluate(off), true, `${row.name} runs again while paused`);
        assert.equal(await running(page), 0, "no animation runs while paused and the pointer moves");
        await play(page);
        await away(page);
        await row.hover(page);
        await page.waitForFunction(row.act);
      }));

      test(`${row.name}: reduced motion`, async () => {
        await withPage(row.path, { pin: on }, async (page) => {
          await row.hover(page);
          await page.waitForFunction(row.act);
          await page.emulateMedia({ reducedMotion: "reduce" });
          await page.waitForFunction(() => document.documentElement.dataset.tier === "0");
          const off = row.still ?? row.rest;
          assert.equal(await page.evaluate(off), true, `${row.name} is not undone by a live reduced motion change`);
          assert.equal(await running(page), 0, "no animation runs after the switch to reduced motion");
          await row.poke(page);
          await sleep(400);
          assert.equal(await page.evaluate(off), true, `${row.name} runs again under reduced motion`);
        });
        await withPage(row.path, { pin: on, reduced: true }, async (page) => {
          await row.hover(page);
          await row.poke(page);
          await sleep(400);
          // Tier 1 never starts here, so only the stylesheet can show the arrow's instant 4 px (DV-02.5).
          if (row.still) {
            assert.equal(await page.evaluate(row.still), true, `${row.name} is not at its instant 4 px on a page loaded with reduced motion`);
            return;
          }
          assert.equal(await page.evaluate(row.act), false, `${row.name} runs on a page loaded with reduced motion`);
          assert.equal(await page.evaluate(row.rest), true, `${row.name} left marks on a reduced motion page`);
        });
      });
    }

    // ---- row details ------------------------------------------------------------------------------------------------

    test("card tilt and glare: at most 4 deg by 5 deg, follows the pointer, then a soft return", () => withPage("/", { pin: 0 }, async (page) => {
      const tilt = () => page.evaluate(() => {
        const el = document.querySelector("[data-fx~=tilt]");
        const m = /rotateX\((-?[\d.]+)deg\) rotateY\((-?[\d.]+)deg\)/.exec(el.style.transform);
        return { rx: Number(m[1]), ry: Number(m[2]), computed: getComputedStyle(el).transform, perspective: /^perspective\(([\d.]+)px\)/.exec(el.style.transform)[1] + "px", glare: el.querySelector(":scope > [data-fx=glare]")?.style.opacity, glareImage: el.querySelector(":scope > [data-fx=glare]")?.style.backgroundImage };
      });
      const p = await pointIn(page, "[data-fx~=tilt]", 0.8, 0.2);
      await sleep(1100);
      await page.mouse.move(p.x, p.y, { steps: 4 });
      await page.waitForFunction(rows[0].act);
      let t = await tilt();
      assert.ok(Math.abs(t.rx - 1.2) < 0.4 && Math.abs(t.ry - 1.5) < 0.4, `rotateX ${t.rx}, rotateY ${t.ry} for a pointer at 80% by 20%`);
      assert.ok(t.perspective.startsWith("1100px"), `perspective ${t.perspective}`);
      assert.notEqual(t.computed, "none");
      assert.equal(t.glare, "1");
      assert.match(t.glareImage, /420px at .*transparent 65%\)$/, `glare ${t.glareImage}`);
      const corner = await pointIn(page, "[data-fx~=tilt]", 0.97, 0.04);
      await page.mouse.move(corner.x, corner.y, { steps: 4 });
      await sleep(400);
      t = await tilt();
      assert.ok(Math.abs(t.rx) <= 2.001 && Math.abs(t.ry) <= 2.501, `rotateX ${t.rx}, rotateY ${t.ry} past the mockup's 2 deg by 2.5 deg`);
      assert.ok(Math.abs(t.ry) > 2, `rotateY ${t.ry} at the edge`);
      await away(page);
      await sleep(150);
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector("[data-fx~=tilt]")).transform), "none", "the return is soft (0.9 s), not a cut");
      await page.waitForFunction(rows[0].rest, undefined, { timeout: 3000 });
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("[data-fx~=tilt]")).transform), "none");
    }));

    test("card depth parallax: a page that has not scrolled is not touched (hydration and the tier 3 zones stay still)", () => withPage("/", { pin: 0 }, async (page) => {
      await sleep(500);
      const touched = await page.evaluate(() => [...document.querySelectorAll("[data-fx~=parallax], [data-fx~=tilt]")].filter((el) => el.hasAttribute("style")).length);
      assert.equal(touched, 0, "no card carries an inline style before the first scroll or pointer move");
    }));

    test("card depth parallax: within 6 px, follows the scroll", () => withPage("/", { pin: 4 }, async (page) => {
      const shift = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector("[data-fx~=parallax]")).translate.split(" ")[1]));
      await rows[1].hover(page);
      await page.waitForFunction(rows[1].act);
      await sleep(1100);
      const low = await shift();
      assert.ok(Math.abs(low) <= 6.01 && Math.abs(low) > 0.3, `shift ${low}`);
      assert.ok(low < 0, `a card below the centre moves up (shift ${low})`);
      await page.evaluate(() => {
        const r = document.querySelector("[data-fx~=parallax]").getBoundingClientRect();
        scrollTo({ top: scrollY + r.top + r.height / 2 - innerHeight / 2, behavior: "instant" });
      });
      await page.waitForFunction(() => Math.abs(parseFloat(getComputedStyle(document.querySelector("[data-fx~=parallax]")).translate.split(" ")[1])) < 0.6, undefined, { timeout: 3000 });
      const mid = await shift();
      assert.ok(Math.abs(mid) < Math.abs(low), `centred ${mid} against ${low}`);
    }));

    test("pointer ring: 28 px at the pointer, the link's box plus 14 by 10 over a link", () => withPage("/", { pin: 5 }, async (page) => {
      const ring = () => page.evaluate(() => {
        const r = document.querySelector("[data-fx=ring]").getBoundingClientRect();
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height, radius: getComputedStyle(document.querySelector("[data-fx=ring]")).borderTopLeftRadius };
      });
      const e = await emptyPoint(page);
      await page.mouse.move(e.x, e.y, { steps: 3 });
      await page.waitForFunction(([x, y]) => {
        const r = document.querySelector("[data-fx=ring]")?.getBoundingClientRect();
        return !!r && Math.abs(r.left + r.width / 2 - x) < 0.6 && Math.abs(r.top + r.height / 2 - y) < 0.6 && Math.abs(r.width - 28) < 0.6;
      }, [e.x, e.y], { timeout: 4000 });
      let r = await ring();
      assert.ok(Math.abs(r.h - 28) < 0.6 && r.radius !== "14px", `ring ${JSON.stringify(r)} at the pointer`);
      const link = await page.evaluate(() => {
        const el = document.querySelector("a.btn");
        el.scrollIntoView({ block: "center", behavior: "instant" });
        const b = el.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height };
      });
      await sleep(300);
      await page.mouse.move(link.x - 4, link.y, { steps: 3 });
      await page.waitForFunction(([w, h]) => {
        const r = document.querySelector("[data-fx=ring]").getBoundingClientRect();
        return Math.abs(r.width - (w + 14)) < 1.5 && Math.abs(r.height - (h + 10)) < 1.5;
      }, [link.w, link.h], { timeout: 4000 });
      await page.waitForFunction(() => getComputedStyle(document.querySelector("[data-fx=ring]")).borderTopLeftRadius === "14px", undefined, { timeout: 3000 }); // a 0.2 s CSS transition
      r = await ring();
      assert.equal(r.radius, "14px", "the corner radius is 14 px over a link");
    }));

    test("magnetic primary button: within 5 by 4 px, a baked 0.6 s return, re-entry resumes the follow", () => withPage("/", { pin: 5 }, async (page) => {
      const offset = () => page.evaluate(() => {
        const el = document.querySelector("[data-fx~=magnet]");
        const [x, y = "0px"] = getComputedStyle(el).translate.split(" ");
        const anim = el.getAnimations().find((x) => x.effect.getKeyframes().some((k) => k.translate !== undefined));
        return { x: parseFloat(x) || 0, y: parseFloat(y) || 0, anim: anim ? { easing: anim.effect.getTiming().easing, duration: anim.effect.getTiming().duration, state: anim.playState } : null };
      });
      const corner = await pointIn(page, "[data-fx~=magnet]", 0.97, 0.9);
      await page.mouse.move(corner.x, corner.y, { steps: 4 });
      await page.waitForFunction(rows[3].act);
      let o = await offset();
      assert.ok(Math.abs(o.x) <= 5.01 && Math.abs(o.y) <= 4.01, `offset ${o.x}, ${o.y}`);
      assert.ok(o.x > 4 && o.y > 3, `offset ${o.x}, ${o.y} at the corner`);
      assert.equal(o.anim, null, "no animation while the pointer is over the button");
      // The glow spot (140 px radial, DV-01.1) follows the pointer on a background-image; the fill colour stays opaque.
      const glow = () => page.evaluate(() => { const el = document.querySelector("[data-fx~=magnet]"); return { image: el.style.backgroundImage, color: getComputedStyle(el).backgroundColor }; });
      const at = (s) => Number(/at (-?[\d.]+)px/.exec(s)[1]);
      let g = await glow();
      assert.match(g.image, /radial-gradient\((circle )?140px at .*transparent 70%\)$/);
      assert.doesNotMatch(g.color, /^rgba\(.*, 0\)$|transparent/, `the pill keeps an opaque fill, not ${g.color}`);
      const gx = at(g.image);
      const mid = await pointIn(page, "[data-fx~=magnet]", 0.3, 0.5);
      await page.mouse.move(mid.x, mid.y, { steps: 3 });
      g = await glow();
      assert.ok(at(g.image) < gx - 20, `the glow spot moved with the pointer (${gx} to ${at(g.image)})`);
      await page.mouse.move(corner.x, corner.y, { steps: 3 });
      await away(page);
      o = await offset();
      assert.ok(o.anim && o.anim.easing.startsWith("linear(") && o.anim.duration > 400 && o.anim.duration <= 620, `return ${JSON.stringify(o.anim)}`);
      // Re-entering during the return cancels it and follows the pointer again.
      await page.mouse.move(corner.x, corner.y, { steps: 2 });
      o = await offset();
      assert.equal(o.anim, null, "the return is cancelled when the pointer comes back");
      assert.ok(o.x > 3, `follow resumes at ${o.x}`);
      await away(page);
      await page.waitForFunction(rows[3].rest, undefined, { timeout: 2000 });
    }));

    test("404 link-row arrow: springs 4 px on hover and on keyboard focus, and back", () => withPage("/404.html", { pin: 0 }, async (page) => {
      const p = await pointIn(page, ".row", 0.5, 0.5);
      await page.mouse.move(p.x, p.y, { steps: 4 });
      assert.equal(await page.evaluate(() => document.querySelector("[data-fx~=arrow]").getAnimations().filter((a) => a.playState === "running").length), 1);
      await sleep(900);
      assert.ok(Math.abs(await matrixX(page, "[data-fx~=arrow]") - 4) < 0.15, "the arrow rests 4 px over");
      await away(page);
      await sleep(900);
      assert.ok(Math.abs(await matrixX(page, "[data-fx~=arrow]")) < 0.15, "the arrow rests back at 0");
      // A key press first, so the engine's focus-visible heuristic reads the focus as the keyboard's (WebKit's Tab skips links).
      await page.keyboard.press("Tab");
      await page.focus(".row");
      assert.equal(await page.evaluate(() => document.querySelector(".row").matches(":focus-visible")), true);
      await sleep(900);
      assert.ok(Math.abs(await matrixX(page, "[data-fx~=arrow]") - 4) < 0.15, "keyboard focus moves the arrow 4 px");
    }));

    test("404 link-row arrow: hover, then leave at 150 ms re-aims the one running animation (A-4)", () => withPage("/404.html", { pin: 0 }, async (page) => {
      await page.evaluate(() => {
        const svg = document.querySelector("[data-fx~=arrow]");
        const row = svg.closest("a");
        const tx = () => { const m = /^matrix\(([^)]*)\)$/.exec(getComputedStyle(svg).transform); return m ? Number(m[1].split(",")[4]) : 0; };
        // The animation's own position: its keyframes interpolated at its current (eased) progress. Firefox's computed
        // style lags currentTime by up to a frame, so this is the reading that is exact in every engine.
        const model = () => {
          const a = svg.getAnimations()[0];
          const [from, to] = a.effect.getKeyframes().map((k) => Number(/translateX\((-?[\d.e-]+)px\)/.exec(k.transform)[1]));
          return from + (to - from) * a.effect.getComputedTiming().progress;
        };
        const log = (window.__leave = {});
        // Capture phase on window runs before the arrow's own handler; the row listener below runs after it.
        window.addEventListener("pointerleave", (e) => {
          if (e.target !== row) return;
          log.before = tx();
          log.modelBefore = model();
          log.timeBefore = svg.getAnimations()[0]?.currentTime;
        }, true);
        row.addEventListener("pointerleave", () => {
          const all = svg.getAnimations();
          log.total = all.length;
          log.running = all.filter((a) => a.playState === "running").length;
          log.start = tx();
          log.modelStart = model();
          log.timeAfter = all[0]?.currentTime;
          // One frame later every engine's computed style has caught up with the animation (Firefox's lags by about a frame).
          requestAnimationFrame(() => { log.next = tx(); log.modelNext = model(); });
        });
      });
      const p = await pointIn(page, ".row", 0.5, 0.5);
      await page.mouse.move(p.x, p.y, { steps: 4 });
      await page.waitForFunction(() => document.querySelector("[data-fx~=arrow]").getAnimations()[0]?.currentTime >= 150);
      await away(page);
      const log = await page.evaluate(() => window.__leave);
      assert.ok(log.timeBefore >= 140 && log.timeBefore < 600, `left at ${log.timeBefore} ms`);
      assert.ok(log.before > 0.5 && log.before < 4.6, `the arrow was moving at ${log.before} px`);
      assert.equal(log.total, 1, "one animation on the arrow");
      assert.equal(log.running, 1, "one running animation");
      assert.ok(Math.abs(log.modelStart - log.modelBefore) < 0.1, `start ${log.modelStart} px against ${log.modelBefore} px before the leave`);
      if (engine !== "firefox") assert.ok(Math.abs(log.start - log.before) < 0.1, `computed start ${log.start} px against ${log.before} px before the leave`);
      // The rendered value, a frame after the leave, is the retargeted animation's own position in every engine, Firefox's included.
      assert.ok(Math.abs(log.next - log.modelNext) < 0.05, `computed ${log.next} px a frame after the leave against the animation's ${log.modelNext} px`);
      assert.ok(log.timeAfter < 100, `the animation restarted (currentTime ${log.timeAfter})`);
    }));

    // ---- the arrow's instant column (DV-02.5, A-4): Pause, reduced motion, a touch tap ------------------------------------

    const arrowState = (page) => page.evaluate(() => {
      const el = document.querySelector("[data-fx~=arrow]");
      const m = /^matrix\(([^)]*)\)$/.exec(getComputedStyle(el).transform);
      return { x: m ? Number(m[1].split(",")[4]) : 0, animations: el.getAnimations().length };
    });

    test("404 link-row arrow: under Pause, after a finished spring, hover and focus show 4 px at once and nothing pins it at 0", () => withPage("/404.html", { pin: 0 }, async (page) => {
      const p = await pointIn(page, ".row", 0.5, 0.5);
      await page.mouse.move(p.x, p.y, { steps: 4 });
      await sleep(900); // the spring ends at 4 px, then back at 0: its fill-both animation is finished and holds 0
      await away(page);
      await sleep(900);
      assert.equal((await arrowState(page)).animations, 1, "the finished spring is what a pause has to release");
      await pause(page);
      assert.equal((await arrowState(page)).animations, 0, "Pause releases the spring");
      const q = await pointIn(page, ".row", 0.5, 0.5); // focusing the pause button can scroll the row
      await page.mouse.move(q.x, q.y, { steps: 2 });
      let a = await arrowState(page);
      assert.ok(Math.abs(a.x - 4) < 0.01 && a.animations === 0, `hover while paused: ${JSON.stringify(a)}`);
      await away(page);
      a = await arrowState(page);
      assert.ok(Math.abs(a.x) < 0.01 && a.animations === 0, `away while paused: ${JSON.stringify(a)}`);
      await page.keyboard.press("Tab");
      await page.focus(".row");
      assert.equal(await page.evaluate(() => document.querySelector(".row").matches(":focus-visible")), true);
      a = await arrowState(page);
      assert.ok(Math.abs(a.x - 4) < 0.01 && a.animations === 0, `focus while paused: ${JSON.stringify(a)}`);
      await play(page);
      await page.evaluate(() => document.activeElement.blur());
      await away(page);
      const r = await pointIn(page, ".row", 0.5, 0.5);
      await page.mouse.move(r.x, r.y, { steps: 2 });
      await page.waitForFunction(rows[4].act); // and the spring is back after Play
    }));

    test("404 link-row arrow: with reduced motion at load (tier 1 never starts) hover and focus show 4 px at once", () => withPage("/404.html", { pin: 0, reduced: true }, async (page) => {
      const p = await pointIn(page, ".row", 0.5, 0.5);
      await page.mouse.move(p.x, p.y, { steps: 2 });
      let a = await arrowState(page);
      assert.ok(Math.abs(a.x - 4) < 0.01 && a.animations === 0, `hover: ${JSON.stringify(a)}`);
      await away(page);
      a = await arrowState(page);
      assert.ok(Math.abs(a.x) < 0.01 && a.animations === 0, `away: ${JSON.stringify(a)}`);
      await page.keyboard.press("Tab");
      await page.focus(".row");
      a = await arrowState(page);
      assert.ok(Math.abs(a.x - 4) < 0.01 && a.animations === 0, `focus: ${JSON.stringify(a)}`);
    }));

    test("404 link-row arrow: a touch tap shows the arrow at 4 px at once, with no spring", () => withPage("/404.html", { pin: 0 }, async (page) => {
      // Synthetic touch pointer events on the row: a real tap would also follow the link.
      const touch = (type) => page.evaluate((t) => document.querySelector(".row").dispatchEvent(new PointerEvent(t, { pointerType: "touch" })), type);
      await touch("pointerenter");
      let a = await arrowState(page);
      assert.ok(Math.abs(a.x - 4) < 0.01, `the tap shows ${a.x} px at once`);
      assert.equal(await running(page), 0, "no spring runs for a tap");
      await touch("pointerleave");
      a = await arrowState(page);
      assert.ok(Math.abs(a.x) < 0.01 && (await running(page)) === 0, `the release returns at once: ${JSON.stringify(a)}`);
    }));

    // ---- a live step: the rank rules apply while the page runs (A-3, DV-01.1), not just at load -------------------------

    test("a live step to rank 1, 5 and 6 undoes the tilt, the parallax, then the ring and the magnet, with the pointer still", async (t) => {
      const probe = await browser.newPage();
      const gl = await probe.evaluate(() => ({ gl: !!document.createElement("canvas").getContext("webgl2"), offscreen: typeof OffscreenCanvas !== "undefined" && new OffscreenCanvas(1, 1).getContext("webgl2") !== null }));
      await probe.close();
      // A live step needs tier 3, which needs WebGL2 (the same skips as test/browser.test.mjs).
      if (engine === "firefox" && !gl.gl) return t.skip("no WebGL2 context: firefox");
      if (engine === "webkit" && !gl.offscreen) return t.skip("no OffscreenCanvas WebGL2: webkit");
      const site = await tier3Site(browser);
      const { context, page } = await open(browser, "/", { pin: "trace:20fps", base: site.base, init: site.init });
      try {
        await page.waitForFunction(() => document.documentElement.dataset.field === "on", undefined, { timeout: 20000 });
        const level = () => page.evaluate(() => { try { return JSON.parse(sessionStorage.getItem("motion-level")).level; } catch { return 0; } });
        const reach = (n) => page.waitForFunction((n) => { try { return JSON.parse(sessionStorage.getItem("motion-level")).level >= n; } catch { return false; } }, n, { timeout: 30000 });
        // Each effect is seen running first, then the level is read: it only rises, so a level still below the rank means the
        // effect ran at a level that allows it.
        const p = await pointIn(page, "[data-fx~=tilt]", 0.8, 0.2);
        await page.mouse.move(p.x, p.y, { steps: 4 });
        await page.waitForFunction(rows[0].act, undefined, { timeout: 3000 });
        assert.equal(await level(), 0, "the page ran too slowly: the tilt was seen after the first step");
        await reach(1);
        await page.waitForFunction(rows[0].rest, undefined, { timeout: 3000 }); // the pointer has not moved
        await rows[1].hover(page);
        await page.waitForFunction(rows[1].act, undefined, { timeout: 3000 });
        await rows[3].hover(page);
        await page.waitForFunction(rows[3].act, undefined, { timeout: 3000 });
        await page.waitForFunction(rows[2].act, undefined, { timeout: 3000 });
        assert.ok(await level() < 5, "the page ran too slowly: the parallax and magnet were seen late");
        await reach(5);
        await page.waitForFunction(rows[1].rest, undefined, { timeout: 3000 });
        await reach(6);
        await page.waitForFunction(rows[3].rest, undefined, { timeout: 3000 });
        await page.waitForFunction(rows[2].rest, undefined, { timeout: 3000 });
      } finally { await context.close(); }
    });

    // ---- the A-1 (e) layout check while each motion runs -------------------------------------------------------------

    test("layout check: over a card (tilt and parallax), over a primary button (magnet)", () => withPage("/", { pin: 0 }, async (page) => {
      const card = await pointIn(page, "[data-fx~=tilt]", 0.8, 0.2);
      await sleep(1100);
      await page.mouse.move(card.x, card.y, { steps: 4 });
      await page.waitForFunction(rows[0].act);
      // Scrolling off the viewport centre moves the card's parallax while the pointer is still over it.
      await page.mouse.wheel(0, 120);
      await page.waitForFunction(rows[1].act);
      await page.waitForFunction(rows[0].act);
      let out = await assertLayout(page, `${engine} / over a card`);
      assert.ok(out.transformed.some((t) => /panel-card/.test(t.el) && t.why === "opaque"), `the check saw the moving card: ${JSON.stringify(out.transformed)}`);
      const btn = await pointIn(page, "[data-fx~=magnet]", 0.9, 0.5);
      await page.mouse.move(btn.x, btn.y, { steps: 4 });
      await page.waitForFunction(rows[3].act);
      out = await assertLayout(page, `${engine} / over a primary button`);
      assert.ok(out.transformed.some((t) => /btn-primary/.test(t.el) && t.why === "opaque"), `the check saw the moving button: ${JSON.stringify(out.transformed)}`);
      await away(page); // the return runs while the check scans
      out = await assertLayout(page, `${engine} / the magnet's return`);
    }));

    test("layout check: over a 404 row during the arrow's spring", () => withPage("/404.html", { pin: 0 }, async (page) => {
      const p = await pointIn(page, ".row", 0.5, 0.5);
      await page.mouse.move(p.x, p.y, { steps: 4 });
      await sleep(120);
      const state = await page.evaluate(() => {
        const svg = document.querySelector("[data-fx~=arrow]");
        return { running: svg.getAnimations().filter((a) => a.playState === "running").length, transform: getComputedStyle(svg).transform };
      });
      assert.equal(state.running, 1, "the spring is running when the page is checked");
      assert.notEqual(state.transform, "none");
      await assertLayout(page, `${engine} /404.html during the spring`);
      // The arrow carries no text, so the check skips it: its own travel is 4 px, the zone padding of 10 px covers it.
      await sleep(900);
      assert.ok(Math.abs(await matrixX(page, "[data-fx~=arrow]")) <= 4.5, "the arrow stays inside the 10 px zone padding");
    }));

    for (const path of ["/", "/projects/certway/", "/report/", "/404.html"]) {
      test(`layout check: the pointer ring runs on ${path}`, () => withPage(path, { pin: 0 }, async (page) => {
        const e = await emptyPoint(page);
        await page.mouse.move(e.x, e.y, { steps: 3 });
        await page.waitForFunction(rows[2].act);
        const out = await assertLayout(page, `${engine} ${path} with the ring`);
        assert.ok(out.zones > 0, "the page has text zones, so the check is not vacuous");
      }));
    }

    // ---- tier 1 starts the effects -------------------------------------------------------------------------------------

    test("tier 1 starts the effects: a fresh page has the ring after one mouse move", () => withPage("/", { pin: 0 }, async (page) => {
      assert.equal(await page.evaluate(() => document.querySelector("[data-fx=ring]") === null), true, "no ring before the pointer moves");
      const e = await emptyPoint(page);
      await page.mouse.move(e.x, e.y, { steps: 3 });
      await page.waitForFunction(rows[2].act, undefined, { timeout: 3000 });
    }));
  });
}

describe("wiring (source)", () => {
  const read = (file) => readFileSync(`${root}/src/motion/${file}`, "utf8");

  test("tier1.start calls startEffects after the controller starts", () => {
    const src = read("tier1.ts");
    assert.match(src, /import \{ startEffects \} from "\.\/effects\.ts"/);
    assert.match(src, /startBudget\(\);[\s\S]*await startEffects\(root, signal\);[\s\S]*return true;/);
  });

  test("effects.ts starts the pointer, reading and facts modules", () => {
    const src = read("effects.ts");
    for (const [name, file] of [["startPointer", "pointer"], ["startReading", "reading"], ["startFacts", "facts"]]) {
      assert.match(src, new RegExp(`import \\{ start as ${name} \\} from "\\./effects/${file}\\.ts"`), `${file} is imported`);
      assert.match(src, new RegExp(`${name}\\(root, signal\\)`), `${file} is started with (root, signal)`);
    }
  });

  test("the reading and facts modules export start(root, signal) and resolve at once", async () => {
    for (const file of ["reading", "facts"]) {
      assert.match(read(`effects/${file}.ts`), /export async function start\(_root: HTMLElement, _signal: AbortSignal\): Promise<void> \{\}/);
    }
  });
});
