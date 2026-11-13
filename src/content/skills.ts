// The signed step 3 copy of the skills section (design.md DS-05, D-027). Each export carries the name of its DS-00 row.
import type { MarkedText } from "./identity.ts";

export const COPY_AT_STEP_3_SKILLS_HEADING = "Skills";
export const COPY_AT_STEP_3_SKILLS_SHIPPED_HEADING = "Shipped in public";
export const COPY_AT_STEP_3_SKILLS_ALSO_HEADING = "Also worked with";

/** A public repository that is not this site: its skills are checked by the reader with one click on `url`. */
export interface RepositoryItem {
  label: string;
  url: string;
  skills: readonly string[];
}

/** This site's own item: each skill carries a marker that must occur in a file of the site repository (D-027). */
export interface SiteItem {
  label: string;
  url: string;
  skills: readonly MarkedText[];
}

/**
 * One item per public repository, in this order. The list names only what the repository shows: the skills of the
 * animation tiers are added, with their markers, by the task that builds the tier.
 */
export const COPY_AT_STEP_3_SKILLS_SHIPPED: readonly (RepositoryItem | SiteItem)[] = [
  { label: "certway", url: "https://github.com/MrAryanCode/certway", skills: ["Rust"] },
  {
    label: "This site",
    url: "https://github.com/MrAryanCode/MrAryanCode.github.io",
    skills: [
      { text: "TypeScript", file: "package.json", marker: '"typescript"' },
      { text: "SolidJS", file: "package.json", marker: '"solid-js"' },
      { text: "Vite", file: "package.json", marker: '"vite"' },
      { text: "Node.js", file: ".nvmrc", marker: "26.13.0" },
      { text: "Playwright", file: "package.json", marker: "@playwright/test" },
      { text: "HTML and CSS", file: "index.html", marker: "<!--ssr-app-->" },
      { text: "GitHub Actions", file: ".github/workflows/pages.yml", marker: "actions/deploy-pages" },
      { text: "Web Animations API", file: "src/motion/spring.ts", marker: "el.animate(" },
    ],
  },
  { label: "GitHub profile", url: "https://github.com/MrAryanCode/MrAryanCode", skills: ["Python", "GitHub Actions"] },
];

/** The profile README's stack names that the shipped list does not hold, in the README's order and grouping. One paragraph. */
export const COPY_AT_STEP_3_SKILLS_ALSO = "Go · React, Svelte · .NET · Flutter";
