// Style fidelity checks (headless Chromium) for three values of design.md DV-01.1 and DV-02.1 and the DS-01 identity line:
// link underlines sit under the text of 44px links, the header band padding, the footer stamp size, the handle under the name.
// The band, the links row, definition lists and tiles are not on every page yet, so the test adds a minimal copy of each to
// the built home page; the rules under test are the ones in src/style.css.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { BASE, buildAndServe, stopAll, TEST_SHA } from "./helpers.mjs";

let browser;
before(async () => {
  await buildAndServe({ githubSha: TEST_SHA });
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
});
after(async () => {
  await browser?.close();
  await stopAll();
});

const FIXTURE = `
<section class="band" id="fx-band">
  <h1>Band</h1>
  <ul class="links-row"><li><a href="/fx/1/">Source code on GitHub</a></li><li><a href="/fx/2/">Engineering report</a></li></ul>
</section>
<section id="fx-rest">
  <dl><dt>Path</dt><dd><a href="/fx/3/">src/example/path.ts</a></dd></dl>
  <div class="tiles"><div class="tile"><span class="tile-label">Release</span><a href="/fx/4/">v1.0.1</a></div></div>
</section>`;

/** Opens the built home page at a viewport width, with the fixture added to main, after the fonts are loaded. */
async function open({ width = 1000, colorScheme = "light" } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, colorScheme });
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.evaluate((html) => document.querySelector("#root > main").insertAdjacentHTML("beforeend", html), FIXTURE);
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page };
}

const LINK_SELECTORS = ["#root > header a", ".site-nav a", "dd a", ".tile a", ".links-row a"];

/**
 * For each link: the box height, the bottom of its text (a Range over its contents), and the bottom edge of the underline.
 * Both underline layers are anchored at the bottom of the background positioning area (position-y 100%), so the underline
 * bottom is that area's bottom: the border-box bottom minus the border, minus the padding when the origin is the content box.
 */
function measureLinks(selectors) {
  const out = [];
  for (const selector of selectors) {
    for (const a of document.querySelectorAll(selector)) {
      a.scrollIntoView({ block: "center" });
      const cs = getComputedStyle(a);
      const r = a.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(a);
      const textBottom = Math.max(...[...range.getClientRects()].map((q) => q.bottom));
      const origins = cs.backgroundOrigin.split(",").map((v) => v.trim());
      const positionsY = cs.backgroundPositionY.split(",").map((v) => v.trim());
      const contentBox = origins.every((o) => o === "content-box");
      const underlineBottom = r.bottom - parseFloat(cs.borderBottomWidth) - (contentBox ? parseFloat(cs.paddingBottom) : 0);
      out.push({
        selector, text: a.textContent.trim().slice(0, 24), height: r.height, textBottom, underlineBottom,
        gap: underlineBottom - textBottom, positionsY, origins,
      });
    }
  }
  return out;
}

async function assertUnderlinesUnderText(page, state) {
  const links = await page.evaluate(measureLinks, LINK_SELECTORS);
  for (const selector of LINK_SELECTORS) assert.ok(links.some((l) => l.selector === selector), `no link matches ${selector}`);
  for (const l of links) {
    const who = `${state}: ${l.selector} "${l.text}"`;
    assert.ok(l.height >= 43.99, `${who}: the link box is ${l.height}px high, below the 44px target`);
    assert.deepEqual(l.positionsY, ["100%", "100%"], `${who}: both underline layers are anchored at the bottom of the positioning area`);
    assert.ok(l.gap >= 0 && l.gap <= 4, `${who}: the underline is ${l.gap.toFixed(2)}px below the text bottom (allowed 0 to 4)`);
  }
}

test("underline: 44px links draw their resting underline under the text", async () => {
  const { ctx, page } = await open();
  await assertUnderlinesUnderText(page, "resting");
  await ctx.close();
});

test("underline: the hover and focus draw stays under the text", async () => {
  const { ctx, page } = await open();
  for (const selector of LINK_SELECTORS) {
    const link = page.locator(selector).first();
    await link.scrollIntoViewIfNeeded();
    await link.hover();
    const hovered = await link.evaluate((a) => a.matches(":hover"));
    assert.ok(hovered, `${selector} is hovered`);
    await assertUnderlinesUnderText(page, `hover ${selector}`);
    await page.mouse.move(0, 0);
    await page.keyboard.press("Shift");
    await link.focus();
    assert.ok(await link.evaluate((a) => a.matches(":focus-visible")), `${selector} has the focus ring`);
    await assertUnderlinesUnderText(page, `focus ${selector}`);
    await link.evaluate((a) => a.blur());
  }
  await ctx.close();
});

test("band padding: 48 / 44 px below 960 px, 72 / 60 px from 960 px (DV-02.1)", async () => {
  for (const [width, top, bottom] of [[959, 48, 44], [960, 72, 60]]) {
    const { ctx, page } = await open({ width });
    const got = await page.evaluate(() => {
      const band = document.querySelector("#fx-band");
      const cs = getComputedStyle(band);
      const ticks = getComputedStyle(band, "::before");
      return { top: cs.paddingTop, bottom: cs.paddingBottom, tickTop: ticks.top, tickBottom: ticks.bottom };
    });
    assert.deepEqual(got, { top: `${top}px`, bottom: `${bottom}px`, tickTop: `${top}px`, tickBottom: `${bottom}px` }, `band at ${width}px wide`);
    await ctx.close();
  }
});

test("footer stamp: 11.5px with line-height 1.4, also for an element inside it (DV-01.1)", async () => {
  for (const width of [390, 1000]) {
    const { ctx, page } = await open({ width });
    const got = await page.evaluate(() => {
      const stamp = document.querySelector(".footer-stamp");
      if (!stamp) return null;
      stamp.insertAdjacentHTML("beforeend", " <small>extra</small><span>extra</span>");
      return [stamp, ...stamp.querySelectorAll("*")].map((el) => {
        const cs = getComputedStyle(el);
        return { tag: el.tagName, fontSize: cs.fontSize, lineHeight: cs.lineHeight };
      });
    });
    assert.ok(got, `the footer stamp renders at ${width}px wide`);
    assert.ok(got.length >= 4, "the stamp holds its link and the two added elements");
    for (const g of got) {
      assert.deepEqual({ fontSize: g.fontSize, lineHeight: g.lineHeight }, { fontSize: "11.5px", lineHeight: "16.1px" }, `${g.tag} in the stamp at ${width}px wide`);
    }
    await ctx.close();
  }
});

// DV-01.1 secondary text colour, and the colour of the page's quietest pixel (the field quiet colour) that text is measured against.
const SECONDARY = { light: [79, 84, 92], dark: [157, 163, 174] };
const QUIET = { light: [216, 219, 209], dark: [28, 33, 40] };
const BG = { light: [241, 241, 236], dark: [8, 9, 11] };
const luminance = (rgb) => {
  const [r, g, b] = rgb.map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const parseRgb = (s) => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);

test("identity line: the handle under the name is secondary text colour and smaller than the name (DS-01)", async () => {
  for (const scheme of ["light", "dark"]) {
    const { ctx, page } = await open({ colorScheme: scheme });
    const got = await page.evaluate(() => {
      const link = document.querySelector("#root > header > a");
      const handle = link.querySelector("small");
      const name = link.firstElementChild;
      const read = (el) => ({ color: getComputedStyle(el).color, fontSize: parseFloat(getComputedStyle(el).fontSize), text: el.textContent.trim() });
      return { handle: read(handle), name: read(name), handleTop: handle.getBoundingClientRect().top, nameTop: name.getBoundingClientRect().top };
    });
    assert.equal(got.handle.text, "MrAryanCode");
    assert.deepEqual(parseRgb(got.handle.color), SECONDARY[scheme], `${scheme}: the handle is in the secondary text colour`);
    assert.notDeepEqual(parseRgb(got.handle.color), parseRgb(got.name.color), `${scheme}: the handle differs from the name's colour`);
    assert.ok(got.handle.fontSize < got.name.fontSize, `${scheme}: the handle (${got.handle.fontSize}px) is smaller than the name (${got.name.fontSize}px)`);
    assert.ok(got.handleTop > got.nameTop, `${scheme}: the handle sits below the name`);
    for (const [label, surface] of [["quiet colour", QUIET[scheme]], ["page background", BG[scheme]]]) {
      const ratio = contrast(parseRgb(got.handle.color), surface);
      assert.ok(ratio >= 4.5, `${scheme}: the handle's contrast on the ${label} is ${ratio.toFixed(2)}, below 4.5`);
    }
    await ctx.close();
  }
});
