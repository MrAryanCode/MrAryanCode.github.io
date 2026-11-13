// A-3 (algorithms.md): the weak-device step-down controller, in Node with no browser (T-016).
// Verification (a) the eleven traces of the worked example and the gap trace, (b) their invariants, (c) the
// `motion-level-pin` seam and its `trace:<n>fps` companion; plus onLevel, the learned interval and tier 1's start.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createBudget } from "../src/motion/budget.ts";

const KEY = "motion-level";
const PIN = "motion-level-pin";

/** A stub sessionStorage over a Map; `writes` records every setItem. */
function stubStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  const writes = [];
  return {
    map,
    writes,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { writes.push([k, v]); map.set(k, v); },
  };
}

/** rAF timestamps at `hz` for `durMs`; `deltaAt(t, v)` is the next delta (v is the display interval). */
function trace(hz, durMs, deltaAt = (t, v) => v) {
  const v = 1000 / hz;
  const out = [];
  for (let t = 0; t < durMs; t += deltaAt(t, v)) out.push(t);
  return out;
}

/** Feeds `ts` to a fresh controller started from `storage`; returns the steps as {level, at (s)} and the controller. */
function run(ts, storage, { resetAt = [] } = {}) {
  const b = createBudget(() => storage);
  const steps = [];
  let now = 0;
  b.onLevel((level) => steps.push({ level, at: now / 1000 }));
  b.start();
  const pending = new Set(resetAt);
  for (const t of ts) {
    now = t;
    if (pending.has(t)) b.reset();
    b.frame(t);
  }
  return { b, steps };
}

const known = (hz, level = 0) => stubStorage({ [KEY]: JSON.stringify({ level, interval: 1000 / hz }) });

// The eleven traces of A-3's worked example, built as the script of that example builds them. Each lists the step
// times (s) of the table; the times hold within 50 ms, and the final level is the number of steps.
const counter = (every, from) => {
  let n = 0;
  return (t, v) => (t < from ? v : (++n % every === 0 ? 2 * v : v));
};
const stall = () => {
  let done = false;
  return (t, v) => (!done && t >= 4000 ? (done = true, 260) : v);
};
const TRACES = [
  { name: "60 Hz healthy", hz: 60, deltaAt: (t, v) => v, steps: [] },
  { name: "120 Hz healthy", hz: 120, deltaAt: (t, v) => v, steps: [] },
  { name: "120 Hz delivering 60 fps", hz: 120, deltaAt: (t, v) => 2 * v, steps: [] },
  { name: "90 Hz delivering about 60 fps", hz: 90, deltaAt: (t, v) => (Math.round(t / v) % 2 ? v : 2 * v), steps: [] },
  { name: "30 Hz panel, healthy", hz: 30, deltaAt: (t, v) => v, steps: [] },
  { name: "60 Hz, one 260 ms stall at 4 s", hz: 60, deltaAt: stall(), steps: [] },
  { name: "60 Hz, 1 frame in 3 doubled from 3 s", hz: 60, deltaAt: counter(3, 3000), steps: [3.9, 6.4, 8.9, 11.4, 14.0, 16.5, 19.0] },
  { name: "60 Hz, 1 frame in 4 doubled from 3 s", hz: 60, deltaAt: counter(4, 3000), steps: [4.1, 8.6, 11.2, 13.8, 16.4] },
  { name: "60 Hz, every frame doubled from 3 s", hz: 60, deltaAt: (t, v) => (t < 3000 ? v : 2 * v), steps: [3.45, 6.0, 8.5, 11.0, 13.5, 16.0, 18.55] },
  { name: "60 Hz weak phone, 20 fps from the start", hz: 60, deltaAt: (t, v) => 3 * v, steps: [2.5, 5.0, 7.5, 10.0, 12.5, 15.0, 17.5] },
  { name: "60 Hz panel drops to 30 Hz at 5 s", hz: 60, deltaAt: (t, v) => (t < 5000 ? v : 2 * v), steps: [5.4, 8.0, 10.5, 13.0, 15.5, 18.0] },
];

for (const c of TRACES) {
  test(`A-3 (a) ${c.name}: the final level and every step time, and (b) the invariants`, () => {
    const { b, steps } = run(trace(c.hz, 20000, c.deltaAt), known(c.hz));
    assert.equal(steps.length, c.steps.length, `steps ${JSON.stringify(steps)}`);
    steps.forEach((s, i) => {
      assert.equal(s.level, i + 1, "a step is exactly one level");
      assert.ok(Math.abs(s.at - c.steps[i]) <= 0.05 + 1e-6, `step ${i + 1} at ${s.at} s, table ${c.steps[i]} s`);
      if (i > 0) assert.ok(s.at - steps[i - 1].at >= 2.5 - 1e-9, `steps ${i} and ${i + 1} are ${s.at - steps[i - 1].at} s apart`);
    });
    assert.equal(b.level(), c.steps.length);
  });
}

test("A-3 (a) the gap trace: 60 Hz, rAF paused for 5 s from 3 s; reset() at the gap gives no step, no reset gives one step", () => {
  const ts = [...trace(60, 3000), ...trace(60, 20000).filter((t) => t >= 8000)];
  const resumed = ts.find((t) => t >= 8000);
  const withReset = run(ts, known(60), { resetAt: [resumed] });
  assert.deepEqual(withReset.steps, []);
  assert.equal(withReset.b.level(), 0);
  const without = run(ts, known(60));
  assert.equal(without.steps.length, 1, JSON.stringify(without.steps));
  assert.ok(Math.abs(without.steps[0].at - 8.02) <= 0.05, `the step is at ${without.steps[0].at} s`);
  assert.equal(without.steps[0].at, resumed / 1000, "on the first frame after the gap");
  assert.equal(without.b.level(), 1);
});

test("A-3 (b) the level never exceeds 7, whatever the load, and stays there", () => {
  const { b, steps } = run(trace(60, 40000, (t, v) => 3 * v), known(60));
  assert.equal(steps.length, 7);
  assert.equal(b.level(), 7);
});

test("A-3 (c) a pinned level is applied at start; the controller never steps, calls no listener and writes nothing", () => {
  for (const pin of ["0", "3", "7"]) {
    const storage = known(60, 5);
    storage.map.set(PIN, pin);
    const { b, steps } = run(trace(60, 20000, (t, v) => 3 * v), storage);
    assert.equal(b.level(), Number(pin), `pin ${pin}`);
    assert.deepEqual(steps, []);
    assert.deepEqual(storage.writes, []);
  }
});

test("A-3 (c) trace:20fps steps a run as a constant 50 ms delta would; the timestamps stay real", () => {
  const real = run(trace(60, 20000, (t, v) => 3 * v), known(60));
  const storage = known(60);
  storage.map.set(PIN, "trace:20fps");
  const seam = run(trace(60, 20000), storage);
  assert.equal(seam.steps.length, 7);
  seam.steps.forEach((s, i) => {
    assert.ok(Math.abs(s.at - real.steps[i].at) <= 0.1, `step ${i + 1} at ${s.at} s, constant 50 ms delta ${real.steps[i].at} s`);
  });
  assert.ok(Math.abs(seam.steps[0].at - 2.5) <= 0.05, "the settle period and the window run on the real timestamps");
});

test("A-3 (c) under a trace reset() restarts the settle period on real time", () => {
  const storage = known(60);
  storage.map.set(PIN, "trace:20fps");
  const ts = trace(60, 12000);
  const at = ts.find((t) => t >= 3000);
  const { steps } = run(ts, storage, { resetAt: [at] });
  assert.ok(Math.abs(steps[0].at - 2.5) <= 0.05, "the first step comes at 2.5 s");
  // The first step's settle period would end at 4.0 s; the reset at 3 s discards it, and the next frame starts 1.5 s of
  // settling and 1 s of window: the second step comes 2.5 s after the reset.
  assert.ok(Math.abs(steps[1].at - (at / 1000 + 2.5)) <= 0.05, `the second step is at ${steps[1].at} s`);
});

test("A-3 (c) trace:60fps never steps, even on frames that really arrive at 20 fps", () => {
  const storage = known(60);
  storage.map.set(PIN, "trace:60fps");
  const { b, steps } = run(trace(60, 20000, (t, v) => 3 * v), storage);
  assert.deepEqual(steps, []);
  assert.equal(b.level(), 0);
});

test("A-3 (c) under a trace I is fixed at 1000/60, not learned, and that interval is stored with the level", () => {
  const storage = stubStorage({ [PIN]: "trace:20fps", [KEY]: JSON.stringify({ level: 2, interval: 33 }) });
  const b = createBudget(() => storage);
  b.start();
  assert.equal(b.level(), 2, "the stored level is carried");
  assert.equal(b.interval(), 1000 / 60, "known at once, whatever was stored");
  for (const t of trace(60, 4000)) b.frame(t);
  assert.equal(b.level(), 3);
  const [key, value] = storage.writes.at(-1);
  assert.equal(key, KEY);
  assert.deepEqual(JSON.parse(value), { level: 3, interval: 1000 / 60 });
});

test("A-3 (c) a malformed value is ignored as if the key were absent", () => {
  for (const bad of ["trace:0fps", "trace:abc", "trace:241fps", "trace:1.5fps", "trace:fps", "trace:-20fps", "trace:20", "8", "-1", "1.5", "abc", ""]) {
    const storage = stubStorage({ [PIN]: bad });
    const b = createBudget(() => storage);
    b.start();
    assert.equal(b.level(), 0, `${bad}: level`);
    assert.equal(b.interval(), 0, `${bad}: the interval is still to be learned, as with no key`);
  }
  const edge = stubStorage({ [PIN]: "trace:240fps" });
  const b = createBudget(() => edge);
  b.start();
  assert.equal(b.interval(), 1000 / 60, "trace:240fps is valid");
});

test("onLevel calls each listener once per step with the new level, and the unsubscribe function removes it", () => {
  const b = createBudget(() => known(60));
  const a = [];
  const c = [];
  b.onLevel((l) => a.push(l));
  const off = b.onLevel((l) => c.push(l));
  b.start();
  let removed = false;
  for (const t of trace(60, 20000, (t, v) => 3 * v)) {
    b.frame(t);
    if (!removed && t >= 6000) { off(); removed = true; }
  }
  assert.deepEqual(a, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(c, [1, 2]);
});

test("the stored level is carried, written on each step as {level, interval}, and a failed write keeps the level for this page", () => {
  const storage = known(60, 5);
  const { b, steps } = run(trace(60, 20000, (t, v) => 3 * v), storage);
  assert.equal(steps.length, 2);
  assert.deepEqual(storage.writes.map(([k, v]) => [k, JSON.parse(v).level]), [[KEY, 6], [KEY, 7]]);
  assert.equal(JSON.parse(storage.writes[0][1]).interval, 1000 / 60);
  assert.equal(b.level(), 7);

  const failing = { ...known(60), setItem() { throw new DOMException("full", "QuotaExceededError"); } };
  const r = run(trace(60, 6000, (t, v) => 3 * v), failing);
  assert.equal(r.b.level(), 2, "the step holds in memory");
  assert.deepEqual(r.steps.map((s) => s.level), [1, 2]);
});

test("blocked storage, and stored values that are invalid, read as no stored level", () => {
  const blocked = createBudget(() => null);
  blocked.start();
  assert.equal(blocked.level(), 0);
  const throwing = createBudget(() => ({ getItem() { throw new DOMException("denied", "SecurityError"); }, setItem() {} }));
  throwing.start();
  assert.equal(throwing.level(), 0);
  for (const bad of ["not json", "null", "{}", '{"level":8,"interval":16.7}', '{"level":1.5,"interval":16.7}', '{"level":1,"interval":2}', '{"level":1,"interval":"16"}']) {
    const b = createBudget(() => stubStorage({ [KEY]: bad }));
    b.start();
    assert.equal(b.level(), 0, bad);
    assert.equal(b.interval(), 0, bad);
  }
});

test("without a stored interval the controller learns it as the median of 30 deltas, clamped to 6.9 to 33.4 ms, then starts at level 0", () => {
  for (const [hz, expected] of [[60, 1000 / 60], [90, 1000 / 90], [144, 1000 / 144], [20, 33.4]]) {
    const b = createBudget(() => stubStorage());
    b.start();
    const ts = trace(hz, 2000);
    ts.slice(0, 30).forEach((t) => b.frame(t));
    assert.equal(b.interval(), 0, `${hz} Hz: 29 deltas are not enough`);
    b.frame(ts[30]);
    assert.ok(Math.abs(b.interval() - expected) < 1e-9, `${hz} Hz: learned ${b.interval()}`);
    assert.equal(b.level(), 0);
  }
  // A few stalls among the deltas do not move the median.
  const b = createBudget(() => stubStorage());
  b.start();
  let t = 0;
  for (let i = 0; i < 31; i += 1) {
    b.frame(t);
    t += i % 10 === 5 ? 200 : 1000 / 60;
  }
  assert.ok(Math.abs(b.interval() - 1000 / 60) < 1e-9);
});

test("a reset during learning discards the deltas collected so far", () => {
  const b = createBudget(() => stubStorage());
  b.start();
  const ts = trace(60, 3000);
  for (let i = 0; i < 20; i += 1) b.frame(ts[i]);
  b.reset();
  for (let i = 20; i < 50; i += 1) b.frame(ts[i]);
  assert.equal(b.interval(), 0, "30 frames after the reset give 29 deltas");
  b.frame(ts[50]);
  assert.ok(b.interval() > 0);
});

test("two callbacks of one animation frame (one timestamp) carry no extra evidence", () => {
  const twice = trace(60, 20000, (t, v) => 2 * v).flatMap((t) => [t, t]);
  const { steps } = run(twice, known(60));
  assert.equal(steps.length, 7);
  assert.ok(Math.abs(steps[0].at - 2.5) <= 0.05);
});

test("a second start() only resets: the level is kept (Play restarts tier 1 on the same module)", () => {
  const storage = known(60);
  const b = createBudget(() => storage);
  b.start();
  for (const t of trace(60, 3000, (t, v) => 3 * v)) b.frame(t);
  assert.equal(b.level(), 1);
  storage.map.set(KEY, JSON.stringify({ level: 0, interval: 1000 / 60 }));
  b.start();
  assert.equal(b.level(), 1);
});

// G-61: the loader's tier-1 start, with the browser globals it touches stubbed. tier1.ts uses the module-level controller,
// so this is one ordered sequence in one test.
test("tier 1 start: declines on reduced motion and on an aborted signal, learns the interval on rAF, resets on a hidden tab, and lets go on abort", async () => {
  const { start } = await import("../src/motion/tier1.ts");
  const budget = await import("../src/motion/budget.ts");
  const saved = {};
  const names = ["matchMedia", "document", "addEventListener", "removeEventListener", "requestAnimationFrame", "cancelAnimationFrame", "sessionStorage"];
  for (const n of names) saved[n] = Object.getOwnPropertyDescriptor(globalThis, n);
  const set = (n, value) => Object.defineProperty(globalThis, n, { value, configurable: true, writable: true });
  try {
    let reduced = true;
    const docListeners = new Map();
    const winListeners = new Map();
    const rafs = new Map();
    let nextId = 1;
    set("matchMedia", (q) => ({ matches: q === "(prefers-reduced-motion: reduce)" && reduced }));
    set("document", {
      fonts: { ready: Promise.resolve() },
      addEventListener: (type, fn) => docListeners.set(type, fn),
      removeEventListener: (type, fn) => { if (docListeners.get(type) === fn) docListeners.delete(type); },
    });
    set("addEventListener", (type, fn) => winListeners.set(type, fn));
    set("removeEventListener", (type, fn) => { if (winListeners.get(type) === fn) winListeners.delete(type); });
    set("requestAnimationFrame", (fn) => { rafs.set(nextId, fn); return nextId++; });
    set("cancelAnimationFrame", (id) => { rafs.delete(id); });
    set("sessionStorage", stubStorage());
    const flush = () => new Promise((r) => setImmediate(r));
    /** Runs the pending rAF callbacks once with timestamp `ts`. */
    const tick = (ts) => { const now = [...rafs]; rafs.clear(); for (const [, fn] of now) fn(ts); };
    const root = {};

    assert.equal(await start(root, new AbortController().signal), false, "reduced motion declines");
    assert.equal(docListeners.size + winListeners.size + rafs.size, 0, "a declined start leaves nothing behind");

    reduced = false;
    const dead = new AbortController();
    dead.abort();
    assert.equal(await start(root, dead.signal), false, "an aborted signal declines");
    assert.equal(docListeners.size + winListeners.size + rafs.size, 0);

    // Abort during learning cancels the pending frame.
    const early = new AbortController();
    assert.equal(await start(root, early.signal), true);
    await flush();
    assert.equal(rafs.size, 1, "the learning loop waits for a frame");
    early.abort();
    assert.equal(rafs.size, 0, "abort cancels the pending frame");
    assert.equal(docListeners.size + winListeners.size, 0);

    const live = new AbortController();
    assert.equal(await start(root, live.signal), true, "a normal start resolves true");
    assert.ok(docListeners.has("visibilitychange") && winListeners.has("pageshow"), "the reset listeners are in");
    await flush();
    assert.equal(rafs.size, 1, "the learning loop waits for a frame");
    assert.equal(budget.interval(), 0);

    // A hidden tab mid-learning discards the deltas: 20 frames, a reset, then 30 more frames are 29 deltas.
    for (let i = 0; i < 20; i += 1) tick(i * 20);
    docListeners.get("visibilitychange")();
    for (let i = 20; i < 50; i += 1) tick(i * 20);
    assert.equal(budget.interval(), 0, "29 deltas after the reset are not enough");
    assert.equal(rafs.size, 1);
    tick(50 * 20);
    assert.equal(budget.interval(), 20, "the 31st frame after the reset teaches the interval");
    assert.equal(rafs.size, 0, "the loop ends once the interval is known");
    // A restored page (persisted) resets too; a plain pageshow does not throw.
    winListeners.get("pageshow")({ persisted: false });
    winListeners.get("pageshow")({ persisted: true });

    live.abort();
    assert.equal(docListeners.size + winListeners.size, 0, "abort removes both listeners");
  } finally {
    for (const n of names) {
      if (saved[n]) Object.defineProperty(globalThis, n, saved[n]);
      else delete globalThis[n];
    }
  }
});
