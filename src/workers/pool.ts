// The tagged transfer pool of A-5 (realtime-visual-web-stack-code section 5, extended): both directions share one
// port, so every transfer is { type, buf } with type "frame" (a filled buffer) or "back" (a buffer returned empty).
// Only ownership moves: a transferred buffer is detached on the sending side until it comes back. No SharedArrayBuffer.

/** Input frame, Float64Array(41): slots 0 frame no, 1 t, 2 scrollX, 3 scrollY, 4 flags, 5 n, 6 m, 7 level, 8.. samples, 32.. taps. */
export const IN_SLOTS = 41;
export const IN_SAMPLES = 8;
export const IN_TAPS = 32;
export const MAX_SAMPLES = 8;
export const MAX_TAPS = 3;
/** Output frame, Float32Array(61): slots 0 frame no, 1 input frame answered, 2 trail count, 3 ripple count, 4.. trail, 52.. ripples. */
export const OUT_SLOTS = 61;
export const OUT_TRAIL = 4;
export const OUT_RIPPLES = 52;
export const IN_BYTES = 8 * IN_SLOTS;
export const OUT_BYTES = 4 * OUT_SLOTS;
export const POOL_SIZE = 3;

export type Message =
  | { type: "frame"; buf: ArrayBuffer }
  | { type: "back"; buf: ArrayBuffer }
  | { type: "fault"; message: string };

export interface Port {
  postMessage(message: unknown, options: { transfer: Transferable[] }): void;
}

export interface Pool {
  /** A free buffer, or null when every buffer is with the other side (skip this frame, never block). */
  take(): ArrayBuffer | null;
  /** Sends a buffer the caller has filled; it is detached here until it comes back. */
  send(buf: ArrayBuffer): void;
  /** A buffer returned by the other side becomes free again. */
  back(buf: ArrayBuffer): void;
  size(): number;
}

/** The side that owns and fills `count` buffers of `bytes` bytes each. The pool size is fixed here and never changes. */
export function makePool(port: Port, count: number, bytes: number): Pool {
  const free: ArrayBuffer[] = [];
  for (let i = 0; i < count; i++) free.push(new ArrayBuffer(bytes));
  return {
    take: () => free.pop() ?? null,
    send: (buf) => port.postMessage({ type: "frame", buf }, { transfer: [buf] }),
    back: (buf) => { free.push(buf); },
    size: () => free.length,
  };
}

export interface Latest {
  /** A frame arrived: keep it, and hand the one it supersedes straight back unread. */
  put(buf: ArrayBuffer): void;
  /** Calls `fn` with the newest frame, if there is one, then returns the buffer; false when none had arrived. */
  read(fn: (buf: ArrayBuffer) => void): boolean;
}

/** The reading side: keeps only the newest frame and returns every other buffer to its owner. */
export function makeLatest(port: Port): Latest {
  let newest: ArrayBuffer | null = null;
  return {
    put(buf) {
      if (newest) port.postMessage({ type: "back", buf: newest }, { transfer: [newest] });
      newest = buf;
    },
    read(fn) {
      if (!newest) return false;
      const buf = newest;
      newest = null;
      fn(buf);
      port.postMessage({ type: "back", buf }, { transfer: [buf] });
      return true;
    },
  };
}
