// A-4 (algorithms.md): the springs, in Node with no browser (T-016). Verification (a) the pointer ring at 30, 60 and
// 120 Hz, (b) the button and arrow constants, (c) a retarget keeps position and velocity, (d) the digit-roll string,
// (e) every baked duration is under 1 s.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ARROW_SPRING,
  BUTTON_SPRING,
  DIGIT_ROLL_EASING,
  DIGIT_ROLL_MS,
  RING_C,
  RING_K,
  RING_KICK,
  bake,
  createRingAxis,
  createSpring,
  retarget,
  ringStep,
  settleTime,
  springAt,
  stepMatrix,
} from "../src/motion/spring.ts";

test("A-4 the ring constants are the continuous law of the signed-off 60 Hz recurrence", () => {
  assert.equal(RING_K.toFixed(2), "515.44");
  assert.equal(RING_C.toFixed(4), "21.4005");
  assert.equal(RING_KICK.toFixed(4), "4.0881");
  // The exact one-step map at 60 Hz, plus the kick, has the recurrence's own 0.881 in its position row.
  const m = stepMatrix(RING_K, RING_C, 1 / 60);
  assert.ok(Math.abs(m[0] - (0.881 + RING_KICK * m[1])) < 1e-12);
});

/** The signed-off recurrence: v' = 0.70 v - 0.119 (x - target), x' = x + v', one frame at 60 Hz. */
function recurrence(frames, targetAt) {
  let x = 0;
  let v = 0;
  const out = [0];
  for (let i = 1; i <= frames; i += 1) {
    v = 0.7 * v - 0.119 * (x - targetAt(i / 60));
    x += v;
    out.push(x);
  }
  return out;
}

test("A-4 (a) a 100 px jump then a 120 px jump at 0.6 s: 30, 60 and 120 Hz agree with the 60 Hz recurrence to 1e-9 px", () => {
  // The target changes at 0.6 s, which starts a step at every one of the three rates; a step is aimed by its end time.
  const targetAt = (end) => (end > 0.6 + 1e-9 ? 120 : 100);
  const ref = recurrence(120, targetAt);
  for (const hz of [30, 60, 120]) {
    const axis = createRingAxis(0);
    const dt = 1 / hz;
    const every = hz / 30;
    let compared = 0;
    for (let i = 1; i <= 2 * hz; i += 1) {
      ringStep(axis, targetAt(i / hz), dt);
      if (i % every === 0) {
        const frame = (i / hz) * 60;
        const expected = ref[Math.round(frame)];
        assert.ok(Math.abs(axis.x - expected) <= 1e-9, `${hz} Hz, t = ${(i / hz).toFixed(4)} s: ${axis.x} against ${expected}`);
        compared += 1;
      }
    }
    assert.equal(compared, 60);
  }
});

test("A-4 a resumed tab does not fling the ring: dt is capped at 0.1 s", () => {
  const a = createRingAxis(0);
  const b = createRingAxis(0);
  ringStep(a, 100, 5);
  ringStep(b, 100, 0.1);
  assert.equal(a.x, b.x);
  assert.equal(a.v, b.v);
});

/** The largest overshoot of a spring from `travel` px at rest, sampled every 0.1 ms, and its settle time. */
function profile({ k, c }, travel) {
  let overshoot = 0;
  const s = [0, 0];
  for (let i = 0; i <= 10000; i += 1) {
    springAt(k, c, travel, 0, i * 1e-4, s);
    overshoot = Math.max(overshoot, -s[0] * Math.sign(travel));
  }
  return { overshoot: Math.abs(overshoot), settle: settleTime(k, c, travel, 0) };
}

test("A-4 (b) the button settles to 0.1 px at 0.600 s and the arrow at 0.450 s, each with 10% overshoot", () => {
  const button = profile(BUTTON_SPRING, 5);
  assert.ok(Math.abs(button.settle - 0.6) <= 0.01, `button settles at ${button.settle} s`);
  assert.ok(Math.abs(button.overshoot - 0.5) <= 0.02, `button overshoots ${button.overshoot} px of 5`);
  const arrow = profile(ARROW_SPRING, 4);
  assert.ok(Math.abs(arrow.settle - 0.45) <= 0.01, `arrow settles at ${arrow.settle} s`);
  assert.ok(Math.abs(arrow.overshoot - 0.4) <= 0.02, `arrow overshoots ${arrow.overshoot} px of 4`);
});

/** A Web Animations stand-in: it keeps what retarget writes, and a currentTime the test sets. */
function fakeElement() {
  const calls = { keyframes: null, timing: null, plays: 0 };
  const anim = {
    currentTime: 0,
    playState: "idle",
    finish() { this.currentTime = 1; this.playState = "finished"; },
    play() { calls.plays += 1; this.playState = "running"; },
    effect: {
      setKeyframes(kf) { calls.keyframes = kf; },
      updateTiming(t) { calls.timing = t; },
    },
  };
  return { el: { animate: () => anim }, anim, calls };
}

test("A-4 (c) a retarget at 150 ms keeps the position (3.511 px) and the velocity (19.05 px/s) to 1e-6", () => {
  const { el, anim, calls } = fakeElement();
  const sp = createSpring(el, ARROW_SPRING.k, ARROW_SPRING.c, 0);
  retarget(sp, 4);
  assert.equal(sp.target, 4);
  anim.currentTime = 150;
  const before = springAt(ARROW_SPRING.k, ARROW_SPRING.c, -4, 0, 0.15);
  assert.ok(Math.abs(4 + before[0] - 3.511) < 5e-4 && Math.abs(before[1] - 19.05) < 5e-3, "the figures of the design");
  const ms = retarget(sp, 0);
  // The new motion starts where the old one was, with the old velocity: u0 = position - target, v0 = velocity.
  assert.ok(Math.abs(sp.u0 - (4 + before[0])) < 1e-6, `u0 ${sp.u0}`);
  assert.ok(Math.abs(sp.v0 - before[1]) < 1e-6, `v0 ${sp.v0}`);
  assert.equal(sp.target, 0);
  assert.equal(anim.currentTime, 0, "the same animation restarts its own clock");
  assert.equal(anim.playState, "running");
  assert.equal(ms, calls.timing.duration);
  assert.ok(ms > 0 && ms < 1000);
  // The first sample of the baked easing puts the element where it was, within the 0.1 px of the design.
  const [from, to] = calls.keyframes.map((k) => Number(/translateX\((-?[\d.e+-]+)px\)/.exec(k.transform)[1]));
  const first = Number(/^linear\((-?[\d.]+) 0%/.exec(calls.timing.easing)[1]);
  assert.ok(Math.abs(from + (to - from) * first - sp.u0) < 0.1, "the transform at the start equals the transform before");
  assert.equal(to, 0);
});

test("A-4 a retarget after the motion has settled starts from rest", () => {
  const { el, anim } = fakeElement();
  const sp = createSpring(el, BUTTON_SPRING.k, BUTTON_SPRING.c, 0);
  retarget(sp, 5);
  anim.currentTime = 5000;
  retarget(sp, 0);
  assert.ok(Math.abs(sp.u0 - 5) < 1e-12);
  assert.equal(sp.v0, 0);
});

/** The digit roll as the build regenerates it: the first peak at 0.3 s, then a critically damped return (A-4 step 5). */
function regenerateDigitRoll() {
  const OS = 0.15;
  const z = -Math.log(OS) / Math.sqrt(Math.PI ** 2 + Math.log(OS) ** 2);
  const tp = 0.3;
  const wd = Math.PI / tp;
  const w0 = wd / Math.sqrt(1 - z * z);
  const travel = 270;
  const eps = 0.1;
  const Ttot = 0.9;
  let lo = 1;
  let hi = 60;
  for (let i = 0; i < 200; i += 1) {
    const w = (lo + hi) / 2;
    const e = OS * (1 + w * (Ttot - tp)) * Math.exp(-w * (Ttot - tp)) * travel;
    if (e > eps) lo = w;
    else hi = w;
  }
  const wc = hi;
  const f = (t) => (t <= tp
    ? 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t))
    : 1 + OS * (1 + wc * (t - tp)) * Math.exp(-wc * (t - tp)));
  const n = 40;
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const t = Ttot * (i / n) ** 1.5;
    pts.push([t, i === n ? 1 : +f(t).toFixed(4)]);
  }
  return "linear(" + pts.map(([t, y]) => `${y} ${+(100 * t / Ttot).toFixed(2)}%`).join(", ") + ")";
}

test("A-4 (d) the committed digit-roll string equals the regenerated one, starts at 0, ends at 1, peaks at 1.15 and never rises again", () => {
  assert.equal(DIGIT_ROLL_EASING, regenerateDigitRoll());
  assert.equal(DIGIT_ROLL_EASING.length, 591);
  assert.equal(DIGIT_ROLL_MS, 900);
  const stops = [...DIGIT_ROLL_EASING.matchAll(/(-?[\d.]+) ([\d.]+)%/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.equal(stops.length, 41);
  assert.deepEqual(stops[0], [0, 0]);
  assert.deepEqual(stops.at(-1), [1, 100]);
  const peak = Math.max(...stops.map(([y]) => y));
  assert.ok(Math.abs(peak - 1.15) <= 0.005, `the peak is ${peak}`);
  const at = stops.findIndex(([y]) => y === peak);
  for (let i = at + 1; i < stops.length; i += 1) assert.ok(stops[i][0] <= stops[i - 1][0], `rises at stop ${i}`);
  assert.ok(stops.slice(at).every(([y]) => y >= 1), "no bounce-back below the value");
});

test("A-4 (e) every baked duration is under 1 s, over the travel and velocity the page can produce", () => {
  let baked = 0;
  for (const { k, c } of [BUTTON_SPRING, ARROW_SPRING]) {
    for (let u0 = -6; u0 <= 6; u0 += 0.5) {
      for (let v0 = -300; v0 <= 300; v0 += 25) {
        const b = bake(k, c, u0, v0);
        if (!b) continue;
        baked += 1;
        assert.ok(b.durationMs < 1000, `k ${k}, u0 ${u0}, v0 ${v0}: ${b.durationMs} ms`);
        assert.match(b.easing, /^linear\(.*, 1 100%\)$/);
      }
    }
  }
  assert.ok(baked > 100);
  assert.equal(bake(BUTTON_SPRING.k, BUTTON_SPRING.c, 0, 0), null, "nothing moves, nothing is baked");
});
