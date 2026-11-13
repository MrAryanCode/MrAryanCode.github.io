// The signed step 3 copy of the home page's identity, its first screen and the two cards under `Work`
// (design.md DS-02, DS-03, DS-04; D-024, D-025, D-026). Each export carries the name of its DS-00 row.

/** A line of text that must stay true: `marker` is a literal string that has to occur in `file` of this repository. */
export interface MarkedText {
  text: string;
  file: string;
  marker: string;
}

export const COPY_AT_STEP_3_HOME_H1 = "Aryan Miri";

export const COPY_AT_STEP_3_ROLE_LINE = "Full-stack developer. I build web products end to end and ship them with tests and CI.";

/** Two sentences, in this order. They are the profile README's own words (AT-12). */
export const COPY_AT_STEP_3_AVAILABILITY: readonly [string, string] = [
  "Open to remote full-stack roles, full-time or contract.",
  "Based in Tehran (UTC+03:30).",
];

export const COPY_AT_STEP_3_CERTWAY_SUMMARY =
  "HTTPS in one command. One static binary that gets and renews TLS certificates from Let's Encrypt on Linux and macOS.";

export const COPY_AT_STEP_3_SITE_SUMMARY = "The site you are reading. It goes live only when every one of these checks passes:";

/** The six checks a deploy must pass, in order. A unit test of the home page task reads each `file` for its `marker`. */
export const COPY_AT_STEP_3_SITE_CHECKS: readonly MarkedText[] = [
  { text: "Unit tests", file: ".github/workflows/pages.yml", marker: "npm test" },
  { text: "Acceptance tests in Chromium, Firefox and WebKit", file: "package.json", marker: "test:acceptance" },
  { text: "Accessibility check on every page (axe-core)", file: "package.json", marker: "@axe-core/playwright" },
  { text: "Performance check (Lighthouse)", file: "lighthouserc.cjs", marker: "categories:performance" },
  { text: "HTML validation (Nu Html Checker)", file: "package.json", marker: "vnu-jar" },
  { text: "Link check (lychee)", file: ".github/workflows/pages.yml", marker: "lycheeverse/lychee-action" },
];
