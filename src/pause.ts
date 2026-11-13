// The page-level pause control (P-06.5, D-023, D-051). Browser-only: nothing here runs during the prerender.
const KEY = "motion-paused";
export const PLAY_EVENT = "motion-play";
const MORPH_MS = 360;

// The two polygons of the icon, on a 16 x 16 box. Both states have four points per polygon, so clip-path interpolates.
const BARS = ["polygon(3px 2px, 7px 2px, 7px 14px, 3px 14px)", "polygon(9px 2px, 13px 2px, 13px 14px, 9px 14px)"];
const TRIANGLE = ["polygon(3px 2px, 8.5px 5px, 8.5px 11px, 3px 14px)", "polygon(8.5px 5px, 14px 8px, 14px 8px, 8.5px 11px)"];

// Storage can be blocked: every access sits inside try, nothing is logged, and the choice then holds for the page view
// only, because `paused` below stays the truth for this page.
function readStored(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
function writeStored(paused: boolean): void {
  try {
    if (paused) sessionStorage.setItem(KEY, "1");
    else sessionStorage.removeItem(KEY);
  } catch {
    // Blocked storage: the choice holds for this page view only.
  }
}

let paused = false;
let controller = new AbortController();
let button: HTMLButtonElement | null = null;
let label: HTMLSpanElement;
let bars: HTMLSpanElement[];

function polygonSpan(clip: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.style.cssText = "position:absolute;inset:0;background:currentColor";
  span.style.clipPath = clip;
  return span;
}

function build(): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "pause";
  const icon = document.createElement("span");
  icon.setAttribute("aria-hidden", "true");
  icon.style.cssText = "position:relative;display:block;width:16px;height:16px";
  bars = BARS.map(polygonSpan);
  icon.append(...bars);
  label = document.createElement("span");
  label.style.minWidth = "12ch"; // "Pause motion" and "Play motion" share one cell, so the width never changes
  el.append(icon, label);
  el.addEventListener("click", press);
  return el;
}

// Shows the state: the label, aria-pressed, <html data-motion> and the icon. The icon shows the action the press
// performs, so it is the triangle while paused and the two bars while running.
function render(pressed: boolean): void {
  const html = document.documentElement;
  if (paused) html.dataset.motion = "paused";
  else if (pressed) delete html.dataset.motion; // the first render of a running page leaves the attribute alone
  button!.setAttribute("aria-pressed", String(paused));
  label.textContent = paused ? "Play motion" : "Pause motion";
  const to = paused ? TRIANGLE : BARS;
  const from = paused ? BARS : TRIANGLE;
  const motion = pressed && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  bars.forEach((span, i) => {
    span.style.clipPath = to[i];
    if (motion) span.animate([{ clipPath: from[i] }, { clipPath: to[i] }], { duration: MORPH_MS, easing: "ease-in-out" });
  });
}

function press(): void {
  paused = !paused;
  writeStored(paused);
  render(true);
  if (paused) controller.abort();
  else button!.dispatchEvent(new Event(PLAY_EVENT, { bubbles: true }));
}

/**
 * Creates the pause button in the header (once) and returns a fresh signal for one run of the loader.
 * The signal is aborted when the visitor presses Pause, and already aborted when the page starts paused
 * (`motion-paused` = `1` in sessionStorage). Pressing Play dispatches a `motion-play` event on the button, which
 * bubbles to `root`: the loader listens for it and starts again from tier 1 with a new call of this function.
 */
export function createPause(root: HTMLElement): AbortSignal {
  if (!button) {
    paused = readStored();
    button = build();
    render(false);
    root.querySelector(".pause-slot")!.append(button); // the slot sits before "Message me" in the tab order
  }
  controller = new AbortController();
  if (paused) controller.abort();
  return controller.signal;
}
