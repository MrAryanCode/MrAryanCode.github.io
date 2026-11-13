// A CPU copy of the cell pass (algorithms.md A-1, A-2; the GLSL in src/gpu/webgl2.ts and the WGSL in src/gpu/layer.ts), written
// from the shader text. It reads the same 73-row uniform block the shaders read, so a test that fills the block with
// core.ts's UniformBlock and then calls cell() checks the writer and the pass together. Integers are exact (Math.imul and
// >>> 0 for the unsigned arithmetic); float steps are rounded to f32 with Math.fround after each operation, as the GPU
// computes them. `sin`, `exp` and `sqrt` are the JavaScript ones, so the float-part cells (stars, rings, rails, twist) agree
// with a GPU only to the integer they truncate to, which is why the parity tests compare the other cells bit for bit.
const f = Math.fround;

export function pcg3d(x, y, z) {
  x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
  y = (Math.imul(y, 1664525) + 1013904223) >>> 0;
  z = (Math.imul(z, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0;
  y = (y + Math.imul(z, x)) >>> 0;
  z = (z + Math.imul(x, y)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  y = (y ^ (y >>> 16)) >>> 0;
  z = (z ^ (z >>> 16)) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0;
  y = (y + Math.imul(z, x)) >>> 0;
  z = (z + Math.imul(x, y)) >>> 0;
  return [x, y, z];
}

const hash = (cx, cy, seed) => pcg3d(cx >>> 0, cy >>> 0, seed)[0];

export function vnoise(px, py, seed) {
  const ix = px >> 10, iy = py >> 10, fx = px & 1023, fy = py & 1023;
  const sx = Math.floor((fx * fx * (3072 - 2 * fx)) / 1048576), sy = Math.floor((fy * fy * (3072 - 2 * fy)) / 1048576);
  const h = (a, b) => hash(a & 255, b & 255, seed) >>> 22;
  const ab = (h(ix, iy) * (1024 - sx) + h(ix + 1, iy) * sx) >> 10;
  const cd = (h(ix, iy + 1) * (1024 - sx) + h(ix + 1, iy + 1) * sx) >> 10;
  return (ab * (1024 - sy) + cd * sy) >> 10;
}

export function bayer8(x, y) {
  let v = 0;
  for (let k = 0; k < 3; k++) {
    const a = (x >> k) & 1, b = (y >> k) & 1;
    v += ((a ^ b) * 2 + b) << (2 * (2 - k));
  }
  return v;
}

const u01 = (h) => f((h >>> 8) * (1 / 16777216));
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
const smoothstep = (a, b, x) => {
  const t = f(clamp(f(f(x - a) / f(b - a)), 0, 1));
  return f(f(t * t) * f(3 - f(2 * t)));
};
const mod = (x, y) => f(x - f(y * Math.floor(f(x / y))));
const iss = (n, lo, hi) => {
  const s = Math.min(Math.trunc((Math.max(n - lo, 0) * 1024) / (hi - lo)), 1024);
  return (s * s * (3072 - 2 * s)) >> 20;
};
const itrunc = (x) => Math.trunc(x);

/** The palette index and the working values of one cell. `u` is a 1,168-byte uniform block (core.ts's UniformBlock.write);
 *  `mask` is the R8 mask as a Uint8Array of maskR.z x maskR.w texels, or null. Cell (cx, cy) is the page cell. */
export function cell(u, cx, cy, mask = null) {
  const I = new Int32Array(u), F = new Float32Array(u);
  const D = I[2], flags = I[3];
  const origin = [I[4], I[5], I[6], I[7]];
  const nz = I[8], nt = I[9], nr = I[10], ns = I[11];
  const maskR = [I[12], I[13], I[14], I[15]];
  const eff = [F[16], F[17], F[18], F[19]];
  const timef = [F[20], F[21], F[22], F[23]];
  const misc = [F[24], F[25], F[26], F[27]];
  const dpr = timef[2], t = timef[0], tf = timef[1];
  const anchors = [F[284], F[285], F[286], F[287]];
  const extra = [F[288], F[289], F[290], F[291]];
  const fcx = cx - origin[0];
  const c = [cx, cy];
  const r = [cx * D, cy * D, cx * D + D, cy * D + D];

  let cap = 4, dmin = f(1e9);
  for (let i = 0; i < Math.min(nz, 32); i++) {
    const z = [I[28 + 4 * i], I[29 + 4 * i], I[30 + 4 * i], I[31 + 4 * i]];
    if (r[0] < z[2] && r[2] > z[0] && r[1] < z[3] && r[3] > z[1]) cap = 2;
    const gx = Math.max(Math.max(z[0] - r[2], r[0] - z[2]), 0), gy = Math.max(Math.max(z[1] - r[3], r[1] - z[3]), 0);
    dmin = Math.min(dmin, f(f(Math.sqrt(f(gx * gx + gy * gy))) / dpr));
  }
  const flat = (flags & 2) !== 0;
  const e = cap === 2 ? 0 : flat ? 1 : smoothstep(0, 32, dmin);
  const cssX = f(f(f(cx * D) + f(D * 0.5)) / dpr), cssY = f(f(f(cy * D) + f(D * 0.5)) / dpr);
  const cyd = r[1] + Math.trunc(D / 2);
  const sec = (k) => [I[232 + 4 * k], I[233 + 4 * k], I[234 + 4 * k], I[235 + 4 * k]];
  let bi = -1;
  for (let i = 0; i < Math.min(ns, 8); i++) if (cyd >= sec(i)[0] && cyd < sec(i)[1]) bi = i;
  let kind = 0;
  if (bi >= 0) {
    kind = sec(bi)[2];
    const u0 = u01(hash(cx, cy, 6)), e0 = f(sec(bi)[0] / dpr), e1 = f(sec(bi)[1] / dpr);
    if (bi > 0 && f(cssY - e0) < 140) {
      if (u0 >= smoothstep(e0 - 140, e0 + 140, cssY)) kind = sec(bi - 1)[2];
    } else if (bi + 1 < ns && f(e1 - cssY) < 140) {
      if (u0 < smoothstep(e1 - 140, e1 + 140, cssY)) kind = sec(bi + 1)[2];
    }
  }

  // Pointer input.
  const pc = [f(f(r[0] + Math.trunc(D / 2)) / dpr), f(f(r[1] + Math.trunc(D / 2)) / dpr)];
  let sw = [0, 0], wake = 0, wakeHot = 0, rip = 0;
  for (let i = 0; i < Math.min(nt, 16); i++) {
    const p = [F[156 + 4 * i], F[157 + 4 * i], F[158 + 4 * i]];
    const a = clamp(p[2], 0, 1);
    const sg = f(24 + f(80 * a));
    const d = [f(pc[0] - f(p[0] / dpr)), f(pc[1] - f(p[1] / dpr))];
    const g = f(f(Math.exp(-f(f(d[0] * d[0] + d[1] * d[1]) / f(2 * sg * sg)))) * f(1 - a));
    sw = [f(sw[0] + f(f(-d[1] * g) * 0.8)), f(sw[1] + f(f(d[0] * g) * 0.8))];
    wake = Math.max(wake, f(g * 0.38));
    wakeHot = Math.max(wakeHot, f(f(g * f(1 - a)) * f(1 - a)));
  }
  for (let i = 0; i < Math.min(nr, 3); i++) {
    const p = [F[220 + 4 * i], F[221 + 4 * i], F[222 + 4 * i]];
    const dx = f(pc[0] - f(p[0] / dpr)), dy = f(pc[1] - f(p[1] / dpr));
    const rr = f(f(f(Math.sqrt(f(dx * dx + dy * dy))) - f(480 * p[2])) / 16);
    rip = f(rip + f(f(Math.exp(-f(rr * rr))) * Math.max(0, f(1 - f(p[2] / 1.4)))));
  }
  const swl = f(Math.hypot(sw[0], sw[1]));
  if (swl > 20) sw = [f(sw[0] * f(20 / swl)), f(sw[1] * f(20 / swl))];
  const swc = [f(f(sw[0] * dpr) / D), f(f(sw[1] * dpr) / D)];
  const t51 = [Math.floor(f(f(swc[0] * 51) + 0.5)), Math.floor(f(f(swc[1] * 51) + 0.5))];
  const t128 = [Math.floor(f(f(swc[0] * 128) + 0.5)), Math.floor(f(f(swc[1] * 128) + 0.5))];
  const n = vnoise(cx * 51 + origin[2] + t51[0], cy * 51 + origin[3] + t51[1], 1);
  let vd = Math.trunc((n * 128 + 511) / 1023);
  let vh = Math.min(Math.trunc((Math.max(vnoise(cx * 128 + origin[2] * 2 + t128[0], cy * 128 + origin[3] * 2 + t128[1], 2) - 634, 0) * 384) / 1023), 128);
  const Lg = Math.floor(f(f(32 * dpr) + 0.5));
  const line = (cx * D) % Lg < D || (cy * D) % Lg < D;
  const yb = mod(f(cssY - f(sec(0)[3] / 16)), 1100);
  const bandA = f(f(yb - 550) / 46);
  const band = f(Math.exp(-f(bandA * bandA)));
  const ph = (flags & 32) !== 0;
  if (kind === 1 || kind === 7) {
    vd = (line ? 18 + itrunc(f(59 * band)) : 0) + ((13 * iss(n, 757, 941)) >> 10);
    if (kind === 7) vd = Math.min(Math.trunc((vd * 147) / 128), 128);
    vh = line ? itrunc(f(96 * band)) : 0;
  } else if (kind === 6) {
    vd = (line ? 10 + itrunc(f(49 * band)) : 0) + ((6 * iss(n, 839, 972)) >> 10);
    vh = line ? itrunc(f(77 * band)) : 0;
  } else if (kind === 2) {
    const px = f(cssX + extra[1]), py = f(cssY + extra[2]);
    const bx = Math.floor(f(px / 56)), by = Math.floor(f(py / 56));
    const hs = u01(hash(bx, by, 11));
    const sb = hs >= f(1 - f(0.22 * (ph ? 0.6 : 1)));
    const ccx = f(f(bx * 56) + f(f(0.15 + f(0.7 * u01(hash(bx, by, 3)))) * 56));
    const ccy = f(f(by * 56) + f(f(0.15 + f(0.7 * u01(hash(bx, by, 7)))) * 56));
    const r2 = f(f(f(px - ccx) * f(px - ccx)) + f(f(py - ccy) * f(py - ccy)));
    const tw = f(0.5 + f(0.5 * f(Math.sin(f(f(t * f(1 + f(2 * hs))) + f(30 * hs))))));
    const star = sb && f(Math.sqrt(r2)) < f(f(0.95 * D) / dpr);
    const halo = sb ? itrunc(f(f(f(128 * 0.38) * tw) * f(Math.exp(-f(r2 / 338))))) : 0;
    vd = Math.min(Math.max(star ? 128 : 0, halo) + ((8 * iss(n, 818, 972)) >> 10), 128);
    vh = star ? itrunc(f(128 * f(0.35 + f(0.65 * tw)))) : 0;
  } else if (kind === 3) {
    const rr = f(Math.hypot(f(cssX - anchors[0]), f(cssY - anchors[1])));
    const rings = f(0.5 + f(0.5 * f(Math.sin(f(f(rr * 0.045) + f(eff[0] * 1.8))))));
    const dR = f(f(f(smoothstep(0.82, 1.0, rings) * 0.42) * f(Math.exp(-f(rr / 560)))) + f(0.58 * f(Math.exp(-f(rr / 100)))));
    vd = Math.min(itrunc(f(128 * dR)) + ((9 * iss(n, 736, 941)) >> 10), 128);
    vh = itrunc(f(128 * f(Math.exp(-f(rr / 150)))));
    vd = itrunc(f(vd * eff[1]));
    vh = itrunc(f(vh * eff[1]));
  } else if (kind === 4) {
    vd = (20 * iss(n, 818, 972)) >> 10;
    vh = 0;
  } else if (kind === 5) {
    const edge = Math.max(smoothstep(16, 150, f(anchors[2] - cssX)), smoothstep(16, 150, f(cssX - anchors[3])));
    const colI = Math.floor(f(cssX / 8));
    const sp = f(0.22 + f(0.3 * u01(hash(colI, 3, 12))));
    const sn = vnoise(colI * 379, Math.floor(f(f(f(cssY * 0.006) - f(eff[2] * sp)) * 1024)), 5);
    const stream = smoothstep(0.68, 0.95, f(sn / 1023));
    const trA = f(f(cssY - extra[0]) / 18);
    const tr = f(f(f(f(Math.exp(-f(trA * trA))) * edge) * (mod(cssX, 16) < 8 ? 1 : 0)) * eff[3]);
    vd = Math.min(itrunc(f(128 * f(f(f(0.3 * stream) * edge) + f(0.3 * tr)))), 128);
    vh = itrunc(f(f(128 * 0.55) * tr));
  }

  let letter = 0, clock = null;
  if (maskR[2] > 0) {
    const fade = smoothstep(0.4, 0.9, tf);
    vd = itrunc(f(vd * fade));
    vh = itrunc(f(vh * fade));
    if (tf < 0.9) {
      const w = f(0.4 + f(1.2 * clamp(f(fcx / Math.max(timef[3], 1)), 0, 1)));
      if (u01(hash(cx, cy, 100 + Math.floor(f(10 * tf)))) < f(f(0.02 * smoothstep(0, 0.9, tf)) * w)) vh = 256;
    }
    let m = [cx - maskR[0], cy - maskR[1]];
    let gate = true;
    const mode = itrunc(extra[3]);
    let tw = 0, sc = 1;
    if (mode === 0) {
      const C = [f(maskR[0] + f(maskR[2] * 0.5)), f(maskR[1] + f(maskR[3] * 0.5))];
      const qv = [f(f(f(cx + 0.5) + swc[0]) - C[0]), f(f(f(cy + 0.5) + swc[1]) - C[1])];
      const R = f(0.75 * Math.max(maskR[2], maskR[3]));
      tw = tf < 1.5 ? f(4.6 * smoothstep(0.9, 1.5, tf)) : f(4.6 * f(1 - smoothstep(1.5, 2.4, tf)));
      sc = f(1.8 - f(0.8 * smoothstep(1.5, 2.4, tf)));
      const ang = f(-tw * Math.max(0, f(1 - f(f(Math.hypot(qv[0], qv[1])) / R))));
      const ca = f(Math.cos(ang)), sa = f(Math.sin(ang));
      const src = [f(C[0] + f(f(f(ca * qv[0]) + f(-sa * qv[1])) / sc)), f(C[1] + f(f(f(sa * qv[0]) + f(ca * qv[1])) / sc))];
      m = [Math.floor(src[0]) - maskR[0], Math.floor(src[1]) - maskR[1]];
    } else if (mode === 1) gate = vnoise(cx * 51, cy * 51, 8) < f(1024 * smoothstep(0.9, 2.4, tf));
    const appear = tf >= 3.2 ? f(0.8 + f(0.2 * misc[1])) : f(smoothstep(0.9, 1.5, tf) * f(0.6 + f(0.4 * smoothstep(1.5, 2.4, tf))));
    clock = { fade, appear, m, tw, sc };
    const keep = misc[2] < 0.5 || f(f(f(0.85 * vnoise(cx * itrunc(misc[2]), cy * itrunc(misc[2]), 9)) / 1023) + 0.1) > misc[0];
    if (tf >= 0.9 && m[0] >= 0 && m[1] >= 0 && m[0] < maskR[2] && m[1] < maskR[3] && mask && mask[m[1] * maskR[2] + m[0]] > 127 && gate && keep && u01(hash(cx, cy, 7)) < appear) {
      letter = tf >= 2.4 && tf < 2.7 ? 200 : 192;
    }
  }
  const vdBefore = vd, vhBefore = vh;
  vd = Math.min(vd + itrunc(f(128 * f(wake + f(0.6 * rip)))), 128);
  vh = Math.max(vh, itrunc(f(128 * Math.min(1, Math.max(f(0.78 * wakeHot), f(0.75 * rip))))));
  const vdLifted = vd, vhLifted = vh;
  if (ph) vd = Math.trunc((vd * 3) / 5);
  vh = itrunc(f(vh * e));
  vd = itrunc(f(vd * f(0.5 + f(0.5 * e))));
  let vf = letter > 0 ? letter : vd + vh;
  if (flat) vf = 256;
  vf = Math.min(vf, 128 + itrunc(f(128 * e)));
  const bayer = bayer8(c[0], c[1]);
  let idx = clamp((vf + bayer) >> 6, 0, 4);
  if ((flags & 16) !== 0 && letter > 0 && cap === 2 && bayer < 32) idx = 0;
  idx = Math.min(idx, cap);
  return { idx, kind, cap, e, n, clock, vd, vh, vf, bayer, letter, dmin, wake, wakeHot, rip, sw, vdBefore, vhBefore, vdLifted, vhLifted };
}

/** The palette index of an RGB triple in a theme, or -1. `palette` is core.ts's PALETTE[theme]. */
export function indexOf(palette, r, g, b) {
  return palette.findIndex((hex) => {
    const v = parseInt(hex.slice(1), 16);
    return ((v >> 16) & 255) === r && ((v >> 8) & 255) === g && (v & 255) === b;
  });
}
