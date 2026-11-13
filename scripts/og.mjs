// Open Graph cards and the icon set at build time (design.md DV-02.7, DS-11).
// Card: sharp paints the flat background, the edge dither and the pixel mark as raw RGBA layers, and satori draws
// only the two text lines on a transparent card (reference satori-sharp-og-raster-and-ico, "Method A: sharp
// composite (default)"). satori lays text out as SVG paths, sharp rasterises it. No browser is involved.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import satori from "satori";
import sharp from "sharp";
import { routes } from "../src/routes.ts";

// Resolve fonts from the project root (the build script runs with the root as working directory).
const require = createRequire(join(process.cwd(), "package.json"));
const font = (pkg, file) => readFileSync(require.resolve(`${pkg}/files/${file}`));
// Exactly two static latin WOFF files: Geist 400 (line 2) and Geist Mono 500 (line 1). satori substitutes a family
// or weight that is not registered without an error, so no other pair may appear in a card (G-44). Geist 400 is
// first because satori uses the first font for a family that is not registered.
export const fonts = [
  { name: "Geist", data: font("@fontsource/geist", "geist-latin-400-normal.woff"), weight: 400, style: "normal" },
  { name: "Geist Mono", data: font("@fontsource/geist-mono", "geist-mono-latin-500-normal.woff"), weight: 500, style: "normal" },
];

export const CARD = { width: 1200, height: 630 };
export const COLOR = {
  bg: "#08090B", // tile and card background
  glyph: "#C6F432",
  quiet: "#1C2128", // the dither
  accent: "#4A6122", // the dither in its outermost band
  line1: "#EDEFF2",
  line2: "#9DA3AE",
};
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// ---- The pixel A (DV-02.7, "pixel A"): a 16 x 16 unit grid, glyph in columns 3 to 12 and rows 3 to 12. ----
export const GRID = 16;
export const GLYPH_ORIGIN = 3;
export const GLYPH = [
  "..XXXXXX..",
  ".XX....XX.",
  "XX......XX",
  "XX......XX",
  "XX......XX",
  "XXXXXXXXXX",
  "XX......XX",
  "XX......XX",
  "XX......XX",
  "XX......XX",
];
const glyphUnit = (ux, uy) => {
  const x = ux - GLYPH_ORIGIN;
  const y = uy - GLYPH_ORIGIN;
  return y >= 0 && y < GLYPH.length && x >= 0 && x < GLYPH[y].length && GLYPH[y][x] === "X";
};

/** `icon.svg`: viewBox 0 0 16 16, crisp edges, tile rect rx=2, one path of one-unit-high runs for the glyph. */
export function iconSvg() {
  const runs = [];
  GLYPH.forEach((row, y) => {
    for (const m of row.matchAll(/X+/g)) runs.push(`M${m.index + GLYPH_ORIGIN} ${y + GLYPH_ORIGIN}h${m[0].length}v1h-${m[0].length}z`);
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">` +
    `<rect width="16" height="16" rx="2" fill="${COLOR.bg}"/>` +
    `<path fill="${COLOR.glyph}" d="${runs.join("")}"/></svg>\n`
  );
}

/**
 * Raw RGBA of the tile with the glyph, `px` pixels per unit. Pixel-exact: no anti-aliasing. A corner pixel is cut
 * (alpha 0) when its centre lies outside the rect of radius 2 units, which is 1 pixel per corner at 1 px per unit and
 * 3 pixels per corner at 2 px per unit.
 */
export function iconPixels(px) {
  const size = GRID * px;
  const r = 2 * px;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.max(r - (x + 0.5), x + 0.5 - (size - r), 0);
      const dy = Math.max(r - (y + 0.5), y + 0.5 - (size - r), 0);
      if (dx * dx + dy * dy > r * r) continue; // cut corner: stays 0,0,0,0
      const on = glyphUnit(Math.floor(x / px), Math.floor(y / px));
      out.set([...rgb(on ? COLOR.glyph : COLOR.bg), 255], (y * size + x) * 4);
    }
  }
  return out;
}

/** The 4 x 4 ordered-dither matrix: a cell is on when its value is below the level (0 to 16). */
export const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/**
 * `apple-touch-icon.png`, 180 x 180, fully opaque. The 16-unit mark at 10 px per unit (160 px) with 10 px padding.
 * A faint ordered-dither patch of 5 px cells in the quiet colour sits in the lower-right corner: it covers the
 * 70 px square from 110 to 180, its level rises from 0 at the patch's top-left corner to 6 of 16 at the corner of
 * the icon, and a cell that would touch a glyph pixel stays empty.
 */
export function appleTouchPixels() {
  const size = 180;
  const pad = 10;
  const px = 10;
  const out = Buffer.alloc(size * size * 4);
  const [bgR, bgG, bgB] = rgb(COLOR.bg);
  const glyphAt = (x, y) => glyphUnit(Math.floor((x - pad) / px), Math.floor((y - pad) / px)) && x >= pad && y >= pad;
  const cell = 5;
  const patch = 110;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let color = [bgR, bgG, bgB];
      if (glyphAt(x, y)) color = rgb(COLOR.glyph);
      else if (x >= patch && y >= patch) {
        const cx = Math.floor(x / cell);
        const cy = Math.floor(y / cell);
        const x0 = cx * cell;
        const y0 = cy * cell;
        const touchesGlyph = [x0, x0 + cell - 1].some((px_) => [y0, y0 + cell - 1].some((py_) => glyphAt(px_, py_)));
        const t = ((x0 - patch) + (y0 - patch) + 2 * cell) / (2 * (size - patch)); // 0 at the patch's corner, 1 at the icon's
        const level = Math.round(6 * Math.min(1, Math.max(0, t)) ** 1.5);
        if (!touchesGlyph && BAYER4[cy % 4][cx % 4] < level) color = rgb(COLOR.quiet);
      }
      out.set([...color, 255], (y * size + x) * 4);
    }
  }
  return out;
}

const rawPng = (data, size) => sharp(data, { raw: { width: size, height: size, channels: 4 } }).ensureAlpha().png().toBuffer();

export const appleTouchPng = () => rawPng(appleTouchPixels(), 180);

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** ICONDIR, one ICONDIRENTRY per image, then the PNG files (reference satori-sharp-og-raster-and-ico, "favicon.ico by hand"). */
export function buildIco(images) {
  const dir = Buffer.alloc(6 + 16 * images.length);
  dir.writeUInt16LE(1, 2); // idType: icon
  dir.writeUInt16LE(images.length, 4);
  let offset = dir.length;
  images.forEach(({ size, png }, i) => {
    if (!png.subarray(0, 8).equals(PNG_MAGIC)) throw new Error("ICO payload is not a PNG");
    if (png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size) throw new Error("ICO payload size differs from its entry");
    if (png[24] !== 8 || png[25] !== 6) throw new Error("ICO payload is not 8-bit RGBA (colour type 6)");
    const e = 6 + 16 * i;
    dir[e] = size === 256 ? 0 : size;
    dir[e + 1] = size === 256 ? 0 : size;
    dir.writeUInt16LE(1, e + 4); // planes
    dir.writeUInt16LE(32, e + 6); // bit count
    dir.writeUInt32LE(png.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([dir, ...images.map((m) => m.png)]);
}

/** `favicon.ico`: 32 x 32 (2 px per unit) then 16 x 16 (1 px per unit), RGBA PNG payloads. */
export async function faviconIco() {
  return buildIco([
    { size: 32, png: await rawPng(iconPixels(2), 32) },
    { size: 16, png: await rawPng(iconPixels(1), 16) },
  ]);
}

// ---- The edge pattern (DV-02.7, "Share cards"): one static image, 6 px cells, 4 x 4 ordered dither. ----
export const PATTERN = {
  cell: 6,
  quiet: [300, 900], // the central 600 px stay empty
  maxLevel: 8, // 8 of 16 is 50% (the next step, 9 of 16, is 56.25%, over the 55% of DV-02.7)
  band: 48, // the outermost 48 px (8 cells) on each side may hold the accent colour
  accentBelow: 4, // in the band, an on-cell whose matrix value is below this is drawn in the accent colour
};

/** Level (0 to 16) of the cell whose centre is at card x: 0 in the quiet zone, rising as 8.8 * t^1.5 to the edge. */
export function patternLevel(cx) {
  const [from, to] = PATTERN.quiet;
  const depth = cx < from ? from - cx : cx - to;
  if (depth <= 0) return 0;
  const t = Math.min(1, depth / from);
  return Math.min(PATTERN.maxLevel, Math.round(0.55 * 16 * t ** 1.5));
}

/** Raw RGBA of the whole card width: the dither on a transparent ground. */
export function patternRaw() {
  const { width, height } = CARD;
  const { cell, band, accentBelow } = PATTERN;
  const out = Buffer.alloc(width * height * 4);
  const quiet = [...rgb(COLOR.quiet), 255];
  const accent = [...rgb(COLOR.accent), 255];
  for (let cy = 0; cy < height / cell; cy++) {
    for (let cx = 0; cx < width / cell; cx++) {
      const v = BAYER4[cy % 4][cx % 4];
      if (v >= patternLevel(cx * cell + cell / 2)) continue;
      const inBand = cx * cell < band || (cx + 1) * cell > width - band;
      const color = inBand && v < accentBelow ? accent : quiet;
      for (let y = cy * cell; y < (cy + 1) * cell; y++) for (let x = cx * cell; x < (cx + 1) * cell; x++) out.set(color, (y * width + x) * 4);
    }
  }
  return out;
}

// ---- The card layout (DV-02.7): numbers are pixels in the 1200 x 630 card. ----
export const MARK = { px: 5, left: 560, top: 176 }; // 80 x 80 box, glyph 50 x 50, centred, box top at y=176
export const SAFE_BOX = { left: 300, right: 900, top: 64, bottom: 566 };
const LAYOUT = {
  home: { size: 96, baseline: 384 },
  card: { size: 54, baseline: 362 },
};
const LINE2 = { size: 32, gap: 60 };
// Geist and Geist Mono share one vertical metric set (ascent 1005, descent 295 per 1000 em, from fontaine's capsize
// table): with a line-height of 1.3 em the half-leading is zero, so the baseline is the box top plus 1.005 em.
const ASCENT = 1.005;
const textTop = (baseline, size) => baseline - ASCENT * size;

/** The satori element tree of the text lines on a card with no background (the pattern and mark are sharp layers). */
export function cardTree(line1, line2, layout = "card") {
  const l1 = LAYOUT[layout];
  const base = { display: "flex", justifyContent: "center", position: "absolute", left: 0, width: CARD.width, lineHeight: 1.3 };
  return {
    type: "div",
    props: {
      style: { display: "flex", position: "relative", width: CARD.width, height: CARD.height },
      children: [
        { type: "div", props: { style: { ...base, top: textTop(l1.baseline, l1.size), fontFamily: "Geist Mono", fontWeight: 500, fontSize: l1.size, color: COLOR.line1 }, children: line1 } },
        { type: "div", props: { style: { ...base, top: textTop(l1.baseline + LINE2.gap, LINE2.size), fontFamily: "Geist", fontWeight: 400, fontSize: LINE2.size, color: COLOR.line2 }, children: line2 } },
      ],
    },
  };
}

export async function ogSvg(line1, line2, layout) {
  return satori(cardTree(line1, line2, layout), { ...CARD, fonts });
}

const markLayer = () => {
  const { px, left, top } = MARK;
  const size = GRID * px;
  const out = Buffer.alloc(size * size * 4);
  const glyph = [...rgb(COLOR.glyph), 255];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (glyphUnit(Math.floor(x / px), Math.floor(y / px))) out.set(glyph, (y * size + x) * 4);
  return { input: out, raw: { width: size, height: size, channels: 4 }, left, top };
};

/**
 * Compose a card: flat background, then the pattern, the mark, the text. `text: false` and `mark: false` leave a layer
 * out (the safe-box test compares a card with the same card without them).
 */
export async function ogPng(line1, line2, layout = "card", { text = true, mark = true } = {}) {
  const layers = [{ input: patternRaw(), raw: { ...CARD, channels: 4 }, left: 0, top: 0 }];
  if (mark) layers.push(markLayer());
  if (text) layers.push({ input: await sharp(Buffer.from(await ogSvg(line1, line2, layout))).png().toBuffer(), left: 0, top: 0 });
  const [r, g, b] = rgb(COLOR.bg);
  return sharp({ create: { ...CARD, channels: 4, background: { r, g, b } } }).composite(layers).png().toBuffer();
}

/**
 * One card per route that has one: { slug: [line 1, line 2, layout] } from `ogCard` in the route table (D-033). The text
 * is static and never uses the GitHub facts (P-04): a card is cached by link previews, so it must not go stale. Only
 * characters in the latin subset of the Geist files may appear (satori draws any other character as a box and does not
 * throw). The home card has the 96 px title, the others the 54 px one.
 */
export function ogCards() {
  return Object.fromEntries(
    routes.filter((r) => r.ogCard).map((r) => [r.ogSlug, [...r.ogCard, r.id === "home" ? "home" : "card"]]),
  );
}

// `node scripts/og.mjs --icons` rewrites the three icon files in public/ from the grid above (the files are committed).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2] === "--icons") {
  const pub = join(fileURLToPath(new URL("..", import.meta.url)), "public");
  writeFileSync(join(pub, "icon.svg"), iconSvg());
  writeFileSync(join(pub, "favicon.ico"), await faviconIco());
  writeFileSync(join(pub, "apple-touch-icon.png"), await appleTouchPng());
}
