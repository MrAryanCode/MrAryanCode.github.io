import { hydrate } from "solid-js/web";
import { App } from "./App";
import type { Build, Facts } from "./facts";
import { runLiveFacts } from "./live";
import type { RouteId } from "./routes";
import "./fonts.css";
import "./style.css";

// The page is chosen from data the build wrote into the HTML, not from location.pathname:
// GitHub Pages serves 404.html at arbitrary paths.
const data = JSON.parse(document.getElementById("site-data")!.textContent!) as {
  route: RouteId;
  facts: Facts;
  build: Build | null;
};
hydrate(() => <App route={data.route} facts={data.facts} build={data.build} />, document.getElementById("root")!);
(window as unknown as { __hydrated: boolean }).__hydrated = true;
void runLiveFacts(data.facts, document.getElementById("root")!);
// Test-only seek hook. __SEEK_HOOK__ is a build-time constant (vite.config.ts define): false in the deploy build,
// so this branch and the import vanish. entry-client.tsx runs on every page and is never part of the server bundle.
if (__SEEK_HOOK__) void import("./gpu/seek-hook").then((m) => m.installSeekHook());
