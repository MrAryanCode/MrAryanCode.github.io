// Server bundle. The build script imports ONLY this module, so there is one Solid server instance.
import geistUrl from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url";
import geistMonoUrl from "@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?url";
import { generateHydrationScript, renderToString } from "solid-js/web";
import { App } from "./App";
import type { Build, Facts } from "./facts";
import { renderHead } from "./head";
import { routeById, routes, type RouteId } from "./routes";

export { routes };

export interface Rendered {
  head: string;
  app: string;
  data: string;
}

/** `<` must not appear raw inside the JSON script block. */
const jsonForScript = (v: unknown): string => JSON.stringify(v).replace(/</g, "\\u003c");

// Both variable faces are used in the first paint, so both are preloaded. `crossorigin` is required for fonts.
const fontPreloads = [geistUrl, geistMonoUrl].map(
  (href) => `<link rel="preload" as="font" type="font/woff2" href="${href}" crossorigin>`,
);

export function renderPage(id: RouteId, facts: Facts, build: Build | null): Rendered {
  const route = routeById(id);
  if (!route) throw new Error(`unknown route ${id}`);
  const app = renderToString(() => <App route={id} facts={facts} build={build} />);
  return {
    head: renderHead(route, fontPreloads) + "\n" + generateHydrationScript(),
    app,
    data: `<script type="application/json" id="site-data">${jsonForScript({ route: id, facts, build })}</script>`,
  };
}
