// The WebGPU layer. Loaded only by dynamic import() after the capability checks pass,
// so Vite emits it as its own chunk. Rendering itself is out of scope (realtime-visual-web-stack).
export interface GpuAdapterLike { requestDevice(): Promise<unknown> }

export async function startGpu(canvas: HTMLCanvasElement, adapter: GpuAdapterLike): Promise<string> {
  const device = await adapter.requestDevice();
  const ctx = canvas.getContext("webgpu");
  if (!ctx || !device) throw new Error("no webgpu context");
  return "WebGPU layer running.";
}
