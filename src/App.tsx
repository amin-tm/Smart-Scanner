import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { FileDown, Plus, Settings as Cog, Sparkles, Layers, Palette } from 'lucide-react';
import logo from './assets/logo.svg';
import EmptyState from './components/EmptyState';
import Rail from './components/Rail';
import Stage from './components/Stage';
import FilterModal from './components/FilterModal';
import PagesDrawer from './components/PagesDrawer';
import SettingsDialog from './components/SettingsDialog';
import AutoUpdateNotice from './components/AutoUpdateNotice';
import { DropOverlay, ErrorToast, ExportOverlay, ResultToast } from './components/Overlays';
import { Presence, Spinner, cx } from './components/ui';
import { useScanner } from './lib/useScanner';
import { appReady, setBackgroundMode } from './lib/desktop';
import { faNum } from './lib/storage';
import { DEFAULT_ADJUST, type Adjust, type FilterId } from './lib/types';

export default function App() {
  const sc = useScanner();
  const { pages, sel, settings } = sc;
  const [crop, setCrop] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showPages, setShowPages] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pick = useCallback(() => fileRef.current?.click(), []);

  /* Notify desktop shell once UI is ready */
  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => void appReady()));
    void setBackgroundMode(sc.settings.runInBackground);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Global drag & drop + paste */
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer?.files.length) void sc.addFiles(e.dataTransfer.files);
    };
    const paste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) void sc.addFiles(files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener('paste', paste);
    };
  }, [sc.addFiles]);

  /* Always keep a page selected */
  useEffect(() => {
    if (!sel && pages.length) sc.select(pages[0].id);
    if (!pages.length) {
      setCrop(false);
      setShowFilters(false);
      setShowPages(false);
    }
  }, [sel, pages, sc]);

  /** page switch with a smooth cross-fade (View Transitions API, falls back silently) */
  const selectPage = useCallback(
    (id: string) => {
      const d = document as unknown as { startViewTransition?: (cb: () => void) => unknown };
      if (d.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        d.startViewTransition(() => flushSync(() => sc.select(id)));
      } else sc.select(id);
    },
    [sc],
  );

  const busy = sc.busyCount > 0 || sc.importing > 0;
  const readyCount = pages.filter((p) => p.status === 'ready').length;
  const canExport = readyCount > 0 && !busy && !sc.exporting;

  /* Keyboard shortcuts */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (showSettings || showFilters || showPages) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        pick();
      } else if ((mod && e.key.toLowerCase() === 's') || (e.key === 'Enter' && !crop)) {
        if (canExport) {
          e.preventDefault();
          void sc.exportPdf();
        }
      } else if (!mod && sel) {
        const i = pages.findIndex((p) => p.id === sel.id);
        if (e.key === 'ArrowLeft' || e.key === 'PageDown') {
          if (i < pages.length - 1) selectPage(pages[i + 1].id);
        } else if (e.key === 'ArrowRight' || e.key === 'PageUp') {
          if (i > 0) selectPage(pages[i - 1].id);
        } else if (e.key.toLowerCase() === 'c') setCrop((c) => !c);
        else if (e.key.toLowerCase() === 'f') setShowFilters((f) => !f);
        else if (e.key.toLowerCase() === 'r' && sel.status === 'ready')
          sc.edit(sel.id, { rotation: (sel.rotation + (e.shiftKey ? 3 : 1)) % 4 });
        else if (e.key === 'Delete') sc.removePage(sel.id);
        else if (e.key === 'Escape') setCrop(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const done = pages.length - sc.busyCount;
  const curIndex = sel ? pages.findIndex((p) => p.id === sel.id) : 0;

  const exportBtn = (cls: string) => (
    <button
      className={cx('btn btn-primary whitespace-nowrap', canExport && 'btn-ready', cls)}
      disabled={!canExport}
      onClick={() => void sc.exportPdf()}
    >
      {sc.exporting ? (
        <Spinner className="h-5 w-5" />
      ) : busy ? (
        <Spinner className="h-5 w-5" />
      ) : (
        <FileDown className="h-5 w-5" />
      )}
      <span className="whitespace-nowrap">{busy ? 'در حال آماده‌سازی…' : 'ساخت PDF'}</span>
      {readyCount > 0 && !busy && (
        <span className="rounded-full bg-black/20 px-2 py-0.5 text-xs tabular-nums font-bold">
          {faNum(readyCount)}
        </span>
      )}
    </button>
  );

  return (
    <div className="relative h-full overflow-hidden flex flex-col">
      <div className="aurora">
        <i />
        <i />
        <i />
      </div>
      <div className="grain" />

      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/*,application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void sc.addFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <div className="relative z-10 flex h-full flex-col min-h-0">
        {/* Header - Single line, never wraps */}
        <header
          className="relative mx-3 mt-3 flex shrink-0 items-center gap-3 rounded-2xl border border-white/10 px-4 py-2.5 backdrop-blur-xl sm:mx-4 sm:mt-4 shadow-lg shadow-black/40"
          style={{ background: 'rgba(9, 14, 27, 0.72)' }}
        >
          <div className="hairline absolute inset-x-6 bottom-0 h-px opacity-70" />

          {/* Logo & Brand */}
          <div className="flex items-center gap-2.5 shrink-0">
            <img src={logo} alt="" className="h-8 w-8 rounded-xl shadow-lg shadow-teal-500/30" draggable={false} />
            <div className="leading-tight shrink-0">
              <div className="text-[0.92rem] font-extrabold tracking-tight whitespace-nowrap text-white">اسکنر هوشمند</div>
              <div className="flex items-center gap-1 text-[0.65rem] text-slate-400 whitespace-nowrap">
                <Sparkles className="h-3 w-3 text-teal-300" />
                <span>Smart Scanner</span>
              </div>
            </div>
          </div>

          {/* Center Progress HUD (Entertaining Live Status) */}
          <div className="mx-auto min-w-0 flex-1 px-3">
            {busy && pages.length > 0 && (
              <div className="a-fade-in mx-auto max-w-sm">
                <div className="mb-1 flex items-center justify-between text-[0.68rem] text-teal-200 whitespace-nowrap">
                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                    <Spinner className="h-3 w-3" />
                    <span>تشخیص هوشمند لبه و سفیدسازی…</span>
                  </span>
                  <span className="tabular-nums font-bold whitespace-nowrap">
                    {faNum(done)} / {faNum(pages.length)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="bar-fill h-full rounded-full transition-all duration-300"
                    style={{ width: `${Math.max(6, (done / Math.max(1, pages.length)) * 100)}%` }}
                  />
                </div>
              </div>
            )}
            {!busy && sc.finalPending > 0 && (
              <div className="a-fade-in mx-auto flex w-fit items-center gap-1.5 rounded-full bg-teal-400/10 border border-teal-300/20 px-3 py-1 text-[0.68rem] text-teal-200 whitespace-nowrap">
                <Spinner className="h-3 w-3" />
                <span>نهایی‌سازی کیفیت چاپ در پس‌زمینه…</span>
              </div>
            )}
          </div>

          {/* Right Action Buttons - strictly single line */}
          <div className="flex items-center gap-2 shrink-0">
            {pages.length > 0 && (
              <button
                className="btn !px-3 !py-1.5 text-xs text-teal-300 hover:text-white whitespace-nowrap"
                onClick={pick}
                title="افزودن عکس یا سند جدید"
              >
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline whitespace-nowrap">افزودن</span>
              </button>
            )}

            {pages.length > 0 && (
              <button
                className="btn btn-icon !p-2"
                onClick={() => setShowPages(true)}
                title="مدیریت صفحات"
                aria-label="مدیریت صفحات"
              >
                <Layers className="h-4 w-4 text-cyan-300" />
              </button>
            )}

            {pages.length > 0 && (
              <button
                className="btn btn-icon !p-2"
                onClick={() => setShowFilters(true)}
                title="فیلتر و رنگ جادویی"
                aria-label="فیلترها"
              >
                <Palette className="h-4 w-4 text-teal-300" />
              </button>
            )}

            <button
              className="btn btn-icon !p-2 text-slate-400 hover:text-white"
              onClick={() => setShowSettings(true)}
              title="تنظیمات خروجی"
              aria-label="تنظیمات"
            >
              <Cog className="h-4 w-4" />
            </button>

            {pages.length > 0 && exportBtn('!px-4 !py-1.5 text-xs')}
          </div>
        </header>

        <AutoUpdateNotice hasWork={pages.length > 0 || busy || Boolean(sc.exporting)} />

        {/* Main Canvas Body */}
        <main className="min-h-0 flex-1 px-3 pb-3 pt-2 sm:px-4 sm:pb-4 overflow-hidden flex flex-col">
          {pages.length === 0 ? (
            <EmptyState onPick={pick} dragging={dragging} importing={sc.importing > 0} />
          ) : (
            <div className="flex min-h-0 h-full gap-3">
              {/* Optional left mini rail for instant thumbnail switching */}
              <div className="hidden md:flex shrink-0 w-[80px] lg:w-[90px] flex-col overflow-hidden">
                <Rail
                  pages={pages}
                  selId={sc.selId}
                  onSelect={selectPage}
                  onRemove={sc.removePage}
                  onMove={sc.movePage}
                  onAdd={pick}
                />
              </div>

              {/* Main Document Display Stage (Fills all available room) */}
              <div className="min-h-0 min-w-0 flex-1 h-full">
                {sel && (
                  <Stage
                    key={sel.id}
                    page={sel}
                    crop={crop}
                    setCrop={setCrop}
                    pageIndex={curIndex}
                    totalPages={pages.length}
                    onQuad={(q) => sc.edit(sel.id, { quad: q })}
                    onRotate={(d) => sc.edit(sel.id, { rotation: (sel.rotation + d + 4) % 4 })}
                    onDelete={() => sc.removePage(sel.id)}
                    onOpenFilters={() => setShowFilters(true)}
                    onOpenPages={() => setShowPages(true)}
                  />
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Popups & Drawers */}
      <Presence show={showFilters && !!sel}>{sel && (
        <FilterModal
          open
          page={sel}
          pageCount={pages.length}
          onClose={() => setShowFilters(false)}
          onFilter={(f: FilterId) => sc.edit(sel.id, { filter: f })}
          onAdjust={(a: Partial<Adjust>) => sc.edit(sel.id, { adjust: { ...sel.adjust, ...a } })}
          onResetAdjust={() => sc.edit(sel.id, { adjust: { ...DEFAULT_ADJUST } })}
          onApplyAll={() => sc.applyFilterToAll(sel.filter)}
        />
      )}</Presence>

      <Presence show={showPages}>
        <PagesDrawer
          open
          pages={pages}
          selId={sc.selId}
          onClose={() => setShowPages(false)}
          onSelect={(id) => {
            selectPage(id);
            setShowPages(false);
          }}
          onRemove={sc.removePage}
          onMove={sc.movePage}
          onAdd={pick}
          onClearAll={sc.clearAll}
        />
      </Presence>

      {dragging && pages.length > 0 && <DropOverlay />}
      {sc.exporting && <ExportOverlay done={sc.exporting.done} total={sc.exporting.total} />}
      {sc.result && !sc.exporting && (
        <ResultToast
          r={sc.result}
          onClose={sc.dismissResult}
          onOpen={() => void sc.openResult()}
          onShow={() => void sc.showResult()}
        />
      )}
      {sc.error && !sc.exporting && <ErrorToast msg={sc.error} onClose={sc.dismissError} />}
      <Presence show={showSettings}>
        <SettingsDialog s={settings} onChange={sc.updateSettings} onClose={() => setShowSettings(false)} />
      </Presence>
    </div>
  );
}
