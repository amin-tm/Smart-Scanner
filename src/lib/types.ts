export type FilterId = 'original' | 'magic' | 'noshadow' | 'lighten' | 'gray' | 'bw';

export interface Pt {
  x: number;
  y: number;
}

/** Corners in order: top-left, top-right, bottom-right, bottom-left (normalized 0..1 of the photo) */
export type Quad = [Pt, Pt, Pt, Pt];

export interface Adjust {
  brightness: number; // -100..100
  contrast: number; // -100..100
  sharpness: number; // 0..100
  strength: number; // 0..100  (filter intensity)
  threshold: number; // 0..100  (B&W darkness / text darkness)
}

export interface RenderParams {
  quad: Quad;
  rotation: number; // quarter turns clockwise
  filter: FilterId;
  adjust: Adjust;
  cleanEdges: boolean;
}

export type PageStatus = 'queued' | 'working' | 'ready' | 'error';

export interface Page {
  id: string;
  name: string;
  /** original file (or the rendered PDF page) */
  blob: Blob;
  /** photo size in pixels (after EXIF orientation) */
  width: number;
  height: number;
  quad: Quad;
  autoQuad: Quad | null;
  detected: boolean;
  rotation: number;
  filter: FilterId;
  adjust: Adjust;
  status: PageStatus;
  error?: string;
  fromPdf?: boolean;
  /** small working copy of the original photo (<= 1800 px) – used by the crop editor and fast previews */
  proxy?: Blob;
  srcUrl?: string;
  /** fast interactive preview of the current settings */
  prev?: { url: string; width: number; height: number; rev: number };
  /** crop + rotation the thumbnails were made for */
  thumbKey?: string;
  /** thumbnails exist for every filter (otherwise only for the current one) */
  thumbsAll?: boolean;
  /** final processed page (this exact image goes into the PDF) */
  out?: { blob: Blob; url: string; width: number; height: number; rev: number };
  /** tiny thumbnails: one per filter, of the current crop */
  thumbs?: Partial<Record<FilterId, string>>;
  /** bumped on every change that alters the output */
  rev: number;
}

export type PageSizeId = 'a4' | 'a5' | 'a3' | 'letter' | 'legal' | 'fit';
export type QualityId = 'fast' | 'standard' | 'high';

export interface Settings {
  defaultFilter: FilterId;
  autoDetect: boolean;
  pageSize: PageSizeId;
  quality: QualityId;
  cleanEdges: boolean;
  autoSave: boolean;
  openAfterSave: boolean;
  saveDir: string;
  filePrefix: string;
  clearAfterExport: boolean;
  runInBackground: boolean;
  autostart: boolean;
}

export const FULL_QUAD: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** Corners may lie this far outside the photo (sheets cut off by the frame). */
export const QUAD_OUT = 0.1;

export const DEFAULT_ADJUST: Adjust = {
  brightness: 0,
  contrast: 0,
  sharpness: 15,
  strength: 78,
  threshold: 58,
};

export const ALL_FILTERS: FilterId[] = ['magic', 'original', 'noshadow', 'lighten', 'gray', 'bw'];

export const FILTERS: { id: FilterId; label: string; hint: string }[] = [
  { id: 'magic', label: 'رنگ جادویی', hint: 'زمینه سفید، رنگ زنده و متن تیز' },
  { id: 'original', label: 'اصلی', hint: 'فقط برش و صاف کردن' },
  { id: 'noshadow', label: 'حذف سایه', hint: 'حذف سایه با حفظ رنگ طبیعی' },
  { id: 'lighten', label: 'روشن‌تر', hint: 'روشنایی و کنتراست بیشتر' },
  { id: 'gray', label: 'خاکستری', hint: 'طیف خاکستری با زمینه سفید' },
  { id: 'bw', label: 'سیاه و سفید', hint: 'متن سیاه روی زمینه سفید، مناسب چاپ' },
];

/** long side of the exported page image (px) + JPEG quality */
export const QUALITY: Record<QualityId, { label: string; hint: string; maxOut: number; jpeg: number }> = {
  fast: { label: 'سریع', hint: 'حجم کم · ۲۰۰ DPI', maxOut: 2339, jpeg: 0.85 },
  standard: { label: 'متعادل', hint: 'پیشنهادی · ۲۵۰ DPI', maxOut: 3008, jpeg: 0.88 },
  high: { label: 'چاپ', hint: 'کیفیت بالا · ۳۵۰+ DPI', maxOut: 4200, jpeg: 0.92 },
};

export const DEFAULT_SETTINGS: Settings = {
  defaultFilter: 'magic',
  autoDetect: true,
  pageSize: 'a4',
  quality: 'standard',
  cleanEdges: true,
  autoSave: true,
  openAfterSave: true,
  saveDir: '',
  filePrefix: 'Scan',
  clearAfterExport: true,
  runInBackground: true,
  autostart: false,
};

/* ---------- worker protocol ---------- */
export interface ProcessMsg {
  type: 'process';
  id: string;
  blob: Blob;
  /** run auto edge detection (otherwise `quad` is used) */
  detect: boolean;
  quad: Quad;
  rotation: number;
  filter: FilterId;
  adjust: Adjust;
  cleanEdges: boolean;
  /** long side of the working copy that is decoded from the file */
  srcMax: number;
  /** long side of the produced page image */
  maxOut: number;
  jpeg: number;
  bicubic: boolean;
  /** keep decoded source + warp in the worker (interactive edits) */
  cache: boolean;
  makeProxy: boolean;
  /** filters to produce 300px thumbnails for (empty = none) */
  thumbs: FilterId[];
}

export interface ProcessResult {
  width: number;
  height: number;
  quad: Quad;
  found: boolean;
  score: number;
  out: Blob;
  outW: number;
  outH: number;
  proxy?: Blob | null;
  thumbs?: { filter: FilterId; blob: Blob }[];
  /** milliseconds spent per stage (diagnostics) */
  timing?: Record<string, number>;
}

export type WorkerMsg = ProcessMsg;
