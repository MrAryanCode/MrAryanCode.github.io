// T-014: the Open Graph cards, the pattern and the icon set (design.md DV-02.7, DS-11). Pure: no build, no server.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import satori from "satori";
import sharp from "sharp";
import { BAYER4, CARD, MARK, PATTERN, SAFE_BOX, appleTouchPixels, cardTree, fonts, iconPixels, iconSvg, ogCards, ogPng, patternRaw } from "../scripts/og.mjs";
import { routes } from "../src/routes.ts";

const require = createRequire(import.meta.url);
const pub = (name) => readFileSync(new URL(`../public/${name}`, import.meta.url));
const raw = async (png) => {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, ...info };
};
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const BG = hex("#08090B");
const QUIET = hex("#1C2128");
const ACCENT = hex("#4A6122");
const GLYPH_COLOR = hex("#C6F432");
// DV-02.7, "Icon, pixel A", written out here on purpose: rows top to bottom, glyph in columns 3 to 12 and rows 3 to 12.
const PIXEL_A = ["..XXXXXX..", ".XX....XX.", "XX......XX", "XX......XX", "XX......XX", "XXXXXXXXXX", "XX......XX", "XX......XX", "XX......XX", "XX......XX"];
const rgba = ({ data, width }, x, y) => Array.from(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
const isGlyphUnit = (ux, uy) => PIXEL_A[uy - 3]?.[ux - 3] === "X";

const cards = Object.entries(ogCards());

test("the route table gives a card to home, certway and report, and none to 404", () => {
  assert.deepEqual(cards.map(([slug]) => slug), ["home", "certway", "report"]);
  for (const [slug, [line1, line2, layout]] of cards) {
    const route = routes.find((r) => r.ogSlug === slug && r.ogCard);
    assert.deepEqual([line1, line2], route.ogCard);
    assert.equal(layout, slug === "home" ? "home" : "card");
  }
});

test("scripts/og.mjs registers exactly Geist 400 and Geist Mono 500, from the static latin .woff files", () => {
  assert.deepEqual(fonts.map((f) => [f.name, f.weight, f.style]), [["Geist", 400, "normal"], ["Geist Mono", 500, "normal"]]);
  assert.ok(fonts[0].data.equals(readFileSync(require.resolve("@fontsource/geist/files/geist-latin-400-normal.woff"))));
  assert.ok(fonts[1].data.equals(readFileSync(require.resolve("@fontsource/geist-mono/files/geist-mono-latin-500-normal.woff"))));
});

test("no text style of any card element tree lies outside the two registered family and weight pairs (G-44)", () => {
  const allowed = new Set(fonts.map((f) => `${f.name}/${f.weight}`));
  const used = new Set();
  const walk = (node, inherited) => {
    const style = node.props?.style ?? {};
    const here = { family: style.fontFamily ?? inherited.family, weight: style.fontWeight ?? inherited.weight };
    const kids = [node.props?.children ?? []].flat();
    for (const kid of kids) {
      if (typeof kid === "string") {
        const pair = `${here.family}/${here.weight}`;
        assert.ok(allowed.has(pair), `text "${kid}" is styled ${pair}, which is not registered`);
        used.add(pair);
      } else walk(kid, here);
    }
  };
  for (const [, [line1, line2, layout]] of cards) walk(cardTree(line1, line2, layout), {});
  assert.deepEqual([...used].sort(), [...allowed].sort(), "each registered font is used and no other");
});

test("U+00B7 renders as a real glyph: its SVG differs from the one for U+2192, which the latin subset lacks (G-44)", async () => {
  // Characters outside the font draw as the same .notdef box, so two such characters give equal SVG.
  const svg = (ch) => satori(cardTree("x", `Aryan Miri ${ch} Full-stack developer`), { ...CARD, fonts });
  const [dot, arrow, star] = await Promise.all([svg("·"), svg("→"), svg("★")]);
  assert.notEqual(dot, arrow, "the middle dot must not be a box");
  assert.equal(arrow, star, "control: two characters the font lacks give the same box");
});

test("every card is 1200x630", async () => {
  for (const [, [line1, line2, layout]] of cards) {
    const { width, height, channels } = await raw(await ogPng(line1, line2, layout));
    assert.deepEqual([width, height, channels], [1200, 630, 4]);
  }
});

test("every text pixel and the mark lie inside x 300 to 900, y 64 to 566", async () => {
  for (const [slug, [line1, line2, layout]] of cards) {
    const full = await raw(await ogPng(line1, line2, layout));
    const bare = await raw(await ogPng(line1, line2, layout, { text: false, mark: false }));
    let inside = 0;
    for (let y = 0; y < CARD.height; y++) {
      for (let x = 0; x < CARD.width; x++) {
        const k = (y * CARD.width + x) * 4;
        if (full.data.compare(bare.data, k, k + 4, k, k + 4) === 0) continue;
        const ok = x >= SAFE_BOX.left && x < SAFE_BOX.right && y >= SAFE_BOX.top && y < SAFE_BOX.bottom;
        assert.ok(ok, `${slug}: pixel ${x},${y} differs from the card with no text and no mark, outside the safe box`);
        inside++;
      }
    }
    assert.ok(inside > 2500, `${slug}: the card has text and a mark inside the safe box (${inside} pixels)`);
  }
});

test("the mark is the pixel A at 5 px per unit, box top at y=176, centred", async () => {
  const card = await raw(await ogPng(...cards[0][1]));
  assert.deepEqual([MARK.px, MARK.left, MARK.top], [5, 560, 176]);
  for (let y = 0; y < 80; y++) {
    for (let x = 0; x < 80; x++) {
      const px = rgba(card, MARK.left + x, MARK.top + y);
      if (isGlyphUnit(Math.floor(x / 5), Math.floor(y / 5))) assert.deepEqual(px, [...GLYPH_COLOR, 255], `glyph pixel ${x},${y}`);
      else assert.deepEqual(px, [...BG, 255], `tile pixel ${x},${y}`);
    }
  }
});

test("the card text sits on the baselines of DV-02.7 (flat-bottomed capitals end on the row above)", async () => {
  const inkRows = async (slug, x0, x1, y0, y1) => {
    const [line1, line2, layout] = ogCards()[slug];
    const full = await raw(await ogPng(line1, line2, layout));
    const bare = await raw(await ogPng(line1, line2, layout, { text: false, mark: false }));
    let last = -1;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const k = (y * CARD.width + x) * 4;
      if (full.data.compare(bare.data, k, k + 4, k, k + 4) !== 0) last = y;
    }
    return last;
  };
  assert.equal(await inkRows("home", 314, 343, 260, 400) + 1, 384, "home line 1: the A of Aryan");
  assert.equal(await inkRows("home", 452, 465, 400, 480) + 1, 444, "home line 2: the F of Full-stack");
  assert.equal(await inkRows("report", 312, 336, 260, 380) + 1, 362, "report line 1: the E of Engineering");
  assert.equal(await inkRows("report", 365, 378, 380, 470) + 1, 422, "report line 2: the A of Aryan");
});

test("the pattern: 6 px cells, ordered 4 x 4 dither, empty in the central 600 px, at most 55% at the edges, accent only in the outer band", async () => {
  const [line1, line2, layout] = ogCards().home;
  const card = await raw(await ogPng(line1, line2, layout, { text: false, mark: false }));
  const cell = PATTERN.cell;
  assert.equal(cell, 6);
  const cols = CARD.width / cell;
  const rows = CARD.height / cell;
  const on = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const colors = new Set();
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const first = rgba(card, cx * cell, cy * cell);
      for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
        assert.deepEqual(rgba(card, cx * cell + x, cy * cell + y), first, `cell ${cx},${cy} is one colour`);
      }
      colors.add(first.join());
      on[cy][cx] = first.join() !== [...BG, 255].join();
      if (on[cy][cx] && first.join() === [...ACCENT, 255].join()) {
        assert.ok(cx * cell < PATTERN.band || (cx + 1) * cell > CARD.width - PATTERN.band, `accent cell ${cx},${cy} is outside the outermost band`);
      }
    }
  }
  assert.deepEqual([...colors].sort(), [[...BG, 255], [...QUIET, 255], [...ACCENT, 255]].map(String).sort());
  // "Mostly #1C2128": the accent is under half of the dither's pixels (the outermost band is a small part of the margins).
  const pixels = { quiet: 0, accent: 0 };
  for (let i = 0; i < card.data.length; i += 4) {
    if (card.data[i] === ACCENT[0] && card.data[i + 1] === ACCENT[1]) pixels.accent++;
    else if (card.data[i] === QUIET[0] && card.data[i + 1] === QUIET[1]) pixels.quiet++;
  }
  assert.ok(pixels.accent > 0, "the outermost band holds the accent colour");
  assert.ok(pixels.accent < 0.25 * (pixels.accent + pixels.quiet), `the accent is a minority of the dither (${pixels.accent} of ${pixels.accent + pixels.quiet} pixels)`);
  // Empty in the central 600 px: cells 50 to 149.
  for (let cy = 0; cy < rows; cy++) for (let cx = 50; cx < 150; cx++) assert.equal(on[cy][cx], false, `cell ${cx},${cy} in the central 600 px is empty`);
  // Ordered dither: in each cell column the on-cells are exactly the cells whose matrix value is below some level
  // (0 to 16). Several levels can give one column the same cells, so keep every level that fits.
  const fits = (cx) => Array.from({ length: 17 }, (_, level) => level).filter((level) => Array.from({ length: rows }, (_, cy) => cy).every((cy) => on[cy][cx] === BAYER4[cy % 4][cx % 4] < level));
  const levels = [];
  for (let cx = 0; cx < cols; cx++) {
    levels.push(fits(cx));
    assert.ok(levels[cx].length > 0, `cell column ${cx} follows the 4 x 4 matrix`);
  }
  // The dither thickens toward each edge: walking outward from the quiet zone, some non-decreasing level fits every column.
  for (const order of [Array.from({ length: 50 }, (_, i) => 49 - i), Array.from({ length: 50 }, (_, i) => 150 + i)]) {
    let level = 0;
    for (const cx of order) {
      const next = levels[cx].find((l) => l >= level);
      assert.notEqual(next, undefined, `cell column ${cx} is no thinner than the column inside it`);
      level = next;
    }
  }
  // At most 55% density: per cell column and per 4 x 4 block of the outermost cells.
  for (const cx of [0, 1, 2, 3, cols - 4, cols - 3, cols - 2, cols - 1]) {
    const n = on.filter((row) => row[cx]).length;
    assert.ok(n / rows <= 0.55, `cell column ${cx} has density ${n / rows}`);
  }
  for (const x0 of [0, cols - 4]) {
    let n = 0;
    for (let y = 0; y < 4; y++) for (let x = x0; x < x0 + 4; x++) if (on[y][x]) n++;
    assert.ok(n / 16 <= 0.55, `the 4 x 4 block at cell column ${x0} has density ${n / 16}`);
    assert.ok(n / 16 > 0.4, `the outermost block is a real dither, not empty (${n / 16})`);
  }
  assert.ok(levels.every((fit) => fit[0] <= 8), "no column needs a matrix level above 8 of 16");
  // The raw layer is the same pattern.
  assert.equal(patternRaw().length, CARD.width * CARD.height * 4);
});

test("icon.svg: viewBox 0 0 16 16, crisp edges, tile rx=2, the pixel A in #C6F432 on #08090B", () => {
  const svg = pub("icon.svg").toString("utf8");
  assert.equal(svg, iconSvg());
  assert.match(svg, /viewBox="0 0 16 16"/);
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.match(svg, /<rect [^>]*rx="2"[^>]*fill="#08090B"/);
  assert.match(svg, /fill="#C6F432"/);
  assert.ok(!svg.includes("<text"), "no text element: the glyph is drawn from units");
});

test("favicon.ico holds 32 x 32 and 16 x 16 only, RGBA PNG payloads, pixel-exact with the corner pixels cut", async () => {
  const ico = pub("favicon.ico");
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)], [0, 1, 2], "icon directory with two images");
  for (const [i, size] of [32, 16].entries()) {
    const e = 6 + 16 * i;
    assert.deepEqual([ico[e], ico[e + 1]], [size, size], `entry ${i} is ${size} x ${size}`);
    const offset = ico.readUInt32LE(e + 12);
    const png = ico.subarray(offset, offset + ico.readUInt32LE(e + 8));
    assert.ok(png.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), "PNG payload");
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20), png[24], png[25]], [size, size, 8, 6], `payload is ${size} x ${size}, 8-bit RGBA`);
    const img = await raw(png);
    const px = size / 16;
    const cut = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const got = rgba(img, x, y);
        if (got[3] === 0) { cut.push([x, y]); continue; }
        assert.deepEqual(got, [...(isGlyphUnit(Math.floor(x / px), Math.floor(y / px)) ? GLYPH_COLOR : BG), 255], `${size}px pixel ${x},${y}`);
      }
    }
    const want = size === 16 ? [[0, 0], [15, 0], [0, 15], [15, 15]] : [[0, 0], [1, 0], [0, 1], [30, 0], [31, 0], [31, 1], [0, 30], [0, 31], [1, 31], [31, 30], [30, 31], [31, 31]];
    assert.deepEqual(cut.sort((a, b) => a[1] - b[1] || a[0] - b[0]), want.sort((a, b) => a[1] - b[1] || a[0] - b[0]), `${size}px corner pixels cut`);
    assert.deepEqual([...img.data], [...iconPixels(px)], `${size}px equals the generator`);
  }
});

test("apple-touch-icon.png is 180 x 180, fully opaque, the mark at 10 px per unit with 10 px padding, and a faint dither patch in the lower-right corner", async () => {
  const img = await raw(pub("apple-touch-icon.png"));
  assert.deepEqual([img.width, img.height], [180, 180]);
  let patch = 0;
  for (let y = 0; y < 180; y++) {
    for (let x = 0; x < 180; x++) {
      const got = rgba(img, x, y);
      assert.equal(got[3], 255, `pixel ${x},${y} is opaque`);
      const glyph = x >= 10 && y >= 10 && isGlyphUnit(Math.floor((x - 10) / 10), Math.floor((y - 10) / 10));
      if (glyph) assert.deepEqual(got, [...GLYPH_COLOR, 255], `glyph pixel ${x},${y}`);
      else if (got.slice(0, 3).join() === QUIET.join()) {
        patch++;
        assert.ok(x >= 110 && y >= 110, `patch pixel ${x},${y} lies in the lower-right corner`);
      } else assert.deepEqual(got, [...BG, 255], `tile pixel ${x},${y}`);
    }
  }
  assert.ok(patch > 100, `the patch has dither cells (${patch} pixels)`);
  // 5 px cells over the corner region: each 5 x 5 cell is one colour.
  for (let cy = 22; cy < 36; cy++) for (let cx = 22; cx < 36; cx++) {
    const first = rgba(img, cx * 5, cy * 5).join();
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
      const px = rgba(img, cx * 5 + x, cy * 5 + y).join();
      assert.equal(px, first, `5 px cell ${cx},${cy} is uniform`);
    }
  }
  assert.deepEqual([...img.data], [...appleTouchPixels()], "equals the generator");
});
