import { Match, Switch, onMount } from "solid-js";
import { Layout } from "./components/Layout";
import { enhance } from "./enhance";
import type { Build, Facts } from "./facts";
import type { RouteId } from "./routes";
import { Certway } from "./pages/Certway";
import { Home } from "./pages/Home";
import { NotFound } from "./pages/NotFound";
import { Report } from "./pages/Report";

/** The one component tree. The server renders it to a string; the browser hydrates the same tree. */
export function App(props: { route: RouteId; facts: Facts; build: Build | null }) {
  // The mount point of the enhancement loader (P-06.5): onMount never runs during the server render.
  onMount(() => enhance(document.getElementById("root")!));
  return (
    <Layout build={props.build} route={props.route}>
      <Switch fallback={<NotFound />}>
        <Match when={props.route === "home"}><Home facts={props.facts} /></Match>
        <Match when={props.route === "certway"}><Certway facts={props.facts} /></Match>
        <Match when={props.route === "report"}><Report /></Match>
      </Switch>
    </Layout>
  );
}
