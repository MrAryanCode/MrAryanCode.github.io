import { createSignal, onMount } from "solid-js";

interface GpuNavigator { gpu?: { requestAdapter(): Promise<{ requestDevice(): Promise<unknown> } | null> } }

const STATIC_TEXT = "Static fallback. The WebGPU layer has not started.";

/**
 * Lazy WebGPU layer. The server and the first client render both print STATIC_TEXT.
 * After mount: navigator.gpu check -> requestAdapter() -> import("../gpu/layer").
 * Any failure keeps the static fallback and says why.
 */
export function GpuLayer() {
  const [status, setStatus] = createSignal(STATIC_TEXT);
  let canvas!: HTMLCanvasElement;

  onMount(async () => {
    const gpu = (navigator as unknown as GpuNavigator).gpu;
    if (!gpu) return setStatus("No WebGPU in this browser. Static fallback stays.");
    try {
      const adapter = await gpu.requestAdapter();
      if (!adapter) return setStatus("WebGPU returned no adapter. Static fallback stays.");
      const { startGpu } = await import("../gpu/layer"); // its own chunk; never in the server render
      setStatus(await startGpu(canvas, adapter));
    } catch (err) {
      setStatus(`WebGPU layer failed (${err instanceof Error ? err.message : String(err)}). Static fallback stays.`);
    }
  });

  return (
    <section aria-labelledby="gpu-h">
      <h2 id="gpu-h">WebGPU layer</h2>
      <canvas ref={canvas} width="320" height="120" aria-hidden="true" data-client-only />
      <p data-gpu-status data-client-only>{status()}</p>
    </section>
  );
}
