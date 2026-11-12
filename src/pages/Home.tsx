import { FactsCard } from "../components/FactsCard";
import type { Facts } from "../facts";

export function Home(props: { facts: Facts }) {
  return (
    <>
      <h1>Aryan Miri</h1>
      <p>Full-stack developer, available for remote work.</p>
      <FactsCard facts={props.facts} id="certway" />
      <p><a href="/projects/certway/">Read the certway case study</a> or the <a href="/report/">engineering report</a>.</p>
    </>
  );
}
