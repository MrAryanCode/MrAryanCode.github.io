// The tier-3 cell pass and its writer, checked in Node against the worked cells of algorithms.md A-1 and A-2: the snap table,
// the hash vectors, the base cells, the pointer cells, the section kinds, the mask geometry and the clock. The cell pass is
// test/cpu-field.mjs, a port of the shader that reads the same 73-row block src/gpu/core.ts writes.
import assert from "node:assert/strict";
import test from "node:test";
import * as core from "../src/gpu/core.ts";
import * as cpu from "./cpu-field.mjs";

const FULL = { breathing: "full", dissolve: "full", phone: 1, k3: core.k3Of("full"), k5: core.k5Of("full") };

/** A scene with the defaults of the worked cells: dark, desktop, 4 px cells at DPR 1, no zones, no bands, no mask. */
function sceneOf(o = {}) {
  const dpr = o.dpr ?? 1;
  const geo = o.geo ?? core.geometry(o.vw ?? 1366, o.rootH ?? 6000, dpr, o.cell ?? 4);
  return {
    theme: "dark", phone: false, home: false, g7: false, mode: "vortex", dpr, geo, innerHeight: 768,
    zones: [], bands: [], cta: [683, 3400], col: [363, 1003], mask: null, effects: FULL, ...o,
  };
}
const blockOf = (s, fr) => new core.UniformBlock().write(s, fr).slice(0);
const cellOf = (s, fr, cx, cy, mask = null) => cpu.cell(blockOf(s, fr), cx, cy, mask);
const near = (a, b, eps, what) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);

test("the snap: D and q per DPR and cell size (a1/snapq.out)", () => {
  const rows = {
    1: [[4, 1], [5, 1], [6, 1], [7, 1]],
    1.25: [[5, 1], [6, 5], [8, 5], [9, 5]],
    1.5: [[6, 1], [8, 3], [9, 1], [11, 3]],
    2: [[8, 1], [10, 1], [12, 1], [14, 1]],
    2.625: [[11, 21], [13, 21], [16, 21], [18, 7]],
    2.75: [[11, 1], [14, 11], [17, 11], [19, 11]],
    3: [[12, 1], [15, 1], [18, 1], [21, 1]],
  };
  for (const [dpr, list] of Object.entries(rows)) {
    [4, 5, 6, 7].forEach((px, k) => {
      const D = core.cellDevicePx(px, Number(dpr));
      assert.deepEqual([D, core.snapQ(D, Number(dpr))], list[k], `dpr ${dpr}, ${px} px`);
      const g = core.geometry(1366, 5000, Number(dpr), px);
      assert.equal(g.cellsW % g.q, 0);
      assert.equal(g.cellsH % g.q, 0);
    });
  }
});

test("pcg3d: the worked vectors, in core.ts and in the CPU model", () => {
  const cases = [
    [[0, 0, 1], [2136848594, 1759552940, 990954100]],
    [[1, 0, 1], [171184229, 34287405, 4106931559]],
    [[255, 255, 1], [1599278213, 904141534, 1868615560]],
    [[3, 5, 7], [1296689015, 107950247, 644781372]],
  ];
  for (const [input, want] of cases) {
    assert.deepEqual(core.pcg3d(...input), want);
    assert.deepEqual(cpu.pcg3d(...input), want);
  }
  for (let k = 0; k < 300; k++) {
    const x = (k * 7919) % 5000, y = (k * 104729) % 3000;
    assert.equal(cpu.vnoise(x * 51 + 61, y * 51 + 46, 1), core.vnoise(x * 51 + 61, y * 51 + 46, 1));
    assert.equal(cpu.bayer8(x, y), core.bayer8(x, y));
  }
});

const BASE = sceneOf({ zones: [[14, 30, 154, 68], [88, 559, 334, 615]] });
const QUIET = { t: 1.5, tf: 99 };

test("base cells: n, vd, vh, vf, bayer, palette index (a1/worked.out)", () => {
  const rows = [
    [198, 11, 3, 61, 77, 138, 54],
    [69, 136, 1, 53, 21, 74, 34],
    [10, 10, 0, 39, 0, 39, 4],
  ];
  for (const [cx, cy, idx, vd, vh, vf, bayer] of rows) {
    const c = cellOf(BASE, QUIET, cx, cy);
    assert.deepEqual([c.idx, c.vd, c.vh, c.vf, c.bayer], [idx, vd, vh, vf, bayer], `cell (${cx}, ${cy})`);
  }
});

test("pointer cells: trail and ripple lifts (a1/pointer.out section 5)", () => {
  const rows = [
    [79, 72, { trails: [{ x: 300, y: 300, a: 0.25 }] }, [49, 37, 86, 42, 2]],
    [235, 225, { ripples: [{ x: 700, y: 900, age: 0.5 }] }, [106, 60, 166, 24, 2]],
    [10, 10, { ripples: [{ x: 282, y: 42, age: 0.5 }] }, [63, 0, 63, 4, 1]],
  ];
  for (const [cx, cy, input, [vd, vh, vf, bayer, idx]] of rows) {
    const c = cellOf(BASE, { ...QUIET, ...input }, cx, cy);
    assert.deepEqual([c.vd, c.vh, c.vf, c.bayer, c.idx], [vd, vh, vf, bayer, idx], `cell (${cx}, ${cy})`);
  }
});

test("pointer gate: nothing is written while a formation plays, nothing born before it ended", () => {
  const trails = [{ x: 300, y: 300, a: 0.5 }];
  const ripples = [{ x: 300, y: 300, age: 0.5 }, { x: 400, y: 400, age: 0.2 }];
  const counts = (fr) => {
    const i = new Int32Array(blockOf(BASE, { t: 1, trails, ripples, ...fr }));
    return [i[9], i[10]];
  };
  assert.deepEqual(counts({ tf: 3.0 }), [0, 0]);
  assert.deepEqual(counts({ tf: 3.5 }), [0, 1], "since 0.3: the 0.6 s trail and the 0.5 s ripple are older than the formation's end");
  assert.deepEqual(counts({ tf: 5 }), [1, 2]);
  assert.deepEqual(counts({ tf: 5, inputFormationT: 3.5 }), [0, 1], "the answered frame's clock gates, not the draw's");
  assert.deepEqual(counts({ tf: 5, trails: [{ x: 1, y: 1, a: 1.5 }], ripples: [{ x: 1, y: 1, age: 1.4 }] }), [0, 0]);
});

test("section kinds: one band over the page, t 1.5 (a1/sections.out)", () => {
  const rows = [
    // kind, cx, cy, expected {vd, vh, vf, bayer, idx}; vd, vh, vf, bayer are checked when given.
    [1, 96, 168, { vd: 67, vh: 80, vf: 147, bayer: 0, idx: 2 }],
    [1, 97, 169, { vd: 0, vh: 0, vf: 0, bayer: 16, idx: 0 }],
    [7, 96, 168, { vd: 76, vh: 80, vf: 156, idx: 2 }],
    [6, 96, 168, { vd: 51, vh: 64, vf: 115, idx: 1 }],
    [3, 180, 850, { vd: 50, vh: 98, vf: 148, bayer: 14, idx: 2 }],
    [3, 245, 850, { vd: 11, vh: 17, vf: 28, bayer: 46, idx: 1 }],
    [4, 200, 1200, { idx: 0 }],
    [5, 65, 500, { vd: 26, vh: 48, vf: 74, bayer: 35, idx: 1 }],
    [5, 65, 520, { idx: 0 }],
    [2, 120, 600, { idx: 0 }],
    [2, 5, 17, { vd: 128, vh: 124, vf: 252, bayer: 18, idx: 4 }],
  ];
  const fr = { t: 1.5, tf: 99, scrollY: 1616 };
  for (const [kind, cx, cy, want] of rows) {
    const s = sceneOf({ bands: [{ y0: 0, y1: 6000, kind }] });
    const buf = blockOf(s, fr);
    assert.equal(new Int32Array(buf)[235], 1680, "the kind 1 band phase: 16 * 70 t mod 17600");
    if (kind === 2) {
      // The reference holds the star drift at 0 for the skills cells.
      const f = new Float32Array(buf);
      f[289] = 0;
      f[290] = 0;
    }
    const c = cpu.cell(buf, cx, cy);
    assert.equal(c.kind, kind);
    for (const [k, v] of Object.entries(want)) assert.equal(c[k], v, `kind ${kind} cell (${cx}, ${cy}) ${k}`);
  }
  // Phone 390 @ 3, D 15, kind 1: vd 18 scaled by 3/5 to 10.
  const phone = sceneOf({ phone: true, dpr: 3, cell: 5, vw: 390, bands: [{ y0: 0, y1: 6000, kind: 1 }] });
  const c = cellOf(phone, fr, 40, 45);
  assert.deepEqual([c.vd, c.vf, c.bayer, c.idx], [10, 10, 51, 0]);
});

test("section crossfade: the dithered boundary between two bands", () => {
  const s = sceneOf({ bands: [{ y0: 0, y1: 1000, kind: 1 }, { y0: 1000, y1: 2000, kind: 4 }] });
  const buf = blockOf(s, QUIET);
  const share = (cy) => {
    let n4 = 0;
    for (let cx = 0; cx < 400; cx++) if (cpu.cell(buf, cx, cy).kind === 4) n4++;
    return n4 / 400;
  };
  // Row cy has its centre at cssY = 4 cy + 2; the band edge is at css 1000 (row 249.5); the blend spans 140 css px each side.
  assert.equal(share(100), 0);
  assert.equal(share(400), 1);
  const mid = share(249) + share(250);
  assert.ok(mid > 0.7 && mid < 1.3, `half of the cells at the edge change kind: ${mid / 2}`);
  assert.ok(share(230) < share(250) && share(250) < share(270));
});

test("mask geometry (a2/geometry.out): origin, size, D, per viewport", () => {
  const HDR = 80;
  const phone404 = { top: 96, height: 210 };
  const rows = [
    // kind, vw, vh, dpr, css cell, D, x0, y0, w, h
    ["404", 390, 844, 3, 5, 15, 12, 11, 114, 58],
    ["404", 320, 568, 2, 5, 10, 10, 16, 93, 48],
    ["404", 1366, 768, 1, 4, 4, 133, 47, 213, 109],
    ["404", 760, 900, 1, 4, 4, 74, 89, 119, 62],
    ["404", 1920, 1080, 1.5, 4, 6, 187, 62, 299, 154],
    ["name", 1366, 768, 1, 4, 4, 131, 32, 219, 139],
    ["name", 1920, 1080, 1.5, 4, 6, 184, 42, 308, 194],
    ["name", 760, 900, 1, 4, 4, 72, 81, 123, 78],
    ["name", 390, 844, 3, 5, 15, 1, 17, 80, 51],
    ["name", 320, 568, 2, 5, 10, 0, 17, 66, 42],
    ["404", 390, 844, 3, 7, 21, 8, 8, 82, 42],
    ["name", 1366, 768, 1, 6, 6, 87, 21, 147, 93],
  ];
  for (const [kind, vw, vh, dpr, css, D, x0, y0, w, h] of rows) {
    const geo = core.geometry(vw, vh, dpr, css);
    assert.equal(geo.D, D, `${kind} ${vw}x${vh}@${dpr} D`);
    const r = core.maskRect(kind, vw, vh, HDR, kind === "404" && vw < 760 ? phone404 : undefined);
    assert.deepEqual(core.maskCells(r, dpr, geo.D), { x0, y0, w, h }, `${kind} ${vw}x${vh}@${dpr} cell ${css}`);
  }
});

test("mask size caps (D-055): the 1920 x 1080 size holds above 1920 wide", () => {
  for (const [vw, vh] of [[2560, 1440], [3440, 1440]]) {
    near(core.maskRect("name", vw, vh, 80).font, 396.8, 0.05, `name ${vw}`);
    near(core.maskRect("404", vw, vh, 80).font, 597.3, 0.05, `404 ${vw}`);
  }
  near(core.maskRect("name", 1920, 1080, 80).font, 396.8, 0.05, "name at 1920");
  // Below 1920 the font is still the viewport's: 1600 wide, 1000 high.
  near(core.maskRect("name", 1600, 1000, 80).font, (1600 * 0.62) / 3, 1e-9, "name at 1600");
  near(core.maskRect("404", 1600, 1000, 80).font, (1600 * 0.56) / 1.8, 1e-9, "404 at 1600");
});

test("the formation clock: breathing (a2/formation.out)", () => {
  const want = [[3.2, 1], [4.45, 0.5], [5.7, 0], [6.95, 0.5], [8.2, 1]];
  for (const [tf, b] of want) near(core.breathOf(tf), b, 1e-9, `breath at ${tf}`);
  // The appear share the lanes give: 1.0, 0.9, 0.8, 0.9, 1.0.
  for (const [tf, b] of want) {
    const c = cellOf(maskScene({ mode: "vortex" }), { t: 1, tf }, 69, 40, FULL_MASK);
    near(c.clock.appear, 0.8 + 0.2 * b, 1e-6, `appear at ${tf}`);
  }
});

const MASK = { x0: 12, y0: 11, w: 114, h: 58 };
const FULL_MASK = new Uint8Array(MASK.w * MASK.h).fill(255);
const maskScene = (o = {}) => sceneOf({ dpr: 3, cell: 5, vw: 390, rootH: 844, mask: MASK, ...o });

test("the formation clock: fade, twist, scale, appear, letter (a2/formation.out)", () => {
  const rows = [
    // tf, fade, twist, scale, appear
    [0.2, 0, 0, 1.8, 0],
    [0.9, 1, 0, 1.8, 0],
    [1.2, 1, 2.3, 1.8, 0.3],
    [1.5, 1, 4.6, 1.8, 0.6],
    [2.0, 1, null, 1.3336, 0.8332],
    [2.4, 1, 0, 1, 1],
    [3.2, 1, 0, 1, 1],
  ];
  // A cell whose hash lets it show at every appear >= 0.25, so the letter column is the shader's own.
  let pick = null;
  for (let cx = 60; cx < 80 && !pick; cx++) if (core.u01(core.hash(cx, 40, 7)) < 0.25) pick = [cx, 40];
  assert.ok(pick, "a cell with a low hash exists near the mask centre");
  for (const [tf, fade, tw, sc, appear] of rows) {
    const c = cellOf(maskScene(), { t: 1, tf }, 69, 40, FULL_MASK);
    near(c.clock.fade, fade, 1e-5, `fade at ${tf}`);
    if (tw !== null) near(c.clock.tw, tw, 1e-4, `twist at ${tf}`);
    near(c.clock.sc, sc, 1e-4, `scale at ${tf}`);
    near(c.clock.appear, appear, 1e-4, `appear at ${tf}`);
  }
  const letterAt = (tf) => cellOf(maskScene(), { t: 1, tf }, pick[0], pick[1], FULL_MASK).letter;
  assert.equal(letterAt(0.2), 0);
  for (const [tf, want] of [[1.2, 192], [1.5, 192], [2.0, 192], [2.4, 200], [2.5, 200], [2.7, 192], [3.2, 192], [8.2, 192]]) {
    assert.equal(letterAt(tf), want, `letter at ${tf}`);
  }
});

test("vortex source cells (a2/formation.out)", () => {
  const rows = [
    [1.2, 40, 30, [50, 44]], [1.2, 69, 40, [57, 28]],
    [2.0, 40, 30, [43, 46]], [2.0, 69, 40, [57, 28]],
    [2.4, 40, 30, [28, 19]], [2.4, 69, 40, [57, 29]],
  ];
  for (const [tf, cx, cy, texel] of rows) {
    const c = cellOf(maskScene(), { t: 1, tf }, cx, cy, FULL_MASK);
    assert.deepEqual(c.clock.m, texel, `tf ${tf} cell (${cx}, ${cy})`);
  }
});

test("in-place lighting times (D-042)", () => {
  const sc = maskScene({ mode: "inplace" });
  const letter = (tf, cx, cy) => cellOf(sc, { t: 1, tf }, cx, cy, FULL_MASK).letter;
  assert.equal(letter(1.13, 80, 40), 0);
  assert.equal(letter(1.15, 80, 40), 192);
  assert.equal(letter(1.97, 60, 30), 0);
  assert.equal(letter(1.99, 60, 30), 192);
});

test("dissolve: the kept letters at each scroll (home name, 1366 x 768)", () => {
  const geo = core.geometry(1366, 4000, 1, 4);
  const mask = { x0: 131, y0: 32, w: 219, h: 139 };
  const full = new Uint8Array(mask.w * mask.h).fill(255);
  const sc = sceneOf({ geo, home: true, mask, effects: { ...FULL, breathing: "off" } });
  const cases = [
    [200, 60, [0, 144]],
    [240, 90, [0, 144, 288, 432]],
    [300, 120, [0, 144]],
  ];
  for (const [cx, cy, kept] of cases) {
    for (const scrollY of [0, 144, 288, 432, 576]) {
      const c = cellOf(sc, { t: 1, tf: 99, scrollY }, cx, cy, full);
      assert.equal(c.letter > 0, kept.includes(scrollY), `cell (${cx}, ${cy}) at scrollY ${scrollY}`);
    }
  }
  const f = new Float32Array(blockOf(sc, { t: 1, tf: 99, scrollY: 288 }));
  assert.deepEqual([f[24], f[26]], [0.5, 123]);
});

test("G7: a letter cell inside a zone drops to level 0 on bayer < 32, else stays at level 2", () => {
  const mask = { x0: 0, y0: 0, w: 64, h: 64 };
  const full = new Uint8Array(64 * 64).fill(255);
  const mk = (g7) => sceneOf({ g7, zones: [[0, 0, 4000, 4000]], mask, effects: { ...FULL, breathing: "off" } });
  let lit = 0;
  for (let cy = 8; cy < 24; cy++) {
    for (let cx = 8; cx < 24; cx++) {
      const plain = cellOf(mk(false), { t: 1, tf: 99 }, cx, cy, full);
      const g7 = cellOf(mk(true), { t: 1, tf: 99 }, cx, cy, full);
      assert.equal(plain.letter, 192);
      assert.equal(plain.idx, 2);
      assert.equal(g7.idx, g7.bayer < 32 ? 0 : 2, `cell (${cx}, ${cy}) bayer ${g7.bayer}`);
      lit += g7.idx === 2 ? 1 : 0;
    }
  }
  assert.ok(lit > 100 && lit < 156, `about half of the letter cells stay lit: ${lit}`);
});

test("D-052 variants reach the uniform block: rate, amplitude, lane", () => {
  const f = (effects, fr = { t: 10, tf: 5, scrollY: 0 }, extra = {}) =>
    new Float32Array(blockOf(sceneOf({ effects: { ...FULL, ...effects }, ...extra }), fr));
  assert.deepEqual([...f({}).subarray(16, 20)], [10, 1, 10, 1]);
  assert.deepEqual([...f({ k3: core.k3Of("soft") }).subarray(16, 18)], [5, 0.5]);
  assert.deepEqual([...f({ k3: core.k3Of("off") }).subarray(16, 18)], [0, 1]);
  assert.deepEqual([...f({ k5: core.k5Of("soft") }).subarray(18, 20)], [5, 0.5]);
  assert.deepEqual([...f({ k5: core.k5Of("off") }).subarray(18, 20)], [0, 0]);
  const breath = core.breathOf(5);
  near(f({}).at(25), breath, 1e-6, "breathing full");
  near(f({ breathing: "soft" }).at(25), 0.5 + 0.5 * breath, 1e-6, "breathing soft");
  assert.equal(f({ breathing: "off" }).at(25), 1);
  // The tracer scale takes the k5 amplitude and the frame's own tracer value.
  assert.equal(f({}, { t: 1, tf: 5, tracer: 0 }).at(19), 0);
  // Dissolve is home only: full k 0.75, soft k 1.5, off 0.
  const home = { home: true };
  const fr = { t: 1, tf: 5, scrollY: 288 };
  near(f({}, fr, home).at(24), 288 / (0.75 * 768), 1e-6, "dissolve full");
  near(f({ dissolve: "soft" }, fr, home).at(24), 288 / (1.5 * 768), 1e-6, "dissolve soft");
  assert.equal(f({ dissolve: "off" }, fr, home).at(24), 0);
  assert.equal(f({}, fr).at(24), 0, "off home there is no dissolve");
  assert.equal(f({}, fr).at(26), 0, "and no dissolve scale");
  // The phone rate scales the field time on phone only.
  const phone = { phone: true };
  near(f({ phone: 0.5 }, { t: 10, tf: 5 }, phone).at(16), 5, 1e-6, "phone rate 0.5");
  near(f({ phone: 0.5 }, { t: 10, tf: 5 }).at(16), 10, 1e-6, "desktop ignores the phone rate");
  assert.equal(f({ phone: 0 }, { t: 10, tf: 5 }, phone).at(16), 0, "phone rate 0 holds the time");
});

test("effects tables: dark and light, desktop and phone, hold the documented lanes", () => {
  for (const theme of ["dark", "light"]) {
    for (const width of ["desk", "phone"]) {
      const e = core.effectsFor(theme, width);
      assert.ok(["full", "soft", "off"].includes(e.breathing));
      assert.ok(["full", "soft", "off"].includes(e.dissolve));
      assert.ok(e.phone >= 0 && e.phone <= 1);
      assert.ok(e.k3.rate >= 0 && e.k3.amp >= 0 && e.k5.rate >= 0 && e.k5.amp >= 0);
    }
  }
  assert.equal(core.effectsFor("dark", "desk").phone, 1, "the phone rate is 1 on desktop");
});

test("the block: 73 rows, 1,168 bytes, finite floats, the palette nudge", () => {
  assert.equal(core.UNIFORM_ROWS, 73);
  const buf = blockOf(BASE, QUIET);
  assert.equal(buf.byteLength, 1168);
  const f = new Float32Array(buf);
  for (const v of f) assert.ok(Number.isFinite(v));
  // Levels 0..2 sit a quarter step toward the safe side of the quiet colour; levels 3 and 4 are exact.
  near(f[264] * 255, 8 - 0.25, 1e-4, "dark level 0 red");
  near(f[276] * 255, 0x4a, 1e-4, "dark level 3 red");
  const light = new Float32Array(blockOf(sceneOf({ theme: "light" }), QUIET));
  near(light[264] * 255, 0xf1 + 0.25, 1e-4, "light level 0 red");
  assert.equal(new Int32Array(buf)[3], 0, "dark desktop flags");
  assert.equal(new Int32Array(blockOf(sceneOf({ theme: "light", g7: true, phone: true }), QUIET))[3], 1 | 16 | 32);
});
