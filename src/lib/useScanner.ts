import { useCallback, useEffect, useRef, useState } from 'react';
import { batchPool, previewPool, warmEngine } from './engine';
import { buildPdf } from './pdfWriter';
import { downloadBlob, getDefaultDir, isDesktop, openPath, savePdfNative, showInFolder } from './desktop';
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

const PREVIEW_MAX = 1300;
const srcMaxFor = (maxOut: number) => Math.min(4200, Math.round(maxOut * 1.25));
const thumbKeyOf = (p: Page) => `${p.quad.map((q) => `${q.x.toFixed(4)},${q.y.toFixed(4)}`).join(';')}|${p.rotation}`;

export interface ExportResult {
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
  return any ? { url: any.url, width: any.width, height: any.height, stale: true } : null;
}

export function useScanner() {
  const [pages, setPagesState] = useState<Page[]>([]);
  const pagesRef = useRef<Page[]>([]);
  const [selId, setSelIdState] = useState<string | null>(null);
  const selRef = useRef<string | null>(null);
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const settingsRef = useRef(settings);
  const [importing, setImporting] = useState(0);
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
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
  }, []);

  /* ------------------------------------------------------------ preview (fast, interactive) */
  const runners = useRef(new Map<string, { running: boolean; next: boolean }>());
  const requestPreview = useCallback(
    (id: string) => {
      let r = runners.current.get(id);
      if (!r) runners.current.set(id, (r = { running: false, next: false }));
      r.next = true;
      if (r.running) return;
      r.running = true;
      (async () => {
        const st = r!;
        while (st.next) {
          st.next = false;
          const p = find(id);
          if (!p || !p.proxy || p.status !== 'ready') break;
          const key = thumbKeyOf(p);
          const needThumbs = p.thumbKey !== key || !p.thumbsAll;
          const rev = p.rev;
          try {
            const res = await previewPool.run(
              {
                type: 'process',
                id: p.id,
                blob: p.proxy,
                detect: false,
                quad: p.quad,
                rotation: p.rotation,
                filter: p.filter,
                adjust: p.adjust,
                cleanEdges: settingsRef.current.cleanEdges,
                srcMax: 1650,
                maxOut: PREVIEW_MAX,
                jpeg: 0.82,
                bicubic: false,
                cache: true,
                makeProxy: false,
                thumbs: needThumbs ? ALL_FILTERS : [],
              },
              100,
            );
            const cur = find(id);
            if (!cur) continue;
            const url = URL.createObjectURL(res.out);
            if (cur.prev) URL.revokeObjectURL(cur.prev.url);
            const ch: Partial<Page> = { prev: { url, width: res.outW, height: res.outH, rev } };
            if (res.thumbs) {
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
          }
        }
        st.running = false;
      })();
    },
    [patch],
  );

  /* ------------------------------------------------------------ final (export quality, background) */
  const finals = useRef(new Map<string, { rev: number; promise: Promise<void> }>());
  const timers = useRef(new Map<string, number>());

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
        detect: false,
        quad: p.quad,
        rotation: p.rotation,
        filter: p.filter,
        adjust: p.adjust,
        cleanEdges: s.cleanEdges,
        srcMax: srcMaxFor(q.maxOut),
        maxOut: q.maxOut,
        jpeg: q.jpeg,
        bicubic: s.quality === 'high',
        cache: false,
        makeProxy: false,
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

  const scheduleFinal = useCallback(
    (id: string, delay = 700) => {
      const t = timers.current.get(id);
      if (t) clearTimeout(t);
      timers.current.set(
        id,
        window.setTimeout(() => {
          timers.current.delete(id);
          void ensureFinal(id, 0);
        }, delay),
      );
    },
    [ensureFinal],
  );

  /* ------------------------------------------------------------ import */
  const importPage = useCallback(
    async (id: string) => {
      const p0 = find(id);
      if (!p0) return;
      patch(id, { status: 'working' });
      const s = settingsRef.current;
      try {
        // Upload stage: detect the page + build the working copy + a fast image.
        // The print-quality render is queued right after, in the background,
        // so 20 photos appear on screen immediately instead of one by one.
        const res = await batchPool.run({
          type: 'process',
          id,
          blob: p0.blob,
          detect: s.autoDetect && !p0.fromPdf,
          quad: FULL_QUAD,
          rotation: 0,
          filter: p0.filter,
          adjust: p0.adjust,
          cleanEdges: s.cleanEdges,
          srcMax: 2400,
          maxOut: 1400,
          jpeg: 0.82,
          bicubic: false,
          cache: false,
          makeProxy: true,
          thumbs: [p0.filter],
        });
        const cur = find(id);
        if (!cur) return;
        const thumbs: Partial<Record<FilterId, string>> = {};
        for (const t of res.thumbs ?? []) thumbs[t.filter] = URL.createObjectURL(t.blob);
        const proxy = res.proxy ?? cur.blob;
        const srcUrl = URL.createObjectURL(proxy);
        patch(id, {
          status: 'ready',
          width: res.width,
          height: res.height,
          quad: res.quad,
          autoQuad: res.found ? res.quad : null,
          detected: res.found,
          proxy,
          srcUrl,
          prev: { url: URL.createObjectURL(res.out), width: res.outW, height: res.outH, rev: cur.rev },
          thumbs,
          thumbKey: thumbKeyOf({ ...cur, quad: res.quad }),
        });
        if (!selRef.current) setSel(id);
        if (selRef.current === id) requestPreview(id);
        scheduleFinal(id, 450);
      } catch (e) {
        patch(id, { status: 'error', error: e instanceof Error ? e.message : 'خطا در پردازش' });
      }
    },
    [patch, setSel, requestPreview, scheduleFinal],
  );

  const addFiles = useCallback(
    async (input: File[] | FileList) => {
      const files = Array.from(input)
        .filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf' || /\.(pdf|jpe?g|png|webp|bmp|heic|avif)$/i.test(f.name))
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
        rev: 0,
        fromPdf,
      });
      const images = files.filter((f) => !(f.type === 'application/pdf' || /\.pdf$/i.test(f.name)));
      const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
      const fresh = images.map((f) => mk(f.name, f));
      if (fresh.length) {
        setPages((ps) => [...ps, ...fresh]);
        fresh.forEach((p) => void importPage(p.id));
      }
      for (const f of pdfs) {
        setImporting((n) => n + 1);
        try {
          const { renderPdf } = await import('./pdfImport');
          const dpi = Math.ceil(QUALITY[settingsRef.current.quality].maxOut / 11.69);
          await renderPdf(
            f,
            (img) => {
              const pg = mk(img.name, img.blob, true);
              setPages((ps) => [...ps, pg]);
              void importPage(pg.id);
            },
            dpi,
          );
        } catch (e) {
          console.error(e);
          setError(`خواندن «${f.name}» ممکن نشد.`);
        } finally {
          setImporting((n) => n - 1);
        }
      }
    },
    [importPage, setPages],
  );

  /* ------------------------------------------------------------ edits */
  const edit = useCallback(
    (id: string, ch: Partial<Pick<Page, 'quad' | 'rotation' | 'filter' | 'adjust'>>, withPreview = true) => {
      patch(id, (p) => ({ ...ch, rev: p.rev + 1 }));
      if (withPreview) requestPreview(id);
      scheduleFinal(id);
    },
    [patch, requestPreview, scheduleFinal],
  );

  const select = useCallback(
    (id: string) => {
      setSel(id);
      const p = find(id);
      const d = p ? displayOf(p) : null;
      if (p && p.status === 'ready' && (!d || d.stale || !p.thumbsAll)) requestPreview(id);
    },
    [requestPreview, setSel],
  );

  const freePage = (p: Page) => {
    if (p.srcUrl) URL.revokeObjectURL(p.srcUrl);
    if (p.out) URL.revokeObjectURL(p.out.url);
    if (p.prev) URL.revokeObjectURL(p.prev.url);
    if (p.thumbs) Object.values(p.thumbs).forEach((u) => u && URL.revokeObjectURL(u));
    const t = timers.current.get(p.id);
    if (t) clearTimeout(t);
    timers.current.delete(p.id);
    runners.current.delete(p.id);
  };

  const removePage = useCallback(
    (id: string) => {
      const list = pagesRef.current;
      const i = list.findIndex((p) => p.id === id);
      if (i < 0) return;
      freePage(list[i]);
      const rest = list.filter((p) => p.id !== id);
      setPages(() => rest);
      if (selRef.current === id) {
        const nxt = rest[Math.min(i, rest.length - 1)];
        setSel(nxt ? nxt.id : null);
        if (nxt) requestPreview(nxt.id);
      }
    },
    [requestPreview, setPages, setSel],
  );

  const clearAll = useCallback(() => {
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
    (filter: FilterId) => {
      for (const p of pagesRef.current) {
        if (p.status !== 'ready' || p.filter === filter) continue;
        edit(p.id, { filter }, p.id === selRef.current);
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
        pagesRef.current.forEach((p) => p.status === 'ready' && scheduleFinal(p.id, 900));
        if (selRef.current) requestPreview(selRef.current);
      }
    },
    [requestPreview, scheduleFinal, setPages],
  );

  /* ------------------------------------------------------------ export */
  const exportPdf = useCallback(async () => {
    if (exporting) return;
    const t0 = performance.now();
    const list = pagesRef.current.filter((p) => p.status === 'ready');
    if (!list.length) return;
    setError(null);
    setExporting({ done: 0, total: list.length });
    try {
      let done = 0;
      await Promise.all(
        list.map(async (p) => {
          for (let k = 0; k < 3; k++) {
            await ensureFinal(p.id, 50);
            const cur = find(p.id);
            if (!cur || (cur.out && cur.out.rev === cur.rev)) break;
          }
          setExporting({ done: ++done, total: list.length });
        }),
      );
      const imgs = [];
      for (const p0 of list) {
        const p = find(p0.id);
        if (!p?.out) continue;
        imgs.push({ jpeg: new Uint8Array(await p.out.blob.arrayBuffer()), width: p.out.width, height: p.out.height });
      }
      if (!imgs.length) throw new Error('هیچ صفحه‌ای برای ساخت PDF آماده نیست');
      const s = settingsRef.current;
      const pdf = buildPdf(imgs, s.pageSize);
      const name = `${s.filePrefix.trim() || 'Scan'}_${timestamp()}.pdf`;
      let path: string | undefined;
      if (isDesktop()) {
        path = await savePdfNative(pdf, s.saveDir, name);
        if (path && s.openAfterSave) void openPath(path);
      } else {
        downloadBlob(pdf, name);
      }
      setResult({ name: path ? path.split(/[\\/]/).pop() || name : name, path, pages: imgs.length, bytes: pdf.length, ms: performance.now() - t0, native: !!path });
      if (s.clearAfterExport) clearAll();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'ساخت PDF با خطا روبه‌رو شد');
    } finally {
      setExporting(null);
    }
  }, [clearAll, ensureFinal, exporting]);

  const busyCount = pages.filter((p) => p.status === 'queued' || p.status === 'working').length;

  /* keep the default folder visible in settings (desktop) */
  useEffect(() => {
    if (!isDesktop() || settingsRef.current.saveDir) return;
    void getDefaultDir().then((d) => {
      if (d && !settingsRef.current.saveDir) updateSettings({ saveDir: d });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finalPending = pages.filter((p) => p.status === 'ready' && !(p.out && p.out.rev === p.rev)).length;

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
    finalPending,
    addFiles,
    select,
    edit,
    removePage,
    clearAll,
    movePage,
    applyFilterToAll,
    updateSettings,
    exportPdf,
    requestPreview,
    dismissResult: () => setResult(null),
    dismissError: () => setError(null),
    openResult: () => result?.path && openPath(result.path),
    showResult: () => result?.path && showInFolder(result.path),
    setQuadFor: (id: string, quad: Quad) => edit(id, { quad }),
  };
}
