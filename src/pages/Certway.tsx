import { FactsCard } from "../components/FactsCard";
import { GpuLayer } from "../components/GpuLayer";
import { WorkerDemo } from "../components/WorkerDemo";
import type { Facts } from "../facts";

export function Certway(props: { facts: Facts }) {
  return (
    <>
      <h1>certway case study</h1>
      <p>certway is read from its GitHub repository when this page is built. The text below reads without JavaScript.</p>
      <FactsCard facts={props.facts} />
      <WorkerDemo />
      <GpuLayer />
    </>
  );
}
