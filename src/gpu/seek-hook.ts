// Test-only module. Reached only through the `if (__SEEK_HOOK__)` guard in src/entry-client.tsx, so a production build
// holds no trace of it. It installs globalThis.__T3_SEEK__ (the contract of the flash protocol's "The hook T-018 must
// expose"): at, raw, kinds, noise9, layout, bench, ready, and the per-run variant override read from the `fx` query.
import { effectsFor, frameScalars, k3Of, k5Of } from "./core.ts";
import type { Effects, Frame, Ripple, Scene, Trail } from "./core.ts";
import type { Variant } from "./modes.ts";
import { hookView, started } from "./tier3.ts";
import type { HookView } from "./tier3.ts";

const RATE: Record<Variant, number> = { full: 1, soft: 0.5, off: 0 };
const BASIC = new Set(["full", "soft", "off"]);
const EFFECTS = ["breathing", "dissolve", "phone", "k3", "k5"];

const bad = (tok: string): Error => new Error(`T3_FX_OVERRIDE: bad token ${tok}`);

/** `fx=effect:value,...`: value is full, soft or off; for phone, k3 and k5 also the test-only hfull, hsoft (the rate held at
 *  0, at the full or the soft amplitude) and x<k> (the rate multiplied by k, at the full amplitude). */
function parseFx(search: string): ((e: Effects) => Effects) | null {
  const raw = new URLSearchParams(search).get("fx");
  if (!raw) return null;
  const picks: Record<string, string> = {};
  for (const tok of raw.split(",")) {
    if (tok === "") continue;
    const [name, value, ...rest] = tok.split(":");
    if (!name || !value || rest.length || !EFFECTS.includes(name)) throw bad(tok);
    const testOnly = /^(hfull|hsoft|x\d+(\.\d+)?)$/.test(value);
    if (!BASIC.has(value) && !(testOnly && (name === "phone" || name === "k3" || name === "k5"))) throw bad(tok);
    picks[name] = value;
  }
  // The rate and the amplitude of a test-only value: hold (rate 0) at the full or the soft amplitude, or rate k at full.
  const tuned = (v: string): { rate: number; amp: number } | null => {
    if (v === "hfull") return { rate: 0, amp: 1 };
    if (v === "hsoft") return { rate: 0, amp: 0.5 };
    if (v[0] === "x") return { rate: Number(v.slice(1)), amp: 1 };
    return null;
  };
  return (base) => {
    const out: Effects = { ...base };
    for (const [name, v] of Object.entries(picks)) {
      const t = tuned(v);
      if (name === "breathing") out.breathing = v as Variant;
      else if (name === "dissolve") out.dissolve = v as Variant;
      else if (name === "phone") out.phone = t ? t.rate : RATE[v as Variant];
      else if (name === "k3") out.k3 = t ?? k3Of(v as Variant);
      else if (name === "k5") out.k5 = t ?? k5Of(v as Variant);
    }
    return out;
  };
}

const b64 = (bytes: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** The worst case of A-1 (g): 32 zones, 16 trails, 3 ripples, 8 sections, whatever the page holds. */
function fillScene(scene: Scene): Scene {
  const W = scene.geo.cellsW * scene.geo.D;
  const H = scene.geo.cellsH * scene.geo.D;
  const zones = scene.zones.slice(0, 32);
  for (let k = zones.length; k < 32; k++) {
    const x0 = (k * 97) % Math.max(1, W - 200);
    const y0 = (k * 131) % Math.max(1, H - 40);
    zones.push([x0, y0, x0 + 160, y0 + 24]);
  }
  const step = scene.geo.cssH / 8;
  const bands = Array.from({ length: 8 }, (_, k) => ({ y0: k * step, y1: (k + 1) * step, kind: k }));
  return { ...scene, zones, bands };
}

interface Input {
  trails?: Trail[];
  ripples?: Ripple[];
}

export function installSeekHook(): void {
  const override = parseFx(location.search);
  let view: HookView | null = null;
  let last = { t: 0, tf: 3.2, scrollY: 0 };

  const need = (): HookView => {
    view ??= hookView();
    if (!view) throw new Error("seek hook: tier 3 has not drawn yet; await ready first");
    view.hold(true); // the hook draws; the field's own loop stops
    if (override) view.setEffects(override);
    return view;
  };
  // `input` is the pointer state to draw (a test passes 16 trails and 3 ripples); the default is none, as a seek has no pointer.
  const frameOf = (t: number, tf: number, scrollY: number, debug = 0, input?: Input): Frame => ({
    t, tf, scrollY, trails: input?.trails ?? [], ripples: input?.ripples ?? [], tracer: 1, debug,
  });

  const api = {
    ready: started.then(async (ok) => {
      if (!ok) return false;
      if (override) hookView()?.setEffects(override);
      return true;
    }),
    at(t: number, tf: number, scrollY = 0, input?: Input) {
      const v = need();
      window.scrollTo(0, scrollY);
      const { scene } = v.scene(tf);
      const fr = frameOf(t, tf, scrollY, 0, input);
      v.backend.draw(v.write(scene, fr));
      last = { t, tf, scrollY };
      const sc = frameScalars(scene, fr);
      return { w: scene.geo.cellsW, h: scene.geo.cellsH, dissolve: sc.dissolve, breath: sc.breath, tracerY: sc.tracerY, fieldT: sc.fieldT };
    },
    async raw(t: number, tf: number, scrollY: number, r0: number, r1: number, input?: Input) {
      const v = need();
      window.scrollTo(0, scrollY);
      const { scene } = v.scene(tf);
      last = { t, tf, scrollY };
      return b64(await v.backend.read(v.write(scene, frameOf(t, tf, scrollY, 0, input)), r0, r1));
    },
    /** The uniform block `raw` would draw with, base64 (test inspection: the CPU model reads the same block). */
    block(t: number, tf: number, scrollY = 0, input?: Input) {
      const v = need();
      window.scrollTo(0, scrollY);
      const { scene } = v.scene(tf);
      return b64(new Uint8Array(v.write(scene, frameOf(t, tf, scrollY, 0, input))));
    },
    /** Loses the WebGL2 context or destroys the WebGPU device, as the platform would. */
    lose() {
      need().backend.lose();
    },
    async kinds(r0: number, r1: number) {
      const v = need();
      const { scene } = v.scene(last.tf);
      const px = await v.backend.read(v.write(scene, frameOf(last.t, last.tf, last.scrollY, 1)), r0, r1);
      return b64(Uint8Array.from({ length: px.length / 4 }, (_, k) => px[4 * k]));
    },
    async noise9(r0: number, r1: number) {
      const v = need();
      const { scene } = v.scene(last.tf);
      const px = await v.backend.read(v.write(scene, frameOf(last.t, last.tf, last.scrollY, 2)), r0, r1);
      return Array.from({ length: px.length / 4 }, (_, k) => px[4 * k] + 256 * px[4 * k + 1]);
    },
    layout() {
      return need().scene(last.tf).info;
    },
    /** The formation time the field started from (A-2 (b), the intro state): 0 plays the formation, 3.2 skips it. */
    startTf(): number {
      const v = hookView();
      if (!v) throw new Error("seek hook: tier 3 has not drawn yet; await ready first");
      return v.startTf();
    },
    /** A-1 (g): n frames of the worst-case scene back to back in one task, then one GPU sync (10 warm-up frames first). */
    async bench(n: number, t: number, tf: number) {
      const v = need();
      const { scene: live } = v.scene();
      const scene = fillScene(live);
      const dpr = scene.dpr;
      const build = (k: number): ArrayBuffer => {
        const buf = v.write(scene, frameOf(t + k / 60, tf, 0));
        const i = new Int32Array(buf, 32, 4);
        const f = new Float32Array(buf);
        i[1] = 16;
        i[2] = 3;
        for (let q = 0; q < 16; q++) f.set([(100 + 70 * q) * dpr, (200 + 90 * q) * dpr, 0.4, 0], 156 + 4 * q);
        for (let q = 0; q < 3; q++) f.set([(300 + 200 * q) * dpr, (400 + 150 * q) * dpr, 0.5, 0], 220 + 4 * q);
        return buf;
      };
      for (let k = 0; k < 10; k++) v.backend.draw(build(k));
      await v.backend.sync();
      let prep = 0;
      const t0 = performance.now();
      for (let k = 0; k < n; k++) {
        const c0 = performance.now();
        const buf = build(k);
        prep += performance.now() - c0;
        v.backend.draw(buf);
      }
      const submitted = performance.now() - t0;
      await v.backend.sync();
      const total = performance.now() - t0;
      return {
        n, totalMs: total, perFrameMs: total / n, submitMsPerFrame: submitted / n, prepMsPerFrame: prep / n,
        cells: scene.geo.cellsW * scene.geo.cellsH, pageHeight: scene.geo.cssH, renderer: v.backend.api + " " + v.backend.name,
      };
    },
    /** The effects the override leaves (test inspection). */
    effects(theme: "dark" | "light", width: "desk" | "phone"): Effects {
      const base = effectsFor(theme, width);
      return override ? override(base) : base;
    },
  };
  (globalThis as unknown as Record<string, unknown>).__T3_SEEK__ = api;
}
