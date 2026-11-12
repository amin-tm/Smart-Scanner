import { useCallback, useEffect, useRef, useState } from 'react';
import { batchPool, detectionPool, previewPool, warmEngine } from './engine';
import { decodeHeif, isHeifFile, warmHeifDecoder } from './heif';
import { buildPdf } from './pdfWriter';
import { downloadBlob, getDefaultDir, isDesktop, openPath, pickImageFolder, saveExportNative, showInFolder } from './desktop';
import { loadSettings, saveSettings, timestamp } from './storage';
import {
  ALL_FILTERS,
  DEFAULT_ADJUST,
  FULL_QUAD,
  QUALITY,
  type FilterId,
  type Page,
  type ProcessMsg,
  type Quad,
  type Settings,
} from './types';

let uid = 0;
const newId = () => `p${Date.now().toString(36)}${(uid++).toString(36)}`;

const PREVIEW_MAX = 1000;
const srcMaxFor = (maxOut: number) => Math.min(4200, Math.round(maxOut * 1.25));
const thumbKeyOf = (p: Page) => `${p.quad.map((q) => `${q.x.toFixed(4)},${q.y.toFixed(4)}`).join(';')}|${p.rotation}`;

async function imageSize(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
  return { width: image.naturalWidth, height: image.naturalHeight };
}

export interface ExportResult {
  format: 'pdf' | 'jpg';
  name: string;
  path?: string;
  pages: number;
  bytes: number;
  ms: number;
  native: boolean;
}

/** The image that should currently be shown for a page (newest first). */
export function displayOf(p: Page): { url: string; width: number; height: number; stale: boolean } | null {
  if (p.out && p.out.rev === p.rev) return { ...p.out, stale: false };
  if (p.prev && p.prev.rev === p.rev) return { ...p.prev, stale: false };
  const any = p.prev ?? p.out;
  if (any) return { url: any.url, width: any.width, height: any.height, stale: true };
  return null;
}

export function useScanner() {
  const [pages, setPagesState] = useState<Page[]>([]);
  const pagesRef = useRef<Page[]>([]);
  const [selId, setSelIdState] = useState<string | null>(null);
  const selRef = useRef<string | null>(null);
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const settingsRef = useRef(settings);
  const [importing, setImporting] = useState(0);
  const importSession = useRef(0);
  const [exporting, setExporting] = useState<{ done: number; total: number; format: ExportResult['format'] } | null>(null);
  const exportInProgress = useRef(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setPages = useCallback((fn: (p: Page[]) => Page[]) => {
    pagesRef.current = fn(pagesRef.current);
    setPagesState(pagesRef.current);
  }, []);
  const setSel = useCallback((id: string | null) => {
    selRef.current = id;
    setSelIdState(id);
  }, []);
  const find = (id: string) => pagesRef.current.find((p) => p.id === id);
  const patch = useCallback(
    (id: string, ch: Partial<Page> | ((p: Page) => Partial<Page>)) =>
      setPages((ps) => ps.map((p) => (p.id === id ? { ...p, ...(typeof ch === 'function' ? ch(p) : ch) } : p))),
    [setPages],
  );

  useEffect(() => {
    warmEngine();
    const prewarm = setTimeout(warmHeifDecoder, 250);
    return () => clearTimeout(prewarm);
  }, []);

  /* ------------------------------------------------------------ preview (fast, interactive) */
  const runners = useRef(new Map<string, { running: boolean; next: boolean; thumbnails: boolean }>());
  const requestPreview = useCallback(
    (id: string, thumbnails = false) => {
      let r = runners.current.get(id);
      if (!r) runners.current.set(id, (r = { running: false, next: false, thumbnails: false }));
      r.next = true;
      r.thumbnails ||= thumbnails;
      if (thumbnails && find(id)?.thumbnailError) patch(id, { thumbnailError: undefined });
      if (r.running) return;
      r.running = true;
      (async () => {
        const st = r!;
        while (st.next) {
          st.next = false;
          const p = find(id);
          if (!p || p.status !== 'ready' || p.autoCropPending) break;
          const key = thumbKeyOf(p);
          const needThumbs = st.thumbnails && (p.thumbKey !== key || !p.thumbsAll);
          const previewCurrent = displayOf(p)?.stale === false;
          if (st.thumbnails && !needThumbs && previewCurrent) { st.thumbnails = false; continue; }
          // Deliver the edited document first. A separate small pass can then
          // generate filter samples without delaying the visible preview.
          const thumbsOnly = needThumbs && (previewCurrent || p.previewErrorRev === p.rev);
          st.thumbnails = needThumbs && !thumbsOnly;
          st.next ||= st.thumbnails;
          const rev = p.rev;
          if (!thumbsOnly && p.previewErrorRev === rev) patch(id, { previewErrorRev: undefined });
          try {
            const res = await previewPool.run(
              {
                type: 'process',
                id: p.id,
                blob: p.blob,
                quad: p.quad,
                rotation: p.rotation,
                filter: thumbsOnly ? 'original' : p.filter,
                adjust: p.adjust,
                cleanEdges: settingsRef.current.cleanEdges,
                srcMax: thumbsOnly ? 900 : 1650,
                maxOut: thumbsOnly ? 300 : PREVIEW_MAX,
                jpeg: 0.82,
                bicubic: false,
                cache: true,
                thumbs: thumbsOnly ? ALL_FILTERS : [],
              },
              100,
            );
            const cur = find(id);
            if (!cur) continue;
            const ch: Partial<Page> = {};
            if (!thumbsOnly && cur.rev === rev) {
              ch.previewErrorRev = undefined;
              if (cur.prev) URL.revokeObjectURL(cur.prev.url);
              ch.prev = { url: URL.createObjectURL(res.out), width: res.outW, height: res.outH, rev };
            }
            if (res.thumbs && thumbKeyOf(cur) === key) {
              ch.thumbnailError = undefined;
              if (cur.thumbs) Object.values(cur.thumbs).forEach((u) => u && URL.revokeObjectURL(u));
              const t: Partial<Record<FilterId, string>> = {};
              for (const x of res.thumbs) t[x.filter] = URL.createObjectURL(x.blob);
              ch.thumbs = t;
              ch.thumbKey = key;
              ch.thumbsAll = true;
            }
            patch(id, ch);
          } catch (e) {
            console.warn('preview failed', e);
            const cur = find(id);
            if (!cur) continue;
            const failure: Partial<Page> = {};
            if (!thumbsOnly && cur.rev === rev) failure.previewErrorRev = rev;
            if (thumbsOnly && thumbKeyOf(cur) === key) failure.thumbnailError = key;
            patch(id, failure);
          }
        }
        st.running = false;
      })();
    },
    [patch],
  );

  /* ------------------------------------------------------------ final (export quality, background) */
  const finals = useRef(new Map<string, { rev: number; promise: Promise<void> }>());

  const ensureFinal = useCallback(
    (id: string, priority: number): Promise<void> => {
      const p = find(id);
      if (!p || p.status !== 'ready') return Promise.resolve();
      if (p.out && p.out.rev === p.rev) return Promise.resolve();
      const cur = finals.current.get(id);
      if (cur && cur.rev === p.rev) return cur.promise;
      const rev = p.rev;
      const s = settingsRef.current;
      const q = QUALITY[s.quality];
      const msg: ProcessMsg = {
        type: 'process',
        id: p.id,
        blob: p.blob,
        quad: p.quad,
        rotation: p.rotation,
        filter: p.filter,
        adjust: p.adjust,
        cleanEdges: s.cleanEdges,
        srcMax: srcMaxFor(q.maxOut),
        maxOut: q.maxOut,
        jpeg: q.jpeg,
        bicubic: s.quality !== 'fast',
        upscale: s.quality === 'high',
        cache: false,
        thumbs: [],
      };
      const promise = batchPool
        .run(msg, priority)
        .then((res) => {
          const now = find(id);
          if (!now) return;
          if (now.out) URL.revokeObjectURL(now.out.url);
          patch(id, { out: { blob: res.out, url: URL.createObjectURL(res.out), width: res.outW, height: res.outH, rev } });
        })
        .catch((e) => console.warn('final render failed', e))
        .finally(() => {
          if (finals.current.get(id)?.rev === rev) finals.current.delete(id);
        });
      finals.current.set(id, { rev, promise });
      return promise;
    },
    [patch],
  );

  /* ------------------------------------------------------------ import */
  const detections = useRef(new Map<string, Promise<void>>());

  const importPage = useCallback(
    async (id: string) => {
      const page = find(id);
      if (!page) return;
      patch(id, { status: 'working' });
      let ownedUrl: string | undefined;
      try {
        const converted = page.srcUrl ? undefined : await decodeHeif(page.blob, () => !!find(id));
        if (!find(id)) return;
        const blob = converted?.image ?? page.blob;
        const url = page.srcUrl ?? (ownedUrl = URL.createObjectURL(blob));
        const { width, height } = converted ?? await imageSize(url);
        if (!find(id)) return;
        if (converted) console.debug('[scan] HEIC decode', converted.ms);
        const autoCropPending = settingsRef.current.autoDetect && !page.fromPdf;
        patch(id, { width, height, blob, srcUrl: url, status: 'ready', autoCropPending });
        ownedUrl = undefined;
        if (!autoCropPending) return;

        const task = detectionPool.run({ type: 'detect', id, blob }, id === selRef.current ? 10 : 0)
          .then(result => {
            const current = find(id);
            if (!current) return;
            const shouldCrop = current.autoCropPending && result.found
              && result.quad.some((corner, i) => corner.x !== FULL_QUAD[i].x || corner.y !== FULL_QUAD[i].y);
            patch(id, {
              autoCropPending: false,
              autoQuad: result.found ? result.quad : null,
              detected: result.found,
              ...(shouldCrop ? { quad: result.quad, rev: current.rev + 1 } : {}),
            });
            if (shouldCrop && id === selRef.current) requestPreview(id);
          })
          .catch(error => {
            if (!find(id)) return;
            console.warn('[scan] automatic crop failed', error);
            patch(id, { autoCropPending: false });
          })
          .finally(() => detections.current.delete(id));
        detections.current.set(id, task);
      } catch (error) {
        if (!find(id)) return;
        console.warn('[scan] image import failed', error);
        const detail = page.srcUrl ? 'خواندن تصویر ممکن نشد. سالم بودن فایل را بررسی کنید.'
          : error instanceof Error ? error.message : 'خواندن تصویر HEIC ممکن نشد.';
        patch(id, { status: 'error', error: detail });
      } finally {
        if (ownedUrl) URL.revokeObjectURL(ownedUrl);
      }
    },
    [patch, requestPreview],
  );

  const pendingImages = useRef<string[]>([]);
  const activeImports = useRef(0);
  const pumpImports = useCallback(function pump() {
    // Bound memory when a whole folder of camera originals is selected.
    while (activeImports.current < 4 && pendingImages.current.length) {
      const selected = pendingImages.current.indexOf(selRef.current ?? '');
      const [id] = pendingImages.current.splice(Math.max(selected, 0), 1);
      activeImports.current++;
      void importPage(id).finally(() => {
        activeImports.current--;
        pump();
      });
    }
  }, [importPage]);

  const queueImages = useCallback((newPages: Page[]) => {
    for (const page of newPages) {
      if (page.srcUrl) pendingImages.current.push(page.id);
      else void importPage(page.id); // The HEIC decoder has its own bounded queue.
    }
    pumpImports();
  }, [importPage, pumpImports]);

  const addFiles = useCallback(
    async (input: File[] | FileList) => {
      const files = Array.from(input)
        .filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf' || /\.(pdf|jpe?g|png|webp|bmp|heic|heif|avif)$/i.test(f.name))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      if (!files.length) {
        setError('فایل پشتیبانی‌شده‌ای پیدا نشد. عکس (JPG، PNG، WebP) یا PDF انتخاب کنید.');
        return;
      }
      setError(null);
      setResult(null);
      const s = settingsRef.current;
      const mk = (name: string, blob: Blob, fromPdf = false): Page => ({
        id: newId(),
        name,
        blob,
        width: 0,
        height: 0,
        quad: FULL_QUAD,
        autoQuad: null,
        detected: false,
        rotation: 0,
        filter: s.defaultFilter,
        adjust: { ...DEFAULT_ADJUST },
        status: 'queued',
        srcUrl: isHeifFile(blob, name) ? undefined : URL.createObjectURL(blob),
        rev: 0,
        fromPdf,
      });
      const images = files.filter((f) => !(f.type === 'application/pdf' || /\.pdf$/i.test(f.name)));
      const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
      const fresh = images.map((f) => mk(f.name, f));
      if (fresh.length) {
        setPages((ps) => [...ps, ...fresh]);
        if (!selRef.current) setSel(fresh[0].id);
        queueImages(fresh);
      }
      const session = importSession.current;
      for (const f of pdfs) {
        if (session !== importSession.current) break;
        setImporting((n) => n + 1);
        try {
          const { renderPdf } = await import('./pdfImport');
          const dpi = Math.ceil(QUALITY[settingsRef.current.quality].maxOut / 11.69);
          await renderPdf(
            f,
            (img) => {
              if (session !== importSession.current) return;
              const pg = mk(img.name, img.blob, true);
              setPages((ps) => [...ps, pg]);
              if (!selRef.current) setSel(pg.id);
              queueImages([pg]);
            },
            dpi,
            () => session === importSession.current,
          );
        } catch (e) {
          console.error(e);
          if (session === importSession.current) setError(`خواندن «${f.name}» ممکن نشد.`);
        } finally {
          if (session === importSession.current) setImporting((n) => n - 1);
        }
      }
    },
    [queueImages, setPages, setSel],
  );

  /* ------------------------------------------------------------ edits */
  const edit = useCallback(
    (id: string, ch: Partial<Pick<Page, 'quad' | 'rotation' | 'filter' | 'adjust'>>, withPreview = true) => {
      patch(id, (p) => ({ ...ch, ...(ch.quad ? { autoCropPending: false } : {}), rev: p.rev + 1 }));
      if (withPreview) requestPreview(id);
    },
    [patch, requestPreview],
  );

  const select = useCallback(
    (id: string, withPreview = true) => {
      setSel(id);
      detectionPool.prioritize(id, 10);
      pumpImports();
      const p = find(id);
      const d = p ? displayOf(p) : null;
      if (withPreview && p && p.status === 'ready' && (!d || d.stale)) requestPreview(id);
    },
    [pumpImports, requestPreview, setSel],
  );

  const commitCrops = useCallback((drafts: ReadonlyMap<string, Quad>) => {
    setPages(pages => pages.map(page => {
      const quad = drafts.get(page.id);
      return quad ? { ...page, quad, autoCropPending: false, rev: page.rev + 1 } : page;
    }));
  }, [setPages]);

  const freePage = (p: Page) => {
    if (p.srcUrl) URL.revokeObjectURL(p.srcUrl);
    if (p.out) URL.revokeObjectURL(p.out.url);
    if (p.prev) URL.revokeObjectURL(p.prev.url);
    if (p.thumbs) Object.values(p.thumbs).forEach((u) => u && URL.revokeObjectURL(u));
    runners.current.delete(p.id);
  };

  const removePage = useCallback(
    (id: string) => {
      const list = pagesRef.current;
      const i = list.findIndex((p) => p.id === id);
      if (i < 0) return;
      pendingImages.current = pendingImages.current.filter(pageId => pageId !== id);
      detectionPool.cancelQueued(new Set([id]));
      freePage(list[i]);
      const rest = list.filter((p) => p.id !== id);
      setPages(() => rest);
      if (selRef.current === id) {
        const nxt = rest[Math.min(i, rest.length - 1)];
        setSel(nxt ? nxt.id : null);
        if (nxt) {
          detectionPool.prioritize(nxt.id, 10);
          requestPreview(nxt.id);
        }
      }
    },
    [requestPreview, setPages, setSel],
  );

  const clearAll = useCallback(() => {
    importSession.current++;
    setImporting(0);
    const ids = new Set(pagesRef.current.map(page => page.id));
    pendingImages.current = [];
    detectionPool.cancelQueued(ids);
    batchPool.cancelQueued(ids);
    previewPool.cancelQueued(ids);
    setResult(null);
    setError(null);
    pagesRef.current.forEach(freePage);
    setPages(() => []);
    setSel(null);
  }, [setPages, setSel]);

  const movePage = useCallback(
    (id: string, dir: -1 | 1) =>
      setPages((ps) => {
        const i = ps.findIndex((p) => p.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= ps.length) return ps;
        const c = ps.slice();
        [c[i], c[j]] = [c[j], c[i]];
        return c;
      }),
    [setPages],
  );

  const applyFilterToAll = useCallback(
    (source: Pick<Page, 'id' | 'filter' | 'adjust'>) => {
      for (const p of pagesRef.current) {
        if (p.status !== 'ready' || p.id === source.id) continue;
        edit(p.id, { filter: source.filter, adjust: { ...source.adjust } }, p.id === selRef.current);
      }
    },
    [edit],
  );

  const updateSettings = useCallback(
    (ch: Partial<Settings>) => {
      const prev = settingsRef.current;
      const next = { ...prev, ...ch };
      settingsRef.current = next;
      setSettingsState(next);
      saveSettings(next);
      if (next.quality !== prev.quality || next.cleanEdges !== prev.cleanEdges) {
        setPages((ps) => ps.map((p) => (p.status === 'ready' ? { ...p, rev: p.rev + 1 } : p)));
        if (selRef.current) requestPreview(selRef.current);
      }
    },
    [requestPreview, setPages],
  );

  /* ------------------------------------------------------------ export */
  const exportDocument = useCallback(async (format: ExportResult['format']) => {
    if (exportInProgress.current) return;
    const t0 = performance.now();
    const list = pagesRef.current.filter(p => p.status === 'ready');
    if (!list.length) return;
    if (format === 'jpg' && list.length !== pagesRef.current.length) {
      setError('برای خروجی عکس، همهٔ صفحه‌ها باید آماده باشند. صفحه‌های خطادار را بررسی کنید.');
      return;
    }
    exportInProgress.current = true;
    setError(null);
    const s = settingsRef.current;
    const name = `${s.filePrefix.trim() || 'Scan'}_${timestamp()}.${format}`;
    try {
      const imageFolder = format === 'jpg' ? await pickImageFolder(s.saveDir) : null;
      if (format === 'jpg' && !imageFolder) return;
      setExporting({ done: 0, total: list.length, format });
      let done = 0;
      await Promise.all(
        list.map(async (p) => {
          if (find(p.id)?.autoCropPending) await detections.current.get(p.id);
          for (let k = 0; k < 3; k++) {
            await ensureFinal(p.id, 50);
            const cur = find(p.id);
            if (!cur || (cur.out && cur.out.rev === cur.rev)) break;
          }
          setExporting({ done: ++done, total: list.length, format });
        }),
      );
      const outputs = list.map(({ id }) => {
        const page = find(id);
        if (!page?.out || page.out.rev !== page.rev) {
          throw new Error('آماده‌سازی همهٔ صفحه‌ها کامل نشد. دوباره خروجی بگیرید.');
        }
        return page.out;
      });
      if (imageFolder) {
        const stem = name.slice(0, -4);
        const digits = Math.max(2, String(outputs.length).length);
        let written = 0, bytes = 0, firstPath: string | undefined;
        try {
          for (const output of outputs) {
            const data = new Uint8Array(await output.blob.arrayBuffer());
            const filename = stem + '-' + String(written + 1).padStart(digits, '0') + '.jpg';
            const path = await saveExportNative(data, imageFolder, filename);
            if (!path) throw new Error('مسیر فایل ذخیره‌شده مشخص نیست.');
            firstPath ??= path;
            bytes += data.length;
            written++;
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error('ذخیرهٔ عکس‌ها متوقف شد (' + written + ' از ' + outputs.length + '). ' + detail);
        }
        setResult({ format, name: imageFolder, path: firstPath, pages: written, bytes, ms: performance.now() - t0, native: true });
        return;
      }
      const imgs = await Promise.all(outputs.map(async ({ blob, width, height }) => ({
        jpeg: new Uint8Array(await blob.arrayBuffer()), width, height,
      })));
      const data = buildPdf(imgs, s.pageSize);
      let path: string | undefined;
      if (isDesktop()) {
        path = await saveExportNative(data, s.saveDir, name);
        if (path && format === 'pdf' && s.openAfterSave) void openPath(path);
      } else {
        downloadBlob(data, name);
      }
      if (s.clearAfterExport) clearAll();
      setResult({ format, name: path ? path.split(/[\\/]/).pop() || name : name, path, pages: imgs.length, bytes: data.length, ms: performance.now() - t0, native: !!path });
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : typeof e === 'string' ? e : 'ساخت خروجی با خطا روبه‌رو شد');
    } finally {
      exportInProgress.current = false;
      setExporting(null);
    }
  }, [clearAll, ensureFinal]);

  const busyCount = pages.filter((p) => p.status === 'queued' || p.status === 'working').length;

  /* keep the default folder visible in settings (desktop) */
  useEffect(() => {
    if (!isDesktop() || settingsRef.current.saveDir) return;
    void getDefaultDir().then((d) => {
      if (d && !settingsRef.current.saveDir) updateSettings({ saveDir: d });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  return {
    pages,
    selId,
    sel: pages.find((p) => p.id === selId) ?? null,
    settings,
    importing,
    exporting,
    result,
    error,
    busyCount,
    addFiles,
    select,
    edit,
    commitCrops,
    removePage,
    clearAll,
    movePage,
    applyFilterToAll,
    updateSettings,
    exportPdf: () => exportDocument('pdf'),
    exportImage: () => exportDocument('jpg'),
    requestPreview,
    dismissResult: () => setResult(null),
    dismissError: () => setError(null),
    openResult: () => result?.path && openPath(result.path),
    showResult: () => result?.path && showInFolder(result.path),
    setQuadFor: (id: string, quad: Quad) => edit(id, { quad }),
  };
}
