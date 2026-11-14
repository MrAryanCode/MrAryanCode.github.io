// The pointer motion rows (T-031; P-12, DV-01.1 motion table, DV-02.4, A-4): card tilt and glare (rank 1), card depth
// parallax (rank 5), the pointer ring and the magnetic primary buttons (rank 6), and the 404 link-row arrow (stays at
// every rank). `start` is synchronous apart from its return: it reads the level, attaches its listeners to `signal` and
// resolves at once, so tier 1 and the tiers above it are not held up. Everything it does is undone when `signal`
// aborts (Pause or reduced motion), and a second call after Play starts clean.
//
// Text may not move independently of the document (A-1 (1), (e)): the tilt is a transform on the card, which has an
// opaque surface; the magnet and the parallax use the `translate` property, which the button's own `transform`
// transition and its `:active` transform never touch, and which composes with the tilt on the same card.
import { level as currentLevel, onLevel } from "../budget.ts";
import {
  ARROW_SPRING,
  BUTTON_SPRING,
  RING_MAX_DT,
  bake,
  createRingAxis,
  createSpring,
  retarget,
  ringStep,
  type RingAxis,
  type Spring,
} from "../spring.ts";

// The mockup's gains (home-03 bundle): the tilt peaks at the card's edge at 2 deg by 2.5 deg, inside the table's 4 deg by 5 deg.
const TILT_MAX_X = 2; // deg
const TILT_MAX_Y = 2.5; // deg
const TILT_PERSPECTIVE = 1100; // px
const TILT_FOLLOW = "transform 0.14s ease-out";
const TILT_RETURN_MS = 900;
const TILT_RETURN = `transform ${TILT_RETURN_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1)`;
const PARALLAX_MAX = 6; // px
const PARALLAX_GAIN = 10; // px per viewport of distance from the centre
const PARALLAX_CATCH_UP = "translate 0.9s ease-out";
const MAGNET_X = 5; // px
const MAGNET_Y = 4; // px
const ARROW_TRAVEL = 4; // px
const RING_SIZE = 28; // px
const RING_PAD_X = 14; // px
const RING_PAD_Y = 10; // px
const GLARE_RADIUS = 420; // px (DV-01.1: card glare, radial 420px)
const GLOW_RADIUS = 140; // px (DV-01.1: pointer glow, radial 140px)
const GLOW_DARK = "rgb(255 255 255 / 35%)";
const GLOW_LIGHT = "rgb(198 244 50 / 16%)";

const RANK_TILT = 1;
const RANK_PARALLAX = 5;
const RANK_RING_MAGNET = 6;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const asElement = (t: EventTarget | null): Element | null => (t instanceof Element ? t : null);
/** Touch has no hover: only a mouse or a pen drives these rows. */
const isFine = (e: PointerEvent): boolean => e.pointerType !== "touch";

/** The transition the element had before any inline one of ours, so the tilt does not replace it. */
function baseTransition(el: HTMLElement): string {
  const t = getComputedStyle(el).transition;
  return /^all 0s\b/.test(t) ? "" : t;
}

interface Card {
  el: HTMLElement;
  base: string;
  /** Whether the tilt is engaged, being returned, or idle. */
  tilt: "idle" | "follow" | "return";
  parallax: boolean;
  /** Whether the parallax has written to the card yet: not before the first scroll, so a page at rest is not touched. */
  armed: boolean;
  rect: DOMRect | null;
  glare: HTMLElement | null;
  timer: number;
  /** Document position of the centre, measured at rest, for the parallax. */
  centreY: number;
  /** The parallax offset last written, px. */
  shift: number;
}

export function start(root: HTMLElement, signal: AbortSignal): Promise<void> {
  // No body means a host with no page to move (the loader's unit test stubs `document` without one): nothing to start.
  if (signal.aborted || !document.body) return Promise.resolve();
  const cards = new Map<HTMLElement, Card>();
  let tiltOn = false;
  let parallaxOn = false;
  let ringOn = false; // the ring and the magnet share rank 6
  let hoverTilt: Card | null = null;
  let hoverMagnet: Magnet | null = null;

  // ---- cards: tilt, glare and parallax -------------------------------------------------------------------------------

  function card(el: HTMLElement): Card {
    let c = cards.get(el);
    if (!c) {
      c = { el, base: baseTransition(el), tilt: "idle", parallax: false, armed: false, rect: null, glare: null, timer: 0, centreY: 0, shift: 0 };
      cards.set(el, c);
    }
    return c;
  }

  function writeTransition(c: Card): void {
    const parts = [];
    if (c.base) parts.push(c.base);
    if (c.tilt === "follow") parts.push(TILT_FOLLOW);
    else if (c.tilt === "return") parts.push(TILT_RETURN);
    if (c.parallax && c.armed) parts.push(PARALLAX_CATCH_UP);
    c.el.style.transition = parts.join(", ");
  }

  function makeGlare(c: Card): HTMLElement {
    const g = document.createElement("span");
    g.setAttribute("aria-hidden", "true");
    g.dataset.fx = "glare";
    g.style.cssText = "position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0";
    c.el.insertBefore(g, c.el.firstChild); // first, so the text and the ticks paint above it
    return g;
  }

  function dropGlare(c: Card): void {
    c.glare?.remove();
    c.glare = null;
  }

  function engage(c: Card): void {
    clearTimeout(c.timer);
    c.tilt = "follow";
    c.rect = c.el.getBoundingClientRect();
    writeTransition(c);
    if (!c.glare) {
      c.glare = makeGlare(c);
      void c.glare.offsetWidth; // the glare must exist at opacity 0 before it fades in
    }
    c.glare.style.transition = "opacity 0.14s ease-out";
    c.glare.style.opacity = "1";
  }

  function tiltTo(c: Card, e: PointerEvent): void {
    const r = (c.rect ??= c.el.getBoundingClientRect());
    if (r.width === 0 || r.height === 0) return;
    const nx = clamp((e.clientX - r.left) / r.width, 0, 1);
    const ny = clamp((e.clientY - r.top) / r.height, 0, 1);
    const ry = (nx - 0.5) * 2 * TILT_MAX_Y;
    const rx = -(ny - 0.5) * 2 * TILT_MAX_X;
    c.el.style.transform = `perspective(${TILT_PERSPECTIVE}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
    if (c.glare) c.glare.style.backgroundImage = `radial-gradient(circle ${GLARE_RADIUS}px at ${(nx * 100).toFixed(1)}% ${(ny * 100).toFixed(1)}%, var(--glare), transparent 65%)`;
  }

  /** The soft ease-out return to rest, then the glare is removed. */
  function release(c: Card): void {
    if (c.tilt !== "follow") return;
    c.tilt = "return";
    writeTransition(c);
    c.el.style.transform = "";
    if (c.glare) {
      c.glare.style.transition = `opacity ${TILT_RETURN_MS}ms ease-out`;
      c.glare.style.opacity = "0";
    }
    c.timer = window.setTimeout(() => {
      c.tilt = "idle";
      writeTransition(c);
      dropGlare(c);
    }, TILT_RETURN_MS + 50);
  }

  function moveTilt(e: PointerEvent, target: Element | null): void {
    const el = target?.closest<HTMLElement>("[data-fx~=tilt]") ?? null;
    if (hoverTilt && hoverTilt.el !== el) {
      release(hoverTilt);
      hoverTilt = null;
    }
    if (!el) return;
    const c = card(el);
    if (hoverTilt !== c) {
      hoverTilt = c;
      engage(c);
    }
    tiltTo(c, e);
  }

  /** Measures each parallax card's centre in the document from where it is now, less the offset it carries. */
  function measureParallax(): void {
    for (const c of cards.values()) {
      if (!c.parallax) continue;
      const r = c.el.getBoundingClientRect();
      c.centreY = r.top + r.height / 2 + scrollY - c.shift;
    }
  }

  function parallaxFrame(): void {
    if (!parallaxOn) return;
    const half = innerHeight / 2;
    for (const c of cards.values()) {
      if (!c.parallax) continue;
      // A card below the centre moves up (the mockup's sign).
      const shift = clamp(-((c.centreY - scrollY - half) / innerHeight) * PARALLAX_GAIN, -PARALLAX_MAX, PARALLAX_MAX);
      if (Math.abs(shift - c.shift) < 0.05) continue;
      c.shift = shift;
      if (!c.armed) {
        // The catch-up transition is in place, and flushed, before the first offset is written, so the first scroll eases in.
        c.armed = true;
        writeTransition(c);
        void getComputedStyle(c.el).translate;
      }
      c.el.style.translate = `0 ${shift.toFixed(2)}px`;
    }
  }

  let parallaxQueued = 0;
  function queueParallax(): void {
    if (!parallaxOn || parallaxQueued) return;
    parallaxQueued = requestAnimationFrame(() => {
      parallaxQueued = 0;
      parallaxFrame();
    });
  }

  function startParallax(): void {
    for (const el of root.querySelectorAll<HTMLElement>("[data-fx~=parallax]")) {
      const c = card(el);
      c.parallax = true;
    }
    measureParallax(); // measured now; nothing is written until the page scrolls
  }

  function stopParallax(): void {
    for (const c of cards.values()) {
      if (!c.parallax) continue;
      const touched = c.armed;
      c.parallax = false;
      c.armed = false;
      c.shift = 0;
      if (touched) {
        writeTransition(c);
        c.el.style.translate = "";
      }
    }
  }

  // ---- magnetic primary buttons --------------------------------------------------------------------------------------

  interface Magnet {
    el: HTMLElement;
    dx: number;
    dy: number;
    anim: Animation | null;
  }
  const magnets = new Map<HTMLElement, Magnet>();
  const dark = matchMedia("(prefers-color-scheme: dark)");

  function magnet(el: HTMLElement): Magnet {
    let m = magnets.get(el);
    if (!m) {
      m = { el, dx: 0, dy: 0, anim: null };
      magnets.set(el, m);
    }
    return m;
  }

  function moveMagnet(e: PointerEvent, target: Element | null): void {
    const el = target?.closest<HTMLElement>("[data-fx~=magnet]") ?? null;
    if (hoverMagnet && hoverMagnet.el !== el) {
      returnMagnet(hoverMagnet);
      hoverMagnet = null;
    }
    if (!el) return;
    const m = magnet(el);
    if (hoverMagnet !== m) {
      hoverMagnet = m;
      m.anim?.cancel(); // re-entering during the return resumes the direct follow
      m.anim = null;
    }
    const r = el.getBoundingClientRect();
    // The offset the button carries now is known, so the centre it would have at rest is too.
    const cx = r.left - m.dx + r.width / 2;
    const cy = r.top - m.dy + r.height / 2;
    m.dx = clamp(((e.clientX - cx) / (r.width / 2)) * MAGNET_X, -MAGNET_X, MAGNET_X);
    m.dy = clamp(((e.clientY - cy) / (r.height / 2)) * MAGNET_Y, -MAGNET_Y, MAGNET_Y);
    el.style.translate = `${m.dx.toFixed(2)}px ${m.dy.toFixed(2)}px`;
    // The glow spot follows the pointer. It is a background-image only, so the pill keeps its opaque background-color (A-1 (e)).
    el.style.backgroundImage = `radial-gradient(circle ${GLOW_RADIUS}px at ${(e.clientX - r.left).toFixed(1)}px ${(e.clientY - r.top).toFixed(1)}px, ${dark.matches ? GLOW_DARK : GLOW_LIGHT}, transparent 70%)`;
  }

  /** A-4: from the current offset with no velocity the spring runs along a straight line, so one bake on its length. */
  function returnMagnet(m: Magnet): void {
    const length = Math.hypot(m.dx, m.dy);
    const from = `${m.dx.toFixed(2)}px ${m.dy.toFixed(2)}px`;
    m.dx = 0;
    m.dy = 0;
    m.el.style.translate = "";
    m.el.style.backgroundImage = "";
    const b = length > 0.01 && CSS.supports("animation-timing-function", "linear(0, 1)") ? bake(BUTTON_SPRING.k, BUTTON_SPRING.c, length, 0) : null;
    if (!b) return;
    m.anim = m.el.animate([{ translate: from }, { translate: "0px 0px" }], { duration: b.durationMs, easing: b.easing });
  }

  function stopMagnet(): void {
    for (const m of magnets.values()) {
      m.anim?.cancel();
      m.anim = null;
      m.dx = 0;
      m.dy = 0;
      m.el.style.translate = "";
      m.el.style.backgroundImage = "";
    }
    magnets.clear();
    hoverMagnet = null;
  }

  // ---- pointer ring --------------------------------------------------------------------------------------------------

  let ring: HTMLElement | null = null;
  let ringId = 0;
  let ringLast = 0;
  let ringShown = false;
  const axes: { x: RingAxis; y: RingAxis; w: RingAxis; h: RingAxis } = {
    x: createRingAxis(0),
    y: createRingAxis(0),
    w: createRingAxis(RING_SIZE),
    h: createRingAxis(RING_SIZE),
  };
  const goal = { x: 0, y: 0, w: RING_SIZE, h: RING_SIZE, snapped: false };

  function makeRing(): HTMLElement {
    const el = document.createElement("div");
    el.setAttribute("aria-hidden", "true");
    el.dataset.fx = "ring";
    el.style.cssText =
      "position:fixed;left:0;top:0;z-index:30;pointer-events:none;box-sizing:border-box;border:1.5px solid var(--accent);" +
      "border-radius:999px;opacity:0;transition:border-radius 0.2s ease-out,opacity 0.15s ease-out;will-change:transform";
    document.body.append(el);
    return el;
  }

  function drawRing(): void {
    if (!ring) return;
    const w = Math.max(0, axes.w.x);
    const h = Math.max(0, axes.h.x);
    ring.style.width = `${w.toFixed(2)}px`;
    ring.style.height = `${h.toFixed(2)}px`;
    ring.style.transform = `translate(${(axes.x.x - w / 2).toFixed(2)}px, ${(axes.y.x - h / 2).toFixed(2)}px)`;
  }

  function ringSettled(): boolean {
    for (const a of [axes.x, axes.y, axes.w, axes.h]) {
      if (Math.abs(a.x - a.target) > 0.05 || Math.abs(a.v) > 0.5) return false;
    }
    return true;
  }

  function ringFrame(ts: number): void {
    ringId = 0;
    if (!ring) return;
    const dt = Math.max(0, Math.min((ts - ringLast) / 1000, RING_MAX_DT)); // rAF's timestamp can precede performance.now()
    ringLast = ts;
    ringStep(axes.x, goal.x, dt);
    ringStep(axes.y, goal.y, dt);
    ringStep(axes.w, goal.w, dt);
    ringStep(axes.h, goal.h, dt);
    drawRing();
    if (!ringSettled()) ringId = requestAnimationFrame(ringFrame);
  }

  function moveRing(e: PointerEvent, target: Element | null): void {
    const link = target?.closest("a, button") ?? null;
    if (link) {
      const r = link.getBoundingClientRect();
      goal.x = r.left + r.width / 2;
      goal.y = r.top + r.height / 2;
      goal.w = r.width + RING_PAD_X;
      goal.h = r.height + RING_PAD_Y;
    } else {
      goal.x = e.clientX;
      goal.y = e.clientY;
      goal.w = RING_SIZE;
      goal.h = RING_SIZE;
    }
    if (!ring) ring = makeRing();
    if (!ringShown) {
      // First sight of the pointer: the ring appears where it is, not flying in from the corner.
      for (const [a, v] of [[axes.x, goal.x], [axes.y, goal.y], [axes.w, goal.w], [axes.h, goal.h]] as const) {
        a.x = v;
        a.v = 0;
        a.target = v;
      }
      drawRing();
      ring.style.opacity = "1";
      ringShown = true;
    }
    if (goal.snapped !== !!link) {
      goal.snapped = !!link;
      ring.style.borderRadius = link ? "14px" : "999px";
    }
    if (!ringId) {
      ringLast = performance.now();
      ringId = requestAnimationFrame(ringFrame);
    }
  }

  function hideRing(): void {
    if (ring) ring.style.opacity = "0";
    ringShown = false;
  }

  function stopRing(): void {
    cancelAnimationFrame(ringId);
    ringId = 0;
    ring?.remove();
    ring = null;
    ringShown = false;
    goal.snapped = false;
  }

  // ---- the 404 link-row arrow (stays at every rank) ------------------------------------------------------------------

  const arrows: Spring[] = [];
  /** Puts the arrow at `target` with no motion, leaving its one animation finished there. */
  function snap(sp: Spring, target: number): void {
    const kf = { transform: `translateX(${target}px)` };
    const effect = sp.anim.effect as KeyframeEffect;
    effect.setKeyframes([kf, kf]);
    effect.updateTiming({ duration: 1, easing: "linear" });
    sp.anim.finish();
    sp.target = target;
    sp.u0 = 0;
    sp.v0 = 0;
    sp.T = 0;
  }
  function startArrows(): void {
    // Without `linear()` there is no baked spring: the arrow becomes instant (A-4), 4 px on hover or focus and 0 off them.
    const smooth = CSS.supports("animation-timing-function", "linear(0, 1)");
    for (const el of root.querySelectorAll<SVGElement>("[data-fx~=arrow]")) {
      const row = el.closest<HTMLElement>("a") ?? el.parentElement;
      if (!row) continue;
      const sp = createSpring(el, ARROW_SPRING.k, ARROW_SPRING.c);
      arrows.push(sp);
      // Tier 1 can start with the pointer already over the row (Play after Pause, or reduced motion switched off), when no
      // pointerenter will come: read the state, and show the 4 px the stylesheet was holding with no jump to 0 (DV-02.4, A-4).
      let hover = row.matches(":hover");
      let focus = row.matches(":focus-visible");
      let tap = false;
      if (hover || focus) snap(sp, ARROW_TRAVEL);
      // A touch tap shows the arrow at once (DV-02.5 phone column): no spring.
      const aim = (instant: boolean): void => {
        const to = hover || focus || tap ? ARROW_TRAVEL : 0;
        if (to === sp.target) return;
        if (instant || !smooth) snap(sp, to);
        else retarget(sp, to);
      };
      const on = { signal };
      row.addEventListener("pointerenter", (e) => { if (isFine(e)) hover = true; else tap = true; aim(!isFine(e)); }, on);
      row.addEventListener("pointerleave", (e) => { if (isFine(e)) hover = false; else tap = false; aim(!isFine(e)); }, on);
      row.addEventListener("focusin", () => { focus = row.matches(":focus-visible"); aim(false); }, on);
      row.addEventListener("focusout", () => { focus = false; aim(false); }, on);
    }
  }

  // ---- the rows' ranks ---------------------------------------------------------------------------------------------

  function setLevel(level: number): void {
    const tilt = level < RANK_TILT;
    const parallax = level < RANK_PARALLAX;
    const pointer = level < RANK_RING_MAGNET;
    if (tiltOn && !tilt && hoverTilt) {
      release(hoverTilt);
      hoverTilt = null;
    }
    tiltOn = tilt;
    if (parallax && !parallaxOn) {
      parallaxOn = true;
      startParallax();
    } else if (!parallax && parallaxOn) {
      parallaxOn = false;
      stopParallax();
    }
    if (ringOn && !pointer) {
      stopRing();
      stopMagnet();
    }
    ringOn = pointer;
  }

  // ---- listeners -----------------------------------------------------------------------------------------------------

  const on = { signal, passive: true } as const;
  document.addEventListener("pointermove", (e) => {
    if (!isFine(e)) return;
    const target = asElement(e.target);
    if (ringOn) moveRing(e, target);
    if (ringOn) moveMagnet(e, target);
    if (tiltOn) moveTilt(e, target);
  }, on);
  // The pointer left the window: nothing is hovered any more.
  document.documentElement.addEventListener("pointerleave", (e) => {
    if (!isFine(e)) return;
    if (hoverTilt) release(hoverTilt);
    hoverTilt = null;
    if (hoverMagnet) returnMagnet(hoverMagnet);
    hoverMagnet = null;
    hideRing();
  }, on);
  addEventListener("scroll", () => {
    for (const c of cards.values()) c.rect = null;
    queueParallax();
  }, on);
  const resized = new ResizeObserver(() => {
    for (const c of cards.values()) c.rect = null;
    if (parallaxOn) {
      measureParallax();
      if ([...cards.values()].some((c) => c.armed)) queueParallax(); // a page that has not scrolled is left alone
    }
  });
  resized.observe(document.body);

  const stopLevel = onLevel(setLevel);
  setLevel(currentLevel());
  startArrows();

  signal.addEventListener("abort", () => {
    stopLevel();
    resized.disconnect();
    cancelAnimationFrame(parallaxQueued);
    parallaxOn = false;
    tiltOn = false;
    ringOn = false;
    stopRing();
    stopMagnet();
    for (const c of cards.values()) {
      clearTimeout(c.timer);
      // No transition may start from the reset: it is written with transitions off and flushed before they return.
      c.el.style.transition = "none";
      c.el.style.transform = "";
      c.el.style.translate = "";
      dropGlare(c);
      void getComputedStyle(c.el).transform;
      c.el.style.removeProperty("transition");
    }
    cards.clear();
    hoverTilt = null;
    for (const sp of arrows) sp.anim.cancel();
    arrows.length = 0;
  }, { once: true });
  return Promise.resolve();
}
