import * as pdfjsLib from 'pdfjs-dist';
import workerCode from 'pdfjs-dist/build/pdf.worker.min.mjs?raw';

let configured = false;

function configure() {
  if (configured) return;
  const polyfill =
    "if(typeof Promise.withResolvers!=='function'){Promise.withResolvers=function(){var a,b;var p=new Promise(function(r,j){a=r;b=j});return{promise:p,resolve:a,reject:b}}}\n";
  const blob = new Blob([polyfill, workerCode], { type: 'text/javascript' });
  pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
  configured = true;
}

export interface PdfPageImage {
  blob: Blob;
  width: number;
  height: number;
  name: string;
}

/** Renders every page of a PDF to a high resolution JPEG (≈300 DPI). */
export async function renderPdf(
  file: File,
  onPage: (img: PdfPageImage, index: number, total: number) => void,
  dpi = 300,
): Promise<number> {
  configure();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise;
  const total = pdf.numPages;
  const base = file.name.replace(/\.pdf$/i, '');
  try {
    for (let i = 1; i <= total; i++) {
      const page = await pdf.getPage(i);
      const vp1 = page.getViewport({ scale: 1 });
      const scale = Math.min(dpi / 72, 4200 / Math.max(vp1.width, vp1.height));
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas unavailable');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/jpeg', 0.95),
      );
      onPage({ blob, width: canvas.width, height: canvas.height, name: `${base} - صفحه ${i}` }, i, total);
      page.cleanup();
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    await pdf.destroy();
  }
  return total;
}
