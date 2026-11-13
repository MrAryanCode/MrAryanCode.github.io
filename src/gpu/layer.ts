// The WebGPU backend of tier 3 (algorithms.md A-1): the same cell pass as webgl2.ts, in WGSL, drawn straight into the
// canvas texture. Loaded only by dynamic import() after the capability checks pass, so Vite emits it as its own chunk.
// The uniform block is core.ts's UniformBlock, byte for byte what webgl2.ts binds.
import type { Backend } from "./webgl2.ts";
import { UNIFORM_BYTES } from "./core.ts";

// The WebGPU types are not in the project's lib set; the few members used here are typed loosely at this one boundary.
type Dyn = any;
declare const GPUBufferUsage: { UNIFORM: number; COPY_DST: number; MAP_READ: number };
declare const GPUTextureUsage: { RENDER_ATTACHMENT: number; COPY_SRC: number; TEXTURE_BINDING: number; COPY_DST: number };
declare const GPUMapMode: { READ: number };

const WGSL = `
struct U {
  grid: vec4<i32>, origin: vec4<i32>, counts: vec4<i32>, maskR: vec4<i32>, eff: vec4<f32>,
  timef: vec4<f32>, misc: vec4<f32>,
  zones: array<vec4<i32>, 32>, trails: array<vec4<f32>, 16>, ripples: array<vec4<f32>, 3>,
  sections: array<vec4<i32>, 8>, palette: array<vec4<f32>, 5>,
  anchors: vec4<f32>, extra: vec4<f32>,
};
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var maskTex: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}
fn pcg3d(v0: vec3<u32>) -> vec3<u32> {
  var v = v0 * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> vec3<u32>(16u);
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
fn hash(c: vec2<i32>, s: u32) -> u32 { return pcg3d(vec3<u32>(vec2<u32>(c), s)).x; }
fn vnoise(p: vec2<i32>, seed: u32) -> u32 {
  let i = p >> vec2<u32>(10u);
  let f = vec2<u32>(p & vec2<i32>(1023));
  let s = (f * f * (vec2<u32>(3072u) - 2u * f)) >> vec2<u32>(20u);
  let m = vec2<i32>(255);
  let a = hash(i & m, seed) >> 22u;
  let b = hash((i + vec2<i32>(1, 0)) & m, seed) >> 22u;
  let c = hash((i + vec2<i32>(0, 1)) & m, seed) >> 22u;
  let d = hash((i + vec2<i32>(1, 1)) & m, seed) >> 22u;
  let ab = (a * (1024u - s.x) + b * s.x) >> 10u;
  let cd = (c * (1024u - s.x) + d * s.x) >> 10u;
  return (ab * (1024u - s.y) + cd * s.y) >> 10u;
}
fn bayer8(c: vec2<i32>) -> i32 {
  var v = 0;
  for (var k = 0u; k < 3u; k++) {
    let a = (c.x >> k) & 1;
    let b = (c.y >> k) & 1;
    v += ((a ^ b) * 2 + b) << (2u * (2u - k));
  }
  return v;
}
fn u01(h: u32) -> f32 { return f32(h >> 8u) * (1.0 / 16777216.0); }
fn fmod(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }
fn iss(n: i32, lo: i32, hi: i32) -> i32 {
  let s = min(max(n - lo, 0) * 1024 / (hi - lo), 1024);
  return (s * s * (3072 - 2 * s)) >> 20u;
}
@fragment fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let flags = u.grid.w; let D = u.grid.z;
  let fc = vec2<i32>(pos.xy);
  let c = u.origin.xy + fc;
  let r = vec4<i32>(c * D, c * D + D);
  let dpr = u.timef.z; let t = u.timef.x; let tf = u.timef.y;
  var cap = 4; var dmin = 1e9;
  for (var i = 0; i < 32; i++) {
    if (i >= u.counts.x) { break; }
    let z = u.zones[i];
    if (r.x < z.z && r.z > z.x && r.y < z.w && r.w > z.y) { cap = 2; }
    let g = max(max(z.xy - r.zw, r.xy - z.zw), vec2<i32>(0));
    dmin = min(dmin, length(vec2<f32>(g)) / dpr);
  }
  let flatF = (flags & 2) != 0;
  var e = smoothstep(0.0, 32.0, dmin);
  if (flatF) { e = 1.0; }
  if (cap == 2) { e = 0.0; }
  let cssX = (f32(c.x * D) + f32(D) * 0.5) / dpr;
  let cssY = (f32(c.y * D) + f32(D) * 0.5) / dpr;
  let cyd = r.y + D / 2;
  var bi = -1;
  for (var i = 0; i < 8; i++) {
    if (i >= u.counts.w) { break; }
    if (cyd >= u.sections[i].x && cyd < u.sections[i].y) { bi = i; }
  }
  var kind = 0;
  if (bi >= 0) {
    kind = u.sections[bi].z;
    let uu = u01(hash(c, 6u));
    let e0 = f32(u.sections[bi].x) / dpr;
    let e1 = f32(u.sections[bi].y) / dpr;
    if (bi > 0 && cssY - e0 < 140.0) {
      if (uu >= smoothstep(e0 - 140.0, e0 + 140.0, cssY)) { kind = u.sections[bi - 1].z; }
    } else if (bi + 1 < u.counts.w && e1 - cssY < 140.0) {
      if (uu < smoothstep(e1 - 140.0, e1 + 140.0, cssY)) { kind = u.sections[bi + 1].z; }
    }
  }
  let dbg = i32(u.misc.w);
  if (dbg == 1) { return vec4<f32>(f32(kind) / 255.0, 0.0, 0.0, 1.0); }
  if (dbg == 2) {
    let dn = i32(vnoise(c * i32(u.misc.z), 9u));
    return vec4<f32>(f32(dn & 255) / 255.0, f32(dn >> 8u) / 255.0, 0.0, 1.0);
  }
  let pc = vec2<f32>(r.xy + D / 2) / dpr;
  var sw = vec2<f32>(0.0);
  var wake = 0.0; var wakeHot = 0.0; var rip = 0.0;
  for (var i = 0; i < 16; i++) {
    if (i >= u.counts.y) { break; }
    let p = u.trails[i];
    let a = clamp(p.z, 0.0, 1.0);
    let sg = 24.0 + 80.0 * a;
    let d = pc - p.xy / dpr;
    let g = exp(-dot(d, d) / (2.0 * sg * sg)) * (1.0 - a);
    sw += vec2<f32>(-d.y, d.x) * g * 0.8;
    wake = max(wake, g * 0.38);
    wakeHot = max(wakeHot, g * (1.0 - a) * (1.0 - a));
  }
  for (var i = 0; i < 3; i++) {
    if (i >= u.counts.z) { break; }
    let p = u.ripples[i];
    let rr = (length(pc - p.xy / dpr) - 480.0 * p.z) / 16.0;
    rip += exp(-rr * rr) * max(0.0, 1.0 - p.z / 1.4);
  }
  let swl = length(sw);
  if (swl > 20.0) { sw *= 20.0 / swl; }
  let swc = sw * dpr / f32(D);
  let t51 = vec2<i32>(floor(swc * 51.0 + 0.5));
  let t128 = vec2<i32>(floor(swc * 128.0 + 0.5));
  let n = i32(vnoise(c * 51 + u.origin.zw + t51, 1u));
  var vd = (n * 128 + 511) / 1023;
  var vh = min(max(i32(vnoise(c * 128 + u.origin.zw * 2 + t128, 2u)) - 634, 0) * 384 / 1023, 128);
  let Lg = i32(floor(32.0 * dpr + 0.5));
  let line = (c.x * D) % Lg < D || (c.y * D) % Lg < D;
  let yb = fmod(cssY - f32(u.sections[0].w) / 16.0, 1100.0);
  let bandA = (yb - 550.0) / 46.0;
  let band = exp(-bandA * bandA);
  let ph = (flags & 32) != 0;
  if (kind == 1 || kind == 7) {
    vd = select(0, 18 + i32(59.0 * band), line) + ((13 * iss(n, 757, 941)) >> 10u);
    if (kind == 7) { vd = min(vd * 147 / 128, 128); }
    vh = select(0, i32(96.0 * band), line);
  } else if (kind == 6) {
    vd = select(0, 10 + i32(49.0 * band), line) + ((6 * iss(n, 839, 972)) >> 10u);
    vh = select(0, i32(77.0 * band), line);
  } else if (kind == 2) {
    let px = cssX + u.extra.y;
    let py = cssY + u.extra.z;
    let b = vec2<i32>(floor(vec2<f32>(px, py) / 56.0));
    let hs = u01(hash(b, 11u));
    let sb = hs >= 1.0 - 0.22 * select(1.0, 0.6, ph);
    let ccx = f32(b.x) * 56.0 + (0.15 + 0.7 * u01(hash(b, 3u))) * 56.0;
    let ccy = f32(b.y) * 56.0 + (0.15 + 0.7 * u01(hash(b, 7u))) * 56.0;
    let r2 = (px - ccx) * (px - ccx) + (py - ccy) * (py - ccy);
    let tw = 0.5 + 0.5 * sin(t * (1.0 + 2.0 * hs) + 30.0 * hs);
    let star = sb && sqrt(r2) < 0.95 * f32(D) / dpr;
    let halo = select(0, i32(128.0 * 0.38 * tw * exp(-r2 / 338.0)), sb);
    vd = min(max(select(0, 128, star), halo) + ((8 * iss(n, 818, 972)) >> 10u), 128);
    vh = select(0, i32(128.0 * (0.35 + 0.65 * tw)), star);
  } else if (kind == 3) {
    let rr = length(vec2<f32>(cssX - u.anchors.x, cssY - u.anchors.y));
    let rings = 0.5 + 0.5 * sin(rr * 0.045 + u.eff.x * 1.8);
    let dR = smoothstep(0.82, 1.0, rings) * 0.42 * exp(-rr / 560.0) + 0.58 * exp(-rr / 100.0);
    vd = min(i32(128.0 * dR) + ((9 * iss(n, 736, 941)) >> 10u), 128);
    vh = i32(128.0 * exp(-rr / 150.0));
    vd = i32(f32(vd) * u.eff.y);
    vh = i32(f32(vh) * u.eff.y);
  } else if (kind == 4) {
    vd = (20 * iss(n, 818, 972)) >> 10u;
    vh = 0;
  } else if (kind == 5) {
    let edge = max(smoothstep(16.0, 150.0, u.anchors.z - cssX), smoothstep(16.0, 150.0, cssX - u.anchors.w));
    let colI = i32(floor(cssX / 8.0));
    let sp = 0.22 + 0.3 * u01(hash(vec2<i32>(colI, 3), 12u));
    let sn = i32(vnoise(vec2<i32>(colI * 379, i32(floor((cssY * 0.006 - u.eff.z * sp) * 1024.0))), 5u));
    let stream = smoothstep(0.68, 0.95, f32(sn) / 1023.0);
    let trA = (cssY - u.extra.x) / 18.0;
    let tr = exp(-trA * trA) * edge * select(0.0, 1.0, fmod(cssX, 16.0) < 8.0) * u.eff.w;
    vd = min(i32(128.0 * (0.30 * stream * edge + 0.30 * tr)), 128);
    vh = i32(128.0 * 0.55 * tr);
  }
  var letter = 0;
  if (u.maskR.z > 0) {
    let fade = smoothstep(0.4, 0.9, tf);
    vd = i32(f32(vd) * fade); vh = i32(f32(vh) * fade);
    if (tf < 0.9) {
      let w = 0.4 + 1.2 * clamp(f32(fc.x) / max(u.timef.w, 1.0), 0.0, 1.0);
      if (u01(hash(c, 100u + u32(floor(10.0 * tf)))) < 0.02 * smoothstep(0.0, 0.9, tf) * w) { vh = 256; }
    }
    var m = c - u.maskR.xy;
    var gate = true;
    let mode = i32(u.extra.w);
    if (mode == 0) {
      let C = vec2<f32>(u.maskR.xy) + vec2<f32>(u.maskR.zw) * 0.5;
      let q = vec2<f32>(c) + 0.5 + swc - C;
      let R = 0.75 * f32(max(u.maskR.z, u.maskR.w));
      var tw = 4.6 * (1.0 - smoothstep(1.5, 2.4, tf));
      if (tf < 1.5) { tw = 4.6 * smoothstep(0.9, 1.5, tf); }
      let sc = 1.8 - 0.8 * smoothstep(1.5, 2.4, tf);
      let ang = -tw * max(0.0, 1.0 - length(q) / R);
      let src = C + mat2x2<f32>(cos(ang), sin(ang), -sin(ang), cos(ang)) * q / sc;
      m = vec2<i32>(floor(src)) - u.maskR.xy;
    } else if (mode == 1) {
      gate = f32(vnoise(c * 51, 8u)) < 1024.0 * smoothstep(0.9, 2.4, tf);
    }
    var appear = smoothstep(0.9, 1.5, tf) * (0.6 + 0.4 * smoothstep(1.5, 2.4, tf));
    if (tf >= 3.2) { appear = 0.8 + 0.2 * u.misc.y; }
    let keep = u.misc.z < 0.5 || 0.85 * f32(vnoise(c * i32(u.misc.z), 9u)) / 1023.0 + 0.1 > u.misc.x;
    if (tf >= 0.9 && m.x >= 0 && m.y >= 0 && m.x < u.maskR.z && m.y < u.maskR.w) {
      if (textureLoad(maskTex, m, 0).r > 0.5 && gate && keep && u01(hash(c, 7u)) < appear) {
        letter = select(192, 200, tf >= 2.4 && tf < 2.7);
      }
    }
  }
  vd = min(vd + i32(128.0 * (wake + 0.6 * rip)), 128);
  vh = max(vh, i32(128.0 * min(1.0, max(0.78 * wakeHot, 0.75 * rip))));
  if (ph) { vd = vd * 3 / 5; }
  vh = i32(f32(vh) * e);
  vd = i32(f32(vd) * (0.5 + 0.5 * e));
  var vf = select(vd + vh, letter, letter > 0);
  if (flatF) { vf = 256; }
  vf = min(vf, 128 + i32(128.0 * e));
  var idx = clamp((vf + bayer8(c)) >> 6u, 0, 4);
  if ((flags & 16) != 0 && letter > 0 && cap == 2 && bayer8(c) < 32) { idx = 0; }
  idx = min(idx, cap);
  return u.palette[idx];
}`;

/** Creates the backend on `canvas` from an adapter, or returns null when there is no device or context. `onLost` runs
 *  when the device is lost for a reason other than destroy(); the device is then gone for good, so the caller rebuilds. */
export async function createWebGpu(canvas: HTMLCanvasElement, adapter: Dyn, onLost: () => void): Promise<Backend | null> {
  const gpu: Dyn = (navigator as Dyn).gpu;
  const device: Dyn = await adapter.requestDevice();
  const ctx: Dyn = canvas.getContext("webgpu");
  if (!device || !ctx) return null;
  const format: string = gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "opaque", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const module = device.createShaderModule({ code: WGSL });
  const pipeline: Dyn = await device.createRenderPipelineAsync({
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  const ubo = device.createBuffer({ size: UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const info: Dyn = adapter.info ?? {};
  const name = (`${info.vendor ?? ""} ${info.architecture ?? ""}`.trim() || "unknown") + (adapter.isFallbackAdapter ? " (fallback)" : "");
  const maxDim: number = device.limits?.maxTextureDimension2D ?? 8192;
  let destroyed = false;
  let lost = false;
  let cw = 1;
  let ch = 1;
  let maskTex: Dyn = null;
  let bind: Dyn = null;
  void device.lost.then(() => {
    lost = true;
    if (!destroyed) onLost();
  });
  // A validation error in a draw must not reach the console as an uncaptured error; the next draw tries again.
  device.onuncapturederror = (ev: Dyn) => ev.preventDefault?.();

  const setMask = (data: Uint8Array | null, w: number, h: number): void => {
    maskTex?.destroy();
    const tw = data ? w : 1;
    const th = data ? h : 1;
    maskTex = device.createTexture({ size: [tw, th], format: "r8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: maskTex }, data ?? new Uint8Array(1), { bytesPerRow: tw }, [tw, th]);
    bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: maskTex.createView() }],
    });
  };
  setMask(null, 1, 1);

  // `copy` is a readback (the seek hook's): the frame goes to a texture of its own and is copied from there. Copying out of
  // the canvas's current texture lost the device on the CI runner's SwiftShader adapter.
  const encode = (uniforms: ArrayBuffer, copy: { r0: number; n: number; buf: Dyn; rowBytes: number; tex: Dyn } | null): void => {
    device.queue.writeBuffer(ubo, 0, uniforms);
    const enc = device.createCommandEncoder();
    const tex = copy ? copy.tex : ctx.getCurrentTexture();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: tex.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.draw(3);
    pass.end();
    if (copy) enc.copyTextureToBuffer({ texture: tex, origin: { x: 0, y: copy.r0 } }, { buffer: copy.buf, bytesPerRow: copy.rowBytes }, [cw, copy.n]);
    device.queue.submit([enc.finish()]);
  };

  return {
    api: "webgpu",
    name,
    resize(cellsW, cellsH) {
      if (cellsW > maxDim || cellsH > maxDim) return false;
      canvas.width = cellsW;
      canvas.height = cellsH;
      cw = cellsW;
      ch = cellsH;
      return true;
    },
    setMask,
    draw(uniforms) {
      if (lost) return false;
      encode(uniforms, null);
      return true;
    },
    async read(uniforms, r0, r1) {
      const row = Math.max(0, r0);
      const n = Math.max(0, Math.min(ch, r1) - row);
      if (lost || n === 0) return new Uint8Array(0);
      const rowBytes = Math.ceil((cw * 4) / 256) * 256;
      const buf = device.createBuffer({ size: rowBytes * n, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const tex = device.createTexture({ size: [cw, ch], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      encode(uniforms, { r0: row, n, buf, rowBytes, tex });
      await buf.mapAsync(GPUMapMode.READ);
      tex.destroy();
      const src = new Uint8Array(buf.getMappedRange());
      const out = new Uint8Array(cw * n * 4);
      const bgra = format.startsWith("bgra");
      for (let j = 0; j < n; j++) {
        const from = j * rowBytes;
        const to = j * cw * 4;
        out.set(src.subarray(from, from + cw * 4), to);
        if (bgra) for (let k = to; k < to + cw * 4; k += 4) { const b = out[k]; out[k] = out[k + 2]; out[k + 2] = b; }
      }
      buf.unmap();
      buf.destroy();
      return out;
    },
    async sync() {
      if (!lost) await device.queue.onSubmittedWorkDone();
    },
    lose() {
      device.destroy();
    },
    destroy() {
      destroyed = true;
      maskTex?.destroy();
      ubo.destroy();
      device.destroy();
    },
  };
}
