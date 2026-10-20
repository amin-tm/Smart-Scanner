/*
 * Core image processing engine (pure TypeScript, runs inside a Web Worker).
 *  - Perspective rectification with bicubic (Catmull-Rom) sampling
 *  - True aspect-ratio estimation of the photographed sheet (Zhang & He)
 *  - Content-aware illumination / paper-colour estimation (shadow removal)
 *  - Filters: Magic Color, No-Shadow, Lighten, Grayscale, B&W
 *  - Unsharp mask, brightness / contrast, border cleaning
 */
import type { Adjust, FilterId, Pt, Quad } from './types';

export interface RGBAImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Reference long side = A4 @ 300 DPI. Kernel sizes scale relative to this. */
export const REF_LONG = 3508;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/* =====================================================================
 * Geometry
 * ===================================================================== */

function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    if (piv !== c) {
      const t = M[c];
      M[c] = M[piv];
      M[piv] = t;
    }
    const pv = M[c][c];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / pv;
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x: number[] = new Array(n);
  for (let i = 0; i < n; i++) x[i] = M[i][n] / M[i][i];
  return x;
}

/** Homography (row-major 3x3, h[8]=1) mapping src points onto dst points. */
export function homography(src: Pt[], dst: Pt[]): number[] | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const X = dst[i].x;
    const Y = dst[i].y;
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
    b.push(Y);
  }
  const h = solveLinear(A, b);
  return h ? [...h, 1] : null;
}

export function applyH(h: number[], x: number, y: number): Pt {
  const d = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / d, y: (h[3] * x + h[4] * y + h[5]) / d };
}

export function polygonArea(q: Pt[]): number {
  let a = 0;
  for (let i = 0; i < q.length; i++) {
    const p = q[i];
    const n = q[(i + 1) % q.length];
    a += p.x * n.y - n.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function isConvex(q: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cr) < 1e-12) return false;
    const s = cr > 0 ? 1 : -1;
    if (!sign) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Order 4 points as TL, TR, BR, BL (clockwise on screen). */
export function orderQuad(pts: Pt[]): Quad {
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
  const sorted = [...pts].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  let start = 0;
  let best = Infinity;
  sorted.forEach((p, i) => {
    const s = p.x + p.y;
    if (s < best) {
      best = s;
      start = i;
    }
  });
  return [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]) as Quad;
}

/** Min & max interior angle in degrees. */
export function quadAngles(q: Pt[]): [number, number] {
  let mn = 180;
  let mx = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[(i + 3) % 4];
    const c = q[i];
    const n = q[(i + 1) % 4];
    const ax = p.x - c.x;
    const ay = p.y - c.y;
    const bx = n.x - c.x;
    const by = n.y - c.y;
    const den = Math.hypot(ax, ay) * Math.hypot(bx, by);
    if (den < 1e-9) return [0, 180];
    const ang = (Math.acos(clamp((ax * bx + ay * by) / den, -1, 1)) * 180) / Math.PI;
    if (ang < mn) mn = ang;
    if (ang > mx) mx = ang;
  }
  return [mn, mx];
}

/**
 * Estimates the real width/height ratio of the photographed rectangle
 * (Zhang & He, "Whiteboard scanning and image enhancement").
 */
export function estimateAspect(q: Quad, imgW: number, imgH: number): number {
  const wTop = dist(q[0], q[1]);
  const wBot = dist(q[3], q[2]);
  const hL = dist(q[0], q[3]);
  const hR = dist(q[1], q[2]);
  const simple = (wTop + wBot) / Math.max(1e-6, hL + hR);
  const u0 = imgW / 2;
  const v0 = imgH / 2;
  const m1 = [q[0].x - u0, q[0].y - v0, 1];
  const m2 = [q[1].x - u0, q[1].y - v0, 1];
  const m3 = [q[3].x - u0, q[3].y - v0, 1];
  const m4 = [q[2].x - u0, q[2].y - v0, 1];
  const cross = (a: number[], b: number[]) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const d2 = dot(cross(m2, m4), m3);
  const d3 = dot(cross(m3, m4), m2);
  if (Math.abs(d2) < 1e-9 || Math.abs(d3) < 1e-9) return simple;
  const c14 = cross(m1, m4);
  const k2 = dot(c14, m3) / d2;
  const k3 = dot(c14, m2) / d3;
  const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 - 1];
  const n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 - 1];
  const longSide = Math.max(imgW, imgH);
  let f2 = 0;
  if (Math.abs(n2[2]) > 1e-3 && Math.abs(n3[2]) > 1e-3) {
    f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
  }
  const f = f2 > 0 ? Math.sqrt(f2) : 0;
  const fUse = f > 0.4 * longSide && f < 5 * longSide ? f : 0.85 * longSide;
  const F2 = fUse * fUse;
  const num = n2[0] * n2[0] + n2[1] * n2[1] + F2 * n2[2] * n2[2];
  const den = n3[0] * n3[0] + n3[1] * n3[1] + F2 * n3[2] * n3[2];
  if (!(num > 0) || !(den > 0)) return simple;
  const ratio = Math.sqrt(num / den);
  if (!isFinite(ratio) || ratio / simple > 1.6 || ratio / simple < 0.62) return simple;
  return ratio;
}

/** Natural output size (in source pixels) that keeps the full resolution. */
export function outputSize(q: Quad, imgW: number, imgH: number): { w: number; h: number } {
  const ratio = estimateAspect(q, imgW, imgH);
  const wMax = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  const hMax = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  let w: number;
  let h: number;
  if (wMax / Math.max(1e-6, hMax) >= ratio) {
    w = wMax;
    h = wMax / ratio;
  } else {
    h = hMax;
    w = hMax * ratio;
  }
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

/** Rotates the output by k quarter turns clockwise (by re-ordering corners). */
export function rotateQuad(q: Quad, k: number): Quad {
  const r = ((k % 4) + 4) % 4;
  return [0, 1, 2, 3].map((i) => q[(i + 4 - r) % 4]) as Quad;
}

export function planOutput(
  qpx: Quad,
  W: number,
  H: number,
  rotation: number,
  maxOut: number,
  upscale: boolean,
): { quad: Quad; outW: number; outH: number } {
  let { w, h } = outputSize(qpx, W, H);
  const long = Math.max(w, h);
  let s = 1;
  if (long > maxOut) s = maxOut / long;
  else if (upscale && long < maxOut) s = Math.min(2, maxOut / long);
  w = Math.max(8, Math.round(w * s));
  h = Math.max(8, Math.round(h * s));
  const k = ((rotation % 4) + 4) % 4;
  return { quad: rotateQuad(qpx, k), outW: k % 2 ? h : w, outH: k % 2 ? w : h };
}

/* =====================================================================
 * Perspective warp – bicubic Catmull-Rom
 * ===================================================================== */

/**
 * Perspective rectification. `fast` = bilinear sampling (interactive previews,
 * ~2.5x faster); otherwise bicubic Catmull-Rom (final PDF output).
 */
export function warpPerspective(src: RGBAImage, q: Quad, outW: number, outH: number, fast = false): RGBAImage {
  const out = new Uint8ClampedArray(outW * outH * 4);
  const Hm = homography(
    [
      { x: 0, y: 0 },
      { x: outW, y: 0 },
      { x: outW, y: outH },
      { x: 0, y: outH },
    ],
    q,
  );
  if (!Hm) {
    out.fill(255);
    return { data: out, width: outW, height: outH };
  }
  const [h0, h1, h2, h3, h4, h5, h6, h7] = Hm;
  const s = src.data;
  const sw = src.width;
  const sh = src.height;
  const maxX = sw - 1;
  const maxY = sh - 1;
  const stride = sw * 4;
  if (fast) {
    let o = 0;
    for (let v = 0; v < outH; v++) {
      const vc = v + 0.5;
      let nx = h0 * 0.5 + h1 * vc + h2;
      let ny = h3 * 0.5 + h4 * vc + h5;
      let dd = h6 * 0.5 + h7 * vc + 1;
      for (let u = 0; u < outW; u++, o += 4) {
        let sx = nx / dd - 0.5;
        let sy = ny / dd - 0.5;
        nx += h0;
        ny += h3;
        dd += h6;
        // outside the photo (sheet cut off by the frame) -> paper white
        if (sx < -0.5 || sy < -0.5 || sx > maxX + 0.5 || sy > maxY + 0.5) {
          out[o] = 255;
          out[o + 1] = 255;
          out[o + 2] = 255;
          out[o + 3] = 255;
          continue;
        }
        sx = sx < 0 ? 0 : sx > maxX ? maxX : sx;
        sy = sy < 0 ? 0 : sy > maxY ? maxY : sy;
        const xi = sx | 0;
        const yi = sy | 0;
        const fx = sx - xi;
        const fy = sy - yi;
        const i00 = yi * stride + (xi << 2);
        const i01 = xi < maxX ? i00 + 4 : i00;
        const i10 = yi < maxY ? i00 + stride : i00;
        const i11 = xi < maxX ? i10 + 4 : i10;
        const w00 = (1 - fx) * (1 - fy);
        const w01 = fx * (1 - fy);
        const w10 = (1 - fx) * fy;
        const w11 = fx * fy;
        out[o] = s[i00] * w00 + s[i01] * w01 + s[i10] * w10 + s[i11] * w11;
        out[o + 1] = s[i00 + 1] * w00 + s[i01 + 1] * w01 + s[i10 + 1] * w10 + s[i11 + 1] * w11;
        out[o + 2] = s[i00 + 2] * w00 + s[i01 + 2] * w01 + s[i10 + 2] * w10 + s[i11 + 2] * w11;
        out[o + 3] = 255;
      }
    }
    return { data: out, width: outW, height: outH };
  }
  const cx = new Int32Array(4);
  const ry = new Int32Array(4);
  const wy = new Float64Array(4);
  let o = 0;
  for (let v = 0; v < outH; v++) {
    const vc = v + 0.5;
    let nx = h0 * 0.5 + h1 * vc + h2;
    let ny = h3 * 0.5 + h4 * vc + h5;
    let dd = h6 * 0.5 + h7 * vc + 1;
    for (let u = 0; u < outW; u++, o += 4) {
      const sx = nx / dd - 0.5;
      const sy = ny / dd - 0.5;
      nx += h0;
      ny += h3;
      dd += h6;
      if (sx < -0.5 || sy < -0.5 || sx > maxX + 0.5 || sy > maxY + 0.5) {
        out[o] = 255;
        out[o + 1] = 255;
        out[o + 2] = 255;
        out[o + 3] = 255;
        continue;
      }
      const xi = Math.floor(sx);
      const yi = Math.floor(sy);
      const fx = sx - xi;
      const fy = sy - yi;
      const w0 = ((-0.5 * fx + 1.0) * fx - 0.5) * fx;
      const w1 = (1.5 * fx - 2.5) * fx * fx + 1.0;
      const w2 = ((-1.5 * fx + 2.0) * fx + 0.5) * fx;
      const w3 = (0.5 * fx - 0.5) * fx * fx;
      wy[0] = ((-0.5 * fy + 1.0) * fy - 0.5) * fy;
      wy[1] = (1.5 * fy - 2.5) * fy * fy + 1.0;
      wy[2] = ((-1.5 * fy + 2.0) * fy + 0.5) * fy;
      wy[3] = (0.5 * fy - 0.5) * fy * fy;
      for (let k = 0; k < 4; k++) {
        let xx = xi - 1 + k;
        xx = xx < 0 ? 0 : xx > maxX ? maxX : xx;
        cx[k] = xx << 2;
        let yy = yi - 1 + k;
        yy = yy < 0 ? 0 : yy > maxY ? maxY : yy;
        ry[k] = yy * stride;
      }
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < 4; j++) {
        const row = ry[j];
        const i0 = row + cx[0];
        const i1 = row + cx[1];
        const i2 = row + cx[2];
        const i3 = row + cx[3];
        const wj = wy[j];
        r += (s[i0] * w0 + s[i1] * w1 + s[i2] * w2 + s[i3] * w3) * wj;
        g += (s[i0 + 1] * w0 + s[i1 + 1] * w1 + s[i2 + 1] * w2 + s[i3 + 1] * w3) * wj;
        b += (s[i0 + 2] * w0 + s[i1 + 2] * w1 + s[i2 + 2] * w2 + s[i3 + 2] * w3) * wj;
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
  return { data: out, width: outW, height: outH };
}

/* =====================================================================
 * Float map helpers
 * ===================================================================== */

function convH(src: Float32Array, dst: Float32Array, w: number, h: number, k: Float32Array, r: number) {
  const kl = 2 * r;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      if (x >= r && x < w - r) {
        const base = row + x - r;
        for (let t = 0; t <= kl; t++) acc += src[base + t] * k[t];
      } else {
        for (let t = -r; t <= r; t++) {
          let xx = x + t;
          xx = xx < 0 ? 0 : xx >= w ? w - 1 : xx;
          acc += src[row + xx] * k[t + r];
        }
      }
      dst[row + x] = acc;
    }
  }
}

function convV(src: Float32Array, dst: Float32Array, w: number, h: number, k: Float32Array, r: number) {
  for (let y = 0; y < h; y++) {
    const orow = y * w;
    dst.fill(0, orow, orow + w);
    for (let t = -r; t <= r; t++) {
      let yy = y + t;
      yy = yy < 0 ? 0 : yy >= h ? h - 1 : yy;
      const irow = yy * w;
      const kw = k[t + r];
      for (let x = 0; x < w; x++) dst[orow + x] += src[irow + x] * kw;
    }
  }
}

export function gaussBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const out = new Float32Array(src.length);
  if (sigma < 0.25) {
    out.set(src);
    return out;
  }
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(src.length);
  convH(src, tmp, w, h, k, r);
  convV(tmp, out, w, h, k, r);
  return out;
}

export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src.slice();
  const k = new Float32Array(2 * r + 1).fill(1 / (2 * r + 1));
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  convH(src, tmp, w, h, k, r);
  convV(tmp, out, w, h, k, r);
  return out;
}

/** Running max filter on rows (van Herk / Gil-Werman, O(1) per pixel). */
function maxRows(src: Float32Array, w: number, h: number, r: number, out: Float32Array) {
  const k = 2 * r + 1;
  const Lk = Math.ceil((w + 2 * r) / k) * k;
  const g = new Float32Array(Lk);
  const hb = new Float32Array(Lk);
  const pad = -3.4e38;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let b = 0; b < Lk; b += k) {
      let acc = pad;
      for (let i = b; i < b + k; i++) {
        const x = i - r;
        const v = x >= 0 && x < w ? src[row + x] : pad;
        if (v > acc) acc = v;
        g[i] = acc;
      }
      acc = pad;
      for (let i = b + k - 1; i >= b; i--) {
        const x = i - r;
        const v = x >= 0 && x < w ? src[row + x] : pad;
        if (v > acc) acc = v;
        hb[i] = acc;
      }
    }
    for (let x = 0; x < w; x++) {
      const a = hb[x];
      const c = g[x + k - 1];
      out[row + x] = a > c ? a : c;
    }
  }
}

/** Running max filter on columns, processed row-wise (cache friendly). */
function maxCols(src: Float32Array, w: number, h: number, r: number, out: Float32Array) {
  const k = 2 * r + 1;
  const Lk = Math.ceil((h + 2 * r) / k) * k;
  const G = new Float32Array(Lk * w);
  const Hb = new Float32Array(Lk * w);
  const pad = -3.4e38;
  for (let b = 0; b < Lk; b += k) {
    for (let i = b; i < b + k; i++) {
      const y = i - r;
      const valid = y >= 0 && y < h;
      const srow = y * w;
      const dst = i * w;
      if (i === b) {
        for (let x = 0; x < w; x++) G[dst + x] = valid ? src[srow + x] : pad;
      } else {
        const prev = dst - w;
        for (let x = 0; x < w; x++) {
          const v = valid ? src[srow + x] : pad;
          const q = G[prev + x];
          G[dst + x] = v > q ? v : q;
        }
      }
    }
    for (let i = b + k - 1; i >= b; i--) {
      const y = i - r;
      const valid = y >= 0 && y < h;
      const srow = y * w;
      const dst = i * w;
      if (i === b + k - 1) {
        for (let x = 0; x < w; x++) Hb[dst + x] = valid ? src[srow + x] : pad;
      } else {
        const next = dst + w;
        for (let x = 0; x < w; x++) {
          const v = valid ? src[srow + x] : pad;
          const q = Hb[next + x];
          Hb[dst + x] = v > q ? v : q;
        }
      }
    }
  }
  for (let y = 0; y < h; y++) {
    const a0 = y * w;
    const c0 = (y + k - 1) * w;
    for (let x = 0; x < w; x++) {
      const a = Hb[a0 + x];
      const c = G[c0 + x];
      out[a0 + x] = a > c ? a : c;
    }
  }
}

/** Separable square min / max filter — O(1) per pixel regardless of radius. */
export function morph(src: Float32Array, w: number, h: number, r: number, isMax: boolean): Float32Array {
  const n = src.length;
  if (r < 1) return src.slice();
  const tmp = new Float32Array(n);
  const out = new Float32Array(n);
  if (isMax) {
    maxRows(src, w, h, r, tmp);
    maxCols(tmp, w, h, r, out);
  } else {
    const neg = new Float32Array(n);
    for (let i = 0; i < n; i++) neg[i] = -src[i];
    maxRows(neg, w, h, r, tmp);
    maxCols(tmp, w, h, r, out);
    for (let i = 0; i < n; i++) out[i] = -out[i];
  }
  return out;
}

/** Box blur with running sums — O(1) per pixel (edges clamped). */
export function boxBlurFast(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = src[row] * (r + 1);
    for (let x = 1; x <= r; x++) acc += src[row + Math.min(w - 1, x)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * inv;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  const acc = new Float64Array(w);
  for (let x = 0; x < w; x++) acc[x] = tmp[x] * (r + 1);
  for (let yy = 1; yy <= r; yy++) {
    const rr = Math.min(h - 1, yy) * w;
    for (let x = 0; x < w; x++) acc[x] += tmp[rr + x];
  }
  for (let y = 0; y < h; y++) {
    const o = y * w;
    const ra = Math.min(h - 1, y + r + 1) * w;
    const rs = Math.max(0, y - r) * w;
    for (let x = 0; x < w; x++) {
      out[o + x] = acc[x] * inv;
      acc[x] += tmp[ra + x] - tmp[rs + x];
    }
  }
  return out;
}

function percentile(a: Float32Array, q: number, mask?: Float32Array): number {
  const hist = new Float64Array(256);
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    if (mask && !mask[i]) continue;
    let v = a[i] | 0;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    hist[v]++;
    total++;
  }
  if (!total) return 255;
  const target = q * total;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= target) return v + 0.5;
  }
  return 255;
}

function downscaleRGB(img: RGBAImage, sw: number, sh: number): [Float32Array, Float32Array, Float32Array] {
  const { width: W, height: H, data: d } = img;
  const n = sw * sh;
  const R = new Float32Array(n);
  const G = new Float32Array(n);
  const B = new Float32Array(n);
  const C = new Float32Array(n);
  const xm = new Int32Array(W);
  for (let x = 0; x < W; x++) xm[x] = Math.min(sw - 1, Math.floor((x * sw) / W));
  for (let y = 0; y < H; y++) {
    const ty = Math.min(sh - 1, Math.floor((y * sh) / H)) * sw;
    let p = y * W * 4;
    for (let x = 0; x < W; x++, p += 4) {
      const t = ty + xm[x];
      R[t] += d[p];
      G[t] += d[p + 1];
      B[t] += d[p + 2];
      C[t] += 1;
    }
  }
  for (let i = 0; i < n; i++) {
    const c = C[i] || 1;
    R[i] /= c;
    G[i] /= c;
    B[i] /= c;
  }
  return [R, G, B];
}

/** Pyramid push-pull hole filling: fills pixels with mask=0 from their surroundings. */
function pushPull(val: Float32Array, mask: Float32Array, w: number, h: number): Float32Array {
  type Lvl = { v: Float32Array; wt: Float32Array; w: number; h: number };
  const levels: Lvl[] = [];
  let cur: Lvl = { v: new Float32Array(w * h), wt: new Float32Array(w * h), w, h };
  for (let i = 0; i < w * h; i++) {
    cur.wt[i] = mask[i];
    cur.v[i] = val[i] * mask[i];
  }
  levels.push(cur);
  while (cur.w > 1 || cur.h > 1) {
    const nw = Math.max(1, Math.ceil(cur.w / 2));
    const nh = Math.max(1, Math.ceil(cur.h / 2));
    const nxt: Lvl = { v: new Float32Array(nw * nh), wt: new Float32Array(nw * nh), w: nw, h: nh };
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let sv = 0;
        let sw = 0;
        for (let dy = 0; dy < 2; dy++) {
          const yy = 2 * y + dy;
          if (yy >= cur.h) continue;
          for (let dx = 0; dx < 2; dx++) {
            const xx = 2 * x + dx;
            if (xx >= cur.w) continue;
            const i = yy * cur.w + xx;
            sv += cur.v[i];
            sw += cur.wt[i];
          }
        }
        const j = y * nw + x;
        if (sw > 0) {
          const wn = Math.min(1, sw);
          nxt.v[j] = (sv / sw) * wn;
          nxt.wt[j] = wn;
        }
      }
    }
    levels.push(nxt);
    cur = nxt;
  }
  const top = levels[levels.length - 1];
  for (let i = 0; i < top.v.length; i++) {
    top.v[i] = top.wt[i] > 0 ? top.v[i] / top.wt[i] : 0;
    top.wt[i] = 1;
  }
  for (let L = levels.length - 2; L >= 0; L--) {
    const f = levels[L];
    const c = levels[L + 1];
    for (let y = 0; y < f.h; y++) {
      let cy = (y + 0.5) / 2 - 0.5;
      if (cy < 0) cy = 0;
      if (cy > c.h - 1) cy = c.h - 1;
      const y0 = Math.floor(cy);
      const y1 = Math.min(c.h - 1, y0 + 1);
      const fy = cy - y0;
      for (let x = 0; x < f.w; x++) {
        const i = y * f.w + x;
        const wv = f.wt[i];
        if (wv >= 1) {
          f.v[i] = f.v[i] / wv;
          f.wt[i] = 1;
          continue;
        }
        let cx = (x + 0.5) / 2 - 0.5;
        if (cx < 0) cx = 0;
        if (cx > c.w - 1) cx = c.w - 1;
        const x0 = Math.floor(cx);
        const x1 = Math.min(c.w - 1, x0 + 1);
        const fx = cx - x0;
        const a = c.v[y0 * c.w + x0];
        const b = c.v[y0 * c.w + x1];
        const cc = c.v[y1 * c.w + x0];
        const dd = c.v[y1 * c.w + x1];
        const top2 = a + (b - a) * fx;
        const bot2 = cc + (dd - cc) * fx;
        f.v[i] = f.v[i] + (1 - wv) * (top2 + (bot2 - top2) * fy);
        f.wt[i] = 1;
      }
    }
  }
  return levels[0].v;
}

/* =====================================================================
 * Illumination / paper background estimation
 * ===================================================================== */

export interface Background {
  sw: number;
  sh: number;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  pr: number;
  pg: number;
  pb: number;
}

export function estimateBackground(img: RGBAImage): Background {
  const W = img.width;
  const H = img.height;
  const sc = Math.min(1, 360 / Math.max(W, H));
  const sw = Math.max(4, Math.round(W * sc));
  const sh = Math.max(4, Math.round(H * sc));
  const [R, G, B] = downscaleRGB(img, sw, sh);
  const n = sw * sh;
  const Y = new Float32Array(n);
  for (let i = 0; i < n; i++) Y[i] = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i];
  const dim = Math.max(sw, sh);
  // closing removes dark text / thin lines -> paper level
  const r1 = Math.max(2, Math.round(dim * 0.014));
  const closeOp = (a: Float32Array) => morph(morph(a, sw, sh, r1, true), sw, sh, r1, false);
  const Yc = closeOp(Y);
  const Rc = closeOp(R);
  const Gc = closeOp(G);
  const Bc = closeOp(B);
  // big dark areas (photos, filled boxes) are excluded and interpolated
  const r2 = Math.max(3, Math.round(dim * 0.06));
  const Ymax = morph(Yc, sw, sh, r2, true);
  const P = percentile(Yc, 0.95);
  // strongly coloured areas (logos, coloured boxes, photos) are not paper:
  // excluding them prevents colour casts / blotches after normalisation
  const Ch = new Float32Array(n);
  const brightMask = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = Rc[i];
    const g = Gc[i];
    const b = Bc[i];
    Ch[i] = (r > g ? (r > b ? r : b) : g > b ? g : b) - (r < g ? (r < b ? r : b) : g < b ? g : b);
    brightMask[i] = Yc[i] >= 0.85 * P ? 1 : 0;
  }
  const chMax = Math.max(30, percentile(Ch, 0.5, brightMask) * 1.5 + 20);
  const mask = new Float32Array(n);
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    if (Yc[i] >= 0.72 * Ymax[i] && Yc[i] >= 0.42 * P && Ch[i] <= chMax) {
      mask[i] = 1;
      cnt++;
    }
  }
  let Rb: Float32Array;
  let Gb: Float32Array;
  let Bb: Float32Array;
  if (cnt < n * 0.02) {
    Rb = new Float32Array(n).fill(percentile(Rc, 0.9));
    Gb = new Float32Array(n).fill(percentile(Gc, 0.9));
    Bb = new Float32Array(n).fill(percentile(Bc, 0.9));
  } else {
    const br = Math.max(1, Math.round(r1 * 1.5));
    Rb = boxBlur(pushPull(Rc, mask, sw, sh), sw, sh, br);
    Gb = boxBlur(pushPull(Gc, mask, sw, sh), sw, sh, br);
    Bb = boxBlur(pushPull(Bc, mask, sw, sh), sw, sh, br);
  }
  const pr = percentile(Rb, 0.5);
  const pg = percentile(Gb, 0.5);
  const pb = percentile(Bb, 0.5);
  // the paper has one colour: only the illumination may vary, so the local
  // chroma of the background is clamped close to the global paper chroma
  const pl = (pr + pg + pb) / 3 || 1;
  const kr = pr / pl;
  const kg = pg / pl;
  const kb = pb / pl;
  for (let i = 0; i < n; i++) {
    const l = (Rb[i] + Gb[i] + Bb[i]) / 3;
    if (l <= 1) continue;
    Rb[i] = l * clamp(Rb[i] / l, kr * 0.93, kr * 1.07);
    Gb[i] = l * clamp(Gb[i] / l, kg * 0.93, kg * 1.07);
    Bb[i] = l * clamp(Bb[i] / l, kb * 0.93, kb * 1.07);
  }
  return { sw, sh, r: Rb, g: Gb, b: Bb, pr, pg, pb };
}

/** Row-wise bilinear upsampler of the background map. */
function makeBgSampler(bg: Background, W: number, H: number) {
  const { sw, sh } = bg;
  const x0 = new Int32Array(W);
  const x1 = new Int32Array(W);
  const fx = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    let g = ((x + 0.5) * sw) / W - 0.5;
    if (g < 0) g = 0;
    else if (g > sw - 1) g = sw - 1;
    const i0 = Math.floor(g);
    x0[x] = i0;
    x1[x] = Math.min(sw - 1, i0 + 1);
    fx[x] = g - i0;
  }
  const tR = new Float32Array(sw);
  const tG = new Float32Array(sw);
  const tB = new Float32Array(sw);
  const R = new Float32Array(W);
  const G = new Float32Array(W);
  const B = new Float32Array(W);
  const fr = Math.max(8, bg.pr * 0.3);
  const fg = Math.max(8, bg.pg * 0.3);
  const fb = Math.max(8, bg.pb * 0.3);
  return {
    R,
    G,
    B,
    row(y: number) {
      let g = ((y + 0.5) * sh) / H - 0.5;
      if (g < 0) g = 0;
      else if (g > sh - 1) g = sh - 1;
      const y0 = Math.floor(g);
      const y1 = Math.min(sh - 1, y0 + 1);
      const fy = g - y0;
      const o0 = y0 * sw;
      const o1 = y1 * sw;
      for (let i = 0; i < sw; i++) {
        tR[i] = bg.r[o0 + i] + (bg.r[o1 + i] - bg.r[o0 + i]) * fy;
        tG[i] = bg.g[o0 + i] + (bg.g[o1 + i] - bg.g[o0 + i]) * fy;
        tB[i] = bg.b[o0 + i] + (bg.b[o1 + i] - bg.b[o0 + i]) * fy;
      }
      for (let x = 0; x < W; x++) {
        const a = x0[x];
        const b = x1[x];
        const f = fx[x];
        let v = tR[a] + (tR[b] - tR[a]) * f;
        R[x] = v < fr ? fr : v;
        v = tG[a] + (tG[b] - tG[a]) * f;
        G[x] = v < fg ? fg : v;
        v = tB[a] + (tB[b] - tB[a]) * f;
        B[x] = v < fb ? fb : v;
      }
    },
  };
}

/* =====================================================================
 * Filters
 * ===================================================================== */

export function needsBackground(f: FilterId): boolean {
  return f === 'magic' || f === 'noshadow' || f === 'gray' || f === 'bw';
}

/** Normalised paper level statistics: histogram mode and its left spread (noise). */
function paperStats(img: RGBAImage, bg: Background): { mode: number; spread: number } {
  const { width: W, height: H, data: d } = img;
  const S = makeBgSampler(bg, W, H);
  const step = Math.max(1, Math.round(Math.sqrt((W * H) / 160000)));
  const NB = 320;
  const hist = new Float64Array(NB);
  for (let y = 0; y < H; y += step) {
    S.row(y);
    let p = y * W * 4;
    for (let x = 0; x < W; x += step, p += 4 * step) {
      const v = 0.299 * (d[p] / S.R[x]) + 0.587 * (d[p + 1] / S.G[x]) + 0.114 * (d[p + 2] / S.B[x]);
      const k = (v * 200) | 0;
      hist[k < 0 ? 0 : k >= NB ? NB - 1 : k]++;
    }
  }
  const sm = new Float64Array(NB);
  for (let k = 0; k < NB; k++) {
    sm[k] =
      (hist[Math.max(0, k - 2)] +
        2 * hist[Math.max(0, k - 1)] +
        3 * hist[k] +
        2 * hist[Math.min(NB - 1, k + 1)] +
        hist[Math.min(NB - 1, k + 2)]) /
      9;
  }
  let pk = 200;
  let pv = -1;
  for (let k = 120; k < 270; k++) {
    if (sm[k] > pv) {
      pv = sm[k];
      pk = k;
    }
  }
  let l = pk;
  while (l > 0 && sm[l] > pv * 0.25) l--;
  return { mode: pk / 200, spread: Math.max(0.012, (pk - l) / 200) };
}

/**
 * Print-optimised tone mapping on the illumination-normalised image.
 * The white point sits just below the measured paper noise so the paper turns
 * pure white (no grey haze / toner waste), while everything darker than the
 * paper is stretched and darkened: faint text becomes clearly printable.
 */
function applyNormalizedTone(img: RGBAImage, bg: Background, filter: FilterId, adj: Adjust) {
  const { width: W, height: H, data: d } = img;
  const s = clamp(adj.strength / 100, 0, 1);
  const br = clamp(adj.brightness / 100, -1, 1);
  const ct = clamp(adj.contrast / 100, -1, 1);
  const dark = clamp(adj.threshold / 100, 0, 1) - 0.5;
  const st = paperStats(img, bg);
  let white: number;
  let black: number;
  let gamma: number;
  let sat: number;
  let wc0: number;
  let wc1: number;
  if (filter === 'noshadow') {
    white = clamp(st.mode - 1.5 * st.spread, 0.8, 0.99);
    black = 0.02 + 0.06 * s;
    gamma = 1 + 0.12 * s;
    sat = 1 + 0.18 * s;
    wc0 = 0.93;
    wc1 = 0.99;
  } else if (filter === 'magic') {
    // Magic Color: a printable pure-white background is mandatory, so the white
    // point is pushed deeper under the paper noise floor and near-whites are
    // pulled fully to white. Text punch is kept strong via gamma + clarity.
    white = clamp(st.mode - 2.8 * st.spread, 0.62, 0.93);
    black = 0.05 + 0.22 * s;
    gamma = 1.2 + 0.6 * s;
    sat = 1.14 + 0.44 * s;
    wc0 = 0.8;
    wc1 = 0.95;
  } else {
    white = clamp(st.mode - 2.3 * st.spread, 0.7, 0.95);
    black = 0.05 + 0.2 * s;
    gamma = 1.15 + 0.55 * s;
    sat = filter === 'gray' ? 0 : 1.12 + 0.42 * s;
    wc0 = 0.86;
    wc1 = 0.97;
  }
  white -= 0.12 * br;
  gamma *= 1 - 0.35 * br;
  black += 0.1 * ct + 0.16 * dark;
  gamma *= (1 + 0.3 * ct) * (1 + 0.9 * dark);
  white = clamp(white, 0.5, 1.1);
  black = clamp(black, 0, white - 0.2);
  gamma = clamp(gamma, 0.5, 3.2);
  const LUT_N = 4096;
  const LUT_MAX = 2;
  const lut = new Float32Array(LUT_N + 1);
  for (let i = 0; i <= LUT_N; i++) {
    const nv = (i / LUT_N) * LUT_MAX;
    let v = (nv - black) / (white - black);
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    lut[i] = Math.pow(v, gamma);
  }
  const ls = LUT_N / LUT_MAX;
  const S = makeBgSampler(bg, W, H);
  const wcr = 1 / (wc1 - wc0);
  // darken-only "clarity": thin or slightly blurred strokes get darker & crisper
  // (never brightens anything, so the paper stays clean)
  const clar = filter === 'noshadow' ? 0 : 0.5 + 0.7 * s;
  let det: Float32Array | null = null;
  if (clar > 0.01) {
    const Ln = new Float32Array(W * H);
    for (let y = 0, i = 0; y < H; y++) {
      S.row(y);
      let p = y * W * 4;
      for (let x = 0; x < W; x++, p += 4, i++) {
        Ln[i] = 0.299 * (d[p] / S.R[x]) + 0.587 * (d[p + 1] / S.G[x]) + 0.114 * (d[p + 2] / S.B[x]);
      }
    }
    const rad = Math.max(1, Math.round(Math.max(W, H) / 900));
    const Bl = boxBlurFast(boxBlurFast(Ln, W, H, rad), W, H, rad);
    for (let i = 0; i < Ln.length; i++) {
      const dd = Ln[i] - Bl[i] + 0.012;
      Ln[i] = dd < 0 ? dd * clar : 0;
    }
    det = Ln;
  }
  for (let y = 0; y < H; y++) {
    S.row(y);
    let p = y * W * 4;
    const rowI = y * W;
    for (let x = 0; x < W; x++, p += 4) {
      const dl = det ? det[rowI + x] : 0;
      let ir = ((d[p] / S.R[x] + dl) * ls) | 0;
      let ig = ((d[p + 1] / S.G[x] + dl) * ls) | 0;
      let ib = ((d[p + 2] / S.B[x] + dl) * ls) | 0;
      if (ir > LUT_N) ir = LUT_N;
      else if (ir < 0) ir = 0;
      if (ig > LUT_N) ig = LUT_N;
      else if (ig < 0) ig = 0;
      if (ib > LUT_N) ib = LUT_N;
      else if (ib < 0) ib = 0;
      let vr = lut[ir];
      let vg = lut[ig];
      let vb = lut[ib];
      const L = 0.299 * vr + 0.587 * vg + 0.114 * vb;
      if (sat === 0) {
        vr = vg = vb = L;
      } else {
        // boost colours in mid-tones only: neutral blacks (no colour blotches) and clean paper
        let k = L < 0.06 ? 0 : L > 0.35 ? 1 : (L - 0.06) / 0.29;
        if (L > 0.88) k *= L >= 0.99 ? 0 : 1 - (L - 0.88) / 0.11;
        let f = 1 + (sat - 1) * k;
        if (L < 0.14) f *= 0.4 + (0.6 * L) / 0.14;
        vr = L + (vr - L) * f;
        vg = L + (vg - L) * f;
        vb = L + (vb - L) * f;
      }
      if (L > wc0) {
        let t = L >= wc1 ? 1 : (L - wc0) * wcr;
        t = t * t * (3 - 2 * t);
        vr += (1 - vr) * t;
        vg += (1 - vg) * t;
        vb += (1 - vb) * t;
      }
      d[p] = vr * 255;
      d[p + 1] = vg * 255;
      d[p + 2] = vb * 255;
    }
  }
}

function applyLighten(img: RGBAImage, s: number) {
  const { data: d } = img;
  const N = img.width * img.height;
  const hist = new Float64Array(256);
  const step = Math.max(1, Math.floor(N / 300000));
  let total = 0;
  for (let i = 0; i < N; i += step) {
    const p = i * 4;
    hist[(0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]) | 0]++;
    total++;
  }
  const pct = (q: number) => {
    let acc = 0;
    const t = q * total;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= t) return v;
    }
    return 255;
  };
  const lo = pct(0.01);
  const hi = pct(0.94);
  const black = lo * 0.85;
  const white = Math.max(black + 48, hi * (1 - 0.05 * s));
  const gamma = 1 - 0.28 * s;
  const lut = new Float32Array(256);
  for (let v = 0; v < 256; v++) {
    let t = (v - black) / (white - black);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    lut[v] = Math.pow(t, gamma);
  }
  const sat = 1 + 0.2 * s;
  for (let p = 0; p < N * 4; p += 4) {
    let r = lut[d[p]];
    let g = lut[d[p + 1]];
    let b = lut[d[p + 2]];
    const L = 0.299 * r + 0.587 * g + 0.114 * b;
    r = L + (r - L) * sat;
    g = L + (g - L) * sat;
    b = L + (b - L) * sat;
    d[p] = r * 255;
    d[p + 1] = g * 255;
    d[p + 2] = b * 255;
  }
}

function applyBW(img: RGBAImage, bg: Background, adj: Adjust, res: number) {
  const { width: W, height: H, data: d } = img;
  const N = W * H;
  const lum = new Float32Array(N);
  const S = makeBgSampler(bg, W, H);
  for (let y = 0; y < H; y++) {
    S.row(y);
    let p = y * W * 4;
    let i = y * W;
    for (let x = 0; x < W; x++, p += 4, i++) {
      lum[i] = 0.299 * (d[p] / S.R[x]) + 0.587 * (d[p + 1] / S.G[x]) + 0.114 * (d[p + 2] / S.B[x]);
    }
  }
  // light denoise so that edges stay smooth after thresholding
  const sm = gaussBlur(lum, W, H, 0.4 + 0.4 * res);
  const us = clamp(adj.sharpness / 100, 0, 1);
  if (us > 0.01) {
    const bl = gaussBlur(sm, W, H, Math.max(0.8, 1.8 * res));
    const a = us * 1.6;
    for (let i = 0; i < N; i++) sm[i] += (sm[i] - bl[i]) * a;
  }
  const b = adj.brightness / 100;
  const c = adj.contrast / 100;
  const s = adj.strength / 100;
  const t = 0.55 + 0.4 * (adj.threshold / 100) - 0.12 * b;
  let w = 0.12 - 0.08 * s;
  w *= c >= 0 ? 1 - 0.75 * c : 1 - 1.2 * c;
  w = Math.max(0.008, w);
  const lo = t - w;
  const inv = 1 / (2 * w);
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    let v = (sm[i] - lo) * inv;
    v = v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v);
    const o = v * 255;
    d[p] = o;
    d[p + 1] = o;
    d[p + 2] = o;
  }
}

function unsharp(img: RGBAImage, sigma: number, amount: number) {
  const { width: W, height: H, data: d } = img;
  const N = W * H;
  const Y = new Float32Array(N);
  for (let i = 0, p = 0; i < N; i++, p += 4) Y[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
  const Bl = gaussBlur(Y, W, H, sigma);
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    let df = Y[i] - Bl[i];
    if (df > 1.5) df -= 1.5;
    else if (df < -1.5) df += 1.5;
    else continue;
    const dl = df * amount;
    d[p] = d[p] + dl;
    d[p + 1] = d[p + 1] + dl;
    d[p + 2] = d[p + 2] + dl;
  }
}

function applyBrightnessContrast(img: RGBAImage, brightness: number, contrast: number) {
  const b = brightness / 100;
  const c = contrast / 100;
  const g = Math.pow(2, -b * 1.25);
  const k = c >= 0 ? 1 + c * 1.6 : 1 + c * 0.75;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    let v = Math.pow(i / 255, g);
    v = (v - 0.5) * k + 0.5;
    lut[i] = v * 255;
  }
  const d = img.data;
  for (let p = 0; p < d.length; p += 4) {
    d[p] = lut[d[p]];
    d[p + 1] = lut[d[p + 1]];
    d[p + 2] = lut[d[p + 2]];
  }
}

/** Fades a thin border to white (removes leftover table / shadow lines). */
function cleanBorders(img: RGBAImage) {
  const { width: W, height: H, data: d } = img;
  const e = Math.max(2, Math.round(Math.min(W, H) * 0.005));
  const band = e * 2;
  const paint = (x: number, y: number) => {
    const dd = Math.min(x, y, W - 1 - x, H - 1 - y);
    if (dd >= band) return;
    const t = dd < e ? 1 : 1 - (dd - e + 1) / (e + 1);
    const p = (y * W + x) * 4;
    d[p] += (255 - d[p]) * t;
    d[p + 1] += (255 - d[p + 1]) * t;
    d[p + 2] += (255 - d[p + 2]) * t;
  };
  for (let y = 0; y < H; y++) {
    if (y < band || y >= H - band) {
      for (let x = 0; x < W; x++) paint(x, y);
    } else {
      for (let x = 0; x < band; x++) paint(x, y);
      for (let x = W - band; x < W; x++) paint(x, y);
    }
  }
}

export interface EnhanceOptions {
  resScale: number;
  cleanEdges: boolean;
  bg?: Background | null;
}

/** Applies filter + adjustments in place. */
export function enhance(img: RGBAImage, filter: FilterId, adj: Adjust, opt: EnhanceOptions): void {
  const s = clamp(adj.strength / 100, 0, 1);
  const res = Math.max(0.35, opt.resScale);
  let baseSharp = 0;
  let toneDone = false;
  if (filter === 'lighten') {
    applyLighten(img, s);
    baseSharp = 0.25;
  } else if (filter === 'magic' || filter === 'noshadow' || filter === 'gray') {
    const bg = opt.bg || estimateBackground(img);
    // brightness / contrast / text darkness are folded into the tone curve
    applyNormalizedTone(img, bg, filter, adj);
    baseSharp = filter === 'noshadow' ? 0.25 : 0.55;
    toneDone = true;
  } else if (filter === 'bw') {
    const bg = opt.bg || estimateBackground(img);
    applyBW(img, bg, adj, res);
  }
  if (filter !== 'bw') {
    const amt = baseSharp + clamp(adj.sharpness / 100, 0, 1) * 1.4;
    if (amt > 0.02) unsharp(img, Math.max(0.6, 1.1 * res), amt);
    if (!toneDone && (adj.brightness !== 0 || adj.contrast !== 0)) applyBrightnessContrast(img, adj.brightness, adj.contrast);
  }
  if (opt.cleanEdges && filter !== 'original' && filter !== 'lighten') cleanBorders(img);
}
