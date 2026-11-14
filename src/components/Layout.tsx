import { Show, type JSX } from "solid-js";
import { contact } from "../content/contact";
import type { Build } from "../facts";
import type { RouteId } from "../routes";

const REPO_URL = "https://github.com/MrAryanCode/MrAryanCode.github.io";
const COMMIT_URL = `${REPO_URL}/commit/`;

/**
 * The chrome of every page (design.md DS-01): skip link, header, the reading progress bar, the page in `main`, footer.
 * The pause control is not here: the enhancement loader creates it after hydration (T-019).
 */
export function Layout(props: { children: JSX.Element; build: Build | null; route?: RouteId }) {
  return (
    <>
      <a class="skip" href="#main">Skip to content</a>
      <header>
        {/* Hidden until the reading effect drives it (T-033); the progress bar is not content. */}
        <div data-fx="progress" aria-hidden="true"></div>
        <a href="/" aria-current={props.route === "home" ? "page" : undefined}>
          <span>
            Aryan Miri<br />{" "}
            <small>MrAryanCode</small>
          </span>
        </a>
        <div class="site-nav">
          {/* Filled by the pause control after hydration (T-019); it holds the button's space from first paint. */}
          <span class="pause-slot" data-client-only></span>
          <a href={contact.telegramUrl}>Message me</a>
        </div>
      </header>
      <main id="main">{props.children}</main>
      <footer data-field-kind="4">
        <div class="footer-groups">
          <nav aria-label="Contact">
            <p>Contact</p>
            <p><a href={contact.emailUrl}>{contact.email}</a></p>
            <p><span class="muted">Telegram</span> <a href={contact.telegramUrl}>{contact.telegramHandle}</a></p>
            <p><span class="muted">GitHub</span> <a href={contact.githubUrl}>{contact.githubHandle}</a></p>
            <p><span class="muted">Telegram channel</span> <a href={contact.channelUrl}>{contact.channelHandle}</a></p>
          </nav>
          <nav aria-label="This site">
            <p>This site</p>
            <p><a href={REPO_URL}>Source code (MIT license)</a></p>
            <p><a href="/report/" aria-current={props.route === "report" ? "page" : undefined}>Engineering report</a></p>
          </nav>
        </div>
        <p>© 2026 Aryan Miri. Text and images are not licensed for reuse.</p>
        {/* The build stamp is the footer's last line; a local build has no commit and omits it (D-023). */}
        <Show when={props.build}>
          {(b) => (
            <p class="footer-stamp">Built {b().builtAt.slice(0, 10)} from <a href={COMMIT_URL + b().sha}>{b().sha.slice(0, 7)}</a></p>
          )}
        </Show>
      </footer>
    </>
  );
}
