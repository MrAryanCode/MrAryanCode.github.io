import { formatUtc, type Facts } from "../facts";

/** The certway facts. Receives the build-time data as a prop; fetches nothing. */
export function FactsCard(props: { facts: Facts; id?: string }) {
  return (
    <section id={props.id} aria-labelledby="certway-facts">
      <h2 id="certway-facts"><a href={props.facts.repo.htmlUrl}>{props.facts.repo.fullName}</a></h2>
      <dl>
        <dt>Latest release</dt>
        <dd><a href={props.facts.release.url}>{props.facts.release.tag}</a></dd>
        <dt>License</dt>
        <dd>{props.facts.repo.license ?? "No license"}</dd>
        <dt>Stars</dt>
        <dd>{props.facts.repo.stars}</dd>
        <dt>Last push</dt>
        <dd><time datetime={props.facts.repo.pushedAt}>{props.facts.repo.pushedAt.slice(0, 10)}</time></dd>
      </dl>
      <p class="muted">
        Facts read from GitHub at <time data-read-at datetime={props.facts.asOf}>{formatUtc(props.facts.asOf)}</time>.
      </p>
    </section>
  );
}
