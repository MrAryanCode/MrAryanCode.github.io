// Tier 1 entry (motion): starts the step-down controller (A-3) and the effects (T-031). `start` resolves true when
// tier 1 runs and false when it declines. Reduced motion is read live; pause and reduced motion abort `signal`.
import { frame, interval, reset, start as startBudget } from "./budget.ts";
import { startEffects } from "./effects.ts";

const REDUCED = "(prefers-reduced-motion: reduce)";

// Learns the display interval while the page is light: after the fonts are ready, before the field draws its first
// frame. The loop ends as soon as the controller knows the interval, or when `signal` aborts.
async function learnInterval(signal: AbortSignal): Promise<void> {
  try {
    await document.fonts?.ready;
  } catch {
    // A failed font load does not stop the measurement.
  }
  if (signal.aborted || interval() > 0) return;
  let id = 0;
  const tick = (ts: number): void => {
    frame(ts);
    if (interval() === 0) id = requestAnimationFrame(tick);
  };
  signal.addEventListener("abort", () => cancelAnimationFrame(id), { once: true });
  id = requestAnimationFrame(tick);
}

export async function start(root: HTMLElement, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted || matchMedia(REDUCED).matches) return false;
  startBudget();
  // The evidence of the monitor is discarded when the page was hidden or restored (A-3 reset events).
  const onVisibility = (): void => reset();
  const onPageShow = (e: PageTransitionEvent): void => { if (e.persisted) reset(); };
  document.addEventListener("visibilitychange", onVisibility);
  addEventListener("pageshow", onPageShow);
  signal.addEventListener("abort", () => {
    document.removeEventListener("visibilitychange", onVisibility);
    removeEventListener("pageshow", onPageShow);
  }, { once: true });
  void learnInterval(signal);
  await startEffects(root, signal);
  return true;
}
