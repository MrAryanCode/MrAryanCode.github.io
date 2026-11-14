// Tier 2 entry (A-5): the pointer wake and tap ripples, computed in a module worker over the transfer buffer pool.
// `start` resolves true when the worker runs and false when it declines. Pause and reduced motion abort `signal`,
// which terminates the worker. Tier 3 reads the result through `onOutput`.
import { level, onLevel } from "../motion/budget.ts";
import { IN_BYTES, IN_SAMPLES, IN_SLOTS, IN_TAPS, MAX_SAMPLES, MAX_TAPS, OUT_SLOTS, POOL_SIZE, makeLatest, makePool } from "./pool.ts";
import type { Message } from "./pool.ts";

const REDUCED = "(prefers-reduced-motion: reduce)";
const DARK = "(prefers-color-scheme: dark)";
const TICK = 1000 / 60;
const WATCHDOG_MS = 2000;
const RING = 256; // a power of two: the coalesced pointer ring of realtime-visual-web-stack-code section 6
const MASK = RING - 1;

export type OutputListener = (out: Float32Array) => void;

const listeners = new Set<OutputListener>();
// Slots 2 and 3 (trail count, ripple count) are 0: the field draws no wake. Shared and never written.
const EMPTY = new Float32Array(OUT_SLOTS);

/**
 * Tier 3's seam. The listener runs once per output frame, in the main thread's frame, with a Float32Array(61) laid out as
 * in algorithms.md A-5; the array is valid only during the call (its buffer goes back to the worker afterwards). After a
 * worker fault or the 2 s watchdog it runs once with an all-zero frame, so no stale trail stays on screen.
 */
export function onOutput(listener: OutputListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function emit(out: Float32Array): void {
  for (const listener of listeners) listener(out);
}

export async function start(_root: HTMLElement, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted || matchMedia(REDUCED).matches || typeof Worker === "undefined") return false;
  let worker: Worker;
  try {
    worker = new Worker(new URL("./input.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return false;
  }
  const inPool = makePool(worker, POOL_SIZE, IN_BYTES);
  const latest = makeLatest(worker);
  const dark = matchMedia(DARK);
  const ring = new Float64Array(RING * 3);
  const taps = new Float64Array(3 * MAX_TAPS);
  let written = 0;
  let sent = 0;
  let tapCount = 0;
  let inside = false;
  let inputNo = 0;
  let stepLevel = level();
  let lastOutputAt = performance.now();
  let running = true;
  let rafId = 0;

  const put = (x: number, y: number, ts: number): void => {
    const o = (written & MASK) * 3;
    ring[o] = x;
    ring[o + 1] = y;
    ring[o + 2] = ts;
    written++;
  };
  const onMove = (e: PointerEvent): void => {
    if (e.pointerType === "touch") return;
    inside = true;
    const list = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    if (list.length) for (let i = 0; i < list.length; i++) put(list[i].clientX, list[i].clientY, list[i].timeStamp);
    else put(e.clientX, e.clientY, e.timeStamp);
  };
  const onDown = (e: PointerEvent): void => {
    if (e.pointerType !== "touch") return;
    if (tapCount === MAX_TAPS) { taps.copyWithin(0, 3); tapCount--; }
    const o = 3 * tapCount++;
    taps[o] = e.pageX;
    taps[o + 1] = e.pageY;
    taps[o + 2] = e.timeStamp;
  };
  const onLeave = (): void => { inside = false; };
  const onVisible = (): void => { if (document.visibilityState === "visible") lastOutputAt = performance.now(); };
  const root = document.documentElement;
  document.addEventListener("pointermove", onMove, { passive: true });
  document.addEventListener("pointerdown", onDown, { passive: true });
  root.addEventListener("pointerleave", onLeave);
  document.addEventListener("visibilitychange", onVisible);
  const unsubscribe = onLevel((next) => { stepLevel = next; });

  // Ends tier 2. `handOver` is true after a fault: tier 3 gets one empty frame so the field shows no stale trail.
  const stop = (handOver: boolean): void => {
    if (!running) return;
    running = false;
    cancelAnimationFrame(rafId);
    worker.terminate();
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerdown", onDown);
    root.removeEventListener("pointerleave", onLeave);
    document.removeEventListener("visibilitychange", onVisible);
    unsubscribe();
    if (handOver) emit(EMPTY);
  };
  signal.addEventListener("abort", () => stop(false), { once: true });

  worker.onmessage = (event: MessageEvent<Message>) => {
    if (!running) return;
    const message = event.data;
    if (message.type === "back") inPool.back(message.buf);
    else if (message.type === "frame") {
      latest.put(message.buf);
      lastOutputAt = performance.now();
    } else if (message.type === "fault") stop(true);
  };
  worker.onerror = () => stop(true);

  // Reduces the ring's samples since the last send to the newest one of each 60 Hz bucket, newest 8 buckets, oldest first.
  const fillSamples = (f: Float64Array): number => {
    let count = 0;
    let lastBucket = Number.NaN;
    for (let w = Math.max(sent, written - RING); w < written; w++) {
      const o = (w & MASK) * 3;
      const bucket = Math.ceil(ring[o + 2] / TICK - 1e-6); // the same slack as the worker's tick comparison
      if (count > 0 && bucket === lastBucket) count--;
      else if (count === MAX_SAMPLES) {
        f.copyWithin(IN_SAMPLES, IN_SAMPLES + 3, IN_SAMPLES + 3 * MAX_SAMPLES);
        count--;
      }
      const d = IN_SAMPLES + 3 * count++;
      f[d] = ring[o];
      f[d + 1] = ring[o + 1];
      f[d + 2] = ring[o + 2];
      lastBucket = bucket;
    }
    sent = written;
    return count;
  };

  const loop = (ts: number): void => {
    rafId = requestAnimationFrame(loop);
    if (document.visibilityState === "visible" && performance.now() - lastOutputAt > WATCHDOG_MS) {
      stop(true);
      return;
    }
    latest.read((buf) => emit(new Float32Array(buf, 0, OUT_SLOTS)));
    const buf = inPool.take();
    if (!buf) return; // the worker is behind: the samples and taps stay for the next frame
    const f = new Float64Array(buf, 0, IN_SLOTS);
    f[0] = ++inputNo;
    f[1] = ts;
    f[2] = scrollX;
    f[3] = scrollY;
    f[4] = (inside ? 1 : 0) | (dark.matches ? 0 : 2);
    f[5] = fillSamples(f);
    f[6] = tapCount;
    f[7] = stepLevel;
    for (let i = 0; i < 3 * tapCount; i++) f[IN_TAPS + i] = taps[i];
    tapCount = 0;
    inPool.send(buf);
  };
  rafId = requestAnimationFrame(loop);
  return true;
}
