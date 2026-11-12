import { useCallback, useEffect, useRef, useState } from 'react';
import Stage from './components/Stage';
import PagesDrawer from './components/PagesDrawer';
import SettingsDialog from './components/SettingsDialog';
import AutoUpdateNotice from './components/AutoUpdateNotice';
import { DropOverlay, ErrorToast, ExportOverlay, ResultToast } from './components/Overlays';
import { Modal, Presence } from './components/ui';
import { useScanner } from './lib/useScanner';
import { appReady, setBackgroundMode } from './lib/desktop';
import { faNum } from './lib/storage';
import { DEFAULT_ADJUST, type Quad } from './lib/types';
import { DocumentList, FilterInspector, ImportLanding, WorkspaceCanvas, WorkspaceHeader } from './workspace/WorkspaceParts';
import { useFileDrop, useWorkspaceKeys } from './workspace/useWorkspaceInput';
import './workspace/workspace.css';

type Dialog = 'settings' | 'pages' | 'new-job' | 'updates';

export default function App() {
  const scanner = useScanner();
  const { pages, sel, settings, exporting, requestPreview } = scanner;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [cropDrafts, setCropDrafts] = useState<Map<string, Quad> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pick = useCallback(() => fileInput.current?.click(), []);
  const closeDialog = () => setDialog(null);
  const dragging = useFileDrop(scanner.addFiles);
  const busy = scanner.busyCount > 0 || scanner.importing > 0;
  const canExport = !cropDrafts && !busy && !exporting && pages.some(page => page.status === 'ready');
  const pageIndex = pages.findIndex(page => page.id === sel?.id);
  const readyPage = sel?.status === 'ready' ? sel : null;
  const cropping = cropDrafts !== null;
  const filterPageId = readyPage?.id;
  const filterQuad = readyPage?.quad;
  const filterRotation = readyPage?.rotation;
  const waitingForCrop = readyPage?.autoCropPending;
  const canExportImage = canExport;

  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => void appReady());
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, []);
  useEffect(() => { void setBackgroundMode(settings.runInBackground); }, [settings.runInBackground]);
  useEffect(() => {
    if (filterPageId && !cropping && !waitingForCrop) requestPreview(filterPageId, true);
  }, [filterPageId, filterQuad, filterRotation, cropping, waitingForCrop, requestPreview]);
  useEffect(() => {
    if (!pages.length) {
      setCropDrafts(null);
      setDialog(current => current === 'settings' || current === 'updates' ? current : null);
    }
  }, [pages.length]);

  const select = (id: string) => scanner.select(id, !cropping);
  const save = () => { if (canExport) void scanner.exportPdf(); };
  const saveImage = () => { if (canExportImage) void scanner.exportImage(); };
  const setCrop = (active: boolean) => {
    if (active) {
      if (readyPage) setCropDrafts(new Map());
    } else if (cropDrafts) {
      scanner.commitCrops(cropDrafts);
      setCropDrafts(null);
    }
  };
  const openFilters = () => { if (readyPage) document.querySelector<HTMLElement>('.work-inspector')?.focus(); };
  const rotate = (direction: number) => {
    if (readyPage) scanner.edit(readyPage.id, { rotation: (readyPage.rotation + direction + 4) % 4 });
  };

  useWorkspaceKeys({
    blocked: dialog !== null || !!exporting,
    cropping,
    pick,
    save,
    saveImage,
    move: direction => {
      if (pageIndex < 0) return;
      const next = pages[pageIndex + direction];
      if (next) select(next.id);
    },
    crop: () => setCrop(true),
    filters: openFilters,
    rotate,
    remove: () => { if (sel) scanner.removePage(sel.id); },
    cancel: () => setCropDrafts(null),
  });

  return (
    <div className="scan-workspace" dir="rtl">
      <input ref={fileInput} type="file" multiple accept="image/*,application/pdf,.pdf,.heic,.heif" hidden
        onChange={event => {
          if (event.target.files?.length) void scanner.addFiles(event.target.files);
          event.target.value = '';
        }}
      />
      <WorkspaceHeader hasPages={pages.length > 0} busy={busy} canExport={canExport} canExportImage={canExportImage} reset={() => { if (!exporting) setDialog('new-job'); }} save={save} saveImage={saveImage} settings={() => setDialog('settings')} updates={() => setDialog('updates')} />
      <AutoUpdateNotice open={dialog === 'updates'} onClose={closeDialog} hasWork={pages.length > 0 || busy || !!exporting} />
      {pages.length === 0 ? (
        <ImportLanding pick={pick} dragging={dragging} busy={busy} />
      ) : (
        <main className="work-grid">
          {readyPage && (
            <FilterInspector page={readyPage} retryThumbnails={() => requestPreview(readyPage.id, true)}
              apply={filter => { if (filter !== readyPage.filter) scanner.edit(readyPage.id, { filter }); }}
              adjust={change => scanner.edit(readyPage.id, { adjust: { ...readyPage.adjust, ...change } })}
              reset={() => scanner.edit(readyPage.id, { adjust: { ...DEFAULT_ADJUST } })}
              applyAll={pages.length > 1 ? () => scanner.applyFilterToAll(readyPage) : undefined}
            />
          )}
          <DocumentList pages={pages} selected={scanner.selId} select={select} pick={pick} manage={() => setDialog('pages')} />
          <WorkspaceCanvas title={sel ? `صفحهٔ ${faNum(pageIndex + 1)}` : 'ویرایش سند'}
            status={busy ? `در حال پردازش · ${faNum(pages.length - scanner.busyCount)} از ${faNum(pages.length)}` : cropping ? 'ویرایش برش' : ''}>
            {sel && (
              <Stage key={sel.id} page={cropDrafts?.has(sel.id) ? { ...sel, quad: cropDrafts.get(sel.id)! } : sel}
                crop={cropping} setCrop={setCrop} pageIndex={pageIndex}
                totalPages={pages.length} onRetryPreview={() => requestPreview(sel.id)}
                onQuad={quad => setCropDrafts(drafts => drafts && new Map(drafts).set(sel.id, quad))}
                onRotate={rotate} onDelete={() => scanner.removePage(sel.id)}
                onOpenFilters={openFilters} onOpenPages={() => setDialog('pages')}
              />
            )}
          </WorkspaceCanvas>
        </main>
      )}

      <Presence show={dialog === 'pages' && pages.length > 0}>
        <PagesDrawer open pages={pages} selId={scanner.selId} onClose={closeDialog}
          onSelect={id => { select(id); closeDialog(); }} onRemove={scanner.removePage}
          onMove={scanner.movePage} onAdd={pick} onClearAll={scanner.clearAll}
        />
      </Presence>
      <Presence show={dialog === 'new-job'}>
        <Modal title="شروع کار جدید" onClose={closeDialog} width="snap-dialog-new-job">
          <p className="text-sm leading-7 text-muted">با شروع کار جدید، صفحات و تغییرات سند فعلی از محیط کار پاک می‌شوند.</p>
          <div className="mt-5 flex justify-end gap-2">
            <button className="work-button" type="button" onClick={closeDialog}>ادامهٔ کار فعلی</button>
            <button className="work-button work-primary" type="button" onClick={() => {
              scanner.clearAll();
              setCropDrafts(null);
              closeDialog();
              pick();
            }}>شروع کار جدید</button>
          </div>
        </Modal>
      </Presence>
      <Presence show={dialog === 'settings'}>
        <SettingsDialog s={settings} onChange={scanner.updateSettings} onClose={closeDialog} />
      </Presence>

      {dragging && pages.length > 0 && <DropOverlay />}
      {exporting && <ExportOverlay done={exporting.done} total={exporting.total} format={exporting.format} />}
      {scanner.result && !exporting && (
        <ResultToast r={scanner.result} onClose={scanner.dismissResult}
          onOpen={() => void scanner.openResult()} onShow={() => void scanner.showResult()} />
      )}
      {scanner.error && !exporting && <ErrorToast msg={scanner.error} onClose={scanner.dismissError} />}
    </div>
  );
}
