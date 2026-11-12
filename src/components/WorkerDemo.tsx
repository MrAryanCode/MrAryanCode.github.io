import { createSignal, onCleanup, onMount } from "solid-js";
import type { CountResult } from "../workers/checksum.worker";

/**
 * Browser-only work. The worker is created inside onMount, which Solid never runs during
 * server rendering, so the prerender step never touches `Worker`.
 */
export function WorkerDemo() {
  // Same initial text on the server and in the first client render: hydration needs identical markup.
  const [text, setText] = createSignal("Worker result appears here when JavaScript runs.");

  onMount(() => {
    const worker = new Worker(new URL("../workers/checksum.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<CountResult>) => setText(`Primes below 2,000,000: ${e.data.primes} (${e.data.ms} ms in a worker)`);
    worker.onerror = () => setText("The worker failed to start.");
    worker.postMessage({ limit: 2_000_000 });
    onCleanup(() => worker.terminate());
  });

  return (
    <section aria-labelledby="worker-h">
      <h2 id="worker-h">Worker</h2>
      <p data-client-only data-worker-result>{text()}</p>
    </section>
  );
}
