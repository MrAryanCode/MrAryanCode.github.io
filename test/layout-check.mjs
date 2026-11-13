// The A-1 (e) layout check (algorithms.md A-1 (1) and (e); D-051, D-053 item 4 as amended), exported so the effects tasks
// (T-031, T-033, T-034) can import it and run it while they trigger their own motion.
//
// The field draws from the text's rectangles measured at rest, so no text may move independently of the document:
//  - no text under position: sticky or fixed;
//  - no text under a transform, translate, rotate or scale, outside the two D-051 exceptions:
//    (i) the transformed element has, at or inside it and above the text, an ancestor with an opaque background colour
//        (the field is not visible behind that text), or
//    (ii) the transformed element carries data-fx="arrow" and its travel at the moment of the check is at most 4 px
//        (the 404 link-row arrow; the zone's 10 px padding still covers it).
// "Text" is a non-empty text node or a non-empty CSS-generated ::before or ::after content (the roll digits).
import assert from "node:assert/strict";

/** Runs in the page: returns the zone count before merging and the elements that break a rule. */
function scan() {
  const ARROW_TRAVEL_PX = 4;
  const rect = (el) => el.getBoundingClientRect();
  const opaque = (el) => {
    const m = /^rgba?\(([^)]*)\)$/.exec(getComputedStyle(el).backgroundColor);
    if (!m) return false;
    const parts = m[1].split(/[ ,/]+/).filter(Boolean);
    return parts.length < 4 || Number(parts[3]) === 1;
  };
  const generated = (el, which) => {
    const c = getComputedStyle(el, which).content;
    return c !== "none" && c !== "normal" && c !== '""' && c !== "''" && c !== "";
  };
  const name = (el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""}`;
  // The text carried by an element itself: its own non-empty text nodes, and generated content on it.
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim() !== "") || generated(el, "::before") || generated(el, "::after");
  const carriesText = (el) => ownText(el) || [...el.querySelectorAll("*")].some(ownText);
  const moves = (cs) => cs.transform !== "none" || (cs.translate && cs.translate !== "none") || (cs.rotate && cs.rotate !== "none") || (cs.scale && cs.scale !== "none");
  /** The translation of the element's transform, in px (the largest of x and y), from its computed matrix. */
  const travel = (cs) => {
    const m = /^matrix\(([^)]*)\)$/.exec(cs.transform);
    if (!m) return cs.transform === "none" ? 0 : Infinity;
    const v = m[1].split(",").map(Number);
    return Math.max(Math.abs(v[4]), Math.abs(v[5]));
  };

  const violations = [];
  const transformed = [];
  let zones = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.data.trim() === "") continue;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) zones++;
  }
  for (const el of document.body.querySelectorAll("*")) {
    if (el.closest("[aria-hidden='true'] canvas") || el.tagName === "SCRIPT" || el.tagName === "STYLE") continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none") continue;
    for (const which of ["::before", "::after"]) if (generated(el, which)) zones++;
    if (!carriesText(el)) continue;
    if (cs.position === "sticky" || cs.position === "fixed") violations.push(`${name(el)}: position ${cs.position}`);
    if (!moves(cs)) continue;
    // A transformed element that carries text: look for the exception.
    let why = null;
    if (el.getAttribute("data-fx") === "arrow") {
      if (travel(cs) <= ARROW_TRAVEL_PX) why = "arrow";
      else violations.push(`${name(el)}: data-fx="arrow" travels ${travel(cs).toFixed(1)} px, more than ${ARROW_TRAVEL_PX}`);
      if (why) transformed.push({ el: name(el), why });
      continue;
    }
    // Every text carrier at or inside the transformed element needs an opaque background between it and the element.
    const carriers = [el, ...el.querySelectorAll("*")].filter(ownText);
    const bare = carriers.filter((c) => {
      for (let a = c; a; a = a.parentElement) {
        if (opaque(a)) return false;
        if (a === el) return true;
      }
      return true;
    });
    if (bare.length === 0) transformed.push({ el: name(el), why: "opaque" });
    else violations.push(`${name(el)}: transformed text without an opaque background: ${bare.slice(0, 3).map(name).join(", ")}`);
  }
  return { zones, transformed, violations: [...new Set(violations)] };
}

/** Scans the page as it is now. Returns { zones, transformed, violations }; logs the zone count before merging. */
export async function layoutCheck(page, label = "") {
  const out = await page.evaluate(scan);
  console.log(`layout-check ${label || page.url()}: ${out.zones} text zones before merging, ${out.transformed.length} transformed text elements with an exception`);
  return out;
}

/** layoutCheck, asserting that no rule is broken. */
export async function assertLayout(page, label = "") {
  const out = await layoutCheck(page, label);
  assert.deepEqual(out.violations, [], `${label}: text that moves independently of the document`);
  return out;
}
