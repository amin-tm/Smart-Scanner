/*
 * OpenCV-based document detector (scanner-app grade).
 *
 * Several independent strategies produce candidate quadrilaterals; one
 * shared scorer picks the best:
 *   A. Canny edges on several channels (gray, value, saturation, colour
 *      distance from the background) after a morphological close that erases
 *      printed text -> contours -> convex hull -> 4 corners.
 *   B. Segmentation of the paper itself (Otsu on brightness / colour distance)
 *      -> largest region -> 4 corners, or its rotated bounding box. This is the
 *      "find the sheet even if the four edges are not visible" path.
 *   C. GrabCut foreground extraction, used when A and B are weak.
 * The chosen quad is returned in normalised (0..1) image coordinates.
 */
import type { Pt, Quad } from './types';
import { FULL_QUAD } from './types';
import { clamp, dist, isConvex, orderQuad, polygonArea, quadAngles } from './imageproc';
import { isFullPageScan, refineDocumentQuad } from './refine';

/* eslint-disable @typescript-eslint/no-explicit-any */
type CV = any;

export interface CvDetection {
  quad: Quad;
  found: boolean;
  score: number;
  method: string;
}

interface Cand {
  q: Quad; // pixel coords of the working image
  method: string;
  prior: number; // small bonus per strategy reliability
}

const WORK = 640;

/* ---------------------------------------------------------------- geometry helpers */

function matToPts(m: any): Pt[] {
  const d = m.data32S as Int32Array;
  const out: Pt[] = [];
  for (let i = 0; i + 1 < d.length; i += 2) out.push({ x: d[i], y: d[i + 1] });
  return out;
}

function maxAreaQuad(poly: Pt[]): Quad | null {
  let P = poly;
  if (P.length > 64) P = Array.from({ length: 64 }, (_, i) => poly[Math.floor((i * poly.length) / 64)]);
  const n = P.length;
  if (n < 4) return null;
  if (n === 4) return isConvex(P) ? orderQuad(P) : null;
  const tri = (a: Pt, b: Pt, c: Pt) => Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  let best = -1;
  let res: Pt[] | null = null;
  for (let i = 0; i < n; i++) {
    for (let k = i + 2; k < n; k++) {
      if (i === 0 && k === n - 1) continue;
      let a1 = -1, jb = -1;
      for (let j = i + 1; j < k; j++) {
        const t = tri(P[i], P[j], P[k]);
        if (t > a1) { a1 = t; jb = j; }
      }
      let a2 = -1, lb = -1;
      for (let l = k + 1; l < n + i; l++) {
        const ll = l % n;
        const t = tri(P[i], P[ll], P[k]);
        if (t > a2) { a2 = t; lb = ll; }
      }
      if (jb >= 0 && lb >= 0 && a1 + a2 > best) {
        best = a1 + a2;
        res = [P[i], P[jb], P[k], P[lb]];
      }
    }
  }
  return res && isConvex(res) ? orderQuad(res) : null;
}

/** Rotated bounding box of a point set (paper-region fallback). */
function rotatedRect(cv: CV, cnt: any): Quad | null {
  const r = cv.minAreaRect(cnt);
  const a = (r.angle * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const hw = r.size.width / 2, hh = r.size.height / 2;
  const pts: Pt[] = [
    { x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh },
  ].map((p) => ({ x: r.center.x + p.x * c - p.y * s, y: r.center.y + p.x * s + p.y * c }));
  return isConvex(pts) ? orderQuad(pts) : null;
}

/** Turns one contour into quad candidates (approxPolyDP at several tolerances, then max-area quad). */
function quadsFromContour(cv: CV, cnt: any, minArea: number, method: string, prior: number, out: Cand[], withRect: boolean) {
  const hull = new cv.Mat();
  try {
    cv.convexHull(cnt, hull, false, true);
    const area = cv.contourArea(hull);
    if (area < minArea) return;
    const peri = cv.arcLength(hull, true);
    let got = false;
    for (const eps of [0.012, 0.02, 0.03, 0.045, 0.06]) {
      const ap = new cv.Mat();
      cv.approxPolyDP(hull, ap, eps * peri, true);
      if (ap.rows === 4) {
        const pts = matToPts(ap);
        if (isConvex(pts)) {
          out.push({ q: orderQuad(pts), method, prior });
          got = true;
        }
      }
      ap.delete();
      if (got) break;
    }
    if (!got) {
      const ap = new cv.Mat();
      cv.approxPolyDP(hull, ap, 0.004 * peri, true);
      const q = maxAreaQuad(matToPts(ap));
      ap.delete();
      if (q) out.push({ q, method: method + '-maxquad', prior: prior - 0.03 });
    }
    if (withRect) {
      const r = rotatedRect(cv, hull);
      if (r) out.push({ q: r, method: method + '-rect', prior: prior - 0.06 });
    }
  } finally {
    hull.delete();
  }
}

/* ---------------------------------------------------------------- scoring */

interface ScoreCtx {
  W: number;
  H: number;
  paper: Uint8Array; // 1 = paper-like pixel (bright, low saturation relative to the sheet)
  comp: Uint8Array | null; // largest paper region (filled), null if it fills the frame
  compN: number;
  sat: Uint8Array;
  lum: Float32Array;
  rgb: Uint8Array;
  mag: Float32Array;
  gx: Float32Array;
  gy: Float32Array;
  magThr: number;
}

function buildScoreCtx(gray: Uint8Array, sat: Uint8Array, rgb: Uint8Array, W: number, H: number): ScoreCtx {
  const N = W * H;
  const lum = new Float32Array(N);
  for (let i = 0; i < N; i++) lum[i] = gray[i];
  const gx = new Float32Array(N), gy = new Float32Array(N), mag = new Float32Array(N);
  const hist = new Uint32Array(256);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const sx = lum[i - W + 1] + 2 * lum[i + 1] + lum[i + W + 1] - lum[i - W - 1] - 2 * lum[i - 1] - lum[i + W - 1];
      const sy = lum[i + W - 1] + 2 * lum[i + W] + lum[i + W + 1] - lum[i - W - 1] - 2 * lum[i - W] - lum[i - W + 1];
      gx[i] = sx; gy[i] = sy;
      const m = Math.sqrt(sx * sx + sy * sy) / 8;
      mag[i] = m;
      hist[Math.min(255, m | 0)]++;
    }
  }
  // threshold = 85th percentile of gradient magnitude (adaptive to blur / light)
  let acc = 0, thr = 8;
  const total = (W - 2) * (H - 2);
  for (let k = 0; k < 256; k++) {
    acc += hist[k];
    if (acc >= total * 0.85) { thr = Math.max(4, k); break; }
  }
  return { W, H, paper: new Uint8Array(N), comp: null, compN: 0, sat, lum, rgb, mag, gx, gy, magThr: thr };
}

function onBorder(a: Pt, b: Pt, W: number, H: number): boolean {
  const t = Math.max(3, 0.012 * Math.max(W, H));
  return (
    (a.x <= t && b.x <= t) || (a.y <= t && b.y <= t) ||
    (a.x >= W - 1 - t && b.x >= W - 1 - t) || (a.y >= H - 1 - t && b.y >= H - 1 - t)
  );
}

function sideStats(c: ScoreCtx, a: Pt, b: Pt, cx: number, cy: number): { support: number; contrast: number } {
  const { W, H, lum, mag, gx, gy, magThr } = c;
  const len = dist(a, b);
  let nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
  // outward normal
  if ((cx - (a.x + b.x) / 2) * nx + (cy - (a.y + b.y) / 2) * ny > 0) { nx = -nx; ny = -ny; }
  const K = Math.max(12, Math.min(60, Math.round(len / 5)));
  const band = 3;
  const probe = Math.max(4, Math.round(Math.max(W, H) * 0.012));
  let valid = 0, hits = 0;
  const deltas: number[] = [];
  const colorDeltas: number[] = [];
  for (let k = 0; k < K; k++) {
    const t = 0.08 + (0.84 * (k + 0.5)) / K;
    const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
    if (px < 2 || py < 2 || px > W - 3 || py > H - 3) continue;
    valid++;
    let best = 0;
    for (let o = -band; o <= band; o++) {
      const qx = Math.round(px + nx * o), qy = Math.round(py + ny * o);
      if (qx < 1 || qy < 1 || qx > W - 2 || qy > H - 2) continue;
      const i = qy * W + qx;
      const m = mag[i];
      if (m <= best) continue;
      // gradient must be roughly perpendicular to the side (rejects fingers / text strokes)
      const g = Math.hypot(gx[i], gy[i]) || 1;
      if (Math.abs((gx[i] * nx + gy[i] * ny) / g) < 0.6) continue;
      best = m;
    }
    if (best >= magThr) hits++;
    const ix = Math.round(px - nx * probe), iy = Math.round(py - ny * probe);
    const ox = Math.round(px + nx * probe), oy = Math.round(py + ny * probe);
    if (ix >= 0 && iy >= 0 && ix < W && iy < H && ox >= 0 && oy >= 0 && ox < W && oy < H) {
      deltas.push(lum[iy * W + ix] - lum[oy * W + ox]);
      const a = (iy * W + ix) * 3, b = (oy * W + ox) * 3;
      colorDeltas.push(Math.hypot(c.rgb[a] - c.rgb[b], c.rgb[a + 1] - c.rgb[b + 1], c.rgb[a + 2] - c.rgb[b + 2]) / Math.sqrt(3));
    }
  }
  if (valid < K * 0.4) return { support: 0.4, contrast: 0.4 };
  deltas.sort((p, q) => p - q);
  const med = deltas.length ? deltas[deltas.length >> 1] : 0;
  colorDeltas.sort((a, b) => a - b);
  const colorContrast = colorDeltas.length ? colorDeltas[colorDeltas.length >> 1] : 0;
  return { support: hits / valid, contrast: clamp(Math.max(Math.abs(med), colorContrast) / 40, 0, 1) * (med >= 0 ? 1 : 0.75) };
}

function insideQuad(q: Quad, x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const cr = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    const sg = cr > 0 ? 1 : cr < 0 ? -1 : 0;
    if (!sg) continue;
    if (!sign) sign = sg;
    else if (sg !== sign) return false;
  }
  return true;
}

/**
 * frac  = share of the quad interior that is paper-like (a tablet or phone
 *         inside the quad drags it down; text lines are thin and barely count)
 * cover = share of the main paper region that the quad includes (a quad that
 *         grabs only part of the sheet is penalised)
 */
function paperFit(c: ScoreCtx, q: Quad): { frac: number; cover: number } {
  const { W, H, paper, comp, compN } = c;
  let minX = W, minY = H, maxX = 0, maxY = 0;
  for (const p of q) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const x0 = Math.max(0, Math.floor(minX)), x1 = Math.min(W - 1, Math.ceil(maxX));
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(H - 1, Math.ceil(maxY));
  const st = 2;
  let inside = 0, inPaper = 0, inComp = 0;
  for (let y = y0; y <= y1; y += st) {
    for (let x = x0; x <= x1; x += st) {
      if (!insideQuad(q, x, y)) continue;
      const k = y * W + x;
      inside++;
      if (paper[k]) inPaper++;
      if (comp && comp[k]) inComp++;
    }
  }
  const frac = inside ? inPaper / inside : 0;
  const cover = comp && compN ? Math.min(1, (inComp * st * st) / compN) : 1;
  return { frac, cover };
}

function scoreQuad(c: ScoreCtx, q: Quad): number {
  const { W, H } = c;
  if (!isConvex(q)) return -1;
  const area = polygonArea(q) / (W * H);
  if (area < 0.025 || area > 0.995) return -1;
  const [mn, mx] = quadAngles(q);
  if (mn < 25 || mx > 155) return -1;
  const lens = [0, 1, 2, 3].map((s) => dist(q[s], q[(s + 1) % 4]));
  if (Math.min(...lens) < 0.045 * Math.min(W, H)) return -1;
  // a photographed sheet keeps opposite sides comparable (perspective limits)
  const r1 = Math.max(lens[0], lens[2]) / Math.max(1, Math.min(lens[0], lens[2]));
  const r2 = Math.max(lens[1], lens[3]) / Math.max(1, Math.min(lens[1], lens[3]));
  if (r1 > 4 || r2 > 4) return -1;
  const aspect = (lens[0] + lens[2]) / Math.max(1, lens[1] + lens[3]);
  if (aspect < 0.1 || aspect > 10) return -1;
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  let sup = 0, minSup = 1, con = 0, borders = 0, real = 0;
  for (let s = 0; s < 4; s++) {
    const a = q[s], b = q[(s + 1) % 4];
    if (onBorder(a, b, W, H)) { borders++; continue; }
    const st = sideStats(c, a, b, cx, cy);
    sup += st.support; con += st.contrast; real++;
    minSup = Math.min(minSup, st.support);
  }
  if (real === 0) return 0.05; // the whole frame: weakest possible answer
  sup /= real; con /= real;
  // Dense text/table contours have gradients but no sustained contrast
  // between the paper and its surroundings. Do not crop to the text block.
  if (con < 0.12) return -1;
  // rectangularity: perspective keeps opposite angles similar
  const regularity = 1 - Math.min(1, (Math.max(Math.abs(mn - 90), Math.abs(mx - 90)) / 50));
  let score = 0.34 * sup + 0.2 * minSup + 0.22 * con + 0.08 * regularity + 0.16 * Math.min(1, area / 0.4);
  score *= borders === 0 ? 1 : borders === 1 ? 0.95 : borders === 2 ? 0.86 : 0.7;
  // the decisive questions: is the inside paper, and is it the whole sheet?
  const fit = paperFit(c, q);
  score *= 0.12 + 0.88 * clamp((fit.frac - 0.3) / 0.45, 0, 1);
  score *= 0.45 + 0.55 * fit.cover;
  return score;
}

/* ---------------------------------------------------------------- main */

export function detectWithCV(cv: CV, img: { data: Uint8ClampedArray; width: number; height: number }): CvDetection {
  const mats: any[] = [];
  const keep = <T>(m: T): T => { mats.push(m); return m; };
  try {
    const sc = Math.min(1, WORK / Math.max(img.width, img.height));
    const W = Math.max(16, Math.round(img.width * sc));
    const H = Math.max(16, Math.round(img.height * sc));

    const full = keep(new cv.Mat(img.height, img.width, cv.CV_8UC4));
    full.data.set(img.data);
    const rgba = keep(new cv.Mat());
    cv.resize(full, rgba, new cv.Size(W, H), 0, 0, cv.INTER_AREA);
    const rgb = keep(new cv.Mat());
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
    const gray = keep(new cv.Mat());
    cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);
    const hsv = keep(new cv.Mat());
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    const hsvCh = keep(new cv.MatVector());
    cv.split(hsv, hsvCh);
    const sat = keep(hsvCh.get(1));
    const val = keep(hsvCh.get(2));

    // colour distance from the background (sampled on the frame border)
    const rd = rgb.data as Uint8Array;
    let bR = 0, bG = 0, bB = 0, bN = 0;
    const smp = (x: number, y: number) => { const p = (y * W + x) * 3; bR += rd[p]; bG += rd[p + 1]; bB += rd[p + 2]; bN++; };
    for (let x = 0; x < W; x += 3) { smp(x, 1); smp(x, H - 2); }
    for (let y = 0; y < H; y += 3) { smp(1, y); smp(W - 2, y); }
    bR /= bN; bG /= bN; bB /= bN;
    const cdist = keep(new cv.Mat(H, W, cv.CV_8UC1));
    const cd = cdist.data as Uint8Array;
    for (let i = 0, p = 0; i < W * H; i++, p += 3) {
      cd[i] = Math.min(255, Math.hypot(rd[p] - bR, rd[p + 1] - bG, rd[p + 2] - bB) * 1.4);
    }

    const ctx = buildScoreCtx(gray.data as Uint8Array, sat.data as Uint8Array, rd, W, H);
    const minArea = W * H * 0.025;
    const cands: Cand[] = [];
    let fillsFrame = false;

    /* ---- paper-likeness mask (relative to the brightest, least saturated part) ---- */
    {
      const gd = gray.data as Uint8Array, sd = sat.data as Uint8Array;
      const N = W * H;
      const lh = new Uint32Array(256);
      for (let i = 0; i < N; i++) lh[gd[i]]++;
      let acc = 0, p90 = 230;
      for (let k = 255; k >= 0; k--) { acc += lh[k]; if (acc >= N * 0.1) { p90 = k; break; } }
      const satTop: number[] = [];
      for (let i = 0; i < N; i += 2) if (gd[i] >= p90) satTop.push(sd[i]);
      satTop.sort((a, b) => a - b);
      const paperSat = satTop.length ? satTop[satTop.length >> 1] : 20;
      const lumMin = Math.max(70, p90 * 0.66);
      const satMax = Math.min(110, paperSat + 38);
      const pm = ctx.paper;
      for (let i = 0; i < N; i++) pm[i] = gd[i] >= lumMin && sd[i] <= satMax ? 1 : 0;

      const pmat = new cv.Mat(H, W, cv.CV_8UC1);
      const pd = pmat.data as Uint8Array;
      for (let i = 0; i < N; i++) pd[i] = pm[i] * 255;
      const kc = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(13, 13));
      const ko = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
      cv.morphologyEx(pmat, pmat, cv.MORPH_CLOSE, kc);
      cv.morphologyEx(pmat, pmat, cv.MORPH_OPEN, ko);
      kc.delete(); ko.delete();
      const contours = new cv.MatVector();
      const hier = new cv.Mat();
      cv.findContours(pmat, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      const list: { i: number; a: number }[] = [];
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i);
        const a = cv.contourArea(c);
        if (a >= minArea) list.push({ i, a });
        c.delete();
      }
      list.sort((p, q) => q.a - p.a);
      fillsFrame = list.length > 0 && list[0].a >= N * 0.82;
      if (list.length && list[0].a < N * 0.9) {
        // filled main paper region for the coverage test
        const cm = cv.Mat.zeros(H, W, cv.CV_8UC1);
        const c0 = contours.get(list[0].i);
        const one = new cv.MatVector();
        one.push_back(c0);
        cv.drawContours(cm, one, 0, new cv.Scalar(1), -1);
        ctx.comp = new Uint8Array(cm.data);
        let n = 0;
        for (let i = 0; i < N; i++) n += ctx.comp[i];
        ctx.compN = n;
        one.delete(); c0.delete(); cm.delete();
      }
      for (const it of list.slice(0, 3)) {
        if (it.a > N * 0.985) continue;
        const c = contours.get(it.i);
        quadsFromContour(cv, c, minArea, 'paper', 0.06, cands, true);
        c.delete();
      }
      contours.delete(); hier.delete(); pmat.delete();
    }

    const k3 = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
    const kText = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9)));

    /* ---- A: Canny edge contours on several channels ---- */
    const channels: [string, any][] = [['gray', gray], ['val', val], ['sat', sat], ['cdist', cdist]];
    for (const [name, ch] of channels) {
      const blur = new cv.Mat();
      const closed = new cv.Mat();
      cv.GaussianBlur(ch, blur, new cv.Size(5, 5), 0);
      cv.morphologyEx(blur, closed, cv.MORPH_CLOSE, kText); // erase dark text strokes
      // median-based automatic thresholds + two fixed pairs
      const d = closed.data as Uint8Array;
      const h = new Uint32Array(256);
      for (let i = 0; i < d.length; i++) h[d[i]]++;
      let acc = 0, med = 128;
      for (let k = 0; k < 256; k++) { acc += h[k]; if (acc >= d.length / 2) { med = k; break; } }
      const pairs: [number, number][] = [
        [Math.max(5, 0.5 * med), Math.max(20, 1.2 * med)],
        [20, 60],
        [50, 150],
      ];
      for (const [lo, hi] of pairs) {
        const edges = new cv.Mat();
        const dil = new cv.Mat();
        cv.Canny(closed, edges, lo, hi);
        cv.dilate(edges, dil, k3, new cv.Point(-1, -1), 1);
        const contours = new cv.MatVector();
        const hier = new cv.Mat();
        cv.findContours(dil, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
        // keep only the largest few contours (by hull area) to bound the cost
        const big: { i: number; a: number }[] = [];
        for (let i = 0; i < contours.size(); i++) {
          const c = contours.get(i);
          const r = cv.boundingRect(c);
          if (r.width * r.height >= minArea) big.push({ i, a: r.width * r.height });
          c.delete();
        }
        big.sort((p, q) => q.a - p.a);
        for (const b of big.slice(0, 6)) {
          const c = contours.get(b.i);
          quadsFromContour(cv, c, minArea, 'canny-' + name, 0.04, cands, false);
          c.delete();
        }
        contours.delete(); hier.delete(); edges.delete(); dil.delete();
      }
      blur.delete(); closed.delete();
    }

    /* ---- B: segmentation of the paper region itself ---- */
    const segSources: [string, any, boolean][] = [['bright', gray, false], ['color', cdist, false], ['lowsat', sat, true]];
    for (const [name, ch, invert] of segSources) {
      const blur = new cv.Mat();
      const bin = new cv.Mat();
      const tmp = new cv.Mat();
      cv.GaussianBlur(ch, blur, new cv.Size(7, 7), 0);
      cv.threshold(blur, bin, 0, 255, (invert ? cv.THRESH_BINARY_INV : cv.THRESH_BINARY) + cv.THRESH_OTSU);
      const kBig = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(15, 15));
      cv.morphologyEx(bin, tmp, cv.MORPH_CLOSE, kBig);
      cv.morphologyEx(tmp, bin, cv.MORPH_OPEN, kBig);
      kBig.delete();
      const contours = new cv.MatVector();
      const hier = new cv.Mat();
      cv.findContours(bin, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      const list: { i: number; a: number }[] = [];
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i);
        const a = cv.contourArea(c);
        if (a >= minArea && a <= W * H * 0.985) list.push({ i, a });
        c.delete();
      }
      list.sort((p, q) => q.a - p.a);
      for (const it of list.slice(0, 3)) {
        const c = contours.get(it.i);
        quadsFromContour(cv, c, minArea, 'seg-' + name, 0.02, cands, true);
        c.delete();
      }
      contours.delete(); hier.delete(); blur.delete(); bin.delete(); tmp.delete();
    }

    /* ---- score ---- */
    let best: { c: Cand; s: number } | null = null;
    const evalAll = (list: Cand[]) => {
      for (const c of list) {
        const s0 = scoreQuad(ctx, c.q);
        if (s0 <= 0) continue;
        const s = s0 + c.prior;
        if (!best || s > best.s) best = { c, s };
      }
    };
    evalAll(cands);

    /* ---- C: GrabCut when the evidence is weak ---- */
    if (!best || (best as { s: number }).s < 0.5) {
      const gc = grabCutCandidates(cv, rgb, W, H, minArea);
      evalAll(gc);
    }

    const b = best as { c: Cand; s: number } | null;
    // Keep scanned forms intact instead of selecting an interior table.
    if (fillsFrame && isFullPageScan(img)) {
      return { quad: FULL_QUAD, found: true, score: 0.8, method: 'full-page' };
    }
    if (!b || b.s < 0.16 || (fillsFrame && b.s < 0.42)) {
      // the sheet fills the whole photo: the full frame IS the page
      if (fillsFrame) {
        // A uniform dark desk is not a full-page scan. In an ambiguous frame
        // preserve all pixels, without claiming that four edges were found.
        const lum = ctx.lum;
        let bright = 0, dark = 0;
        for (const v of lum) { if (v > 160) bright++; if (v < 100) dark++; }
        const looksLikeScan = bright > lum.length * 0.65 && dark > lum.length * 0.005;
        return { quad: FULL_QUAD, found: looksLikeScan, score: looksLikeScan ? 0.5 : 0, method: 'full-page' };
      }
      return { quad: FULL_QUAD, found: false, score: b ? b.s : 0, method: 'none' };
    }
    const quad = b.c.q.map((p) => ({ x: clamp(p.x / W, -0.02, 1.02), y: clamp(p.y / H, -0.02, 1.02) })) as Quad;
    return { quad: refineDocumentQuad(img, quad), found: true, score: b.s, method: b.c.method };
  } finally {
    for (const m of mats) {
      try { m.delete(); } catch { /* already freed */ }
    }
  }
}

function grabCutCandidates(cv: CV, rgb: any, W: number, H: number, minArea: number): Cand[] {
  const out: Cand[] = [];
  const s = Math.min(1, 320 / Math.max(W, H));
  const w = Math.round(W * s), h = Math.round(H * s);
  const small = new cv.Mat();
  const mask = new cv.Mat();
  const bgd = new cv.Mat();
  const fgd = new cv.Mat();
  const fg = new cv.Mat(h, w, cv.CV_8UC1);
  try {
    cv.resize(rgb, small, new cv.Size(w, h), 0, 0, cv.INTER_AREA);
    const mx = Math.round(w * 0.03), my = Math.round(h * 0.03);
    const rect = new cv.Rect(mx, my, w - 2 * mx, h - 2 * my);
    cv.grabCut(small, mask, rect, bgd, fgd, 3, cv.GC_INIT_WITH_RECT);
    const md = mask.data as Uint8Array, fd = fg.data as Uint8Array;
    for (let i = 0; i < md.length; i++) fd[i] = md[i] === 1 || md[i] === 3 ? 255 : 0;
    const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
    cv.morphologyEx(fg, fg, cv.MORPH_OPEN, k);
    k.delete();
    const contours = new cv.MatVector();
    const hier = new cv.Mat();
    cv.findContours(fg, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let bi = -1, ba = 0;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const a = cv.contourArea(c);
      if (a > ba) { ba = a; bi = i; }
      c.delete();
    }
    if (bi >= 0 && ba / (s * s) >= minArea) {
      const c = contours.get(bi);
      const tmp: Cand[] = [];
      quadsFromContour(cv, c, minArea * s * s, 'grabcut', 0.0, tmp, true);
      c.delete();
      for (const t of tmp) out.push({ ...t, q: t.q.map((p) => ({ x: p.x / s, y: p.y / s })) as Quad });
    }
    contours.delete();
    hier.delete();
  } catch {
    /* grabcut is optional */
  } finally {
    small.delete(); mask.delete(); bgd.delete(); fgd.delete(); fg.delete();
  }
  return out;
}
