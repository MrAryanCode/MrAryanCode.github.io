// The enhancement loader (P-06.5). It runs after hydrate() and the first paint, decides the tier, creates the pause
// control and passes its signal to every tier. Any failure leaves the static page and logs nothing as an error.
import { PLAY_EVENT, createPause } from "./pause";

interface Tier { start(root: HTMLElement, signal: AbortSignal): Promise<boolean> }
interface GpuNavigator { gpu?: { requestAdapter(): Promise<unknown> } }

const REDUCED = "(prefers-reduced-motion: reduce)";

async function webgpuOrWebgl2(): Promise<boolean> {
  const gpu = (navigator as unknown as GpuNavigator).gpu;
  if (gpu) {
    try {
      if (await gpu.requestAdapter()) return true;
    } catch {
      // A rejected adapter request means no WebGPU: fall through to WebGL2.
    }
  }
  return typeof OffscreenCanvas !== "undefined" && new OffscreenCanvas(1, 1).getContext("webgl2") !== null;
}

/** One run of the loader: tier 1, then 2, then 3, each only when the one below started. */
async function run(root: HTMLElement, reduce: AbortController): Promise<void> {
  const html = document.documentElement;
  try {
    const signal = AbortSignal.any([createPause(root), reduce.signal]);
    html.dataset.tier = "0";
    signal.addEventListener("abort", () => { html.dataset.tier = "0"; });
    if (signal.aborted) return;
    const tier1: Tier = await import("./motion/tier1");
    if (signal.aborted || !(await tier1.start(root, signal))) return;
    html.dataset.tier = "1";
    if (typeof Worker === "undefined") return;
    const tier2: Tier = await import("./workers/tier2");
    if (signal.aborted || !(await tier2.start(root, signal))) return;
    html.dataset.tier = "2";
    if (!(await webgpuOrWebgl2()) || signal.aborted) return;
    const tier3: Tier = await import("./gpu/tier3");
    if (signal.aborted || !(await tier3.start(root, signal))) return;
    html.dataset.tier = "3";
  } catch {
    // A tier that fails to load or start leaves the page at the tier below it.
  }
}

/** Starts the loader. Reduced motion stops at tier 0 with no button; the preference is read live. */
export function enhance(root: HTMLElement): void {
  requestAnimationFrame(() => setTimeout(() => {
    const media = matchMedia(REDUCED);
    if (media.matches) {
      document.documentElement.dataset.tier = "0";
      return;
    }
    let reduce = new AbortController();
    media.addEventListener("change", () => { if (media.matches) reduce.abort(); });
    root.addEventListener(PLAY_EVENT, () => {
      if (media.matches) return;
      reduce = new AbortController();
      void run(root, reduce);
    });
    void run(root, reduce);
  }, 0));
}
