import { For, Show } from "solid-js";
import type { Facts } from "../facts";
import { GpuLayer } from "../components/GpuLayer";
import { COPY_AT_STEP_3_CERTWAY_SUMMARY } from "../content/identity";
import {
  COPY_AT_STEP_3_CERTWAY_SECTIONS,
  commitUrl,
  permalinkLabel,
  releaseUrl,
  repoUrl,
  shortSha,
  statements,
  version,
} from "../content/case-study";

/** Text between backticks is code: the signed sentences mark their commands and paths that way. */
const withCode = (text: string) => text.split("`").map((part, i) => (i % 2 === 1 ? <code>{part}</code> : part));

/**
 * The certway case study (design.md DS-08, DV-02.1, DV-02.2). Prerendered from src/content/case-study.ts; it makes no
 * network read, so it ignores the facts that App passes to every page. A section with no signed statement is not rendered, so no heading stands without a statement.
 */
export function Certway(_props: { facts?: Facts }) {
  return (
    <>
      <div class="band" data-field-kind="7">
        <h1>certway</h1>
        <p class="lead">{COPY_AT_STEP_3_CERTWAY_SUMMARY}</p>
        <p class="pin">
          This page describes certway {version}. Every link below points to the code at commit <a href={commitUrl}>{shortSha}</a>.
        </p>
        <ul class="links-row">
          <li><a href={repoUrl}>Source on GitHub</a></li>
          <li><a href={releaseUrl}>Release {version}</a></li>
        </ul>
      </div>
      <div class="reading" data-field-kind="5">
        <For each={COPY_AT_STEP_3_CERTWAY_SECTIONS}>
          {(section) => (
            <Show when={statements.some((s) => s.section === section.id)}>
              <section class="section">
                <div class="heading-row" data-fx="scan">
                  <span class="index" aria-hidden="true"></span>
                  <h2>{section.heading}</h2>
                </div>
                <ul class="ref-list">
                  <For each={statements.filter((s) => s.section === section.id)}>
                    {(s) => (
                      <li class="ref" data-statement>
                        <p class="ref-statement">{withCode(s.statement)}</p>
                        <a class="ref-path" href={s.permalink}>
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                            <path d="M4 1.75h5l3 3v9.5H4z M9 1.75v3h3" />
                          </svg>
                          {permalinkLabel(s.permalink)}
                        </a>
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            </Show>
          )}
        </For>
      </div>
      <GpuLayer />
    </>
  );
}
