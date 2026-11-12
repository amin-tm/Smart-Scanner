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
const srcCache = new Map<string, RGBAImage>();
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
  let src = m.cache ? lruGet(srcCache, ck) : undefined;
  if (!src) {
    const bitmap = await createImageBitmap(m.blob);
    try {
      const { w, h } = fitSize(bitmap.width, bitmap.height, m.srcMax);
      src = bitmapToImage(bitmap, w, h);
      if (m.cache) lruSet(srcCache, ck, src, 3);
    } finally {
      bitmap.close();
    }
  }

  lap('decode');
  const W = src.width;
  const H = src.height;
  const quad = m.quad;
  /* ----- perspective correction ----- */
  const plan = planOutput(toPx(quad, W, H), W, H, m.rotation, m.maxOut, m.upscale ?? false);
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
  return { out, outW, outH, thumbs, timing: tm };
}

scope.onmessage = async (e: MessageEvent<ProcessMsg>) => {
  try {
    const result = await process(e.data);
    scope.postMessage({ ok: true, result });
  } catch (err) {
    scope.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
