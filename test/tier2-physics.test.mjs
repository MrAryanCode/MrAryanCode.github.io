// A-5 (algorithms.md) Verification (a) to (e), in Node with no browser (T-017): the wake law at 30, 60 and 120 Hz against
// the 60 Hz mockup law, the step-down level, expiry and the ripple spawn limit, the 300 ms stall, and the transfer pool
// over a real worker thread on a stepped clock.
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { test } from "node:test";
import { makeState, serve, step } from "../src/workers/input.worker.ts";
import {
  IN_BYTES, IN_SAMPLES, IN_SLOTS, IN_TAPS, MAX_SAMPLES, OUT_BYTES, OUT_RIPPLES, OUT_SLOTS, OUT_TRAIL, POOL_SIZE,
  makeLatest, makePool,
} from "../src/workers/pool.ts";

const TICK = 1000 / 60;
const SCROLL = 120;

// Pointer: 1 kHz samples on a circle (r 200 px, period 1.5 s) from 0.05 s to 2 s, then still until 3 s.
const samples = [];
for (let ms = 50; ms <= 3000; ms++) {
  const a = ms <= 2000 ? 2 * Math.PI * (ms / 1500) : 2 * Math.PI * (2000 / 1500);
  samples.push([600 + 200 * Math.cos(a), 400 + 200 * Math.sin(a), ms]);
}

/** The newest sample of each 60 Hz bucket among `list`, newest MAX_SAMPLES buckets, oldest first (what tier2.ts sends). */
function reduce(list) {
  const byBucket = new Map();
  for (const p of list) byBucket.set(Math.ceil(p[2] / TICK - 1e-6), p);
  return [...byBucket.values()].slice(-MAX_SAMPLES);
}

function inputFrame({ no, t, flags = 1, level = 0, list = [], taps = [], scrollY = 0 }) {
  const f = new Float64Array(IN_SLOTS);
  f[0] = no;
  f[1] = t;
  f[3] = scrollY;
  f[4] = flags;
  const kept = reduce(list);
  kept.forEach((p, j) => { f[IN_SAMPLES + 3 * j] = p[0]; f[IN_SAMPLES + 3 * j + 1] = p[1]; f[IN_SAMPLES + 3 * j + 2] = p[2]; });
  f[5] = kept.length;
  f[6] = taps.length;
  f[7] = level;
  taps.forEach((p, j) => { f[IN_TAPS + 3 * j] = p[0]; f[IN_TAPS + 3 * j + 1] = p[1]; f[IN_TAPS + 3 * j + 2] = p[2]; });
  return f;
}

const trailOf = (out) => Array.from({ length: out[2] }, (_, j) => [out[OUT_TRAIL + 3 * j], out[OUT_TRAIL + 3 * j + 1], out[OUT_TRAIL + 3 * j + 2]]);

/** The signed-off mockup's law at 60 Hz (k = 1): the head follows at 16% per frame, a point is pushed past 7 px or 0.12 s. */
function mockup60() {
  let hx = -1, hy = -1, mx = -1, my = -1, t = 0, si = 0;
  const trail = [];
  const snaps = new Map();
  for (let f = 1; f <= 180; f++) {
    const now = (f * 1000) / 60;
    while (si < samples.length && samples[si][2] <= now) { mx = samples[si][0]; my = samples[si][1]; si++; }
    t += 1 / 60;
    if (mx >= 0) {
      if (hx < 0) { hx = mx; hy = my; }
      hx += (mx - hx) * 0.16;
      hy += (my - hy) * 0.16;
      const lt = trail[trail.length - 1];
      const px = hx, py = hy + SCROLL;
      if (!lt || Math.hypot(px - lt[0], py - lt[1]) > 7 || t - lt[2] > 0.12) {
        trail.push([px, py, t]);
        if (trail.length > 24) trail.shift();
      }
    }
    const shown = [];
    for (let i = Math.max(0, trail.length - 16); i < trail.length; i++) {
      const age = (t - trail[i][2]) / 1.2;
      if (age < 1) shown.push([trail[i][0], trail[i][1], age]);
    }
    snaps.set(Math.round(now), shown);
  }
  return snaps;
}

function wakeAt(hz) {
  const s = makeState();
  const out = new Float32Array(OUT_SLOTS);
  const snaps = new Map();
  let si = 0;
  for (let f = 1; f <= 3 * hz; f++) {
    const now = (f * 1000) / hz;
    const list = [];
    while (si < samples.length && samples[si][2] <= now) list.push(samples[si++]);
    step(s, inputFrame({ no: f, t: now, list, scrollY: SCROLL }), out);
    snaps.set(Math.round(now), trailOf(out));
  }
  return snaps;
}

test("A-5 (a) the circle trace at 30, 60 and 120 Hz gives the 60 Hz mockup trail within 1e-4", () => {
  const mock = mockup60();
  for (const hz of [30, 60, 120]) {
    const got = wakeAt(hz);
    for (const ms of [500, 1000, 1500, 2000, 2500]) {
      const a = got.get(ms);
      const b = mock.get(ms);
      assert.ok(b.length > 0, `the mockup has points at ${ms} ms`);
      assert.equal(a.length, b.length, `${hz} Hz at ${ms} ms: point count`);
      for (let j = 0; j < a.length; j++) {
        // Positions are Float32 in the output (px); ages are compared as age x 1000.
        assert.ok(Math.hypot(a[j][0] - b[j][0], a[j][1] - b[j][1]) < 1e-4, `${hz} Hz at ${ms} ms, point ${j}: position`);
        assert.ok(Math.abs(a[j][2] - b[j][2]) * 1000 < 1e-4, `${hz} Hz at ${ms} ms, point ${j}: age`);
      }
    }
  }
});

test("A-5 (b) level 2 shows the newest 6 points, level 0 and 1 show 16", () => {
  const run = (level) => {
    const s = makeState();
    const out = new Float32Array(OUT_SLOTS);
    let si = 0;
    for (let f = 1; f <= 60; f++) {
      const now = (f * 1000) / 60;
      const list = [];
      while (si < samples.length && samples[si][2] <= now) list.push(samples[si++]);
      step(s, inputFrame({ no: f, t: now, list, level }), out);
    }
    return out;
  };
  const full = run(0);
  assert.equal(full[2], 16);
  assert.equal(run(1)[2], 16);
  const stepped = run(2);
  assert.equal(stepped[2], 6);
  assert.equal(run(7)[2], 6);
  // The six are the newest six of the sixteen.
  assert.deepEqual(trailOf(stepped), trailOf(full).slice(-6));
});

/** One tap per frame at the tap's own time; returns which taps spawned a ripple. */
function spawnSequence(light, taps) {
  const s = makeState();
  const out = new Float32Array(OUT_SLOTS);
  return taps.map((sec, f) => {
    const before = s.spawnLen === 0 ? null : s.spawns[s.spawnLen - 1];
    step(s, inputFrame({ no: f + 1, t: sec * 1000 + 1, flags: light ? 2 : 0, taps: [[100, 200, sec * 1000]] }), out);
    const after = s.spawnLen === 0 ? null : s.spawns[s.spawnLen - 1];
    return after !== before ? "spawn" : "drop";
  });
}

test("A-5 (c) ripples expire at 1.4 s and trail points at 1.2 s", () => {
  const s = makeState();
  const out = new Float32Array(OUT_SLOTS);
  // One point is born at the tick of 100 ms; the pointer then leaves and a tap lands at page (700, 900) at 0.5 s.
  step(s, inputFrame({ no: 1, t: 100, list: [[300, 300, 90]] }), out);
  assert.equal(out[2], 1);
  step(s, inputFrame({ no: 2, t: 500, flags: 0, taps: [[700, 900, 500]] }), out);
  assert.equal(out[3], 1);
  assert.deepEqual([out[OUT_RIPPLES], out[OUT_RIPPLES + 1]], [700, 900]);
  step(s, inputFrame({ no: 3, t: 1299, flags: 0 }), out);
  assert.equal(out[2], 1, "the point is alive just before 1.2 s of age");
  step(s, inputFrame({ no: 4, t: 1301, flags: 0 }), out);
  assert.equal(out[2], 0, "the point is gone after 1.2 s of age");
  assert.equal(out[3], 1, "the ripple is still alive");
  step(s, inputFrame({ no: 5, t: 1899, flags: 0 }), out);
  assert.equal(out[3], 1, "the ripple is alive just before 1.4 s of age");
  assert.ok(Math.abs(out[OUT_RIPPLES + 2] - 1.399) < 1e-5);
  step(s, inputFrame({ no: 6, t: 1901, flags: 0 }), out);
  assert.equal(out[3], 0, "the ripple is gone after 1.4 s of age");
});

test("A-5 (c) the ripple spawn limit: 3 per 2.4 s in the dark theme, 1 in the light theme", () => {
  assert.deepEqual(spawnSequence(false, [0, 0.3, 0.6, 0.9, 1.2, 2.41]), ["spawn", "spawn", "spawn", "drop", "drop", "spawn"]);
  assert.deepEqual(spawnSequence(true, [0, 1.0, 2.41]), ["spawn", "drop", "spawn"]);
  assert.deepEqual(spawnSequence(true, [0, 2.4, 2.41]), ["spawn", "spawn", "drop"]);
  assert.deepEqual(spawnSequence(false, [0, 0.1, 0.2, 2.4, 2.41]), ["spawn", "spawn", "spawn", "spawn", "drop"]);
});

test("A-5 (d) a 300 ms stall with 300 samples queued runs exactly 6 ticks", () => {
  const s = makeState();
  const out = new Float32Array(OUT_SLOTS);
  step(s, inputFrame({ no: 1, t: 1000, list: [[100, 100, 999]] }), out);
  step(s, inputFrame({ no: 2, t: 1300, list: Array.from({ length: 300 }, (_, i) => [100 + i, 100, 1000 + i]) }), out);
  assert.equal(s.ticks, 6);
  assert.ok(Math.abs(s.k * TICK - 1300) < 1e-6, `the clock is at ${s.k * TICK} ms`);
  // The worked example of A-5: the head lands short of the pointer (399 px) and catches up over the next frames.
  assert.ok(Math.abs(s.hx - 272.6) < 0.1, `the head is at x ${s.hx}`);
  assert.equal(out[2], 7);
});

test("a worker fault is reported once and the worker closes", () => {
  const sent = [];
  let closed = 0;
  const handle = serve({ postMessage: (m) => sent.push(m), close: () => { closed++; } });
  handle({ type: "frame", buf: new ArrayBuffer(4) }); // not a whole number of Float64 slots: the typed-array view throws
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "fault");
  assert.equal(closed, 1);
});

// The worker side of (e) is the real `serve`, run in a worker thread; the main side is the real pool and reader.
const workerSource = `
const { parentPort } = require("node:worker_threads");
import(${JSON.stringify(new URL("../src/workers/input.worker.ts", import.meta.url).href)}).then(({ serve }) => {
  parentPort.on("message", serve(parentPort));
  parentPort.postMessage({ type: "ready" });
});
`;

test("A-5 (e) a pool of 3 + 3 buffers over 600 frames never reads a detached buffer, never goes backwards, lags one frame", async () => {
  const worker = new Worker(workerSource, { eval: true });
  const inPool = makePool(worker, POOL_SIZE, IN_BYTES);
  const latest = makeLatest(worker);
  let waiting = null;
  await new Promise((resolve, reject) => {
    worker.on("error", reject);
    worker.on("message", (m) => {
      if (m.type === "ready") return resolve();
      if (m.type === "back") inPool.back(m.buf);
      else if (m.type === "frame") {
        latest.put(m.buf);
        waiting?.();
      } else reject(new Error(`unexpected ${m.type}`));
    });
  });
  assert.equal(inPool.size(), POOL_SIZE);
  const lags = new Set();
  let last = 0;
  let reads = 0;
  let noBuffer = 0;
  for (let frame = 1; frame <= 600; frame++) {
    latest.read((buf) => {
      assert.equal(buf.byteLength, OUT_BYTES, "the buffer read is owned (not detached)");
      const o = new Float32Array(buf, 0, OUT_SLOTS);
      assert.ok(o[0] > last, `output frame ${o[0]} after ${last}`);
      last = o[0];
      lags.add(frame - o[1]);
      reads++;
    });
    const buf = inPool.take();
    if (!buf) { noBuffer++; continue; }
    assert.equal(buf.byteLength, IN_BYTES);
    const f = new Float64Array(buf, 0, IN_SLOTS);
    f.fill(0);
    f[0] = frame;
    f[1] = frame * TICK;
    f[4] = 1;
    f[5] = 1;
    f[IN_SAMPLES] = 300 + 200 * Math.cos(frame / 20);
    f[IN_SAMPLES + 1] = 300 + 200 * Math.sin(frame / 20);
    f[IN_SAMPLES + 2] = frame * TICK;
    const reply = new Promise((resolve) => { waiting = resolve; });
    inPool.send(buf);
    assert.equal(buf.byteLength, 0, "the sent buffer is detached here until it comes back");
    await reply; // the stepped clock: the next main frame starts when the worker's answer has arrived
  }
  assert.equal(noBuffer, 0, "main always had a free input buffer");
  assert.equal(reads, 599, "every frame but the first read an output");
  assert.deepEqual([...lags], [1], "the output answers the previous main frame's input, exactly one frame late");
  await worker.terminate();
});

test("A-5 (e) the reading side keeps only the newest frame and returns each superseded buffer once, unread", () => {
  const sent = [];
  const port = { postMessage: (message, { transfer }) => { sent.push(message); structuredClone(message.buf, { transfer }); } };
  const latest = makeLatest(port);
  const a = new ArrayBuffer(OUT_BYTES);
  const b = new ArrayBuffer(OUT_BYTES);
  const c = new ArrayBuffer(OUT_BYTES);
  new Float32Array(a)[0] = 1;
  new Float32Array(b)[0] = 2;
  new Float32Array(c)[0] = 3;
  latest.put(a);
  latest.put(b);
  assert.deepEqual(sent.map((m) => m.type), ["back"], "the superseded frame went back at once");
  assert.equal(a.byteLength, 0, "and is detached here");
  const seen = [];
  assert.equal(latest.read((buf) => seen.push(new Float32Array(buf)[0])), true);
  assert.deepEqual(seen, [2], "the read saw the newest frame");
  assert.equal(b.byteLength, 0, "the read buffer went back too");
  assert.equal(latest.read(() => seen.push("again")), false, "nothing is read twice");
  latest.put(c);
  assert.equal(latest.read((buf) => seen.push(new Float32Array(buf)[0])), true);
  assert.deepEqual(seen, [2, 3]);
  assert.equal(sent.length, 3, "each buffer went back exactly once");
});
