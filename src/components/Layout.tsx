import { Show, type JSX } from "solid-js";
import { formatUtc, type Build } from "../facts";

const COMMIT_URL = "https://github.com/MrAryanCode/MrAryanCode.github.io/commit/";

export function Layout(props: { children: JSX.Element; build: Build | null }) {
  return (
    <>
      <a class="skip" href="#main">Skip to content</a>
      <header>
        <a href="/">Aryan Miri</a>{" "}
        <nav aria-label="Main">
          <a href="/projects/certway/">certway</a> <a href="/report/">Report</a>
        </nav>
      </header>
      <main id="main">{props.children}</main>
      <footer>
        <p><small>Prerendered with Solid at build time from public GitHub data.</small></p>
        {/* The build stamp is the footer's last line; a local build has no commit and omits it. */}
        <Show when={props.build}>
          {(b) => (
            <p><small>Built {formatUtc(b().builtAt)} from <a href={COMMIT_URL + b().sha}>{b().sha.slice(0, 7)}</a></small></p>
          )}
        </Show>
      </footer>
    </>
  );
}
