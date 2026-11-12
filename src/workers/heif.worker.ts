import { heicTo } from 'heic-to/next';

self.onmessage = async (event: MessageEvent<Blob>) => {
  let bitmap: ImageBitmap | undefined;
  try {
    const start = performance.now();
    try {
      bitmap = await createImageBitmap(event.data);
    } catch {
      bitmap = await heicTo({ blob: event.data, type: 'bitmap' });
    }
    // Match the maximum source resolution of ScanLite's print pipeline.
    const scale = Math.min(1, 4200 / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
    );
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const image = await canvas.convertToBlob({ type: 'image/jpeg', quality: .98 });
    self.postMessage({ image, width: canvas.width, height: canvas.height, ms: Math.round(performance.now() - start) });
  } catch {
    self.postMessage({ error: 'خواندن تصویر HEIC ممکن نشد. فایل را بررسی کنید.' });
  } finally {
    bitmap?.close();
  }
};

// The caller starts its decode timer only after the worker script has loaded.
self.postMessage({ ready: true });
