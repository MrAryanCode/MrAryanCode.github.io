// The WebGL2 backend of tier 3 (algorithms.md A-1): one cell pass drawn straight into a page-tall canvas, one fragment per
// page cell, GLSL ES 3.00 with the same integer pipeline as the WGSL in layer.ts. The uniform block is core.ts's UniformBlock.
import { FLAG_FLIP, UNIFORM_BYTES } from "./core.ts";

/** What tier 3 asks of a backend. WebGPU (layer.ts) and WebGL2 (this file) both implement it. */
export interface Backend {
  readonly api: "webgpu" | "webgl2";
  /** The renderer description, for logs: UNMASKED_RENDERER_WEBGL, or the adapter's vendor and architecture. */
  readonly name: string;
  /** Sizes the canvas to cellsW x cellsH texels. False when the platform cannot hold that many rows. */
  resize(cellsW: number, cellsH: number): boolean;
  /** Uploads the mask (one R8 texel per cell), or a 1 x 1 empty one when `data` is null. */
  setMask(data: Uint8Array | null, w: number, h: number): void;
  /** Draws one frame. False when the context is lost and nothing was drawn. */
  draw(uniforms: ArrayBuffer): boolean;
  /** Draws, then returns page cell rows r0..r1 as RGBA, top row first (test hook). Resolves after the same task's draw. */
  read(uniforms: ArrayBuffer, r0: number, r1: number): Promise<Uint8Array>;
  /** Resolves when every submitted draw has finished. */
  sync(): Promise<void>;
  /** Loses the context or the device as the platform would (test hook). */
  lose(): void;
  destroy(): void;
}

const HEAD = `#version 300 es
precision highp float;
precision highp int;
layout(std140) uniform U {
  ivec4 grid; ivec4 origin; ivec4 counts; ivec4 maskR; vec4 eff;
  vec4 timef; vec4 misc;
  ivec4 zones[32]; vec4 trails[16]; vec4 ripples[3]; ivec4 sections[8]; vec4 palette[5];
  vec4 anchors; vec4 extra;
};
`;

const VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FS = HEAD + `
uniform sampler2D uMask;
out vec4 outColor;
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
uint hash(ivec2 c, uint s) { return pcg3d(uvec3(uvec2(c), s)).x; }
uint vnoise(ivec2 p, uint seed) {
  ivec2 i = p >> 10; uvec2 f = uvec2(p & 1023);
  uvec2 s = (f * f * (3072u - 2u * f)) >> 20u;
  uint a = hash(i & 255, seed) >> 22u, b = hash((i + ivec2(1, 0)) & 255, seed) >> 22u;
  uint c = hash((i + ivec2(0, 1)) & 255, seed) >> 22u, d = hash((i + ivec2(1, 1)) & 255, seed) >> 22u;
  uint ab = (a * (1024u - s.x) + b * s.x) >> 10u, cd = (c * (1024u - s.x) + d * s.x) >> 10u;
  return (ab * (1024u - s.y) + cd * s.y) >> 10u;
}
int bayer8(ivec2 c) {
  int v = 0;
  for (int k = 0; k < 3; k++) {
    int a = (c.x >> k) & 1, b = (c.y >> k) & 1;
    v += ((a ^ b) * 2 + b) << (2 * (2 - k));
  }
  return v;
}
float u01(uint h) { return float(h >> 8u) * (1.0 / 16777216.0); }
int iss(int n, int lo, int hi) { int s = min(max(n - lo, 0) * 1024 / (hi - lo), 1024); return (s * s * (3072 - 2 * s)) >> 20; }
void main() {
  int flags = grid.w, D = grid.z;
  ivec2 fc = ivec2(gl_FragCoord.xy);
  if ((flags & 4) != 0) fc.y = grid.y - 1 - fc.y;
  ivec2 c = origin.xy + fc;
  ivec4 r = ivec4(c * D, c * D + D);
  float dpr = timef.z, t = timef.x, tf = timef.y;
  int cap = 4; float dmin = 1e9;
  for (int i = 0; i < 32; i++) {
    if (i >= counts.x) break;
    ivec4 z = zones[i];
    if (r.x < z.z && r.z > z.x && r.y < z.w && r.w > z.y) cap = 2;
    ivec2 g = max(max(z.xy - r.zw, r.xy - z.zw), ivec2(0));
    dmin = min(dmin, length(vec2(g)) / dpr);
  }
  bool flatF = (flags & 2) != 0;
  float e = (cap == 2) ? 0.0 : (flatF ? 1.0 : smoothstep(0.0, 32.0, dmin));
  float cssX = (float(c.x * D) + float(D) * 0.5) / dpr, cssY = (float(c.y * D) + float(D) * 0.5) / dpr;
  int cyd = r.y + D / 2;
  int bi = -1;
  for (int i = 0; i < 8; i++) { if (i >= counts.w) break; if (cyd >= sections[i].x && cyd < sections[i].y) bi = i; }
  int kind = 0;
  if (bi >= 0) {
    kind = sections[bi].z;
    float u = u01(hash(c, 6u)), e0 = float(sections[bi].x) / dpr, e1 = float(sections[bi].y) / dpr;
    if (bi > 0 && cssY - e0 < 140.0) { if (u >= smoothstep(e0 - 140.0, e0 + 140.0, cssY)) kind = sections[bi - 1].z; }
    else if (bi + 1 < counts.w && e1 - cssY < 140.0) { if (u < smoothstep(e1 - 140.0, e1 + 140.0, cssY)) kind = sections[bi + 1].z; }
  }
  int dbg = int(misc.w);
  if (dbg == 1) { outColor = vec4(float(kind) / 255.0, 0.0, 0.0, 1.0); return; }
  if (dbg == 2) { int dn = int(vnoise(c * int(misc.z), 9u)); outColor = vec4(float(dn & 255) / 255.0, float(dn >> 8) / 255.0, 0.0, 1.0); return; }
  // Pointer input: trails[i] = (x, y page device px, a = age / 1.2 s, 0), ripples[i] = (x, y, age s, 0).
  vec2 pc = vec2(r.xy + D / 2) / dpr;
  vec2 sw = vec2(0.0);
  float wake = 0.0, wakeHot = 0.0, rip = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= counts.y) break;
    vec4 p = trails[i];
    float a = clamp(p.z, 0.0, 1.0);
    float sg = 24.0 + 80.0 * a;
    vec2 d = pc - p.xy / dpr;
    float g = exp(-dot(d, d) / (2.0 * sg * sg)) * (1.0 - a);
    sw += vec2(-d.y, d.x) * g * 0.8;
    wake = max(wake, g * 0.38);
    wakeHot = max(wakeHot, g * (1.0 - a) * (1.0 - a));
  }
  for (int i = 0; i < 3; i++) {
    if (i >= counts.z) break;
    vec4 p = ripples[i];
    float rr = (length(pc - p.xy / dpr) - 480.0 * p.z) / 16.0;
    rip += exp(-rr * rr) * max(0.0, 1.0 - p.z / 1.4);
  }
  float swl = length(sw);
  if (swl > 20.0) sw *= 20.0 / swl;
  vec2 swc = sw * dpr / float(D);
  ivec2 t51 = ivec2(floor(swc * 51.0 + 0.5)), t128 = ivec2(floor(swc * 128.0 + 0.5));
  int n = int(vnoise(c * 51 + origin.zw + t51, 1u));
  int vd = (n * 128 + 511) / 1023;
  int vh = min(max(int(vnoise(c * 128 + origin.zw * 2 + t128, 2u)) - 634, 0) * 384 / 1023, 128);
  int Lg = int(floor(32.0 * dpr + 0.5));
  bool line = (c.x * D) % Lg < D || (c.y * D) % Lg < D;
  float yb = mod(cssY - float(sections[0].w) / 16.0, 1100.0);
  float bandA = (yb - 550.0) / 46.0;
  float band = exp(-bandA * bandA);
  bool ph = (flags & 32) != 0;
  if (kind == 1 || kind == 7) {
    vd = (line ? 18 + int(59.0 * band) : 0) + ((13 * iss(n, 757, 941)) >> 10);
    if (kind == 7) vd = min(vd * 147 / 128, 128);
    vh = line ? int(96.0 * band) : 0;
  } else if (kind == 6) {
    vd = (line ? 10 + int(49.0 * band) : 0) + ((6 * iss(n, 839, 972)) >> 10);
    vh = line ? int(77.0 * band) : 0;
  } else if (kind == 2) {
    float px = cssX + extra.y, py = cssY + extra.z;
    ivec2 b = ivec2(floor(px / 56.0), floor(py / 56.0));
    float hs = u01(hash(b, 11u));
    bool sb = hs >= 1.0 - 0.22 * (ph ? 0.6 : 1.0);
    float ccx = float(b.x) * 56.0 + (0.15 + 0.7 * u01(hash(b, 3u))) * 56.0;
    float ccy = float(b.y) * 56.0 + (0.15 + 0.7 * u01(hash(b, 7u))) * 56.0;
    float r2 = (px - ccx) * (px - ccx) + (py - ccy) * (py - ccy);
    float tw = 0.5 + 0.5 * sin(t * (1.0 + 2.0 * hs) + 30.0 * hs);
    bool star = sb && sqrt(r2) < 0.95 * float(D) / dpr;
    int halo = sb ? int(128.0 * 0.38 * tw * exp(-r2 / 338.0)) : 0;
    vd = min(max(star ? 128 : 0, halo) + ((8 * iss(n, 818, 972)) >> 10), 128);
    vh = star ? int(128.0 * (0.35 + 0.65 * tw)) : 0;
  } else if (kind == 3) {
    float rr = length(vec2(cssX - anchors.x, cssY - anchors.y));
    float rings = 0.5 + 0.5 * sin(rr * 0.045 + eff.x * 1.8);
    float dR = smoothstep(0.82, 1.0, rings) * 0.42 * exp(-rr / 560.0) + 0.58 * exp(-rr / 100.0);
    vd = min(int(128.0 * dR) + ((9 * iss(n, 736, 941)) >> 10), 128);
    vh = int(128.0 * exp(-rr / 150.0));
    vd = int(float(vd) * eff.y); vh = int(float(vh) * eff.y);
  } else if (kind == 4) {
    vd = (20 * iss(n, 818, 972)) >> 10; vh = 0;
  } else if (kind == 5) {
    float edge = max(smoothstep(16.0, 150.0, anchors.z - cssX), smoothstep(16.0, 150.0, cssX - anchors.w));
    int colI = int(floor(cssX / 8.0));
    float sp = 0.22 + 0.3 * u01(hash(ivec2(colI, 3), 12u));
    int sn = int(vnoise(ivec2(colI * 379, int(floor((cssY * 0.006 - eff.z * sp) * 1024.0))), 5u));
    float stream = smoothstep(0.68, 0.95, float(sn) / 1023.0);
    float trA = (cssY - extra.x) / 18.0;
    float tr = exp(-trA * trA) * edge * (mod(cssX, 16.0) < 8.0 ? 1.0 : 0.0) * eff.w;
    vd = min(int(128.0 * (0.30 * stream * edge + 0.30 * tr)), 128);
    vh = int(128.0 * 0.55 * tr);
  }
  int letter = 0;
  if (maskR.z > 0) {
    float fade = smoothstep(0.4, 0.9, tf);
    vd = int(float(vd) * fade); vh = int(float(vh) * fade);
    if (tf < 0.9) {
      float w = 0.4 + 1.2 * clamp(float(fc.x) / max(timef.w, 1.0), 0.0, 1.0);
      if (u01(hash(c, 100u + uint(floor(10.0 * tf)))) < 0.02 * smoothstep(0.0, 0.9, tf) * w) vh = 256;
    }
    ivec2 m = c - maskR.xy; bool gate = true;
    int mode = int(extra.w);
    if (mode == 0) {
      vec2 C = vec2(maskR.xy) + vec2(maskR.zw) * 0.5, qv = vec2(c) + 0.5 + swc - C;
      float R = 0.75 * float(max(maskR.z, maskR.w));
      float tw = tf < 1.5 ? 4.6 * smoothstep(0.9, 1.5, tf) : 4.6 * (1.0 - smoothstep(1.5, 2.4, tf));
      float sc = 1.8 - 0.8 * smoothstep(1.5, 2.4, tf);
      float ang = -tw * max(0.0, 1.0 - length(qv) / R);
      vec2 src = C + mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * qv / sc;
      m = ivec2(floor(src)) - maskR.xy;
    } else if (mode == 1) gate = float(vnoise(c * 51, 8u)) < 1024.0 * smoothstep(0.9, 2.4, tf);
    float appear = tf >= 3.2 ? 0.8 + 0.2 * misc.y : smoothstep(0.9, 1.5, tf) * (0.6 + 0.4 * smoothstep(1.5, 2.4, tf));
    bool keep = misc.z < 0.5 || 0.85 * float(vnoise(c * int(misc.z), 9u)) / 1023.0 + 0.1 > misc.x;
    if (tf >= 0.9 && m.x >= 0 && m.y >= 0 && m.x < maskR.z && m.y < maskR.w && texelFetch(uMask, m, 0).r > 0.5
        && gate && keep && u01(hash(c, 7u)) < appear) letter = (tf >= 2.4 && tf < 2.7) ? 200 : 192;
  }
  vd = min(vd + int(128.0 * (wake + 0.6 * rip)), 128);
  vh = max(vh, int(128.0 * min(1.0, max(0.78 * wakeHot, 0.75 * rip))));
  if (ph) vd = vd * 3 / 5;
  vh = int(float(vh) * e);
  vd = int(float(vd) * (0.5 + 0.5 * e));
  int vf = letter > 0 ? letter : vd + vh;
  if (flatF) vf = 256;
  vf = min(vf, 128 + int(128.0 * e));
  int idx = clamp((vf + bayer8(c)) >> 6, 0, 4);
  if ((flags & 16) != 0 && letter > 0 && cap == 2 && bayer8(c) < 32) idx = 0;
  idx = min(idx, cap);
  outColor = palette[idx];
}`;

/** Creates the backend on `canvas`, or returns null when the canvas gives no WebGL2 context. `onLost` and `onRestored`
 *  report the context events; the caller then resets the step-down monitor (A-3) and decides about the canvas.
 *  Also returns null (D-063) when the unmasked renderer string says SwiftShader, unless `allowSoftware` (test build only). */
export function createWebGl2(canvas: HTMLCanvasElement, onLost: () => void, onRestored: () => void, allowSoftware = false): Backend | null {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
  });
  if (!gl) return null;
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "unknown";
  if (!allowSoftware && name.includes("SwiftShader")) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return null;
  }
  let lost = false;
  let cw = 1;
  let ch = 1;
  let mask: { data: Uint8Array; w: number; h: number } = { data: new Uint8Array(1), w: 1, h: 1 };
  let prog: WebGLProgram | null = null;
  let ubo: WebGLBuffer | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let maskTex: WebGLTexture | null = null;
  const lose = gl.getExtension("WEBGL_lose_context");

  // A context can die while it is being set up: compile or link then fails with an empty log before isContextLost()
  // turns true. That counts as a loss; the restore event rebuilds everything.
  const compile = (): WebGLProgram | null => {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]] as const) {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        if (gl.isContextLost() || !log) return null;
        throw new Error(log);
      }
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p);
      if (gl.isContextLost() || !log) return null;
      throw new Error(log);
    }
    gl.uniformBlockBinding(p, gl.getUniformBlockIndex(p, "U"), 0);
    return p;
  };
  const uploadMask = (): void => {
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, mask.w, mask.h, 0, gl.RED, gl.UNSIGNED_BYTE, mask.data);
  };
  const init = (): void => {
    // On by default and again after a restore: it may store either neighbour of a palette value per pixel (Claim 2).
    gl.disable(gl.DITHER);
    prog = compile();
    if (!prog) {
      lost = true;
      return;
    }
    gl.useProgram(prog);
    gl.uniform1i(gl.getUniformLocation(prog, "uMask"), 0);
    ubo = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
    gl.bufferData(gl.UNIFORM_BUFFER, UNIFORM_BYTES, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);
    vao = gl.createVertexArray();
    maskTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
    for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE);
    uploadMask();
  };
  canvas.addEventListener("webglcontextlost", (ev) => {
    ev.preventDefault();
    lost = true;
    onLost();
  });
  canvas.addEventListener("webglcontextrestored", () => {
    lost = false;
    init();
    if (!lost) onRestored();
  });
  init();

  const drawNow = (uniforms: ArrayBuffer): void => {
    // The direct draw has gl_FragCoord's origin at the bottom: flag 4 flips the rows back.
    new Int32Array(uniforms, 0, 4)[3] |= FLAG_FLIP;
    gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, uniforms);
    gl.bindVertexArray(vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  return {
    api: "webgl2",
    name,
    resize(cellsW, cellsH) {
      canvas.width = cellsW;
      canvas.height = cellsH;
      cw = gl.drawingBufferWidth;
      ch = gl.drawingBufferHeight;
      return cw >= cellsW && ch >= cellsH;
    },
    setMask(data, w, h) {
      mask = data ? { data, w, h } : { data: new Uint8Array(1), w: 1, h: 1 };
      if (!lost) uploadMask();
    },
    draw(uniforms) {
      if (lost) return false;
      drawNow(uniforms);
      return true;
    },
    async read(uniforms, r0, r1) {
      const n = Math.max(0, Math.min(ch, r1) - Math.max(0, r0));
      const row = Math.max(0, r0);
      if (lost || n === 0) return new Uint8Array(0);
      drawNow(uniforms);
      const px = new Uint8Array(cw * n * 4);
      const out = new Uint8Array(cw * n * 4);
      const rb = cw * 4;
      gl.readPixels(0, ch - (row + n), cw, n, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let j = 0; j < n; j++) out.set(px.subarray((n - 1 - j) * rb, (n - j) * rb), j * rb);
      return out;
    },
    // readPixels cannot return before every earlier draw into the framebuffer has finished.
    async sync() {
      if (!lost) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    },
    lose() {
      lose?.loseContext();
    },
    destroy() {
      lose?.loseContext();
    },
  };
}
