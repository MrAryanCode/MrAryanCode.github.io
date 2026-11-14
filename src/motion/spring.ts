// A-4: springs (algorithms.md A-4; realtime-visual-web-stack-code sections 1 and 2). The closed form of the damped
// spring u'' = -k*u - c*u' is exact at any time, so every motion here looks the same at 30, 60, 90 and 120 Hz.
// Units: px, seconds in the maths, milliseconds in Web Animations. No browser API is used except in createSpring.

/**
 * Damped spring with m = 1. u is the position minus the target (px), v = du/dt (px/s), t in seconds.
 * Preconditions: k > 0, c >= 0. Writes [u, v] into `out` and returns it.
 */
export function springAt(k: number, c: number, u0: number, v0: number, t: number, out: number[] = [0, 0]): number[] {
  const w0 = Math.sqrt(k);
  const a = c / 2;
  const e = Math.exp(-a * t);
  if (Math.abs(a - w0) <= 1e-9 * w0) {
    // Critically damped, with a tolerance so a near-critical spring takes the same branch.
    const B = v0 + a * u0;
    out[0] = e * (u0 + B * t);
    out[1] = e * (v0 - a * B * t);
    return out;
  }
  if (a < w0) {
    const wd = Math.sqrt(k - a * a);
    const C = Math.cos(wd * t);
    const S = Math.sin(wd * t);
    const B = (v0 + a * u0) / wd;
    out[0] = e * (u0 * C + B * S);
    out[1] = e * ((B * wd - a * u0) * C - (u0 * wd + a * B) * S);
    return out;
  }
  const d = Math.sqrt(a * a - k);
  const r1 = -a + d;
  const r2 = -a - d;
  const A = (v0 - r2 * u0) / (r1 - r2);
  const Bq = u0 - A;
  const e1 = Math.exp(r1 * t);
  const e2 = Math.exp(r2 * t);
  out[0] = A * e1 + Bq * e2;
  out[1] = A * r1 * e1 + Bq * r2 * e2;
  return out;
}

/** The exact one-step propagator for a fixed dt: u' = m[0]*u + m[1]*v, v' = m[2]*u + m[3]*v. */
export function stepMatrix(k: number, c: number, dt: number): Float64Array {
  const p = springAt(k, c, 1, 0, dt, [0, 0]);
  const q = springAt(k, c, 0, 1, dt, [0, 0]);
  return new Float64Array([p[0], q[0], p[1], q[1]]);
}

/**
 * The last time (s, on a 0.1 ms grid) at which |u| > eps or |v| > 10*eps. The energy never rises, so the scan stops
 * as soon as it is below the bound that keeps both limits. With c = 0 the energy never falls and the result is `cap`.
 */
export function settleTime(k: number, c: number, u0: number, v0: number, eps = 0.1, cap = 5): number {
  const Emin = 0.5 * Math.min(k * eps * eps, 100 * eps * eps);
  const s = [0, 0];
  const n = Math.round(cap / 1e-4);
  let T = 0;
  for (let i = 0; i <= n; i++) {
    const t = i * 1e-4;
    springAt(k, c, u0, v0, t, s);
    if (Math.abs(s[0]) > eps || Math.abs(s[1]) > 10 * eps) T = t;
    else if (0.5 * (s[1] * s[1] + k * s[0] * s[0]) <= Emin) break;
  }
  return T;
}

export interface Bake {
  /** A `linear()` easing for keyframes [target + scale] -> [target]. */
  easing: string;
  durationMs: number;
  /** The signed sampled u of largest magnitude, px. */
  scale: number;
}

/**
 * Bakes the motion from (u0, v0) into one `linear()` easing. The stops sit at t_i = T*(i/n)^2, dense where the
 * velocity is high, and the last stop is exactly 1 so the element comes to rest on the target. Null if nothing moves.
 */
export function bake(k: number, c: number, u0: number, v0: number, n = 39, eps = 0.1): Bake | null {
  const T = settleTime(k, c, u0, v0, eps);
  if (T === 0) return null;
  const s = [0, 0];
  const ts = new Float64Array(n + 1);
  const us = new Float64Array(n + 1);
  let scale = 0;
  for (let i = 0; i <= n; i++) {
    ts[i] = T * (i / n) ** 2;
    us[i] = springAt(k, c, u0, v0, ts[i], s)[0];
    if (Math.abs(us[i]) > Math.abs(scale)) scale = us[i];
  }
  if (scale === 0) return null;
  let easing = "linear(";
  for (let i = 0; i <= n; i++) {
    const p = i === n ? 1 : +(1 - us[i] / scale).toFixed(4);
    easing += (i ? ", " : "") + p + " " + +((100 * ts[i]) / T).toFixed(3) + "%";
  }
  return { easing: easing + ")", durationMs: T * 1000, scale };
}

// The button's return (0.6 s, ~10% overshoot, up to 5 px) and the 404 arrow (0.45 s, ~10%, 4 px): zeta 0.591 from
// `zeta = -ln OS / sqrt(pi^2 + ln^2 OS)`, and k solved so that settleTime equals the design duration at full travel.
export const BUTTON_SPRING = { k: 125.2, c: 13.23 } as const;
export const ARROW_SPRING = { k: 226.2, c: 17.78 } as const;

export interface Spring {
  el: Element;
  k: number;
  c: number;
  anim: Animation;
  target: number;
  u0: number;
  v0: number;
  T: number;
  s: number[];
}

/** One Web Animation per element, re-aimed in place on every interruption. One axis only (translateX). */
export function createSpring(el: Element, k: number, c: number, start = 0): Spring {
  const kf = { transform: `translateX(${start}px)` };
  const anim = el.animate([kf, kf], { duration: 1, fill: "both" });
  anim.finish();
  return { el, k, c, anim, target: start, u0: 0, v0: 0, T: 0, s: [0, 0] };
}

/**
 * Sends the element toward `target`, keeping its current position and velocity. The state comes from the model at the
 * animation's currentTime (no getComputedStyle, so no style flush). Returns the new duration in ms.
 */
export function retarget(sp: Spring, target: number): number {
  const t = Number(sp.anim.currentTime ?? Infinity) / 1000;
  let u = 0;
  let v = 0;
  if (t < sp.T) {
    springAt(sp.k, sp.c, sp.u0, sp.v0, t, sp.s);
    u = sp.s[0];
    v = sp.s[1];
  }
  const u0 = sp.target + u - target;
  const b = bake(sp.k, sp.c, u0, v);
  const from = b ? target + b.scale : target;
  const effect = sp.anim.effect as KeyframeEffect;
  effect.setKeyframes([{ transform: `translateX(${from}px)` }, { transform: `translateX(${target}px)` }]);
  effect.updateTiming({ duration: b ? b.durationMs : 1, easing: b ? b.easing : "linear" });
  sp.anim.currentTime = 0;
  if (sp.anim.playState !== "running") sp.anim.play();
  sp.target = target;
  sp.u0 = u0;
  sp.v0 = v;
  sp.T = b ? b.durationMs / 1000 : 0;
  return b ? b.durationMs : 0;
}

// The pointer ring's law was signed off as a per-frame recurrence at 60 Hz: v' = 0.70 v - 0.119 u, u' = u + v'. It is a
// linear map of (offset, velocity) whose eigenvalues give the continuous k and c exactly, and its one difference from a
// plain spring (the force is applied before the move, so a target jump moves the ring in the same frame) is an exact
// velocity kick proportional to the jump. Both are derived here from the recurrence, so no rounding enters.
const RING_DT = 1 / 60;
const RING_A = 0.881;
const RING_TRACE = RING_A + 0.7;
const RING_DET = RING_A * 0.7 - 0.7 * -0.119;
const RING_RE = RING_TRACE / 2;
const RING_IM = Math.sqrt(4 * RING_DET - RING_TRACE * RING_TRACE) / 2;
const RING_LR = Math.log(Math.hypot(RING_RE, RING_IM)) / RING_DT;
const RING_LI = Math.atan2(RING_IM, RING_RE) / RING_DT;
/** The ring's stiffness (515.44) and damping (21.4005), per second. */
export const RING_K = RING_LR * RING_LR + RING_LI * RING_LI;
export const RING_C = -2 * RING_LR;
const RING_STEP = stepMatrix(RING_K, RING_C, RING_DT);
/** The velocity kick per px of target jump (4.0881 /s). */
export const RING_KICK = (RING_STEP[0] - RING_A) / RING_STEP[1];
/** A resumed tab does not fling the ring: dt is capped at 0.1 s. */
export const RING_MAX_DT = 0.1;

/** One axis of the ring (x, y, width or height): its value, its velocity and the target of the last frame. */
export interface RingAxis {
  x: number;
  v: number;
  target: number;
}

export function createRingAxis(x: number): RingAxis {
  return { x, v: 0, target: x };
}

const ringScratch = [0, 0];

/** Advances one axis by `dt` seconds (the rAF delta) toward `target`; independent of the frame rate. */
export function ringStep(axis: RingAxis, target: number, dt: number): void {
  axis.v += RING_KICK * (target - axis.target);
  axis.target = target;
  springAt(RING_K, RING_C, axis.x - target, axis.v, Math.min(dt, RING_MAX_DT), ringScratch);
  axis.x = target + ringScratch[0];
  axis.v = ringScratch[1];
}

// The fact counter's digit roll (0.9 s, ~15% overshoot, no bounce-back) is a composite curve: an underdamped spring up
// to its first peak at 0.3 s (zeta 0.5169, w0 12.233), then a critically damped return from rest at the peak
// (wc 13.710, so 0.1 px remain at 0.9 s on the worst-case travel of 270 px). It is continuous in position and
// velocity and never crosses its value after the peak. Baked once into this 40-segment string (f sampled at
// t = 0.9 * (i/40)^1.5, last stop exactly 1); every roll uses it, scaled by its own travel through its keyframes.
export const DIGIT_ROLL_EASING =
  "linear(0 0%, 0.0009 0.4%, 0.0073 1.12%, 0.0236 2.05%, 0.0534 3.16%, 0.0989 4.42%, 0.1607 5.81%, 0.2381 7.32%, 0.3291 8.94%, 0.4305 10.67%, 0.5382 12.5%, 0.6477 14.42%, 0.7543 16.43%, 0.8537 18.53%, 0.9418 20.71%, 1.0159 22.96%, 1.0739 25.3%, 1.1151 27.71%, 1.1399 30.19%, 1.1497 32.74%, 1.146 35.36%, 1.1327 38.04%, 1.1148 40.79%, 1.0958 43.6%, 1.0777 46.48%, 1.0616 49.41%, 1.0478 52.4%, 1.0365 55.46%, 1.0274 58.57%, 1.0203 61.73%, 1.0149 64.95%, 1.0107 68.23%, 1.0077 71.55%, 1.0054 74.93%, 1.0038 78.37%, 1.0026 81.85%, 1.0018 85.38%, 1.0012 88.96%, 1.0008 92.59%, 1.0006 96.27%, 1 100%)";
export const DIGIT_ROLL_MS = 900;
