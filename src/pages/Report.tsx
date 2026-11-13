import { Show, type JSX } from "solid-js";
import { isServer } from "solid-js/web";
import type { Build } from "../facts";
import { COPY_AT_STEP_3_SITE_CHECKS } from "../content/identity";

// Signed step 3 copy of the report (design.md DS-00, DS-09). The names and order of the six checks, and the file each is
// defined in, come from COPY_AT_STEP_3_SITE_CHECKS, so the home page card and this page cannot name a check differently.
const COPY_AT_STEP_3_REPORT_TITLE = "Engineering report";
const COPY_AT_STEP_3_REPORT_LEAD = "How this site is built: the checks every deploy must pass, with the numbers from the build you are reading.";
const COPY_AT_STEP_3_REPORT_ACCEPTANCE_NOTE = "Each test runs once in each browser, so these counts are runs.";
const COPY_AT_STEP_3_REPORT_PERFORMANCE_NOTE = "Median of 3 runs per page, mobile, simulated throttling.";
const COPY_AT_STEP_3_REPORT_TABLE_CAPTION = "Per page, median run";

const REPO_URL = "https://github.com/MrAryanCode/MrAryanCode.github.io";

/** Where the numbers on this page come from: the full commit, and the CI run (null for a local build). */
interface Source {
  sha: string | null;
  runUrl: string | null;
}

/**
 * The commit and the CI run, read the same way on both sides so the markup hydrates unchanged (D-031 item 6).
 * The server reads the environment of the build; the browser has no environment, so it takes the commit from the build
 * data the page carries (#site-data) and the run URL back from the run link the server wrote into the HTML.
 * A page without a commit has no run line, whatever GITHUB_RUN_ID says.
 */
function readSource(): Source {
  if (isServer) {
    const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
    const { GITHUB_SHA: sha, GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: run } = env;
    if (!sha) return { sha: null, runUrl: null };
    return { sha, runUrl: server && repository && run ? `${server}/${repository}/actions/runs/${run}` : null };
  }
  const data = JSON.parse(document.getElementById("site-data")!.textContent!) as { build: Build | null };
  if (!data.build) return { sha: null, runUrl: null };
  return { sha: data.build.sha, runUrl: document.querySelector("a[data-run-link]")?.getAttribute("href") ?? null };
}

/** The link to a commit, as the footer stamp writes it: the first seven characters of the commit. */
function CommitLink(props: { sha: string }) {
  return <a href={`${REPO_URL}/commit/${props.sha}`}>{props.sha.slice(0, 7)}</a>;
}

/** One value tile. The numbers inside are static `__NAME__` placeholders that scripts/inject-report.cjs replaces. */
function Tile(props: { label: string; children: JSX.Element }) {
  return (
    <div class="tile">
      <dt class="tile-label">{props.label}</dt>
      <dd class="tile-value">{props.children}</dd>
    </div>
  );
}

/** One check: its heading row, an optional note, the tiles or table, and the link to the file that defines the check. */
function Check(props: { index: number; sha: string | null; note?: string; children: JSX.Element }) {
  const check = COPY_AT_STEP_3_SITE_CHECKS[props.index];
  return (
    <section class="section panel panel-plain check" data-fx="tiles">
      <div class="check-head">
        <div class="heading-row" data-fx="scan">
          <span class="index" aria-hidden="true"></span>
          <h2>{check.text}</h2>
        </div>
        <Show when={props.note}>{(note) => <p class="check-note">{note()}</p>}</Show>
      </div>
      {props.children}
      <div class="defined-in">
        <span>Defined in</span>
        {/* A local build has no commit to link to, so the path is plain text. */}
        <Show when={props.sha} fallback={<span>{check.file}</span>}>
          {(sha) => <a href={`${REPO_URL}/blob/${sha()}/${check.file}`}>{check.file}</a>}
        </Show>
      </div>
    </section>
  );
}

/**
 * The engineering report (design.md DS-09, DV-02.3). Every number is a static `__NAME__` placeholder in literal text:
 * scripts/inject-report.cjs replaces them after the gates have run, and the page hydrates with the numbers in place.
 * The Lighthouse rows are written out, one per quality/pages.json entry, because the placeholders must stay literal.
 * Markup hooks for the motion tasks (P-12): data-field-kind on the band and the body, data-fx on the checks and their headings.
 */
export function Report() {
  const source = readSource();
  return (
    <>
      <div class="band" data-field-kind="7">
        <h1>{COPY_AT_STEP_3_REPORT_TITLE}</h1>
        <p class="lead">{COPY_AT_STEP_3_REPORT_LEAD}</p>
        <Show when={source.sha}>
          {(sha) => (
            <Show
              when={source.runUrl}
              fallback={
                <p class="pin" data-run-line>
                  Every number on this page comes from the local build of commit <CommitLink sha={sha()} />.
                </p>
              }
            >
              {(url) => (
                <p class="pin" data-run-line>
                  Every number on this page comes from <a href={url()} data-run-link>the CI run that built this page</a>, for commit <CommitLink sha={sha()} />.
                </p>
              )}
            </Show>
          )}
        </Show>
      </div>
      <section data-field-kind="6">
        <Check index={0} sha={source.sha}>
          <dl class="tiles">
            <Tile label="Passed">__UNIT_PASSED__ <span class="tile-of">of __UNIT_TOTAL__</span></Tile>
            <Tile label="Skipped">__UNIT_SKIPPED__</Tile>
          </dl>
        </Check>
        <Check index={1} sha={source.sha} note={COPY_AT_STEP_3_REPORT_ACCEPTANCE_NOTE}>
          <dl class="tiles">
            <Tile label="Passed">__ACCEPTANCE_PASSED__ <span class="tile-of">of __ACCEPTANCE_TOTAL__ runs</span></Tile>
            <Tile label="Flaky (passed on retry)">__ACCEPTANCE_FLAKY__</Tile>
            <Tile label="Skipped">__ACCEPTANCE_SKIPPED__</Tile>
          </dl>
        </Check>
        <Check index={2} sha={source.sha}>
          <dl class="tiles">
            <Tile label="Pages checked">__A11Y_PAGES__</Tile>
            <Tile label="Violations">__A11Y_VIOLATIONS__</Tile>
          </dl>
        </Check>
        <Check index={3} sha={source.sha} note={COPY_AT_STEP_3_REPORT_PERFORMANCE_NOTE}>
          <dl class="tiles">
            <Tile label="Assertions passed">__PERF_ASSERTIONS_PASSED__ <span class="tile-of">of __PERF_ASSERTIONS_TOTAL__</span></Tile>
          </dl>
          {/* From 480 px up, until the table fits, this box scrolls sideways: it is a focusable region so the keyboard can scroll it. */}
          <div class="table-scroll" role="region" aria-labelledby="perf-caption" tabindex="0">
            <table class="perf">
              <caption id="perf-caption">{COPY_AT_STEP_3_REPORT_TABLE_CAPTION}</caption>
              <thead>
                <tr>
                  <th scope="col">Page</th>
                  <th scope="col">Performance</th>
                  <th scope="col">Accessibility</th>
                  <th scope="col">LCP (ms)</th>
                  <th scope="col">TBT (ms)</th>
                  <th scope="col">CLS</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">/</th>
                  <td data-label="Performance">__LH_1_PERFORMANCE__</td>
                  <td data-label="Accessibility">__LH_1_ACCESSIBILITY__</td>
                  <td data-label="LCP (ms)">__LH_1_LCP__</td>
                  <td data-label="TBT (ms)">__LH_1_TBT__</td>
                  <td data-label="CLS">__LH_1_CLS__</td>
                </tr>
                <tr>
                  <th scope="row">/projects/certway/</th>
                  <td data-label="Performance">__LH_2_PERFORMANCE__</td>
                  <td data-label="Accessibility">__LH_2_ACCESSIBILITY__</td>
                  <td data-label="LCP (ms)">__LH_2_LCP__</td>
                  <td data-label="TBT (ms)">__LH_2_TBT__</td>
                  <td data-label="CLS">__LH_2_CLS__</td>
                </tr>
                <tr>
                  <th scope="row">/report/</th>
                  <td data-label="Performance">__LH_3_PERFORMANCE__</td>
                  <td data-label="Accessibility">__LH_3_ACCESSIBILITY__</td>
                  <td data-label="LCP (ms)">__LH_3_LCP__</td>
                  <td data-label="TBT (ms)">__LH_3_TBT__</td>
                  <td data-label="CLS">__LH_3_CLS__</td>
                </tr>
                <tr>
                  <th scope="row">404 page</th>
                  <td data-label="Performance">__LH_4_PERFORMANCE__</td>
                  <td data-label="Accessibility">__LH_4_ACCESSIBILITY__</td>
                  <td data-label="LCP (ms)">__LH_4_LCP__</td>
                  <td data-label="TBT (ms)">__LH_4_TBT__</td>
                  <td data-label="CLS">__LH_4_CLS__</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Check>
        <Check index={4} sha={source.sha}>
          <dl class="tiles">
            <Tile label="Documents checked">__HTML_DOCUMENTS__</Tile>
            <Tile label="Errors">__HTML_ERRORS__</Tile>
            <Tile label="Warnings">__HTML_WARNINGS__</Tile>
          </dl>
        </Check>
        <Check index={5} sha={source.sha}>
          <dl class="tiles">
            <Tile label="Links found">__LINKS_TOTAL__</Tile>
            <Tile label="Unique">__LINKS_UNIQUE__</Tile>
            <Tile label="Checked">__LINKS_CHECKED__</Tile>
            <Tile label="OK">__LINKS_OK__</Tile>
            <Tile label="Broken">__LINKS_BROKEN__</Tile>
            <Tile label="Timed out">__LINKS_TIMEOUTS__</Tile>
            <Tile label="Excluded by rule">__LINKS_EXCLUDED__</Tile>
          </dl>
        </Check>
      </section>
    </>
  );
}
