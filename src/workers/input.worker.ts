// Tier 2 worker (A-5): the pointer wake and tap ripples on a fixed 60 Hz virtual clock, over the transfer pool.
// `step` is pure over fixed typed-array rings and allocates nothing, so a Node test drives it directly; the message
// handler below is installed only inside a worker. Slot layouts are in pool.ts.
import {
  IN_SAMPLES, IN_TAPS, MAX_SAMPLES, MAX_TAPS, OUT_BYTES, OUT_RIPPLES, OUT_SLOTS, OUT_TRAIL, POOL_SIZE, makePool,
} from "./pool.ts";
import type { Message, Port } from "./pool.ts";

const TICK = 1000 / 60;
const FOLLOW = 0.16;
const PUSH_PX = 7;
const PUSH_S = 0.12;
const LIFE = 1.2;
const KEEP = 16;
const KEEP_STEPPED = 6;
const RIPPLE_LIFE = 1.4;
const MAX_RIPPLES = 3;
const MAX_TICKS = 6;
const SPAWN_WINDOW = 2400;
const STEP_DOWN_LEVEL = 2;

export interface State {
  /** The last tick number run, or -1 before the first frame. */
  k: number;
  /** Ticks run by the latest step (the stall test reads it). */
  ticks: number;
  hx: number;
  hy: number;
  mx: number;
  my: number;
  /** Trail points (x, y, birth s), oldest first. */
  trail: Float64Array;
  trailLen: number;
  /** Ripples (x, y, birth s), oldest first. */
  ripples: Float64Array;
  rippleLen: number;
  /** Spawn times (ms), oldest first, the newest 3. */
  spawns: Float64Array;
  spawnLen: number;
}

export function makeState(): State {
  return {
    k: -1, ticks: 0, hx: -1, hy: -1, mx: -1, my: -1,
    trail: new Float64Array(3 * KEEP), trailLen: 0,
    ripples: new Float64Array(3 * MAX_RIPPLES), rippleLen: 0,
    spawns: new Float64Array(MAX_RIPPLES), spawnLen: 0,
  };
}

/** Advances the wake by one input frame and writes the output frame, slots 1 to 60 (slot 0 is the caller's). */
export function step(s: State, inp: Float64Array, out: Float32Array): void {
  const t = inp[1];
  const scrollX = inp[2];
  const scrollY = inp[3];
  const flags = inp[4] | 0;
  const present = (flags & 1) === 1;
  const light = (flags & 2) === 2;
  const n = Math.min(inp[5], MAX_SAMPLES);
  const m = Math.min(inp[6], MAX_TAPS);
  const level = inp[7];

  // Ticks sit on an absolute 60 Hz grid of the timestamp clock: tick k happens at k * TICK.
  const kNow = Math.floor(t / TICK + 1e-6);
  if (s.k < 0) s.k = kNow - 1;
  if (kNow - s.k > MAX_TICKS) s.k = kNow - MAX_TICKS;
  let i = 0;
  s.ticks = 0;
  while (s.k < kNow) {
    s.k++;
    s.ticks++;
    const tick = s.k * TICK;
    while (i < n && inp[IN_SAMPLES + 3 * i + 2] <= tick + 1e-6) {
      s.mx = inp[IN_SAMPLES + 3 * i];
      s.my = inp[IN_SAMPLES + 3 * i + 1];
      i++;
    }
    if (!present && i >= n) s.mx = -1;
    if (s.mx >= 0) {
      if (s.hx < 0) { s.hx = s.mx; s.hy = s.my; }
      s.hx += (s.mx - s.hx) * FOLLOW;
      s.hy += (s.my - s.hy) * FOLLOW;
      const px = s.hx + scrollX;
      const py = s.hy + scrollY;
      const ts = tick / 1000;
      const last = 3 * (s.trailLen - 1);
      if (s.trailLen === 0 || Math.hypot(px - s.trail[last], py - s.trail[last + 1]) > PUSH_PX || ts - s.trail[last + 2] > PUSH_S) {
        if (s.trailLen === KEEP) { s.trail.copyWithin(0, 3); s.trailLen--; }
        const o = 3 * s.trailLen++;
        s.trail[o] = px;
        s.trail[o + 1] = py;
        s.trail[o + 2] = ts;
      }
    }
  }
  // Samples after the last tick wait for the next one.
  while (i < n) {
    s.mx = inp[IN_SAMPLES + 3 * i];
    s.my = inp[IN_SAMPLES + 3 * i + 1];
    i++;
  }
  if (!present) { s.mx = -1; s.hx = -1; s.hy = -1; }

  // Ripple spawn limit (D-042): at most L spawns in any half-open window (tt - 2400 ms, tt]; L is 1 light, 3 dark.
  const limit = light ? 1 : 3;
  for (let j = 0; j < m; j++) {
    const tt = inp[IN_TAPS + 3 * j + 2];
    let inWindow = 0;
    for (let q = 0; q < s.spawnLen; q++) if (s.spawns[q] > tt - SPAWN_WINDOW && s.spawns[q] <= tt) inWindow++;
    if (inWindow >= limit) continue;
    if (s.spawnLen === MAX_RIPPLES) { s.spawns.copyWithin(0, 1); s.spawnLen--; }
    s.spawns[s.spawnLen++] = tt;
    if (s.rippleLen === MAX_RIPPLES) { s.ripples.copyWithin(0, 3); s.rippleLen--; }
    const o = 3 * s.rippleLen++;
    s.ripples[o] = inp[IN_TAPS + 3 * j];
    s.ripples[o + 1] = inp[IN_TAPS + 3 * j + 1];
    s.ripples[o + 2] = tt / 1000;
  }

  const now = t / 1000;
  // Both lists are oldest first, so the expired points are a prefix.
  let drop = 0;
  while (drop < s.trailLen && now - s.trail[3 * drop + 2] >= LIFE) drop++;
  if (drop > 0) { s.trail.copyWithin(0, 3 * drop); s.trailLen -= drop; }
  drop = 0;
  while (drop < s.rippleLen && now - s.ripples[3 * drop + 2] >= RIPPLE_LIFE) drop++;
  if (drop > 0) { s.ripples.copyWithin(0, 3 * drop); s.rippleLen -= drop; }

  const show = Math.min(level >= STEP_DOWN_LEVEL ? KEEP_STEPPED : KEEP, s.trailLen);
  const first = s.trailLen - show;
  out[1] = inp[0];
  out[2] = show;
  out[3] = s.rippleLen;
  for (let j = 0; j < show; j++) {
    const o = 3 * (first + j);
    out[OUT_TRAIL + 3 * j] = s.trail[o];
    out[OUT_TRAIL + 3 * j + 1] = s.trail[o + 1];
    out[OUT_TRAIL + 3 * j + 2] = (now - s.trail[o + 2]) / LIFE;
  }
  for (let j = 0; j < s.rippleLen; j++) {
    out[OUT_RIPPLES + 3 * j] = s.ripples[3 * j];
    out[OUT_RIPPLES + 3 * j + 1] = s.ripples[3 * j + 1];
    out[OUT_RIPPLES + 3 * j + 2] = now - s.ripples[3 * j + 2];
  }
}

/** The worker's message loop: answer each input frame in arrival order, report a fault once, then close. */
export function serve(port: Port & { close(): void }, state: State = makeState()): (message: Message) => void {
  const pool = makePool(port, POOL_SIZE, OUT_BYTES);
  let frameNo = 0;
  return (message) => {
    try {
      if (message.type === "back") { pool.back(message.buf); return; }
      if (message.type !== "frame") return;
      const out = pool.take();
      if (!out) {
        // Every output buffer is with the main thread: skip this frame and give the input buffer back.
        port.postMessage({ type: "back", buf: message.buf }, { transfer: [message.buf] });
        return;
      }
      const view = new Float32Array(out, 0, OUT_SLOTS);
      view[0] = ++frameNo;
      step(state, new Float64Array(message.buf), view);
      port.postMessage({ type: "back", buf: message.buf }, { transfer: [message.buf] });
      pool.send(out);
    } catch (error) {
      port.postMessage({ type: "fault", message: String(error) }, { transfer: [] });
      port.close();
    }
  };
}

if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
  const handle = serve(self as unknown as Port & { close(): void });
  self.onmessage = (event: MessageEvent<Message>) => handle(event.data);
}
