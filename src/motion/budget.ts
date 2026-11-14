// A-3: the weak-device step-down controller (algorithms.md A-3, DV-01.1 build adjustment 1). Pure: no DOM, no timers.
// Whoever draws the field calls frame(ts) once per rAF callback; the level only rises, one step at a time, at most once
// every 2.5 s, when a capped mean of the frame deltas stays above a threshold derived from the display interval.
// Motion state lives in sessionStorage only (P-06.5), reached through a guard that never throws.

const KEY = "motion-level";
const PIN_KEY = "motion-level-pin";
const MAX_LEVEL = 7;
const WINDOW_MS = 1000;
const SETTLE_MS = 1500;
const LEARN_FRAMES = 30;
const INTERVAL_MIN = 6.9;
const INTERVAL_MAX = 33.4;
const TRACE_INTERVAL = 1000 / 60;
const TRACE_PATTERN = /^trace:(\d{1,3})fps$/;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** A guard that never throws: blocked storage reads as no storage. */
function sessionStorageOrNull(): StorageLike | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function readItem(storage: StorageLike | null, key: string): string | null {
  try {
    return storage ? storage.getItem(key) : null;
  } catch {
    return null;
  }
}

/** The pinned level, 0 to 7, or null when the key is absent or holds anything else. */
function parsePin(value: string | null): number | null {
  return value !== null && /^[0-7]$/.test(value) ? Number(value) : null;
}

/** The fixed delta of `trace:<n>fps` in ms, n an integer from 1 to 240, or null (a malformed value reads as absent). */
function parseTrace(value: string | null): number | null {
  const match = value === null ? null : TRACE_PATTERN.exec(value);
  const n = match ? Number(match[1]) : 0;
  return n >= 1 && n <= 240 ? 1000 / n : null;
}

/** The stored `{level, interval}` of an earlier page of the visit, or null when absent or invalid. */
function parseStored(value: string | null): { level: number; interval: number } | null {
  if (value === null) return null;
  try {
    const stored = JSON.parse(value) as { level?: unknown; interval?: unknown } | null;
    const level = stored?.level;
    const interval = stored?.interval;
    if (typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > MAX_LEVEL) return null;
    if (typeof interval !== "number" || !(interval >= INTERVAL_MIN && interval <= INTERVAL_MAX)) return null;
    return { level, interval };
  } catch {
    return null;
  }
}

export interface Budget {
  /** Reads the pin seam, the trace seam and the stored level. A second call only does reset(): the level is kept. */
  start(): void;
  /** One rAF timestamp (ms) of the loop that draws the field. Learns the interval first when none is known. */
  frame(ts: number): void;
  /** Clears the evidence: a hidden tab, pause and play, a restore, a resize and the other events of A-3. */
  reset(): void;
  /** The current level, 0 to 7: ranks 1..level of DV-01.1's step-down order are applied. */
  level(): number;
  /** The display interval in ms, or 0 while it is still being learned. */
  interval(): number;
  /** Calls `listener` once per step with the new level; returns the function that removes it. */
  onLevel(listener: (level: number) => void): () => void;
}

/** One controller. The module's own exports below share one instance; tests build their own. */
export function createBudget(storage: () => StorageLike | null = sessionStorageOrNull): Budget {
  const listeners = new Set<(level: number) => void>();
  let started = false;
  let level = 0;
  let interval = 0;
  let pinned = false;
  let traceDelta: number | null = null;
  let threshold = 0;
  let cap = 0;
  let last: number | null = null;
  let settleUntil: number | null = null;
  let windowTs: number[] = [];
  let windowDelta: number[] = [];
  let learned: number[] = [];

  function derive(): void {
    // B is the smallest whole number of display intervals that is at least about 16.2 ms.
    const budget = interval * Math.ceil((1000 / 60 - 0.5) / interval);
    threshold = Math.max(21, 1.25 * budget);
    cap = 4 * budget;
  }

  function reset(): void {
    last = null;
    settleUntil = null;
    windowTs = [];
    windowDelta = [];
    learned = [];
  }

  function start(): void {
    if (started) {
      reset();
      return;
    }
    started = true;
    const store = storage();
    const pin = parsePin(readItem(store, PIN_KEY));
    traceDelta = parseTrace(readItem(store, PIN_KEY));
    if (pin !== null) {
      // The pin applies its level and never steps (the test seam, A-3 Verification (c)).
      pinned = true;
      level = pin;
      interval = TRACE_INTERVAL;
      derive();
      return;
    }
    const stored = parseStored(readItem(store, KEY));
    if (stored) level = stored.level;
    // Under a trace the interval is fixed and never learned, whatever the renderer's real frame rate.
    if (traceDelta !== null) interval = TRACE_INTERVAL;
    else if (stored) interval = stored.interval;
    if (interval > 0) derive();
  }

  function learn(ts: number): void {
    if (last === null) {
      last = ts;
      return;
    }
    learned.push(ts - last);
    last = ts;
    if (learned.length < LEARN_FRAMES) return;
    const median = learned.sort((a, b) => a - b)[learned.length >> 1];
    interval = Math.min(INTERVAL_MAX, Math.max(INTERVAL_MIN, median));
    derive();
    reset();
  }

  function step(ts: number): void {
    level += 1;
    windowTs = [];
    windowDelta = [];
    settleUntil = ts + SETTLE_MS;
    try {
      storage()?.setItem(KEY, JSON.stringify({ level, interval }));
    } catch {
      // A failed write: the level holds for this page only.
    }
    for (const listener of listeners) listener(level);
  }

  function frame(ts: number): void {
    if (!started || pinned) return;
    // Two callbacks of one animation frame share a timestamp: the second one carries no evidence.
    if (last !== null && ts <= last) return;
    if (interval === 0) {
      learn(ts);
      return;
    }
    if (last === null) {
      last = ts;
      if (settleUntil === null) settleUntil = ts + SETTLE_MS;
      return;
    }
    // Under a trace only the delta is replaced; the timestamps stay real (A-3 Verification (c)).
    const delta = traceDelta ?? ts - last;
    last = ts;
    if (settleUntil === null || ts < settleUntil) return;
    windowTs.push(ts);
    windowDelta.push(Math.min(delta, cap));
    let drop = 0;
    while (windowTs[drop] <= ts - WINDOW_MS) drop += 1;
    if (drop > 0) {
      windowTs = windowTs.slice(drop);
      windowDelta = windowDelta.slice(drop);
    }
    if (ts - settleUntil < WINDOW_MS) return;
    let sum = 0;
    for (const d of windowDelta) sum += d;
    if (sum / windowDelta.length > threshold && level < MAX_LEVEL) step(ts);
  }

  return {
    start,
    frame,
    reset,
    level: () => level,
    interval: () => interval,
    onLevel(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

const shared = createBudget();
export const start = shared.start;
export const frame = shared.frame;
export const reset = shared.reset;
export const level = shared.level;
export const interval = shared.interval;
export const onLevel = shared.onLevel;
