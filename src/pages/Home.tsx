// The home page (design.md DS-02 to DS-07): four sections in `main`, in this order: the first screen, Work (the certway
// card, then this site's card), Skills, Working with me. Everything is static text; only the certway facts change after
// hydration (T-027). Markup hooks for the motion tasks (P-12): data-field-kind on each section, data-fx on what they move.
import { For, type JSX } from "solid-js";
import { FactsCard } from "../components/FactsCard";
import {
  COPY_AT_STEP_3_AVAILABILITY,
  COPY_AT_STEP_3_CERTWAY_SUMMARY,
  COPY_AT_STEP_3_HOME_H1,
  COPY_AT_STEP_3_ROLE_LINE,
  COPY_AT_STEP_3_SITE_CHECKS,
  COPY_AT_STEP_3_SITE_SUMMARY,
} from "../content/identity";
import { COPY_AT_STEP_3_SKILLS_ALSO, COPY_AT_STEP_3_SKILLS_ALSO_HEADING, COPY_AT_STEP_3_SKILLS_HEADING, COPY_AT_STEP_3_SKILLS_SHIPPED, COPY_AT_STEP_3_SKILLS_SHIPPED_HEADING } from "../content/skills";
import { COPY_AT_STEP_3_WORKING_HEADING, COPY_AT_STEP_3_WORKING_LINKS, COPY_AT_STEP_3_WORKING_START } from "../content/working";
import type { Facts } from "../facts";

// Signed step 3 copy that has no module in src/content (design.md DS-02, DS-03, DS-04).
const COPY_AT_STEP_3_SEE_THE_WORK = "See the work";
const COPY_AT_STEP_3_WORK_HEADING = "Work";
const COPY_AT_STEP_3_CERTWAY_TITLE = "certway";
const COPY_AT_STEP_3_CERTWAY_LINKS = { caseStudy: "Read the case study", source: "Source on GitHub" };
const COPY_AT_STEP_3_SITE_TITLE = "This site";
const COPY_AT_STEP_3_SITE_LINKS = { report: "How this site is built", source: "Source on GitHub" };

const SITE_REPO_URL = "https://github.com/MrAryanCode/MrAryanCode.github.io";

/** The heading row of a section: the decorative index (drawn by CSS, outside the heading) and the h2. */
function HeadingRow(props: { children: JSX.Element }) {
  return (
    <div class="heading-row" data-fx="scan">
      <span class="index" aria-hidden="true"></span>
      {props.children}
    </div>
  );
}

const skillText = (s: string | { text: string }) => (typeof s === "string" ? s : s.text);

export function Home(props: { facts: Facts }) {
  const telegram = COPY_AT_STEP_3_WORKING_LINKS.telegram;
  return (
    <>
      <section class="hero" aria-labelledby="home-h1" data-field-kind="0">
        <h1 id="home-h1">{COPY_AT_STEP_3_HOME_H1}</h1>
        <p class="role" data-copy="role">{COPY_AT_STEP_3_ROLE_LINE}</p>
        <p class="availability" data-copy="availability">{COPY_AT_STEP_3_AVAILABILITY[0]} {COPY_AT_STEP_3_AVAILABILITY[1]}</p>
        <div class="actions">
          <a class="btn btn-primary" data-fx="magnet" href={telegram.url}>{telegram.label}</a>
          <a href="#work">{COPY_AT_STEP_3_SEE_THE_WORK}</a>
        </div>
      </section>

      <section class="section" aria-labelledby="work" data-field-kind="1">
        <HeadingRow>
          <h2 id="work" tabindex="-1">{COPY_AT_STEP_3_WORK_HEADING}</h2>
        </HeadingRow>
        <div class="cards">
          <article class="panel panel-card" id="certway" aria-labelledby="certway-h" data-fx="tilt parallax">
            <h3 id="certway-h">{COPY_AT_STEP_3_CERTWAY_TITLE}</h3>
            <p class="card-summary">{COPY_AT_STEP_3_CERTWAY_SUMMARY}</p>
            <FactsCard facts={props.facts} />
            <ul class="links-row">
              <li><a href="/projects/certway/">{COPY_AT_STEP_3_CERTWAY_LINKS.caseStudy}</a></li>
              <li><a href={props.facts.repo.htmlUrl}>{COPY_AT_STEP_3_CERTWAY_LINKS.source}</a></li>
            </ul>
          </article>
          <article class="panel panel-card" id="this-site" aria-labelledby="this-site-h" data-fx="tilt parallax">
            <h3 id="this-site-h">{COPY_AT_STEP_3_SITE_TITLE}</h3>
            <p class="card-summary">{COPY_AT_STEP_3_SITE_SUMMARY}</p>
            <ul class="checks" data-fx="ticks">
              <For each={COPY_AT_STEP_3_SITE_CHECKS}>
                {(check) => (
                  <li>
                    {/* A static tick; the draw is the reading effects' (T-033, P-12). */}
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
                    {check.text}
                  </li>
                )}
              </For>
            </ul>
            <ul class="links-row">
              <li><a href="/report/">{COPY_AT_STEP_3_SITE_LINKS.report}</a></li>
              <li><a href={SITE_REPO_URL}>{COPY_AT_STEP_3_SITE_LINKS.source}</a></li>
            </ul>
          </article>
        </div>
      </section>

      <section class="section" id="skills" aria-labelledby="skills-h" data-field-kind="2">
        <HeadingRow>
          <h2 id="skills-h">{COPY_AT_STEP_3_SKILLS_HEADING}</h2>
        </HeadingRow>
        <div class="skills">
          <div class="panel" data-fx="tilt">
            <h3>{COPY_AT_STEP_3_SKILLS_SHIPPED_HEADING}</h3>
            <ul>
              <For each={COPY_AT_STEP_3_SKILLS_SHIPPED}>
                {(item) => (
                  <li>
                    <a href={item.url}>{item.label}</a>: {item.skills.map(skillText).join(", ")}
                  </li>
                )}
              </For>
            </ul>
          </div>
          <div class="panel" data-fx="tilt">
            <h3>{COPY_AT_STEP_3_SKILLS_ALSO_HEADING}</h3>
            <p>{COPY_AT_STEP_3_SKILLS_ALSO}</p>
          </div>
        </div>
      </section>

      <section class="section" id="working" aria-labelledby="working-h" data-field-kind="3">
        <HeadingRow>
          <h2 id="working-h">{COPY_AT_STEP_3_WORKING_HEADING}</h2>
        </HeadingRow>
        <p>{COPY_AT_STEP_3_WORKING_START}</p>
        <div class="actions">
          <a class="btn btn-primary" data-fx="magnet" href={telegram.url}>{telegram.label}</a>
          <span>
            <span class="muted">{COPY_AT_STEP_3_WORKING_LINKS.email.label}</span>{" "}
            <a href={COPY_AT_STEP_3_WORKING_LINKS.email.url}>{COPY_AT_STEP_3_WORKING_LINKS.email.text}</a>
          </span>
        </div>
      </section>
    </>
  );
}
