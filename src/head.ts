// Per-page <head>, written by hand from the route table. Tag set and order follow
// t3-web-page-conventions (Head template). Runs only in the server bundle.
import { SITE, type Route } from "./routes";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** `preloads` are the font preload tags, already rendered; they go after the icons. */
export function renderHead(route: Route, preloads: string[] = []): string {
  const url = SITE + route.path;
  const image = `${SITE}/og/${route.ogSlug}.png`;
  const lines = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${esc(route.title)}</title>`,
    `<meta name="description" content="${esc(route.description)}">`,
    ...(route.canonical ? [`<link rel="canonical" href="${url}">`] : []),
    `<meta name="color-scheme" content="light dark">`,
    `<link rel="icon" href="/favicon.ico" sizes="48x48">`,
    `<link rel="icon" href="/icon.svg" type="image/svg+xml">`,
    `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`,
    ...preloads,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="MrAryanCode">`,
    `<meta property="og:title" content="${esc(route.title)}">`,
    `<meta property="og:description" content="${esc(route.description)}">`,
    ...(route.canonical ? [`<meta property="og:url" content="${url}">`] : []),
    `<meta property="og:image" content="${image}">`,
    `<meta property="og:image:type" content="image/png">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${esc(route.ogAlt)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:image" content="${image}">`,
    `<style>:root { color-scheme: light dark; }</style>`,
  ];
  return lines.join("\n");
}
