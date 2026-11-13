import { Show } from "solid-js";
import { formatCount, formatUtc, type Facts } from "../facts";

// The signed step 3 copy of the certway facts (design.md DS-03, D-025).
const COPY_AT_STEP_3_LIVE_FAIL_NOTE = "Live facts could not be read. Showing the facts from when this page was built.";

/**
 * The certway facts: the facts box, the live-read failure note and the as-of line (design.md DS-03).
 * The card around it (heading, summary, links) belongs to the page. Receives the build-time data as a prop; fetches nothing.
 * Each fact is plain text on its own [data-fact] element, so the live update (T-027) and the digit roll (T-034) can find it.
 */
export function FactsCard(props: { facts: Facts }) {
  return (
    <>
      <dl class="tiles home-facts" data-fx="tiles">
        <div class="tile">
          <dt class="tile-label">Latest release</dt>
          <dd class="tile-value"><a data-fact="tag" href={props.facts.release.url}>{props.facts.release.tag}</a></dd>
        </div>
        {/* A repository without a license has no row (design.md DS-03, Empty). */}
        <Show when={props.facts.repo.license}>
          {(license) => (
            <div class="tile">
              <dt class="tile-label">License</dt>
              <dd class="tile-value"><span data-fact="license">{license()}</span></dd>
            </div>
          )}
        </Show>
        <div class="tile">
          <dt class="tile-label">Stars</dt>
          <dd class="tile-value"><span data-fact="stars">{formatCount(props.facts.repo.stars)}</span></dd>
        </div>
        <div class="tile">
          <dt class="tile-label">Last push</dt>
          <dd class="tile-value"><span data-fact="pushedAt">{props.facts.repo.pushedAt.slice(0, 10)}</span></dd>
        </div>
      </dl>
      {/* Hidden in the prerendered HTML; the live read (T-027) unhides it when it fails (P-06.4a). */}
      <p class="failed-note" role="status" data-live-fail hidden>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v6M12 16.5v.5" />
        </svg>
        {COPY_AT_STEP_3_LIVE_FAIL_NOTE}
      </p>
      <p class="muted">
        Facts from the GitHub API as of <time data-as-of datetime={props.facts.asOf}>{formatUtc(props.facts.asOf)}</time>, when this page was built.
      </p>
    </>
  );
}
