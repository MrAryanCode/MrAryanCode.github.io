// The 404 page (design.md DS-10, DV-02.4; D-032). Prerendered into 404.html, which Pages serves at any depth: every href
// is root-absolute, the address the visitor tried is not shown, and no link carries aria-current.
// The links are COPY_AT_STEP_3_404_LINKS, in route-table order; a unit test compares them with src/routes.ts.
import { For } from "solid-js";

const COPY_AT_STEP_3_404_H1 = "404";
const COPY_AT_STEP_3_404_LEAD = "This page does not exist. These are the pages on this site:";
const COPY_AT_STEP_3_404_LINKS = [
  { label: "Home page", href: "/" },
  { label: "certway case study", href: "/projects/certway/" },
  { label: "Engineering report", href: "/report/" },
];

export function NotFound() {
  return (
    <div class="not-found" data-field-kind="0">
      <h1>{COPY_AT_STEP_3_404_H1}</h1>
      <p class="role">{COPY_AT_STEP_3_404_LEAD}</p>
      <ul class="page-list">
        <For each={COPY_AT_STEP_3_404_LINKS}>
          {(link) => (
            <li>
              <a class="row" href={link.href}>
                <span class="row-label">{link.label}</span>
                {/* A static arrow; its spring is the pointer effects' (T-031, P-12). */}
                <svg class="row-arrow" data-fx="arrow" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 12h15M13 6l6 6-6 6" />
                </svg>
              </a>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
