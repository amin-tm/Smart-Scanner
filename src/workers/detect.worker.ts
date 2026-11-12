import { detectWithCV } from '../lib/cvDetect';
import { loadCV } from '../lib/cvLoader';
import { detectDocument } from '../lib/detect';
import { cutsThroughPaper, detectFrameSpanningPaper, excludesPrintedContent, isFullPageScan, refineDocumentQuad } from '../lib/refine';
import { FULL_QUAD, type DetectMsg, type DetectResult } from '../lib/types';

function sample(bitmap: ImageBitmap, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

async function detect(blob: Blob): Promise<DetectResult> {
  const bitmap = await createImageBitmap(blob);
  try {
    const image = sample(bitmap, 1600);
    if (isFullPageScan(image)) return { quad: FULL_QUAD, found: true };
    let result: DetectResult | undefined;
    try {
      const loaded = await loadCV();
      if (loaded) {
        const candidate = detectWithCV(loaded.cv, image);
        if (candidate.found) {
          result = candidate;
        } else if (Math.max(image.width, image.height) > 480) {
          const retry = detectWithCV(loaded.cv, sample(bitmap, 480));
          if (retry.found && retry.method !== 'full-page') {
            result = { found: true, quad: refineDocumentQuad(image, retry.quad) };
          }
        }
      }
    } catch (error) {
      console.warn('[detect] OpenCV unavailable, using built-in detector', error);
    }
    const safe = (candidate: DetectResult) => candidate.found
      && !excludesPrintedContent(image, candidate.quad) && !cutsThroughPaper(image, candidate.quad);
    const spansFrame = (quad: DetectResult['quad']) =>
      (Math.max(quad[0].x, quad[3].x) < .04 && Math.min(quad[1].x, quad[2].x) > .96) ||
      (Math.max(quad[0].y, quad[1].y) < .04 && Math.min(quad[2].y, quad[3].y) > .96);
    if (!result || !safe(result) || spansFrame(result.quad)) {
      const spanning = detectFrameSpanningPaper(image);
      if (spanning && safe({ quad: spanning, found: true })) return { quad: spanning, found: true };
    }
    if (result && safe(result)) return { quad: result.quad, found: true };
    const fallback = detectDocument(sample(bitmap, 640), image);
    return safe(fallback) ? { quad: fallback.quad, found: true } : { quad: FULL_QUAD, found: false };
  } finally {
    bitmap.close();
  }
}

self.onmessage = async (event: MessageEvent<DetectMsg>) => {
  try {
    const start = performance.now();
    const result = await detect(event.data.blob);
    result.timing = { detect: Math.round(performance.now() - start) };
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
