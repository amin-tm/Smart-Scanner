/**
 * Minimal, very fast PDF writer for JPEG pages.
 * The JPEG bytes are embedded as-is (DCTDecode) – no re-encoding, no heavy library.
 */
import type { PageSizeId } from './types';

export interface PdfImage {
  jpeg: Uint8Array;
  width: number;
  height: number;
}

const SIZES: Record<string, [number, number]> = {
  a4: [595.28, 841.89],
  a5: [419.53, 595.28],
  a3: [841.89, 1190.55],
  letter: [612, 792],
  legal: [612, 1008],
};

const enc = new TextEncoder();
const f2 = (n: number) => (Math.round(n * 100) / 100).toString();

function layout(iw: number, ih: number, size: PageSizeId) {
  let pw: number;
  let ph: number;
  if (size === 'fit') {
    const long = 841.89;
    if (ih >= iw) {
      ph = long;
      pw = (long * iw) / ih;
    } else {
      pw = long;
      ph = (long * ih) / iw;
    }
  } else {
    [pw, ph] = SIZES[size] || SIZES.a4;
    if (iw > ih) [pw, ph] = [ph, pw];
  }
  const sc = Math.min(pw / iw, ph / ih);
  const w = iw * sc;
  const h = ih * sc;
  return { pw, ph, x: (pw - w) / 2, y: (ph - h) / 2, w, h };
}

const pdfDate = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
};

export function buildPdf(images: PdfImage[], size: PageSizeId): Uint8Array {
  const n = images.length;
  // object numbers: 1 catalog, 2 pages, 3 info, then (page, content, image) per page
  const parts: Uint8Array[] = [];
  const offsets: number[] = [0];
  let pos = 0;
  const push = (u: Uint8Array) => {
    parts.push(u);
    pos += u.length;
  };
  const str = (s: string) => push(enc.encode(s));
  const obj = (id: number, body: string) => {
    offsets[id] = pos;
    str(`${id} 0 obj\n${body}\nendobj\n`);
  };

  str('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const kids = images.map((_, i) => `${4 + i * 3} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  obj(3, `<< /Producer (Smart Scanner) /Creator (Smart Scanner) /CreationDate (${pdfDate(new Date())}) >>`);

  images.forEach((im, i) => {
    const pid = 4 + i * 3;
    const cid = pid + 1;
    const iid = pid + 2;
    const L = layout(im.width, im.height, size);
    obj(
      pid,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f2(L.pw)} ${f2(L.ph)}] /Resources << /XObject << /Im0 ${iid} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${cid} 0 R >>`,
    );
    const content = `q ${f2(L.w)} 0 0 ${f2(L.h)} ${f2(L.x)} ${f2(L.y)} cm /Im0 Do Q`;
    obj(cid, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    offsets[iid] = pos;
    str(
      `${iid} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.jpeg.length} >>\nstream\n`,
    );
    push(im.jpeg);
    str('\nendstream\nendobj\n');
  });

  const total = 4 + n * 3;
  const xref = pos;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let id = 1; id < total; id++) x += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  x += `trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  str(x);

  const out = new Uint8Array(pos);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
