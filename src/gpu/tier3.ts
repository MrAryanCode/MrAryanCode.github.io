// Tier 3 (P-06.5, algorithms.md A-1 and A-2): the dither field, one page-tall canvas of one texel per cell behind the
// page, drawn by WebGPU or, when that fails, WebGL2. This file is the lifecycle: it measures the page, owns the canvas
// and the formation clock, feeds the step-down monitor (A-3) and hands pointer input from tier 2 to the writer in core.ts.
// `start` resolves true once the first frame is drawn and false when tier 3 declines; on false nothing of it stays in the DOM.
import { frame as budgetFrame, interval, level, onLevel, reset as budgetReset } from "../motion/budget.ts";
import { onOutput } from "../workers/tier2.ts";
import {
  FORMATION_END, INPUT_LAG_S, PHONE_BELOW, UniformBlock, cellCss, effectsFor, formationMode, geometry, maskCells, maskRect,
  mergeZones, readOutput, startTf, tileBands, zoneOf,
} from "./core.ts";
import type { Band, DevRect, Effects, Frame, MaskCells, Ripple, Scene, Trail } from "./core.ts";
import type { FormationMode, MaskPage, Theme } from "./modes.ts";
import type { Backend } from "./webgl2.ts";
import { createWebGl2 } from "./webgl2.ts";

// The step-down monitor's reset (A-3), counted in test builds so a test can assert that a loss and a canvas swap call it.
let resets = 0;
const reset = (): void => {
  if (__SEEK_HOOK__) resets++;
  budgetReset();
};
// Test builds only: the three exports below are assigned under __SEEK_HOOK__. A production build leaves them unassigned
// (the loader imports this module as a namespace, so the bundler keeps the export names) and nothing calls them.
/** The number of reset() calls this module has made (the seek hook reads it). */
export let resetCalls: () => number;
if (__SEEK_HOOK__) resetCalls = () => resets;
/** Resolves true when the first frame is drawn, false when tier 3 declined. */
export let started: Promise<boolean>;
let settle!: (ok: boolean) => void;
if (__SEEK_HOOK__) started = new Promise<boolean>((resolve) => { settle = resolve; });

const REDUCED = "(prefers-reduced-motion: reduce)";
const DARK = "(prefers-color-scheme: dark)";
const INTRO_KEY = "motion-intro";
const MONO = '"Geist Mono"';
const FRAME_30 = 1000 / 30;
const NAME_LINES = ["Aryan", "Miri"];
const STILL_LOOK_OFF =
  'html[data-field="on"] body::before, html[data-field="on"] body::after { display: none; }';

interface Run {
  wrap: HTMLDivElement;
  canvas: HTMLCanvasElement;
  sentinel: HTMLDivElement;
  style: HTMLStyleElement;
  backend: Backend;
  ro: ResizeObserver;
  block: UniformBlock;
  root: HTMLElement;
  route: string;
  page: MaskPage | null;
  texts: Text[];
  textsDirty: boolean;
  mutation: MutationObserver;
  range: Range;
  fontOk: boolean;
  geoKey: string;
  rasterKey: string;
  mode: FormationMode;
  tf0: number;
  startTs: number | null;
  t0: number;
  lastTf: number;
  lastDraw: number;
  prevScroll: number;
  pending: boolean;
  pendingTs: number;
  flip: boolean;
  raf: number;
  trails: Trail[];
  ripples: Ripple[];
  drawn: boolean;
  lost: boolean;
  recovering: boolean; // a lost WebGPU device is being replaced
  gone: boolean; // finish(run, true) has run: nothing may be attached to it any more
  unsub: (() => void)[];
  lastCounts?: { trails: number; ripples: number }; // set only in test builds
}

let kept: Run | null = null; // the field while paused: hidden, ready to resume
let live: Run | null = null; // the field that is drawing, or the one the hook holds
let playedThisLoad = false; // the 404 plays its formation on every load
// What the seek hook's view changes (hookView): every read is under __SEEK_HOOK__, so the production chunk keeps none of it
// (vite-test-only-module). The names are distinct so that scripts/seek-markers.json can find a guard that was removed.
const hookState: { heldByHook: boolean; effectsMap: ((e: Effects) => Effects) | null } = { heldByHook: false, effectsMap: null };

// ---- Page measuring ----

const pageRect = (el: Element): { l: number; t: number; r: number; b: number } => {
  const r = el.getBoundingClientRect();
  return { l: r.left + scrollX, t: r.top + scrollY, r: r.right + scrollX, b: r.bottom + scrollY };
};

function collectTexts(root: HTMLElement): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n as Text).data.trim() !== "") out.push(n as Text);
  return out;
}

function measureZones(run: Run, dpr: number): DevRect[] {
  if (run.textsDirty) {
    run.texts = collectTexts(run.root);
    run.textsDirty = false;
  }
  const zones: DevRect[] = [];
  for (const node of run.texts) {
    run.range.selectNodeContents(node);
    const rects = run.range.getClientRects();
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (r.width > 0 && r.height > 0) zones.push(zoneOf(r.left + scrollX, r.top + scrollY, r.right + scrollX, r.bottom + scrollY, dpr));
    }
  }
  return mergeZones(zones);
}

export interface LayoutInfo {
  page: string;
  theme: Theme;
  D: number;
  dpr: number;
  cellsW: number;
  cellsH: number;
  innerWidth: number;
  innerHeight: number;
  maxScroll: number;
  renderer: { api: string; name: string };
  sections: { kind: number; y0: number; y1: number }[];
  cta: [number, number];
  col: [number, number];
}

interface Measured {
  scene: Scene;
  info: LayoutInfo | null; // null in a production build
  maskCssRect: { rect: ReturnType<typeof maskRect>; text: string[] } | null;
}

function measure(run: Run, cell: "auto" | number = "auto"): Measured {
  const html = document.documentElement;
  const vw = html.clientWidth;
  const fold = innerHeight;
  const dpr = devicePixelRatio || 1;
  const phone = vw < PHONE_BELOW;
  const theme: Theme = matchMedia(DARK).matches ? "dark" : "light";
  const rootH = Math.max(html.scrollHeight, 1);
  const cssCell = cell === "auto" ? cellCss(phone, Math.min(level(), 3)) : cell;
  const geo = geometry(vw, rootH, dpr, cssCell);
  const bands: Band[] = [];
  run.root.querySelectorAll("[data-field-kind]").forEach((el) => {
    const r = pageRect(el);
    bands.push({ y0: r.t, y1: r.b, kind: Number((el as HTMLElement).dataset.fieldKind) });
  });
  const tiled = tileBands(bands, rootH);
  const ctaEl = run.root.querySelector('[data-field-kind="3"] .btn-primary');
  const cta: [number, number] = ctaEl ? ((r) => [(r.l + r.r) / 2, (r.t + r.b) / 2] as [number, number])(pageRect(ctaEl)) : [vw / 2, 0];
  const readingEl = run.root.querySelector(".reading");
  let col: [number, number] = [0, 0];
  if (readingEl) {
    const r = pageRect(readingEl);
    const cs = getComputedStyle(readingEl);
    col = [r.l + parseFloat(cs.paddingLeft), r.r - parseFloat(cs.paddingRight)];
  }
  const hdr = run.root.querySelector("header")?.getBoundingClientRect().height ?? 0;
  let maskGeo: Measured["maskCssRect"] = null;
  if (run.page === "home") maskGeo = { rect: maskRect("name", vw, fold, hdr), text: NAME_LINES };
  else if (run.page === "404") {
    let block: { top: number; height: number } | undefined;
    const h1 = run.root.querySelector(".not-found h1");
    const lead = run.root.querySelector(".not-found .role");
    if (h1 && lead) {
      const a = pageRect(h1);
      const b = pageRect(lead);
      block = { top: a.t, height: b.b - a.t };
    }
    maskGeo = { rect: maskRect("404", vw, fold, hdr, block), text: ["404"] };
  }
  const mask = maskGeo && run.fontOk ? maskCells(maskGeo.rect, dpr, geo.D) : null;
  const width = phone ? "phone" : "desk";
  const base = effectsFor(theme, width);
  const scene: Scene = {
    theme,
    phone,
    home: run.page === "home",
    g7: run.page === "404" && phone,
    mode: run.mode,
    dpr,
    geo,
    innerHeight: fold,
    zones: measureZones(run, dpr),
    bands: tiled,
    cta,
    col,
    mask,
    effects: __SEEK_HOOK__ && hookState.effectsMap ? hookState.effectsMap(base) : base,
  };
  // Only the seek hook reads the layout, so a production build does not build it.
  const info: LayoutInfo | null = !__SEEK_HOOK__ ? null : {
    page: run.route,
    theme,
    D: geo.D,
    dpr,
    cellsW: geo.cellsW,
    cellsH: geo.cellsH,
    innerWidth: vw,
    innerHeight: fold,
    maxScroll: Math.max(0, rootH - fold),
    renderer: { api: run.backend.api, name: run.backend.name },
    sections: tiled.map((b) => ({ kind: b.kind, y0: b.y0, y1: b.y1 })),
    cta,
    col,
  };
  return { scene, info, maskCssRect: maskGeo };
}

// ---- The mask ----

/** Rasterises the mask at 4 x 4 samples per cell and keeps a cell lit when at least 8 of its 16 samples are covered. */
function rasterMask(m: NonNullable<Measured["maskCssRect"]>, cells: MaskCells, dpr: number, D: number, page: MaskPage): Uint8Array | null {
  if (typeof OffscreenCanvas === "undefined") return null;
  const S = 4;
  const sw = cells.w * S;
  const sh = cells.h * S;
  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const f = m.rect.font;
  const gs = (S * f * dpr) / D;
  ctx.font = `700 ${gs}px ${MONO}`;
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";
  (ctx as unknown as { letterSpacing: string }).letterSpacing = page === "home" ? `${-0.06 * gs}px` : "0px";
  if (page === "home") {
    ctx.textAlign = "right";
    m.text.forEach((line, li) => ctx.fillText(line, sw, gs * (0.84 + 0.94 * li)));
  } else {
    ctx.textAlign = "left";
    ctx.fillText(m.text[0], 0, gs * 0.84);
  }
  const px = ctx.getImageData(0, 0, sw, sh).data;
  const out = new Uint8Array(cells.w * cells.h);
  for (let y = 0; y < cells.h; y++) {
    for (let x = 0; x < cells.w; x++) {
      let n = 0;
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) if (px[((y * S + j) * sw + x * S + i) * 4 + 3] >= 128) n++;
      if (n >= 8) out[y * cells.w + x] = 255;
    }
  }
  return out;
}

// ---- Backends ----

/** A software adapter: the one the browser itself calls a fallback, or SwiftShader. The reading is `adapter.info`
 *  (`adapter.isFallbackAdapter` is undefined on the adapter object). No GPU list is kept: only the software cases decline. */
function softwareAdapter(adapter: unknown): boolean {
  const info = (adapter as { info?: { isFallbackAdapter?: boolean; architecture?: string } }).info;
  return info?.isFallbackAdapter === true || info?.architecture === "swiftshader";
}

async function createBackend(wrap: HTMLElement, onLost: () => void, onRestored: () => void): Promise<{ backend: Backend; canvas: HTMLCanvasElement } | null> {
  // D-063: tier 3 declines on a software renderer and the page stays on tier 2. Only the seek-hook build can switch the
  // decline off (CI's runner has no GPU); the deploy build folds this to false, so the switch is not in dist/.
  const allowSoftware = __SEEK_HOOK__ && (globalThis as { T3_ALLOW_SOFTWARE?: unknown }).T3_ALLOW_SOFTWARE === true;
  const fresh = (): HTMLCanvasElement => {
    const c = document.createElement("canvas");
    c.setAttribute("aria-hidden", "true");
    c.style.cssText =
      "position:absolute;left:0;top:0;z-index:-2;display:block;image-rendering:pixelated;opacity:1;background:none;visibility:hidden;pointer-events:none";
    return c;
  };
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (gpu) {
    const canvas = fresh();
    wrap.append(canvas);
    try {
      const adapter = await gpu.requestAdapter();
      if (adapter && (allowSoftware || !softwareAdapter(adapter))) {
        const { createWebGpu } = await import("./layer.ts"); // its own chunk, loaded only when an adapter exists
        const backend = await createWebGpu(canvas, adapter, onLost);
        if (backend) return { backend, canvas };
      }
    } catch {
      // Any WebGPU failure falls through to WebGL2.
    }
    canvas.remove(); // a canvas that asked for a webgpu context cannot give a webgl2 one
  }
  const canvas = fresh();
  wrap.append(canvas);
  try {
    const backend = createWebGl2(canvas, onLost, onRestored, allowSoftware);
    if (backend) return { backend, canvas };
  } catch {
    // A context that is not a real one (a stub) ends here: tier 3 declines.
  }
  canvas.remove();
  return null;
}

// ---- Drawing ----

function applyGeometry(run: Run, m: Measured): boolean {
  const { scene } = m;
  const key = `${scene.geo.cellsW}x${scene.geo.cellsH}@${scene.dpr}/${scene.geo.D}`;
  const rasterKey = scene.mask && m.maskCssRect ? `${scene.mask.x0},${scene.mask.y0},${scene.mask.w},${scene.mask.h}@${scene.dpr}/${scene.geo.D}/${m.maskCssRect.rect.font}` : "-";
  if (key === run.geoKey && rasterKey === run.rasterKey) return true;
  if (key !== run.geoKey) {
    if (!run.backend.resize(scene.geo.cellsW, scene.geo.cellsH)) return false;
    run.canvas.style.width = `${scene.geo.cssW}px`;
    run.canvas.style.height = `${scene.geo.cssH}px`;
  }
  if (rasterKey !== run.rasterKey) {
    if (scene.mask && m.maskCssRect && run.page) {
      run.backend.setMask(rasterMask(m.maskCssRect, scene.mask, scene.dpr, scene.geo.D, run.page), scene.mask.w, scene.mask.h);
    } else run.backend.setMask(null, 1, 1);
  }
  run.geoKey = key;
  run.rasterKey = rasterKey;
  reset(); // a resize, a raster and a canvas swap are long tasks the monitor must not count (A-3)
  return true;
}

function frameOf(run: Run, scene: Scene, ts: number): Frame {
  if (run.startTs === null) {
    run.startTs = ts - run.tf0 * 1000;
    run.t0 = ts;
  }
  const tf = Math.min((ts - run.startTs) / 1000, 1e6);
  const lvl = level();
  return {
    t: (ts - run.t0) / 1000,
    tf: scene.mask ? tf : FORMATION_END,
    scrollY: run.prevScroll,
    trails: run.trails,
    ripples: run.ripples,
    inputFormationT: tf - INPUT_LAG_S,
    tracer: lvl >= 5 ? 0 : 1,
  };
}

function drawFrame(run: Run, ts: number): void {
  run.pending = false;
  if (run.lost) return;
  const m = measure(run, cellFor(run));
  // A rank 4 step changes the cell size, but not while the formation plays.
  if (!applyGeometry(run, m)) {
    finish(run, true);
    return;
  }
  const fr = frameOf(run, m.scene, ts);
  if (run.lastTf < FORMATION_END && fr.tf >= FORMATION_END) reset(); // the intro's end: a held rank 4 applies now
  if (run.lastTf < FORMATION_END && run.page && !run.drawn) markPlayed(run.page);
  run.lastTf = fr.tf;
  run.mode = m.scene.mode;
  const buf = run.block.write(m.scene, fr);
  if (__SEEK_HOOK__) run.lastCounts = { trails: new Int32Array(buf, 32, 4)[1], ripples: new Int32Array(buf, 32, 4)[2] };
  if (!run.backend.draw(buf)) return;
  run.lastDraw = ts;
  run.prevScroll = scrollY;
  if (!run.drawn) {
    run.drawn = true;
    run.canvas.style.visibility = "visible";
  }
  // Also after a Play: hide() removed the flag with the pause, and the field is drawing again.
  if (document.documentElement.dataset.field !== "on") document.documentElement.dataset.field = "on";
}

function cellFor(run: Run, tf: number = run.lastTf): number {
  const phone = document.documentElement.clientWidth < PHONE_BELOW;
  const lvl = level();
  return cellCss(phone, lvl >= 4 && tf < FORMATION_END ? 3 : lvl);
}

function markPlayed(page: MaskPage): void {
  if (page === "home") {
    try {
      sessionStorage.setItem(INTRO_KEY, "1");
    } catch {
      // Blocked storage: the intro may play again on the next page of this tab.
    }
  } else playedThisLoad = true;
}

// ---- Lifecycle ----

function hide(run: Run): void {
  cancelAnimationFrame(run.raf);
  run.ro.disconnect();
  run.mutation.disconnect();
  for (const u of run.unsub) u();
  run.unsub = [];
  run.trails = [];
  run.ripples = [];
  run.wrap.style.display = "none";
  delete document.documentElement.dataset.field;
}

/** Ends the field. `destroy` removes it for good; otherwise it stays hidden for the next Play. */
function finish(run: Run, destroy: boolean): void {
  hide(run);
  if (live === run) live = null;
  if (!destroy) {
    kept = run;
    return;
  }
  if (kept === run) kept = null;
  run.gone = true;
  run.backend.destroy();
  run.wrap.remove();
  run.style.remove();
  if (document.documentElement.dataset.tier === "3") document.documentElement.dataset.tier = "2";
}

function begin(run: Run): void {
  run.unsub.push(onOutput((out) => {
    const o = readOutput(out);
    run.trails = o.trails;
    run.ripples = o.ripples;
  }));
  run.unsub.push(onLevel((l) => { if (l >= 7) finish(run, true); }));
  run.ro.observe(document.body);
  run.ro.observe(run.sentinel);
  run.mutation.observe(run.root, { childList: true, subtree: true, characterData: true });
  const loop = (ts: number): void => {
    run.raf = requestAnimationFrame(loop);
    budgetFrame(ts);
    if (level() >= 7) {
      finish(run, true);
      return;
    }
    if (run.pending) drawFrame(run, run.pendingTs); // the observer did not deliver last frame
    if (__SEEK_HOOK__ && hookState.heldByHook) return;
    const I = interval() || 1000 / 60;
    if (level() >= 3 && ts - run.lastDraw < FRAME_30 - I / 2) return; // rank 3: 30 fps
    run.pending = true;
    run.pendingTs = ts;
    run.flip = !run.flip;
    run.sentinel.style.height = run.flip ? "2px" : "1px"; // the observer's callback runs after layout, before paint
  };
  run.raf = requestAnimationFrame(loop);
}

function readRoute(): string {
  try {
    return (JSON.parse(document.getElementById("site-data")!.textContent!) as { route: string }).route;
  } catch {
    return "";
  }
}

export async function start(root: HTMLElement, signal: AbortSignal): Promise<boolean> {
  const ok = await startRun(root, signal);
  if (__SEEK_HOOK__) settle(ok);
  return ok;
}

async function startRun(root: HTMLElement, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted || matchMedia(REDUCED).matches || level() >= 7) return false;
  const onAbort = (): void => {
    const run = live ?? kept;
    if (run) finish(run, matchMedia(REDUCED).matches);
  };
  if (kept) {
    // Play: the same canvas, the formation already over.
    const run = kept;
    kept = null;
    live = run;
    run.tf0 = FORMATION_END;
    run.startTs = null;
    run.lastTf = FORMATION_END;
    run.wrap.style.display = "";
    run.textsDirty = true;
    reset();
    begin(run);
    signal.addEventListener("abort", onAbort, { once: true });
    return true;
  }
  try {
    await document.fonts?.ready;
  } catch {
    // The page's fonts failed; the mask gate below then declines the letters.
  }
  if (signal.aborted) return false;
  const route = readRoute();
  const page: MaskPage | null = route === "home" ? "home" : route === "notfound" ? "404" : null;
  const wrap = document.createElement("div");
  wrap.setAttribute("aria-hidden", "true");
  wrap.style.cssText = "position:absolute;inset:0;overflow:clip;z-index:-2;pointer-events:none";
  const sentinel = document.createElement("div");
  sentinel.style.cssText = "position:absolute;left:0;top:0;width:1px;height:1px;visibility:hidden";
  wrap.append(sentinel);
  const style = document.createElement("style");
  style.textContent = STILL_LOOK_OFF;
  let current: Run | null = null;
  const onLost = (): void => {
    if (!current) return;
    current.lost = true;
    current.canvas.style.visibility = "hidden"; // A-1: hidden from the loss until the first draw after it
    reset();
    if (current.backend.api === "webgpu") void recover(current);
  };
  // A-1 "Context loss": a lost WebGPU device is replaced from a new adapter and device; with no adapter the field falls
  // back to WebGL2 on a new canvas, and the mask is re-uploaded. A re-requested software adapter is treated as a null
  // adapter (D-063, D-064 item 4), so recovery goes on to WebGL2, which applies its own D-063 SwiftShader check: a software
  // WebGL2 declines and the page stays on tier 2, a hardware WebGL2 draws. The canvas is hidden from the loss until its first
  // draw, and the swap calls reset() (A-3).
  const recover = async (run: Run): Promise<void> => {
    if (run.recovering) return;
    run.recovering = true;
    let made: { backend: Backend; canvas: HTMLCanvasElement } | null = null;
    try {
      made = await createBackend(wrap, onLost, onRestored);
    } catch {
      made = null;
    }
    run.recovering = false;
    if (run.gone) {
      made?.backend.destroy();
      made?.canvas.remove();
      return;
    }
    if (!made) {
      finish(run, true);
      return;
    }
    run.backend.destroy();
    run.canvas.remove();
    run.backend = made.backend;
    run.canvas = made.canvas;
    run.geoKey = ""; // the new canvas has no size and no mask yet: the next draw sets both
    run.rasterKey = "";
    run.drawn = false;
    run.lost = false;
    reset();
  };
  const onRestored = (): void => {
    if (!current) return;
    current.lost = false;
    current.drawn = false; // the next draw shows the canvas again
    current.geoKey = "";
    current.rasterKey = "";
    reset();
  };
  const made = await createBackend(wrap, onLost, onRestored);
  if (!made || signal.aborted) {
    made?.backend.destroy();
    wrap.remove();
    return false;
  }
  document.head.append(style);
  document.body.append(wrap);
  let introKey: string | null = null;
  try {
    introKey = sessionStorage.getItem(INTRO_KEY);
  } catch {
    // Blocked storage reads as no key.
  }
  const phone = document.documentElement.clientWidth < PHONE_BELOW;
  const theme: Theme = matchMedia(DARK).matches ? "dark" : "light";
  const mode = page ? formationMode(page, theme, phone ? "phone" : "desk") : "hold";
  const run: Run = {
    wrap, canvas: made.canvas, sentinel, style, backend: made.backend, block: new UniformBlock(), root, route, page,
    texts: [], textsDirty: true, range: document.createRange(), fontOk: false, geoKey: "", rasterKey: "", mode,
    tf0: page ? startTf(page, mode, introKey, playedThisLoad) : FORMATION_END, startTs: null, t0: 0, lastTf: -1,
    lastDraw: -1e9, prevScroll: scrollY, pending: false, pendingTs: 0, flip: false, raf: 0, trails: [], ripples: [],
    drawn: false, lost: false, recovering: false, gone: false, unsub: [],
    ro: new ResizeObserver(() => { if (run.pending) drawFrame(run, run.pendingTs); }),
    mutation: new MutationObserver(() => { run.textsDirty = true; }),
  };
  current = run;
  if (page) {
    const text = page === "home" ? NAME_LINES.join(" ") : "404";
    try {
      run.fontOk = ((await document.fonts.load(`700 100px ${MONO}`, text)) as unknown[]).length > 0;
    } catch {
      run.fontOk = false; // the font gate: no font, no letters, nothing thrown
    }
    if (signal.aborted) {
      finish(run, true);
      return false;
    }
  }
  live = run;
  signal.addEventListener("abort", onAbort, { once: true });
  drawFrame(run, performance.now());
  if (!live || live !== run || !run.drawn) {
    if (live === run) finish(run, true);
    return false;
  }
  reset();
  begin(run);
  return true;
}

// ---- The hook's view (built only under __SEEK_HOOK__: a production build leaves hookView unassigned) ----

export interface HookView {
  readonly backend: Backend;
  /** Re-measures the page and returns the scene, with the canvas and the mask brought up to date. `tf` is the formation
   *  time about to be drawn: a pinned rank 4 uses its coarser cells only from the formation's end, as the field does. */
  scene(tf?: number): { scene: Scene; info: LayoutInfo };
  write(scene: Scene, fr: Frame): ArrayBuffer;
  /** Stops (true) or resumes (false) the field's own drawing. */
  hold(on: boolean): void;
  setEffects(map: ((e: Effects) => Effects) | null): void;
  counts(): { trails: number; ripples: number };
  /** The formation time the run started from: 0 when the formation plays, 3.2 (FORMATION_END) when it is over. */
  startTf(): number;
  /** Resolves true when the first frame is drawn, false when tier 3 declined. */
  ready: Promise<boolean>;
}

export let hookView: () => HookView | null;
if (__SEEK_HOOK__) hookView = () => {
  const run = live;
  if (!run || !run.drawn) return null;
  return {
    get backend() { return run.backend; }, // looked up on every use: a recovery replaces it
    scene(tf) {
      const m = measure(run, tf === undefined ? "auto" : cellFor(run, tf));
      if (!applyGeometry(run, m)) throw new Error("the canvas cannot hold this page");
      return { scene: m.scene, info: m.info! };
    },
    write: (scene, fr) => run.block.write(scene, fr),
    hold: (on) => { hookState.heldByHook = on; },
    setEffects: (map) => { hookState.effectsMap = map; },
    counts: () => run.lastCounts ?? { trails: 0, ripples: 0 },
    startTf: () => run.tf0,
    ready: started,
  };
};
