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
  /** The 404 page has no canonical URL. */
  canonical: boolean;
}

export const routes: Route[] = [
  {
    id: "home",
    path: "/",
    file: "index.html",
    title: "Aryan Miri | MrAryanCode",
    description: "Remote full-stack developer. Every fact on this page is read from GitHub at build time.",
    ogSlug: "home",
    ogAlt: "Aryan Miri, full-stack developer",
    canonical: true,
  },
  {
    id: "certway",
    path: "/projects/certway/",
    file: "projects/certway/index.html",
    title: "certway case study | MrAryanCode",
    description: "How certway is built, with every number read from GitHub when the site was built.",
    ogSlug: "certway",
    ogAlt: "certway case study card",
    canonical: true,
  },
  {
    id: "report",
    path: "/report/",
    file: "report/index.html",
    title: "Engineering report | MrAryanCode",
    description: "An engineering report on how this site is prerendered, measured and tested.",
    ogSlug: "report",
    ogAlt: "Engineering report card",
    canonical: true,
  },
  {
    id: "notfound",
    path: "/404.html",
    file: "404.html",
    title: "Page not found | MrAryanCode",
    description: "This address does not exist on mraryancode.github.io.",
    ogSlug: "home",
    ogAlt: "Aryan Miri, full-stack developer",
    canonical: false,
  },
];

export const routeById = (id: string): Route | undefined => routes.find((r) => r.id === id);
