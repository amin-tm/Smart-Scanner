import { detectDocument } from '../lib/detect';
import { detectWithCV } from '../lib/cvDetect';
import { loadCV } from '../lib/cvLoader';
import {
  REF_LONG,
  enhance,
  estimateBackground,
  needsBackground,
  planOutput,
  warpPerspective,
  type Background,
  type RGBAImage,
} from '../lib/imageproc';
import { DEFAULT_ADJUST } from '../lib/types';
import type { FilterId, ProcessMsg, ProcessResult, Quad } from '../lib/types';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ProcessMsg>) => void) | null;
  postMessage: (msg: unknown) => void;
};

/* ---------- small LRU caches (interactive worker only) ---------- */
const srcCache = new Map<string, { img: RGBAImage; width: number; height: number }>();
const warpCache = new Map<string, { img: RGBAImage; bg: Background | null }>();

function lruGet<T>(m: Map<string, T>, k: string): T | undefined {
  const v = m.get(k);
  if (v !== undefined) {
    m.delete(k);
    m.set(k, v);
  }
  return v;
}
function lruSet<T>(m: Map<string, T>, k: string, v: T, max: number) {
  m.delete(k);
  m.set(k, v);
  while (m.size > max) {
    const first = m.keys().next().value;
    if (first === undefined) break;
    m.delete(first);
  }
}

/* ---------- helpers ---------- */
function drawScaled(src: ImageBitmap, w: number, h: number, willRead: boolean) {
  const oc = new OffscreenCanvas(w, h);
  const c = oc.getContext('2d', willRead ? { willReadFrequently: true } : undefined) as OffscreenCanvasRenderingContext2D;
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  c.drawImage(src, 0, 0, w, h);
  return { oc, c };
}

function bitmapToImage(src: ImageBitmap, w: number, h: number): RGBAImage {
  const { c } = drawScaled(src, w, h, true);
  const id = c.getImageData(0, 0, w, h);
  return { data: id.data, width: w, height: h };
}

function fitSize(w: number, h: number, maxDim: number) {
  const sc = Math.min(1, maxDim / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * sc)), h: Math.max(1, Math.round(h * sc)), sc };
}

async function encodeImage(img: RGBAImage, quality: number): Promise<Blob> {
  const oc = new OffscreenCanvas(img.width, img.height);
  const c = oc.getContext('2d') as OffscreenCanvasRenderingContext2D;
  c.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0);
  return oc.convertToBlob({ type: 'image/jpeg', quality });
}

function downscaleImage(img: RGBAImage, maxDim: number): RGBAImage {
  const { w, h } = fitSize(img.width, img.height, maxDim);
  const a = new OffscreenCanvas(img.width, img.height);
  (a.getContext('2d') as OffscreenCanvasRenderingContext2D).putImageData(
    new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height),
    0,
    0,
  );
  const b = new OffscreenCanvas(w, h);
  const c = b.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  c.drawImage(a, 0, 0, w, h);
  const id = c.getImageData(0, 0, w, h);
  return { data: id.data, width: w, height: h };
}

function toPx(q: Quad, W: number, H: number): Quad {
  return q.map((p) => ({ x: p.x * W, y: p.y * H })) as Quad;
}

/* ---------- the whole pipeline for one page ---------- */
async function process(m: ProcessMsg): Promise<ProcessResult> {
  const T0 = performance.now();
  const tm: Record<string, number> = {};
  let tl = T0;
  const lap = (k: string) => {
    const n = performance.now();
    tm[k] = Math.round(n - tl);
    tl = n;
  };
  const ck = `${m.id}@${m.srcMax}`;
  let width = 0;
  let height = 0;
  let src: RGBAImage | null = null;
  let workBmp: ImageBitmap | null = null;
  let full: ImageBitmap | null = null;

  const hit = m.cache ? lruGet(srcCache, ck) : undefined;
  if (hit) {
    src = hit.img;
    width = hit.width;
    height = hit.height;
  } else {
    full = await createImageBitmap(m.blob); // EXIF orientation is applied by the browser
    width = full.width;
    height = full.height;
    const { w, h, sc } = fitSize(width, height, m.srcMax);
    if (sc < 1) {
      try {
        workBmp = await createImageBitmap(full, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium' });
      } catch {
        workBmp = null;
      }
    }
    const base = workBmp ?? full;
    src = bitmapToImage(base, w, h);
    if (m.cache) lruSet(srcCache, ck, { img: src, width, height }, 3);
  }

  lap('decode');
  const W = src.width;
  const H = src.height;
  let quad = m.quad;
  let found = true;
  let score = 1;
  let proxy: Blob | null = null;

  try {
    if (m.detect) {
      const base = workBmp ?? full!;
      const hs = fitSize(W, H, 1600);
      const hi = bitmapToImage(base, hs.w, hs.h);
      let done = false;
      // 1) OpenCV multi-strategy detector (edges + paper region + GrabCut)
      try {
        const { cv } = await loadCV();
        const det = detectWithCV(cv, hi);
        if (det.found) {
          quad = det.quad;
          found = true;
          score = det.score;
          done = true;
        }
      } catch (e) {
        console.warn('[detect] OpenCV unavailable, using built-in detector', e);
      }
      // 2) built-in detector as a safety net
      if (!done) {
        const sm = fitSize(W, H, 640);
        const small = bitmapToImage(base, sm.w, sm.h);
        const det = detectDocument(small, hi);
        quad = det.quad;
        found = det.found;
        score = det.score;
      }
    }
    if (m.makeProxy && (workBmp || full)) {
      const base = workBmp ?? full!;
      const p = fitSize(W, H, 1800);
      const { oc } = drawScaled(base, p.w, p.h, false);
      proxy = await oc.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    }
  } finally {
    workBmp?.close();
    full?.close();
  }

  lap('detect+proxy');
  /* ----- perspective correction ----- */
  const plan = planOutput(toPx(quad, W, H), W, H, m.rotation, m.maxOut, false);
  const { outW, outH } = plan;
  const wkey = `${ck}|${plan.quad.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(';')}|${outW}x${outH}|${m.bicubic ? 'c' : 'l'}`;
  let entry = m.cache ? lruGet(warpCache, wkey) : undefined;
  if (!entry) {
    entry = { img: warpPerspective(src, plan.quad, outW, outH, !m.bicubic), bg: null };
    if (m.cache) lruSet(warpCache, wkey, entry, 2);
  }

  lap('warp');
  /* ----- tiny filter thumbnails of the current crop ----- */
  let thumbs: { filter: FilterId; blob: Blob }[] | undefined;
  if (m.thumbs.length) {
    const small = downscaleImage(entry.img, 300);
    const sbg = estimateBackground(small);
    thumbs = [];
    for (const fid of m.thumbs) {
      const t: RGBAImage = { data: new Uint8ClampedArray(small.data), width: small.width, height: small.height };
      enhance(t, fid, DEFAULT_ADJUST, {
        resScale: Math.max(small.width, small.height) / REF_LONG,
        cleanEdges: m.cleanEdges,
        bg: needsBackground(fid) ? sbg : null,
      });
      thumbs.push({ filter: fid, blob: await encodeImage(t, 0.8) });
    }
  }

  lap('thumbs');
  /* ----- filter + adjustments ----- */
  if (needsBackground(m.filter) && !entry.bg) entry.bg = estimateBackground(entry.img);
  const work: RGBAImage = {
    data: m.cache ? new Uint8ClampedArray(entry.img.data) : entry.img.data,
    width: outW,
    height: outH,
  };
  enhance(work, m.filter, m.adjust, {
    resScale: Math.max(outW, outH) / REF_LONG,
    cleanEdges: m.cleanEdges,
    bg: entry.bg,
  });
  lap('enhance');
  const out = await encodeImage(work, m.jpeg);
  lap('encode');
  tm.total = Math.round(performance.now() - T0);
  return { width, height, quad, found, score, out, outW, outH, proxy, thumbs, timing: tm };
}

scope.onmessage = async (e: MessageEvent<ProcessMsg>) => {
  if ((e.data as unknown as { type?: string }).type === 'warm') {
    loadCV().catch(() => undefined); // preload only, no reply
    return;
  }
  try {
    const result = await process(e.data);
    scope.postMessage({ ok: true, result });
  } catch (err) {
    scope.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
