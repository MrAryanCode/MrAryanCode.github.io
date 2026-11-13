// Tier 3's pure part (algorithms.md A-1 and A-2): the snap, the zones, the sections, the mask geometry, the formation clock,
// the variants of D-052 and the 73-row uniform block. No DOM, so the Node tests import it directly. Imports carry the .ts
// extension for that reason.
import { EFFECT_MODE, FORMATION_MODE } from "./modes.ts";
import type { FormationMode, MaskPage, Theme, Variant, WidthClass } from "./modes.ts";

export const MAX_ZONES = 32;
export const MAX_TRAILS = 16;
export const MAX_RIPPLES = 3;
export const MAX_SECTIONS = 8;
export const UNIFORM_ROWS = 73;
export const UNIFORM_BYTES = UNIFORM_ROWS * 16;
export const PHONE_BELOW = 760;
export const ZONE_MARGIN_CSS = 10;
export const FORMATION_END = 3.2;
/** Seconds the pointer input may be older than the formation clock when it is written; see `inputFormationT`. */
export const INPUT_LAG_S = 0.1;

// Flags (grid.w). Flag 8, the zone-cap bypass of the reference's detector control, is deleted: nothing here skips the cap.
export const FLAG_LIGHT = 1;
export const FLAG_FLAT = 2;
export const FLAG_FLIP = 4;
export const FLAG_G7 = 16;
export const FLAG_PHONE = 32;

/** Level 0..4: background, still base, quiet, hot, spark. Levels 0..2 never pass the quiet colour. */
export const PALETTE: Record<Theme, readonly string[]> = {
  dark: ["#08090B", "#15191E", "#1C2128", "#4A6122", "#C6F432"],
  light: ["#F1F1EC", "#E0E2D9", "#D8DBD1", "#2B3036", "#5E8F00"],
};

export function rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

// ---- A-1 geometry: the snap ----

/** Device pixels per cell: the CSS cell size snapped to whole device pixels (JavaScript rounds halves up). */
export function cellDevicePx(cssCell: number, dpr: number): number {
  return Math.max(1, Math.round(cssCell * dpr));
}

/** The smallest k in 1..64 for which k cells span a whole number of CSS px (tolerance 1e-4, zoom DPRs), else 1. */
export function snapQ(D: number, dpr: number): number {
  for (let k = 1; k <= 64; k++) {
    const v = (k * D) / dpr;
    if (Math.abs(v - Math.round(v)) < 1e-4) return k;
  }
  return 1;
}

/** The CSS cell size: 4 on desk, 5 on phone; 6 and 7 from rank 4 on. */
export function cellCss(phone: boolean, level: number): number {
  return level >= 4 ? (phone ? 7 : 6) : phone ? 5 : 4;
}

export interface Geometry {
  D: number;
  q: number;
  cellsW: number;
  cellsH: number;
  /** The viewport width in cells, the sparks' weight axis. */
  viewCells: number;
  /** The canvas box in CSS px: cells * D / dpr, a whole number of px whenever a snap exists. */
  cssW: number;
  cssH: number;
}

export function geometry(vw: number, rootH: number, dpr: number, cell: number): Geometry {
  const D = cellDevicePx(cell, dpr);
  const q = snapQ(D, dpr);
  const viewCells = Math.ceil((vw * dpr) / D);
  const cellsW = Math.ceil(viewCells / q) * q;
  const cellsH = Math.ceil(Math.ceil((rootH * dpr) / D) / q) * q;
  return { D, q, cellsW, cellsH, viewCells, cssW: (cellsW * D) / dpr, cssH: (cellsH * D) / dpr };
}

// ---- A-1 zones and sections ----

/** Page rectangle in device pixels, already grown by the zone margin: x0, y0, x1, y1 (half-open). */
export type DevRect = [number, number, number, number];

/** A text box in page CSS px as a zone: the box plus 10 CSS px, floored and ceiled to device pixels. */
export function zoneOf(left: number, top: number, right: number, bottom: number, dpr: number): DevRect {
  const m = ZONE_MARGIN_CSS;
  return [Math.floor((left - m) * dpr), Math.floor((top - m) * dpr), Math.ceil((right + m) * dpr), Math.ceil((bottom + m) * dpr)];
}

/** While more than MAX_ZONES remain, merges the vertically closest pair into its bounding box. A merged zone is a
 *  superset of both, so the quiet guarantee survives the cap. */
export function mergeZones(all: readonly DevRect[]): DevRect[] {
  const z = all.map((r) => [...r] as DevRect).sort((a, b) => a[1] - b[1]);
  while (z.length > MAX_ZONES) {
    let best = 0;
    let bestGap = Infinity;
    for (let i = 0; i + 1 < z.length; i++) {
      const gap = Math.max(0, z[i + 1][1] - z[i][3]);
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    const a = z[best];
    const b = z[best + 1];
    z.splice(best, 2, [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
  }
  return z;
}

/** A band of the page: y0 and y1 in page CSS px, the kind of A-1's table. */
export interface Band {
  y0: number;
  y1: number;
  kind: number;
}

/** Makes the bands tile the page: sorted by top, the first starting at 0, each ending where the next begins, the last
 *  ending at the page height. Gaps and overlaps belong to the upper band, so the dithered crossfade always has a
 *  neighbour. At most MAX_SECTIONS bands are kept. */
export function tileBands(bands: readonly Band[], pageH: number): Band[] {
  const b = bands.map((x) => ({ ...x })).sort((p, q) => p.y0 - q.y0).slice(0, MAX_SECTIONS);
  for (let i = 0; i < b.length; i++) {
    if (i === 0) b[i].y0 = 0;
    b[i].y1 = i + 1 < b.length ? b[i + 1].y0 : pageH;
  }
  return b;
}

// ---- Noise, hashes and the base cell (shared with the Node tests) ----

export const NOISE_VX = 0.04;
export const NOISE_VY = 0.03;
export const NOISE_PERIOD_UNITS = 256;
/** The shader's float time wraps here (the f32 step stays under 0.5 ms); only the twinkle reads it. */
export const TIME_WRAP_S = 5120;

/** Noise drift in 10-bit fixed point. Each axis is wrapped on its own, in float64, modulo the 256-unit lattice period. */
export function noiseOffset(tSeconds: number): [number, number] {
  const ux = (tSeconds * NOISE_VX) % NOISE_PERIOD_UNITS;
  const uy = (tSeconds * NOISE_VY) % NOISE_PERIOD_UNITS;
  return [Math.floor(ux * 1024), Math.floor(uy * 1024)];
}

export function pcg3d(x: number, y: number, z: number): [number, number, number] {
  x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
  y = (Math.imul(y, 1664525) + 1013904223) >>> 0;
  z = (Math.imul(z, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0;
  y = (y + Math.imul(z, x)) >>> 0;
  z = (z + Math.imul(x, y)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  y = (y ^ (y >>> 16)) >>> 0;
  z = (z ^ (z >>> 16)) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0;
  y = (y + Math.imul(z, x)) >>> 0;
  z = (z + Math.imul(x, y)) >>> 0;
  return [x, y, z];
}

export function hash(cx: number, cy: number, seed: number): number {
  return pcg3d(cx >>> 0, cy >>> 0, seed)[0];
}

/** Value noise on a 1/1024 lattice with a period of 256 cells; the result is 0..1023. */
export function vnoise(px: number, py: number, seed: number): number {
  const ix = px >> 10;
  const iy = py >> 10;
  const fx = px & 1023;
  const fy = py & 1023;
  const sx = Math.floor((fx * fx * (3072 - 2 * fx)) / 1048576);
  const sy = Math.floor((fy * fy * (3072 - 2 * fy)) / 1048576);
  const h = (a: number, b: number): number => hash(a & 255, b & 255, seed) >>> 22;
  const ab = (h(ix, iy) * (1024 - sx) + h(ix + 1, iy) * sx) >> 10;
  const cd = (h(ix, iy + 1) * (1024 - sx) + h(ix + 1, iy + 1) * sx) >> 10;
  return (ab * (1024 - sy) + cd * sy) >> 10;
}

export function bayer8(x: number, y: number): number {
  let v = 0;
  for (let k = 0; k < 3; k++) {
    const a = (x >> k) & 1;
    const b = (y >> k) & 1;
    v += ((a ^ b) * 2 + b) << (2 * (2 - k));
  }
  return v;
}

/** The hash's top 24 bits as a float in [0, 1). */
export function u01(h: number): number {
  return (h >>> 8) * (1 / 16777216);
}

// ---- A-2 geometry: the mask rectangle ----

export type MaskKind = "name" | "404";

/** The mask rectangle in page CSS px and its font size. */
export interface MaskRect {
  x: number;
  y: number;
  w: number;
  h: number;
  font: number;
}

/** Desk (vw >= 760) and the home phone: the mockup's `_nameRect` with its switch moved to 760 (D-040); the 404 phone
 *  takes the design's rule (DV-02.4). On desk both masks stop growing at their 1920 x 1080 size (D-055), so name fs is at
 *  most 396.8 and the 404 font at most 597.3. `fold` is innerHeight, `hdr` the measured header height, `block` the h1 + lead
 *  rectangle of the 404 in page px (phone only). */
export function maskRect(kind: MaskKind, vw: number, fold: number, hdr: number, block?: { top: number; height: number }): MaskRect {
  const desk = vw >= PHONE_BELOW;
  const vc = Math.min(vw, 1920);
  if (kind === "404") {
    if (desk) {
      const f = Math.min((vc * 0.56) / 1.8, (fold - hdr) * 0.86);
      const w = 2 * f;
      const h = f * 1.02;
      return { x: vw - w + f * 0.04, y: hdr + Math.max(0, (fold - hdr - h) / 2) - f * 0.04, w, h, font: f };
    }
    const f = (1.3 * vw) / 1.8;
    const h = f * 1.02;
    const top = block?.top ?? hdr;
    const bh = block?.height ?? 0;
    return { x: 0.16 * vw, y: top + bh / 2 - h / 2, w: 2 * f, h, font: f };
  }
  if (desk) {
    const fs = Math.min((vc * 0.62) / 3, (fold - hdr) * 0.47);
    const w = fs * 3.1;
    const h = fs * 1.95;
    return { x: vw - w + fs * 0.12, y: hdr + Math.max(0, (fold - hdr - h) / 2) - fs * 0.06, w, h, font: fs };
  }
  const fs = (vw * 0.98) / 3;
  const w = fs * 3.1;
  return { x: vw - w + fs * 0.08, y: hdr + 8, w, h: fs * 1.95, font: fs };
}

export interface MaskCells {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

/** The mask rectangle in page cells: floor of the origin, ceil of the far edge. Not clipped to the viewport. */
export function maskCells(r: MaskRect, dpr: number, D: number): MaskCells {
  const x0 = Math.floor((r.x * dpr) / D);
  const y0 = Math.floor((r.y * dpr) / D);
  return { x0, y0, w: Math.ceil(((r.x + r.w) * dpr) / D) - x0, h: Math.ceil(((r.y + r.h) * dpr) / D) - y0 };
}

// ---- A-2 clock ----

export function breathOf(tf: number): number {
  return tf >= FORMATION_END ? 0.5 + 0.5 * Math.cos((2 * Math.PI * (tf - FORMATION_END)) / 5) : 1;
}

/** The scroll dissolve (home only): clamp(scrollY / (k innerHeight), 0, 1), k = 0.75 for full and 1.5 for soft; off is 0. */
export function dissolveOf(home: boolean, scrollY: number, innerHeight: number, variant: Variant): number {
  if (!home || variant === "off" || !(innerHeight > 0)) return 0;
  const k = variant === "soft" ? 1.5 : 0.75;
  return Math.min(Math.max(scrollY / (k * innerHeight), 0), 1);
}

/** The scale of the dissolve noise lattice, 0.03 per CSS px in 1/1024 units. */
export function dissolveScale(D: number, dpr: number): number {
  return Math.floor((30.72 * D) / dpr + 0.5);
}

/** tf at the first drawn frame. Home plays the intro once per tab (the key), the 404 on every load (the in-memory flag);
 *  hold mode starts at the hold. */
export function startTf(page: MaskPage, mode: FormationMode, introKey: string | null, playedThisLoad: boolean): number {
  if (mode === "hold") return FORMATION_END;
  if (page === "home") return introKey === "1" ? FORMATION_END : 0;
  return playedThisLoad ? FORMATION_END : 0;
}

export function formationMode(page: MaskPage, theme: Theme, width: WidthClass): FormationMode {
  return FORMATION_MODE[page][theme][width];
}

// ---- D-052 variants ----

/** A rate (how fast the effect's own time runs) and an amplitude (the kind 3 ring scale, the kind 5 tracer scale). */
export interface RateAmp {
  rate: number;
  amp: number;
}

/** The effects of D-052 as numbers. The phone rate scales the field time on phone only. */
export interface Effects {
  breathing: Variant;
  dissolve: Variant;
  phone: number;
  k3: RateAmp;
  k5: RateAmp;
}

const RATE: Record<Variant, number> = { full: 1, soft: 0.5, off: 0 };

/** Kind 3, rings: soft halves the phase speed (1.8 to 0.9 rad/s) and the amplitude, off holds the phase. */
export function k3Of(v: Variant): RateAmp {
  return { rate: RATE[v], amp: v === "soft" ? 0.5 : 1 };
}

/** Kind 5, rails and tracer: soft halves the stream speeds and the tracer term, off holds the streams and zeroes the tracer. */
export function k5Of(v: Variant): RateAmp {
  return { rate: RATE[v], amp: v === "full" ? 1 : v === "soft" ? 0.5 : 0 };
}

/** The effects the tables select for a theme and width class. */
export function effectsFor(theme: Theme, width: WidthClass): Effects {
  const pick = (e: keyof typeof EFFECT_MODE): Variant => EFFECT_MODE[e][theme][width] ?? "full";
  return {
    breathing: pick("breathing"),
    dissolve: pick("dissolve"),
    phone: width === "phone" ? RATE[pick("phone")] : 1,
    k3: k3Of(pick("k3")),
    k5: k5Of(pick("k5")),
  };
}

/** The breathing the shader reads: its `appear = 0.8 + 0.2 b` takes b, so soft (0.9 + 0.1 breath) is b = 0.5 + 0.5 breath
 *  and off (appear 1) is b = 1. */
export function breathLane(breath: number, v: Variant): number {
  return v === "soft" ? 0.5 + 0.5 * breath : v === "off" ? 1 : breath;
}

// ---- The writer ----

export interface Trail {
  x: number;
  y: number;
  a: number;
}
export interface Ripple {
  x: number;
  y: number;
  age: number;
}

/** What a layout fixes: everything the writer needs that does not change from frame to frame. */
export interface Scene {
  theme: Theme;
  phone: boolean;
  home: boolean;
  g7: boolean;
  mode: FormationMode;
  dpr: number;
  geo: Geometry;
  innerHeight: number;
  zones: readonly DevRect[];
  bands: readonly Band[];
  cta: readonly [number, number];
  col: readonly [number, number];
  mask: MaskCells | null;
  effects: Effects;
}

export interface Frame {
  /** Seconds since the field started (the phone-cells variant scales it). */
  t: number;
  /** Formation time. */
  tf: number;
  scrollY: number;
  trails?: readonly Trail[];
  ripples?: readonly Ripple[];
  /** The formation clock at the input frame the pointer output answers; defaults to tf. */
  inputFormationT?: number;
  /** 1 draws the kinds, 2 the dissolve noise (test hook); 0 draws the field. */
  debug?: number;
  /** The tracer's scale: 0 from rank 5. */
  tracer?: number;
}

/** The scalars the writer derives, exposed for the tests and the hook. */
export function frameScalars(s: Scene, f: Frame): { fieldT: number; breath: number; dissolve: number; tracerY: number } {
  const fieldT = f.t * (s.phone ? s.effects.phone : 1);
  return {
    fieldT,
    breath: breathOf(f.tf),
    dissolve: dissolveOf(s.home, f.scrollY, s.innerHeight, s.effects.dissolve),
    tracerY: f.scrollY + s.innerHeight / 2,
  };
}

const mod = (a: number, m: number): number => ((a % m) + m) % m;

/** One uniform block of 73 rows, 1,168 B, identical in std140 and WGSL. Rows: 0 grid, 1 origin and noise offset, 2 counts,
 *  3 maskR, 4 fx (k3 phase, k3 amp, k5 stream time, k5 tracer scale), 5 timef, 6 misc (dissolve, breath lane, dissolve
 *  scale or 0 off home, debug pass), 7..38 zones, 39..54 trails, 55..57 ripples, 58..65 sections, 66..70 palette,
 *  71 anchors (CTA x, y, column left, right), 72 extra (tracer y, star drift x, y, formation mode 0/1/2). */
export class UniformBlock {
  readonly buf = new ArrayBuffer(UNIFORM_BYTES);
  private readonly i = new Int32Array(this.buf);
  private readonly f = new Float32Array(this.buf);

  write(s: Scene, fr: Frame): ArrayBuffer {
    const { i, f } = this;
    const { geo, dpr } = s;
    i.fill(0);
    const sc = frameScalars(s, fr);
    const ft = sc.fieldT;
    const [nx, ny] = noiseOffset(ft);
    const flags = (s.theme === "light" ? FLAG_LIGHT : 0) | (s.g7 ? FLAG_G7 : 0) | (s.phone ? FLAG_PHONE : 0);
    i.set([geo.cellsW, geo.cellsH, geo.D, flags], 0);
    i.set([0, 0, nx, ny], 4);
    // The formation gate: no pointer input while a formation plays, and nothing born before it ended.
    const since = Math.min(fr.tf, fr.inputFormationT ?? fr.tf) - FORMATION_END;
    const trails = fr.trails ?? [];
    const ripples = fr.ripples ?? [];
    let nt = 0;
    let nr = 0;
    if (since >= 0) {
      for (let k = Math.max(0, trails.length - MAX_TRAILS); k < trails.length; k++) {
        const p = trails[k];
        // a >= 0 && a <= 1 also rejects NaN.
        if (!(Number.isFinite(p.x) && Number.isFinite(p.y) && p.a >= 0 && p.a <= 1 && 1.2 * p.a <= since)) continue;
        f.set([p.x * dpr, p.y * dpr, p.a, 0], 156 + 4 * nt++);
      }
      for (let k = Math.max(0, ripples.length - MAX_RIPPLES); k < ripples.length; k++) {
        const p = ripples[k];
        if (!(Number.isFinite(p.x) && Number.isFinite(p.y) && p.age >= 0 && p.age < 1.4 && p.age <= since)) continue;
        f.set([p.x * dpr, p.y * dpr, p.age, 0], 220 + 4 * nr++);
      }
    }
    const nz = Math.min(s.zones.length, MAX_ZONES);
    const ns = Math.min(s.bands.length, MAX_SECTIONS);
    i.set([nz, nt, nr, ns], 8);
    if (s.mask) i.set([s.mask.x0, s.mask.y0, s.mask.w, s.mask.h], 12);
    f.set([ft * s.effects.k3.rate, s.effects.k3.amp, ft * s.effects.k5.rate, s.effects.k5.amp * (fr.tracer ?? 1)], 16);
    f.set([ft % TIME_WRAP_S, fr.tf, dpr, geo.viewCells], 20);
    f.set([sc.dissolve, breathLane(sc.breath, s.effects.breathing), s.home ? dissolveScale(geo.D, dpr) : 0, fr.debug ?? 0], 24);
    for (let k = 0; k < nz; k++) i.set(s.zones[k], 28 + 4 * k);
    const phase16 = Math.floor(16 * 70 * ft) % 17600;
    for (let k = 0; k < ns; k++) {
      const b = s.bands[k];
      i.set([Math.round(b.y0 * dpr), Math.round(b.y1 * dpr), b.kind, phase16], 232 + 4 * k);
    }
    // Levels 0-2 go a quarter step off their 8-bit value, toward the safe side of the quiet colour, so a unorm store that
    // picks either neighbouring integer (Vulkan, GL dithering) still lands on a safe one.
    const nudge = s.theme === "dark" ? -0.25 : 0.25;
    PALETTE[s.theme].forEach((hex, k) => {
      const [r, g, b] = rgb(hex);
      const n = k <= 2 ? nudge : 0;
      f.set([(r + n) / 255, (g + n) / 255, (b + n) / 255, 1], 264 + 4 * k);
    });
    f.set([s.cta[0], s.cta[1], s.col[0], s.col[1]], 284);
    f.set([sc.tracerY, mod(4 * ft, 3584), mod(-2.5 * ft, 3584), s.mode === "vortex" ? 0 : s.mode === "inplace" ? 1 : 2], 288);
    // A non-finite float would poison the whole field; the zones are integers and hold.
    for (let k = 0; k < f.length; k++) if (!Number.isFinite(f[k])) f[k] = 0;
    return this.buf;
  }
}

/** Reads tier 2's output frame (Float32Array(61), algorithms.md A-5) into trail and ripple lists. */
export function readOutput(out: Float32Array): { trails: Trail[]; ripples: Ripple[] } {
  const trails: Trail[] = [];
  const ripples: Ripple[] = [];
  const nt = Math.min(out[2] | 0, 16);
  const nr = Math.min(out[3] | 0, 3);
  for (let k = 0; k < nt; k++) trails.push({ x: out[4 + 3 * k], y: out[5 + 3 * k], a: out[6 + 3 * k] });
  for (let k = 0; k < nr; k++) ripples.push({ x: out[52 + 3 * k], y: out[53 + 3 * k], age: out[54 + 3 * k] });
  return { trails, ripples };
}
