// Live facts in the browser (C-10, D-019, D-025): after hydration the certway facts are read again from the GitHub API
// and replace the prerendered ones only when both calls succeeded. Algorithm: algorithms.md A-6.
// Nothing here logs, throws or touches `window` or `document` at module level.
import { applyLive, loadLiveFacts, type Facts } from "./facts/github-facts.ts";
import { formatCount, formatUtc } from "./facts.ts";

// The signed step 3 copy of the as-of line, live wording (design.md DS-03, D-025). The build wording is FactsCard's.
const COPY_AT_STEP_3_AS_OF_LIVE_LEAD = "Facts read live from the GitHub API at ";
const COPY_AT_STEP_3_AS_OF_LIVE_TAIL = ".";

// The rate-limit stop carried to later pages of the same tab (github-api-rate-limit-carry-across-pages).
const KEY = "gh-api-rate-reset";
// A-6: the stored stop is clamped to between 60 s and 3,600 s after the page's own clock, so a wrong visitor clock
// costs at most one hour of build facts.
const MIN_STOP_S = 60;
const MAX_STOP_S = 3600;

function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** The stop time in epoch seconds, or null when no stop applies. A malformed stored value is removed. Never throws. */
function readCarriedReset(nowMs: number): number | null {
  const s = store();
  if (!s) return null;
  let raw: string | null;
  try {
    raw = s.getItem(KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const sec = Number(raw);
  if (!Number.isInteger(sec) || sec <= 0) {
    try {
      s.removeItem(KEY);
    } catch {
      /* ignore */
    }
    return null;
  }
  return sec * 1000 > nowMs ? sec : null;
}

/** Stores the stop. A blocked or full storage is ignored: the stop then holds for this page view only. Never throws. */
function writeCarriedReset(resetSec: number): void {
  const s = store();
  if (!s) return;
  try {
    s.setItem(KEY, String(resetSec));
  } catch {
    /* ignore */
  }
}

/** The reset time in epoch seconds, clamped to between now + 60 s and now + 3,600 s on the page's clock. */
function stopUntil(resetAt: Date, nowMs: number): number {
  const now = Math.floor(nowMs / 1000);
  return Math.min(Math.max(Math.floor(resetAt.getTime() / 1000), now + MIN_STOP_S), now + MAX_STOP_S);
}

/** One update: every [data-fact] element, the as-of time and the as-of sentence change together. The region is not a live region. */
function render(root: ParentNode, facts: Facts): void {
  const fact = (name: string) => root.querySelector<HTMLElement>(`[data-fact="${name}"]`);
  const tag = fact("tag");
  if (tag) {
    tag.textContent = facts.release.tag;
    tag.setAttribute("href", facts.release.url);
  }
  const license = fact("license");
  if (license) {
    // A live license of null hides the License row; a build without a license has no row to show.
    if (facts.repo.license === null) license.closest(".tile")?.setAttribute("hidden", "");
    else license.textContent = facts.repo.license;
  }
  const stars = fact("stars");
  if (stars) stars.textContent = formatCount(facts.repo.stars);
  const pushedAt = fact("pushedAt");
  if (pushedAt) pushedAt.textContent = facts.repo.pushedAt.slice(0, 10);
  const time = root.querySelector<HTMLTimeElement>("time[data-as-of]");
  if (time) {
    time.setAttribute("datetime", facts.asOf);
    time.textContent = formatUtc(facts.asOf);
    time.parentElement?.replaceChildren(COPY_AT_STEP_3_AS_OF_LIVE_LEAD, time, COPY_AT_STEP_3_AS_OF_LIVE_TAIL);
  }
}

/** The failure note (D-025): shown once per page view for a failed, partial or skipped read; nothing removes it. */
function showNote(root: ParentNode): void {
  root.querySelector("p[data-live-fail]")?.removeAttribute("hidden");
}

/**
 * Reads the certway facts live and updates `root`. Returns the new facts, or the very same `build` object when nothing
 * changed. Called once per page view, after `hydrate()` has returned. A root with no [data-fact] element (the report
 * and 404 pages) makes no request.
 */
export async function runLiveFacts(build: Facts, root: ParentNode): Promise<Facts> {
  if (!root.querySelector("[data-fact]")) return build;
  if (readCarriedReset(Date.now()) !== null) {
    showNote(root);
    return build;
  }
  const live = await loadLiveFacts("MrAryanCode/certway", 8000);
  const nowMs = Date.now();
  for (const part of [live.repo, live.release]) {
    if (!part.ok && part.reason === "rate-limited" && part.rate?.resetAt) {
      writeCarriedReset(stopUntil(part.rate.resetAt, nowMs));
    }
  }
  const facts = applyLive(build, live, new Date(nowMs));
  if (facts === build) {
    showNote(root);
    return build;
  }
  render(root, facts);
  return facts;
}
