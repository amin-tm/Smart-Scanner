/*
 * CamScanner-grade Document Detection Engine (v7)
 *
 * Strategy (classic scanner pipeline):
 *  1. Blur + Sobel gradient maps on the detection copy.
 *  2. Adaptive Canny-free edge map + Hough line extraction (angles 0..180).
 *  3. Candidate quads from line quadruples (image borders allowed for pages
 *     that run out of the frame) + row-envelope RDP candidates.
 *  4. Scoring: gradient coverage with direction agreement, angle regularity,
 *     area prior, interior/exterior contrast and border allowances.
 *  5. HIGH-RESOLUTION REFINEMENT with FINGER REJECTION:
 *     - Samples gradients along each side normal, keeping only points whose
 *       gradient direction agrees with the side normal (>0.55 cosine) — the
 *       side of a finger crosses the paper edge almost perpendicularly, so it
 *       is rejected.
 *     - Iterative trimmed total-least-squares (MAD outlier rejection) fits the
 *       remaining points, so even if a finger covers part of an edge the fitted
 *       line follows the true paper edge.
 *  6. Corners = intersections of the 4 fitted lines (sub-pixel).
 */

import type { Pt, Quad } from './types';
import { FULL_QUAD, QUAD_OUT } from './types';
import type { RGBAImage } from './imageproc';
import { clamp, dist, isConvex, orderQuad, polygonArea, quadAngles } from './imageproc';
import { isFullPageScan } from './refine';

export interface Detection {
  quad: Quad;
  found: boolean;
  score: number;
}

const DEG = Math.PI / 180;
const FOUND_MIN = 0.26;

interface Maps {
  W: number;
  H: number;
  gx: Float32Array;
  gy: Float32Array;
  mag: Float32Array;
  lum: Float32Array;
  tau: number;
}

interface LineEq {
  nx: number;
  ny: number;
  c: number;
}

/* ------------------------------------------------------------------ */
/* gradient maps                                                       */
/* ------------------------------------------------------------------ */
function buildMaps(img: RGBAImage): Maps {
  const { width: W, height: H, data: d } = img;
  const N = W * H;
  const lum = new Float32Array(N);
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    lum[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
  }
  // light 3x3 smoothing (separable box = gaussian-ish)
  const sm = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) {
    const r = y * W;
    for (let x = 1; x < W - 1; x++) {
      sm[r + x] = (lum[r + x - 1] + 2 * lum[r + x] + lum[r + x + 1]) * 0.25;
    }
  }
  const sm2 = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) {
    const r0 = (y - 1) * W, r1 = y * W, r2 = (y + 1) * W;
    for (let x = 1; x < W - 1; x++) {
      sm2[r1 + x] = (sm[r0 + x] + 2 * sm[r1 + x] + sm[r2 + x]) * 0.25;
    }
  }
  const gx = new Float32Array(N);
  const gy = new Float32Array(N);
  const mag = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) {
    const r0 = (y - 1) * W, r1 = y * W, r2 = (y + 1) * W;
    for (let x = 1; x < W - 1; x++) {
      const sx = sm2[r0 + x + 1] + 2 * sm2[r1 + x + 1] + sm2[r2 + x + 1] - sm2[r0 + x - 1] - 2 * sm2[r1 + x - 1] - sm2[r2 + x - 1];
      const sy = sm2[r2 + x - 1] + 2 * sm2[r2 + x] + sm2[r2 + x + 1] - sm2[r0 + x - 1] - 2 * sm2[r0 + x] - sm2[r0 + x + 1];
      const i = r1 + x;
      gx[i] = sx * 0.125;
      gy[i] = sy * 0.125;
      mag[i] = Math.sqrt(sx * sx + sy * sy) * 0.125;
    }
  }
  // adaptive threshold: robust percentile over non-trivial edges
  const hist = new Float64Array(256);
  let total = 0;
  for (let i = 0; i < N; i++) {
    const v = mag[i];
    if (v < 1.5) continue;
    hist[Math.min(255, v * 8 | 0)]++;
    total++;
  }
  let acc = 0;
  let tau = 6;
  if (total > 200) {
    for (let k = 255; k >= 0; k--) {
      acc += hist[k];
      if (acc >= total * 0.34) {
        tau = Math.max(3, Math.min(24, (k + 1) / 8));
        break;
      }
    }
  }
  return { W, H, gx, gy, mag, lum, tau };
}

/* ------------------------------------------------------------------ */
/* Hough lines                                                         */
/* ------------------------------------------------------------------ */
function angDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % Math.PI;
  return d > Math.PI / 2 ? Math.PI - d : d;
}

function meanAngle(a: number, b: number): number {
  let dd = b - a;
  if (dd > Math.PI / 2) dd -= Math.PI;
  else if (dd < -Math.PI / 2) dd += Math.PI;
  let m = a + dd / 2;
  if (m < 0) m += Math.PI;
  if (m >= Math.PI) m -= Math.PI;
  return m;
}

function intersectLines(A: LineEq, B: LineEq): Pt | null {
  const det = A.nx * B.ny - A.ny * B.nx;
  if (Math.abs(det) < 1e-7) return null;
  return { x: (A.c * B.ny - B.c * A.ny) / det, y: (A.nx * B.c - B.nx * A.c) / det };
}

function houghLines(m: Maps): LineEq[] {
  const { W, H, gx, gy, mag, tau } = m;
  const NT = 180;
  const diag = Math.ceil(Math.hypot(W, H));
  const NR = 2 * diag + 1;
  const acc = new Float32Array(NT * NR);
  const cs = new Float32Array(NT);
  const sn = new Float32Array(NT);
  for (let t = 0; t < NT; t++) {
    cs[t] = Math.cos((t * Math.PI) / NT);
    sn[t] = Math.sin((t * Math.PI) / NT);
  }
  let votes = 0;
  for (let y = 2; y < H - 2; y += 1) {
    const r = y * W;
    for (let x = 2; x < W - 2; x++) {
      const i = r + x;
      const v = mag[i];
      if (v < tau) continue;
      let th = Math.atan2(gy[i], gx[i]); // line NORMAL = gradient direction
      if (th < 0) th += Math.PI;
      if (th >= Math.PI) th -= Math.PI;
      const tb = Math.round((th * NT) / Math.PI) % NT;
      const rho = Math.round(x * cs[tb] + y * sn[tb]) + diag;
      if (rho < 0 || rho >= NR) continue;
      acc[tb * NR + rho] += 1;
      votes++;
    }
  }
  if (votes < 50) return [];
  const minVotes = Math.max(9, 0.012 * Math.min(W, H));
  const peaks: { t: number; r: number; v: number }[] = [];
  for (let t = 0; t < NT; t++) {
    const row = t * NR;
    for (let r = 1; r < NR - 1; r++) {
      const v = acc[row + r];
      if (v < minVotes) continue;
      if (v >= acc[row + r - 1] && v >= acc[row + r + 1]) {
        peaks.push({ t, r, v });
      }
    }
  }
  peaks.sort((a, b) => b.v - a.v);
  const out: LineEq[] = [];
  const tolR = Math.max(3, 0.006 * Math.max(W, H));
  for (const pk of peaks) {
    const theta = (pk.t * Math.PI) / NT;
    const rho = pk.r - diag;
    let dup = false;
    for (const L of out) {
      const Ltheta = Math.atan2(L.ny, L.nx);
      if (angDiff(theta, Ltheta) > 4 * DEG) continue;
      if (Math.abs(rho - L.c) < tolR) {
        dup = true;
        break;
      }
    }
    if (dup) continue;
    out.push({ nx: Math.cos(theta), ny: Math.sin(theta), c: rho });
    if (out.length >= 60) break;
  }
  return out;
}

function borderLines(W: number, H: number): LineEq[] {
  return [
    { nx: 1, ny: 0, c: 0 },
    { nx: 1, ny: 0, c: W - 1 },
    { nx: 0, ny: 1, c: 0 },
    { nx: 0, ny: 1, c: H - 1 },
  ];
}

function isBorderLine(L: LineEq, W: number, H: number): boolean {
  const eps = Math.max(3, 0.006 * Math.max(W, H));
  if (Math.abs(L.ny) < 0.01 && (Math.abs(L.c) < eps || Math.abs(L.c - (W - 1)) < eps)) return true;
  if (Math.abs(L.nx) < 0.01 && (Math.abs(L.c) < eps || Math.abs(L.c - (H - 1)) < eps)) return true;
  return false;
}

/* candidate quads from Hough line quadruples ------------------------- */
function houghCandidates(m: Maps): Quad[] {
  const { W, H } = m;
  const lines = houghLines(m);
  if (lines.length < 4) return [];
  const all = lines.concat(borderLines(W, H));
  const cx = W / 2, cy = H / 2;
  const minSep = 0.14 * Math.min(W, H);

  const pairs: { i: number; j: number; theta: number }[] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const A = all[i], B = all[j];
      const thA = Math.atan2(A.ny, A.nx);
      const thB = Math.atan2(B.ny, B.nx);
      if (angDiff(thA, thB) > 30 * DEG) continue;
      const flip = A.nx * B.nx + A.ny * B.ny < 0 ? -1 : 1;
      const dA = A.nx * cx + A.ny * cy - A.c;
      const dB = flip * (B.nx * cx + B.ny * cy - B.c);
      if (Math.abs(dA - dB) < minSep) continue;
      const X = intersectLines(A, B);
      // two members of the same group must be PARALLEL: their intersection
      // must lie far outside the frame; intersecting inside = invalid pair
      if (X && X.x > -0.25 * W && X.x < 1.25 * W && X.y > -0.25 * H && X.y < 1.25 * H) continue;
      pairs.push({ i, j, theta: meanAngle(thA, thB) });
    }
  }

  const quads: Quad[] = [];
  const seen: Quad[] = [];
  for (let p = 0; p < pairs.length; p++) {
    let pushedForP = 0;
    for (let q = p + 1; q < pairs.length && pushedForP < 20; q++) {
      const P = pairs[p], Q = pairs[q];
      if (P.i === Q.i || P.i === Q.j || P.j === Q.i || P.j === Q.j) continue;
      if (angDiff(P.theta, Q.theta) < 48 * DEG || angDiff(P.theta, Q.theta) > 132 * DEG) continue;
      const bc = (isBorderLine(all[P.i], W, H) ? 1 : 0) + (isBorderLine(all[P.j], W, H) ? 1 : 0) +
                 (isBorderLine(all[Q.i], W, H) ? 1 : 0) + (isBorderLine(all[Q.j], W, H) ? 1 : 0);
      if (bc > 3) continue;
      const L = [all[P.i], all[Q.i], all[P.j], all[Q.j]];
      const pts: Pt[] = [];
      let ok = true;
      for (const [u, v] of [[0, 1], [1, 2], [2, 3], [3, 0]] as const) {
        const X = intersectLines(L[u], L[v]);
        if (!X || X.x < -QUAD_OUT * W || X.x > (1 + QUAD_OUT) * W || X.y < -QUAD_OUT * H || X.y > (1 + QUAD_OUT) * H) {
          ok = false;
          break;
        }
        const near = X.x > -0.03 * W && X.x < 1.03 * W && X.y > -0.03 * H && X.y < 1.03 * H;
        pts.push(near ? { x: clamp(X.x, 0, W - 1), y: clamp(X.y, 0, H - 1) } : X);
      }
      if (!ok) continue;
      const quad = orderQuad(pts);
      // duplicates = all four CORNERS coincide; identical centers is normal
      // for nested rectangles (text block vs paper edge) and must be kept
      let dup = false;
      const thr = 0.025 * Math.max(W, H);
      for (const s of seen) {
        let same = true;
        for (let k = 0; k < 4; k++) {
          if (dist(s[k], quad[k]) > thr) { same = false; break; }
        }
        if (same) { dup = true; break; }
      }
      if (dup) continue;
      seen.push(quad);
      quads.push(quad);
      pushedForP++;
      if (quads.length > 4000) return quads;
    }
  }
  return quads;
}

/* ------------------------------------------------------------------ */
/* candidate 2: largest connected component + PCA extremal corners     */
/* (robust when Hough is confused by texture / many text lines)        */
/* ------------------------------------------------------------------ */
function findCornersPCA(points: Pt[]): Quad | null {
  if (points.length < 60) return null;
  let sx = 0, sy = 0;
  for (const p of points) { sx += p.x; sy += p.y; }
  const cx = sx / points.length, cy = sy / points.length;
  let cxx = 0, cxy = 0, cyy = 0;
  for (const p of points) {
    const dx = p.x - cx, dy = p.y - cy;
    cxx += dx * dx; cxy += dx * dy; cyy += dy * dy;
  }
  const th = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const co = Math.cos(th), si = Math.sin(th);
  // Max-extremal projection in each rotated quadrant.
  // This correctly identifies the paper's boundary even with perspective tilt.
  // Fingers are handled by the scoring + robust refinement step, not here.
  let tl: Pt | null = null, tr: Pt | null = null, br: Pt | null = null, bl: Pt | null = null;
  let tlv = -Infinity, trv = -Infinity, brv = -Infinity, blv = -Infinity;
  for (const p of points) {
    const dx = p.x - cx, dy = p.y - cy;
    const lx = dx * co + dy * si, ly = -dx * si + dy * co;
    const v1 = -lx - ly, v2 = lx - ly, v3 = lx + ly, v4 = -lx + ly;
    if (v1 > tlv) { tlv = v1; tl = p; }
    if (v2 > trv) { trv = v2; tr = p; }
    if (v3 > brv) { brv = v3; br = p; }
    if (v4 > blv) { blv = v4; bl = p; }
  }
  if (!tl || !tr || !br || !bl) return null;
  const q: Quad = [tl, tr, br, bl];
  return isConvex(q) ? orderQuad(q) : null;
}

function componentCandidates(img: RGBAImage): Quad[] {
  const { width: W, height: H, data: d } = img;
  const sc = Math.min(1, 400 / Math.max(W, H));
  const sw = Math.round(W * sc), sh = Math.round(H * sc), sN = sw * sh;
  const sx = W / sw, sy = H / sh;

  let bgR = 0, bgG = 0, bgB = 0, bgN = 0;
  const sample = (x: number, y: number) => {
    const p = (y * W + x) * 4;
    bgR += d[p]; bgG += d[p + 1]; bgB += d[p + 2]; bgN++;
  };
  for (let x = 0; x < W; x += 12) { sample(x, 4); sample(x, H - 5); }
  for (let y = 0; y < H; y += 12) { sample(4, y); sample(W - 5, y); }
  bgR /= bgN; bgG /= bgN; bgB /= bgN;
  const bgLum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;

  // Collect lum samples for the percentile fallback
  const sampleLums: number[] = [];
  for (let i = 0; i < sN; i += 3) {
    const px = Math.min(W - 1, Math.floor((i % sw) * sx));
    const py = Math.min(H - 1, Math.floor(Math.floor(i / sw) * sy));
    const p = (py * W + px) * 4;
    sampleLums.push(0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]);
  }

  const out: Quad[] = [];
  const bin = new Uint8Array(sN);
  const labels = new Int32Array(sN);
  const stack = new Int32Array(sN);

  function tryThresholds(thList: number[], luminanceOnly = false) {
    for (const th of thList) {
      bin.fill(0);
      labels.fill(0);
      for (let y = 0; y < sh; y++) {
        const srcY = Math.min(H - 1, Math.floor(y * sy));
        const rO = y * sw, sRO = srcY * W;
        for (let x = 0; x < sw; x++) {
          const srcX = Math.min(W - 1, Math.floor(x * sx));
          const p = (sRO + srcX) * 4;
          const dc = Math.hypot(d[p] - bgR, d[p + 1] - bgG, d[p + 2] - bgB);
          const lum = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
          bin[rO + x] = (luminanceOnly ? lum >= th : dc >= th || lum >= Math.max(bgLum + 14, 208)) ? 1 : 0;
        }
      }
      let bestCount = 0, bestLabel = 0, cur = 0;
      for (let i = 0; i < sN; i++) {
        if (!bin[i] || labels[i]) continue;
        cur++;
        let count = 0, sp = 0;
        stack[sp++] = i;
        labels[i] = cur;
        while (sp > 0) {
          const idx = stack[--sp];
          count++;
          const px = idx % sw, py = (idx / sw) | 0;
          if (px > 0 && bin[idx - 1] && !labels[idx - 1]) { labels[idx - 1] = cur; stack[sp++] = idx - 1; }
          if (px < sw - 1 && bin[idx + 1] && !labels[idx + 1]) { labels[idx + 1] = cur; stack[sp++] = idx + 1; }
          if (py > 0 && bin[idx - sw] && !labels[idx - sw]) { labels[idx - sw] = cur; stack[sp++] = idx - sw; }
          if (py < sh - 1 && bin[idx + sw] && !labels[idx + sw]) { labels[idx + sw] = cur; stack[sp++] = idx + sw; }
        }
        if (count > bestCount) { bestCount = count; bestLabel = cur; }
      }
      if (bestCount < sN * 0.08 || bestCount > sN * 0.985) continue;
      const pts: Pt[] = [];
      for (let y = 0; y < sh; y++) {
        const rO = y * sw;
        for (let x = 0; x < sw; x++) {
          if (labels[rO + x] === bestLabel) pts.push({ x: x / sc, y: y / sc });
        }
      }
      const q = findCornersPCA(pts);
      if (q) out.push(q);
    }
  }

  // Pass 1: original proven thresholds
  tryThresholds([14, 24, 36]);

  // A textured desk may produce a bad colour component, so also consider
  // brightness components even when colour candidates already exist.
  tryThresholds([10, 18, 28]);

  // Pass 3: percentile-based fallback — always finds the brightest region
  if (sampleLums.length > 20) {
    sampleLums.sort((a, b) => a - b);
    const pTh = sampleLums[Math.floor(sampleLums.length * 0.65)] ?? 180;
    const bright = sampleLums[Math.floor(sampleLums.length * 0.9)] ?? 230;
    tryThresholds([pTh, bright * 0.92, bright * 0.82], true);
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* scoring                                                             */
/* ------------------------------------------------------------------ */
function sideAgreement(m: Maps, a: Pt, b: Pt, cx: number, cy: number): number {
  const { W, H, gx, gy, mag, lum, tau } = m;
  const len = dist(a, b);
  if (len < 8) return 0;
  let nx = -(b.y - a.y) / len;
  let ny = (b.x - a.x) / len;
  // normal must point OUTWARD from quad center
  if ((cx - (a.x + b.x) / 2) * nx + (cy - (a.y + b.y) / 2) * ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const K = Math.max(10, Math.min(46, Math.round(len / 6)));
  let valid = 0, hits = 0, dirOk = 0, sum = 0;
  const deltas: number[] = [];
  // must be wide enough that a FLAT approximation of a slightly tilted
  // edge still locates the paper step; refinement then straightens it
  const band = Math.max(4, Math.min(40, Math.max(W, H) * 0.022));
  // MUST stay well below the text-line pitch (~30px) otherwise the probes
  // straddle a text line and invent a fake paper/desk contrast
  const probe = Math.max(6, Math.min(13, Math.max(W, H) * 0.008));
  for (let k = 0; k < K; k++) {
    const t = 0.06 + (0.88 * (k + 0.5)) / K;
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;
    if (px < 1 || py < 1 || px > W - 2 || py > H - 2) continue;
    valid++;

    // luminance difference: inside (toward quad center) vs outside
    const ix = px - nx * probe, iy = py - ny * probe; // inside (normal is outward)
    const ox = px + nx * probe, oy = py + ny * probe;
    if (ix >= 1 && iy >= 1 && ix < W - 1 && iy < H - 1 && ox >= 1 && oy >= 1 && ox < W - 1 && oy < H - 1) {
      const lin = lum[Math.round(iy) * W + Math.round(ix)];
      const lout = lum[Math.round(oy) * W + Math.round(ox)];
      deltas.push(lin - lout);
    }

    let best = 0, bestDot = 0, bestO = 0;
    const step = Math.max(3, Math.round(band / 5));
    for (const pass of [0, 1]) {
      const from = pass === 0 ? -band : bestO - step;
      const to = pass === 0 ? band : bestO + step;
      for (let o = from; o <= to; o += pass === 0 ? step : 1) {
        const qx = Math.round(px + nx * o);
        const qy = Math.round(py + ny * o);
        if (qx < 1 || qy < 1 || qx > W - 2 || qy > H - 2) continue;
        const i = qy * W + qx;
        const v = mag[i];
        if (v <= best) continue;
        const dot = (gx[i] * nx + gy[i] * ny) / (v || 1);
        if (Math.abs(dot) < 0.55) continue; // reject perpendicular gradients (fingers!)
        best = v;
        bestDot = dot;
        bestO = o;
      }
      if (pass === 0 && best > 0) bestO = bestO; // fine pass relative to coarse peak
      if (pass === 1) break;
    }
    // Text inside the page can set a much higher global threshold than the
    // paper/desk boundary. Sustained inside/outside contrast below rejects
    // texture, so permit a weaker but continuous physical edge here.
    if (best >= Math.max(2, tau * 0.2)) {
      hits++;
      if (bestDot > 0) dirOk++;
      sum += Math.min(best, 60);
    }
  }
  if (valid < K * 0.5) return 0.15;
  const cov = hits / valid;
  const cons = hits ? Math.max(dirOk, hits - dirOk) / hits : 0.5;
  const strength = sum / valid / 60;
  // A genuine paper edge has a big luminance step (bright paper vs darker desk).
  // A text row inside the page has ~0 contrast -> heavily discounted.
  // MEDIAN is essential: dark text rows bias the mean into a fake contrast.
  let delta = 0;
  if (deltas.length) {
    const sorted = [...deltas].sort((x, y) => x - y);
    delta = sorted[sorted.length >> 1];
  }
  const contrastScore = clamp(Math.abs(delta) / 32, 0, 1);
  const polarity = delta > 6 ? 1 : delta < -6 ? 0.6 : 0.35; // bright paper on darker desk preferred
  const edge = 0.45 * cov + 0.3 * strength + 0.25 * cons;
  return Math.min(1.15, edge * (0.3 + 0.7 * contrastScore) * (0.5 + 0.5 * polarity) * 2.0);
}

function onBorder(a: Pt, b: Pt, W: number, H: number): boolean {
  const t = Math.max(2, 0.005 * Math.max(W, H));
  return (
    (a.x <= t && b.x <= t) ||
    (a.y <= t && b.y <= t) ||
    (a.x >= W - 1 - t && b.x >= W - 1 - t) ||
    (a.y >= H - 1 - t && b.y >= H - 1 - t)
  );
}

function scoreQuad(m: Maps, q: Quad): number {
  if (!isConvex(q)) return -1;
  const { W, H, lum } = m;
  const area = polygonArea(q) / (W * H);
  if (area < 0.06 || area > 0.99) return -1;
  const [mn, mx] = quadAngles(q);
  if (mn < 40 || mx > 140) return -1;
  const lens = [0, 1, 2, 3].map((s) => dist(q[s], q[(s + 1) % 4]));
  if (Math.min(...lens) < 0.09 * Math.min(W, H)) return -1;
  const ar = (lens[0] + lens[2]) / Math.max(1e-6, lens[1] + lens[3]);
  if (ar < 0.18 || ar > 5.5) return -1;

  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  let total = 0, minSc = 1, maxSide = 0, borders = 0, real = 0;
  for (let s = 0; s < 4; s++) {
    const a = q[s], b = q[(s + 1) % 4];
    let sc: number;
    if (onBorder(a, b, W, H)) {
      sc = 0.3;
      borders++;
    } else {
      sc = sideAgreement(m, a, b, cx, cy);
      real++;
    }
    total += sc;
    if (sc < minSc) minSc = sc;
    if (sc > maxSide) maxSide = sc;
  }
  if (borders > 3 || real === 0) return -1;
  let score = total / 4;
  // the WEAKEST side decides: a finger-stolen corner or an interior text
  // line yields one poor side while the rest look fine
  score *= 0.35 + 0.65 * clamp(minSc, 0, 1);
  score *= 0.75 + 0.25 * Math.min(1, area / 0.5);
  if (minSc < 0.22) score *= 0.7;
  // more real (photo-interior) sides = trustworthy; border sides are weak evidence
  if (borders === 3) score *= 0.7;
  else if (borders === 2) score *= 0.85;
  else if (borders === 1) score *= 0.96;
  // require at least one strong side
  if (maxSide < 0.3) return -1;

  // interior vs exterior luminance (paper usually brighter)
  const get = (x: number, y: number) => lum[clamp(Math.round(y), 0, H - 1) * W + clamp(Math.round(x), 0, W - 1)];
  const inside = get(cx, cy);
  let ext = 0, n = 0;
  for (let s = 0; s < 4; s++) {
    const mx2 = (q[s].x + q[(s + 1) % 4].x) / 2;
    const my = (q[s].y + q[(s + 1) % 4].y) / 2;
    const ox = mx2 + (mx2 - cx) * 0.2;
    const oy = my + (my - cy) * 0.2;
    if (ox >= 0 && ox < W && oy >= 0 && oy < H) { ext += get(ox, oy); n++; }
  }
  const avgExt = n ? ext / n : 128;
  score *= 0.85 + 0.15 * clamp((inside - avgExt + 40) / 60, 0, 1);
  score *= 1 - 0.7 * Math.max(0, Math.max(...q.map((p) => Math.max(-p.x / W, p.x / W - 1, -p.y / H, p.y / H - 1))));
  return score;
}

/* ------------------------------------------------------------------ */
/* high-res refinement with finger rejection                           */
/* ------------------------------------------------------------------ */
function fitSide(m: Maps, a: Pt, b: Pt, cx: number, cy: number): LineEq {
  const { W, H, gx, gy, mag, lum, tau } = m;
  const len = dist(a, b);
  const tx = (b.x - a.x) / len;
  const ty = (b.y - a.y) / len;
  let nx = -ty;
  let ny = tx;
  if ((cx - (a.x + b.x) / 2) * nx + (cy - (a.y + b.y) / 2) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const K = Math.max(20, Math.min(110, Math.round(len / 6)));
  const band = Math.max(4, Math.min(30, len / 12));
  const pts: Pt[] = [];
  const wts: number[] = [];

  for (let k = 0; k < K; k++) {
    const t = 0.05 + (0.9 * (k + 0.5)) / K;
    const px = a.x + (b.x - a.x) * t;
    const py = a.y + (b.y - a.y) * t;
    let bestV = 0, bestOff = 0, bestDot = 0;
    for (let o = -band; o <= band; o += 1) {
      const qx = Math.round(px + nx * o);
      const qy = Math.round(py + ny * o);
      if (qx < 1 || qy < 1 || qx > W - 2 || qy > H - 2) continue;
      const i = qy * W + qx;
      const v = mag[i];
      if (v <= bestV) continue;
      const gm = v || 1;
      const dot = (gx[i] * nx + gy[i] * ny) / gm;
      if (Math.abs(dot) < 0.55) continue;
      bestV = v;
      bestOff = o;
      bestDot = dot;
    }
    if (bestV >= tau) {
      // sub-pixel peak by parabola fit across the normal samples
      const lumAt = (o: number) => {
        const xx = Math.round(px + nx * o), yy = Math.round(py + ny * o);
        return xx >= 1 && yy >= 1 && xx < W - 1 && yy < H - 1 ? lum[yy * W + xx] : -1;
      };
      let extra = 0;
      const v0 = lumAt(bestOff), vm = lumAt(bestOff - 1), vp = lumAt(bestOff + 1);
      if (v0 >= 0 && vm >= 0 && vp >= 0) {
        const den = vm - 2 * v0 + vp;
        if (Math.abs(den) > 1e-4) extra = clamp(0.5 * (vm - vp) / den, -0.6, 0.6);
      }
      pts.push({ x: px + nx * (bestOff + extra), y: py + ny * (bestOff + extra) });
      wts.push(Math.min(1, bestV / 40) * (bestDot > 0 ? 1 : 0.85));
    }
  }

  if (pts.length < Math.max(8, K * 0.3)) {
    return { nx, ny, c: nx * a.x + ny * a.y };
  }

  // trimmed TLS: 4 iterations, drop the worst 25% (finger bumps & shadows)
  let weights = wts;
  let kept = pts.map((p, i) => ({ p, w: weights[i] }));
  for (let it = 0; it < 4; it++) {
    if (kept.length < 8) break;
    let sw = 0, mx = 0, my = 0;
    for (const k of kept) { sw += k.w; mx += k.p.x * k.w; my += k.p.y * k.w; }
    mx /= sw; my /= sw;
    let sxx = 0, sxy = 0, syy = 0;
    for (const k of kept) {
      const dx = k.p.x - mx, dy = k.p.y - my;
      sxx += dx * dx * k.w; sxy += dx * dy * k.w; syy += dy * dy * k.w;
    }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const fnx = -Math.sin(th), fny = Math.cos(th);
    const fc = fnx * mx + fny * my;
    const res = kept.map((k) => Math.abs(fnx * k.p.x + fny * k.p.y - fc));
    const sorted = [...res].sort((x, y) => x - y);
    const med = sorted[sorted.length >> 1];
    const cut = Math.max(1.2, 2.6 * med);
    const next = kept.filter((_, i) => res[i] < cut);
    if (next.length >= 8 && next.length < kept.length) kept = next;
    else {
      // final line from current kept
      let sw2 = 0, mx2 = 0, my2 = 0;
      for (const k of kept) { sw2 += k.w; mx2 += k.p.x * k.w; my2 += k.p.y * k.w; }
      mx2 /= sw2; my2 /= sw2;
      let a2 = 0, b2 = 0, c2 = 0;
      for (const k of kept) {
        const dx = k.p.x - mx2, dy = k.p.y - my2;
        a2 += dx * dx * k.w; b2 += dx * dy * k.w; c2 += dy * dy * k.w;
      }
      const th2 = 0.5 * Math.atan2(2 * b2, a2 - c2);
      const lnx = -Math.sin(th2), lny = Math.cos(th2);
      return { nx: lnx, ny: lny, c: lnx * mx2 + lny * my2 };
    }
  }
  if (!kept.length) return { nx, ny, c: nx * a.x + ny * a.y };
  let sw3 = 0, mx3 = 0, my3 = 0;
  for (const k of kept) { sw3 += k.w; mx3 += k.p.x * k.w; my3 += k.p.y * k.w; }
  mx3 /= sw3; my3 /= sw3;
  let a3 = 0, b3 = 0, c3 = 0;
  for (const k of kept) {
    const dx = k.p.x - mx3, dy = k.p.y - my3;
    a3 += dx * dx * k.w; b3 += dx * dy * k.w; c3 += dy * dy * k.w;
  }
  const th3 = 0.5 * Math.atan2(2 * b3, a3 - c3);
  const lnx = -Math.sin(th3), lny = Math.cos(th3);
  return { nx: lnx, ny: lny, c: lnx * mx3 + lny * my3 };
}

function refineQuad(q: Quad, m: Maps): Quad {
  const { W, H } = m;
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  const lines: LineEq[] = [];
  for (let s = 0; s < 4; s++) {
    lines.push(fitSide(m, q[s], q[(s + 1) % 4], cx, cy));
  }
  const out: Pt[] = [];
  const maxDisp = Math.max(0.06 * Math.max(W, H), 20);
  for (let i = 0; i < 4; i++) {
    const X = intersectLines(lines[(i + 3) % 4], lines[i]);
    if (!X || dist(X, q[i]) > maxDisp || !isFinite(X.x) || !isFinite(X.y)) {
      out.push(q[i]);
    } else {
      out.push({ x: clamp(X.x, -QUAD_OUT * W, (1 + QUAD_OUT) * W), y: clamp(X.y, -QUAD_OUT * H, (1 + QUAD_OUT) * H) });
    }
  }
  if (!isConvex(out)) return q;
  const lim = 0.12 * Math.max(W, H);
  for (let i = 0; i < 4; i++) if (dist(out[i], q[i]) > lim) return q;
  return out as Quad;
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */
export function detectDocument(img: RGBAImage, hi?: RGBAImage | null): Detection {
  const W = img.width, H = img.height;
  if (W < 32 || H < 32) return { quad: FULL_QUAD, found: false, score: 0 };
  if (isFullPageScan(img)) return { quad: FULL_QUAD, found: true, score: 0.8 };

  const m = buildMaps(img);
  const cands: Quad[] = [];
  try { cands.push(...houghCandidates(m)); } catch { /* skip strategy */ }
  try { cands.push(...componentCandidates(img)); } catch { /* skip strategy */ }

  const scored: { q: Quad; s: number }[] = [];
  for (const q of cands) {
    const s = scoreQuad(m, q);
    if (s > 0) scored.push({ q, s });
  }
  scored.sort((a, b) => b.s - a.s);
  const top = scored.slice(0, 14);

  if (!top.length || top[0].s < 0.06) {
    return { quad: FULL_QUAD, found: false, score: top[0]?.s ?? 0 };
  }

  const refineMaps: Maps[] = hi && hi.width > W ? [buildMaps(hi)] : [m];
  const rm = refineMaps[0];

  let best: { q: Quad; s: number } | null = null;
  for (const c of top) {
    // scale to refine resolution
    const kx = rm.W / W, ky = rm.H / H;
    const scaled = c.q.map((p) => ({ x: p.x * kx, y: p.y * ky })) as Quad;
    const s0 = scoreQuad(rm, scaled);
    let chosen = scaled, s = s0;
    try {
      const refined = refineQuad(scaled, rm);
      const s1 = scoreQuad(rm, refined);
      if (s1 > s0) { chosen = refined; s = s1; }
    } catch { /* keep original */ }
    if (!best || s > best.s) best = { q: chosen, s };
  }
  if (!best || best.s < FOUND_MIN) {
    return { quad: FULL_QUAD, found: false, score: best?.s ?? 0 };
  }

  const normQuad: Quad = [
    { x: clamp(best.q[0].x / rm.W, -QUAD_OUT, 1 + QUAD_OUT), y: clamp(best.q[0].y / rm.H, -QUAD_OUT, 1 + QUAD_OUT) },
    { x: clamp(best.q[1].x / rm.W, -QUAD_OUT, 1 + QUAD_OUT), y: clamp(best.q[1].y / rm.H, -QUAD_OUT, 1 + QUAD_OUT) },
    { x: clamp(best.q[2].x / rm.W, -QUAD_OUT, 1 + QUAD_OUT), y: clamp(best.q[2].y / rm.H, -QUAD_OUT, 1 + QUAD_OUT) },
    { x: clamp(best.q[3].x / rm.W, -QUAD_OUT, 1 + QUAD_OUT), y: clamp(best.q[3].y / rm.H, -QUAD_OUT, 1 + QUAD_OUT) },
  ];
  return { quad: normQuad, found: true, score: best.s };
}
