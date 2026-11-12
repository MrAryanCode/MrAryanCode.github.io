import { Match, Switch } from "solid-js";
import { Layout } from "./components/Layout";
import type { Build, Facts } from "./facts";
import type { RouteId } from "./routes";
import { Certway } from "./pages/Certway";
import { Home } from "./pages/Home";
import { NotFound } from "./pages/NotFound";
import { Report } from "./pages/Report";

/** The one component tree. The server renders it to a string; the browser hydrates the same tree. */
export function App(props: { route: RouteId; facts: Facts; build: Build | null }) {
  return (
    <Layout build={props.build}>
      <Switch fallback={<NotFound />}>
        <Match when={props.route === "home"}><Home facts={props.facts} /></Match>
        <Match when={props.route === "certway"}><Certway facts={props.facts} /></Match>
        <Match when={props.route === "report"}><Report /></Match>
      </Switch>
    </Layout>
  );
}
