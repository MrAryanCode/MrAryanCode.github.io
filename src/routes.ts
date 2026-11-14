// Route table shared by the server bundle (head, output file names) and the client (page choice).
// No Node imports here: this file is bundled for the browser too.
export const SITE = "https://mraryancode.github.io";

export type RouteId = "home" | "certway" | "report" | "notfound";

export interface Route {
  id: RouteId;
  /** URL path. Directory pages end with "/". */
  path: string;
  /** File written under the output folder. */
  file: string;
  title: string;
  description: string;
  /** Open Graph image: /og/<ogSlug>.png */
  ogSlug: RouteId;
  ogAlt: string;
  /** The two text lines drawn on the card. Absent on the 404 route, which has no card of its own (D-033). */
  ogCard?: [string, string];
  /** The 404 page has no canonical URL. */
  canonical: boolean;
}

export const routes: Route[] = [
  {
    id: "home",
    path: "/",
    file: "index.html",
    title: "Aryan Miri | Full-stack developer",
    description:
      "Full-stack developer who builds web products end to end and ships them with tests and CI. Open to remote full-stack roles, full-time or contract.",
    ogSlug: "home",
    ogAlt: 'Card with the text "Aryan Miri" and "Full-stack developer".',
    ogCard: ["Aryan Miri", "Full-stack developer"],
    canonical: true,
  },
  {
    id: "certway",
    path: "/projects/certway/",
    file: "projects/certway/index.html",
    title: "certway case study | Aryan Miri",
    description:
      "A case study of certway, written in Rust: one static binary that gets and renews TLS certificates from Let's Encrypt on Linux and macOS. How it is built, tested and released, pinned to v1.0.1.",
    ogSlug: "certway",
    ogAlt: 'Card with the text "certway case study" and "Aryan Miri, Full-stack developer".',
    ogCard: ["certway case study", "Aryan Miri · Full-stack developer"],
    canonical: true,
  },
  {
    id: "report",
    path: "/report/",
    file: "report/index.html",
    title: "Engineering report | Aryan Miri",
    description:
      "How this site is built: the checks every deploy must pass, with the numbers from the build you are reading.",
    ogSlug: "report",
    ogAlt: 'Card with the text "Engineering report" and "Aryan Miri, Full-stack developer".',
    ogCard: ["Engineering report", "Aryan Miri · Full-stack developer"],
    canonical: true,
  },
  {
    id: "notfound",
    path: "/404.html",
    file: "404.html",
    title: "404: Page not found | Aryan Miri",
    description: "This page does not exist.",
    // No card and no alt text (D-033). The field stays a string and the slug stays "home" only because head.ts
    // (T-014) still prints og:image and og:image:alt for every route; T-014 drops both for 404.
    ogSlug: "home",
    ogAlt: "",
    canonical: false,
  },
];

export const routeById = (id: string): Route | undefined => routes.find((r) => r.id === id);
