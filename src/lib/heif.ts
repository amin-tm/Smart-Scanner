import Decoder from '../workers/heif.worker.ts?worker';

export function isHeifFile(file: Blob, name: string) {
  return /\.(heic|heif)$/i.test(name) || /^image\/(heic|heif)(-sequence)?$/i.test(file.type);
}

let readyDecoder: Promise<Worker> | undefined;
let queue = Promise.resolve();
interface DecodedImage {
  image: Blob;
  width: number;
  height: number;
  ms: number;
}

function getDecoder(): Promise<Worker> {
  if (readyDecoder) return readyDecoder;
  readyDecoder = new Promise<Worker>((resolve, reject) => {
    const decoder = new Decoder();
    const timer = setTimeout(() => fail('رمزگشای HEIC بارگذاری نشد.'), 30_000);
    function fail(message: string) {
      clearTimeout(timer);
      decoder.terminate();
      reject(new Error(message));
    }
    decoder.onerror = event => fail(event.message || 'رمزگشای HEIC اجرا نشد.');
    decoder.onmessage = (event: MessageEvent<{ ready?: boolean }>) => {
      if (!event.data.ready) return;
      clearTimeout(timer);
      decoder.onmessage = null;
      decoder.onerror = () => { decoder.terminate(); readyDecoder = undefined; };
      resolve(decoder);
    };
  }).catch(error => {
    readyDecoder = undefined;
    throw error;
  });
  return readyDecoder;
}

export function warmHeifDecoder() {
  void getDecoder().catch(() => undefined);
}

async function decode(file: Blob): Promise<DecodedImage> {
  const decoder = await getDecoder();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => fail('زمان خواندن تصویر HEIC به پایان رسید.'), 60_000);
    function cleanUp() {
      clearTimeout(timer);
      decoder.onmessage = null;
      decoder.onmessageerror = null;
      decoder.onerror = () => { decoder.terminate(); readyDecoder = undefined; };
    }
    function fail(message: string) {
      cleanUp();
      decoder.terminate();
      readyDecoder = undefined;
      reject(new Error(message));
    }
    decoder.onmessage = (event: MessageEvent<DecodedImage | { error: string }>) => {
      cleanUp();
      if ('image' in event.data) resolve(event.data);
      else reject(new Error(event.data.error));
    };
    decoder.onerror = event => fail(event.message || 'رمزگشای HEIC اجرا نشد.');
    decoder.onmessageerror = () => fail('پاسخ رمزگشای HEIC قابل خواندن نبود.');
    try { decoder.postMessage(file); } catch { fail('ارسال تصویر به رمزگشا ممکن نشد.'); }
  });
}

export function decodeHeif(file: Blob, isCurrent: () => boolean): Promise<DecodedImage> {
  // Avoid allocating multiple decoded camera originals at the same time.
  const result = queue.then(() => {
    if (!isCurrent()) throw new Error('Cancelled');
    return decode(file);
  });
  queue = result.then(() => undefined, () => undefined);
  return result;
}
