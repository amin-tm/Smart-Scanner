import { CircleAlert, CircleArrowDown, FileDown, ImageDown, ImageOff, Files, Plus, FilePlus2, ScanLine, Settings2, SlidersHorizontal, Sparkles, Upload } from 'lucide-react';
import scanLiteIcon from '../assets/scanlite.svg';
import type { ReactNode } from 'react';
import { Slider, Spinner } from '../components/ui';
import { faNum } from '../lib/storage';
import { FILTERS, type Adjust, type FilterId, type Page } from '../lib/types';

export function WorkspaceHeader({ hasPages, busy, canExport, canExportImage, reset, save, saveImage, settings, updates }: {
  hasPages: boolean; busy: boolean; canExport: boolean; canExportImage: boolean; saveImage: () => void; reset: () => void; save: () => void; settings: () => void; updates: () => void;
}) {
  return (
    <header className="work-header">
      <div className="work-brand"><img src={scanLiteIcon} width={38} height={38} alt="" /><strong dir="ltr">ScanLite</strong></div>
      <div className="work-actions">
        <button className="work-button work-icon" aria-label="تنظیمات" title="تنظیمات" onClick={settings}><Settings2 size={18} /></button>
        <button className="work-button work-icon" aria-label="به‌روزرسانی" title="به‌روزرسانی" onClick={updates}><CircleArrowDown size={18} /></button>
        {hasPages && <>
        <button className="work-button" onClick={reset}><FilePlus2 size={17} /> کار جدید</button>
        <button className="work-button work-secondary" onClick={saveImage} disabled={!canExportImage} title="Ctrl+Shift+S">
          <ImageDown size={17} /> خروجی عکس
        </button>
        <button className="work-button work-primary" onClick={save} disabled={!canExport}>
          {busy ? <Spinner className="size-4" /> : <FileDown size={17} />} ساخت <span lang="en">PDF</span>
        </button>
        </>}
      </div>
    </header>
  );
}

export function DocumentList({ pages, selected, select, manage, pick }: {
  pages: Page[]; selected: string | null; select: (id: string) => void; manage: () => void; pick: () => void;
}) {
  return (
    <aside className="work-pages" aria-label="صفحه‌های سند">
      <div className="work-pane-title">
        <h2>صفحه‌ها <span>{faNum(pages.length)}</span></h2>
        <button className="work-button work-icon" title="مدیریت صفحات" aria-label="مدیریت صفحات" onClick={manage}><Files size={17} /></button>
      </div>
      <ol className="work-page-list">
        {pages.map((page, index) => {
          const thumb = !page.autoCropPending && page.prev?.rev === page.rev ? page.prev?.url : page.thumbs?.[page.filter];
          return (
            <li key={page.id}>
              <button className="work-page" aria-label={`صفحهٔ ${faNum(index + 1)}`} aria-current={page.id === selected ? 'page' : undefined} onClick={() => select(page.id)}>
                <span className="work-thumbnail">
                  {thumb ? <img src={thumb} alt="" loading="lazy" decoding="async" draggable={false} /> : page.status === 'error' ?
                    <CircleAlert size={19} /> : page.status === 'ready' && !page.autoCropPending ? <Files size={16} /> : <Spinner className="size-4" />}
                </span>
                <span className="work-page-label">صفحهٔ {faNum(index + 1)}{page.status === 'error' && <small>خطا در خواندن</small>}</span>
              </button>
            </li>
          );
        })}
        <li><button type="button" className="work-button work-add-page" aria-label="افزودن فایل" onClick={pick}><Plus size={17} /><span>افزودن فایل</span></button></li>
      </ol>
    </aside>
  );
}

export function WorkspaceCanvas({ title, status, children }: { title: string; status: string; children: ReactNode }) {
  return (
    <section className="work-editor" aria-label={title}>
      <span className="sr-only" role="status">{status}</span>
      <div className="work-stage">{children}</div>
    </section>
  );
}

export function FilterInspector({ page, apply, adjust, reset, applyAll, retryThumbnails }: {
  page: Page;
  apply: (filter: FilterId) => void;
  adjust: (change: Partial<Adjust>) => void;
  reset: () => void;
  applyAll?: () => void;
  retryThumbnails: () => void;
}) {
  const a = page.adjust;
  const enhanced = page.filter !== 'original';
  return (
    <aside className="work-inspector" aria-label="تنظیمات تصویر" tabIndex={-1}>
      <div className="work-pane-title"><h2><SlidersHorizontal size={17} /> فیلتر تصویر</h2></div>
      <div className="work-inspector-scroll">
        <button type="button" className="work-magic work-button" aria-pressed={page.filter === 'magic'} onClick={() => apply('magic')}>
          <Sparkles size={17} /> رنگ جادویی
        </button>
        <div className="work-presets" role="group" aria-label="سایر فیلترها">
          {FILTERS.filter(option => option.id !== 'magic').map(option => {
            const thumb = page.thumbs?.[option.id];
            return (
              <button key={option.id} type="button" className="work-preset" aria-pressed={page.filter === option.id}
                title={option.hint} onClick={() => apply(option.id)}>
                <span className="work-filter-sample" data-filter={option.id} aria-hidden="true">
                  {thumb ? <img src={thumb} alt="" /> : page.thumbnailError ? <ImageOff size={16} /> : <Spinner className="size-4" />}
                </span>
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
        {page.thumbnailError && <button type="button" className="work-button work-thumb-retry" onClick={retryThumbnails}>تلاش دوباره برای نمونهٔ فیلترها</button>}
        <section className="work-adjustments" aria-label="تنظیمات دقیق">
          <div className="work-adjustment-heading"><h3>تنظیمات دقیق</h3><button type="button" className="work-button" onClick={reset}>بازنشانی</button></div>
          {enhanced && <Slider label="شدت فیلتر" value={a.strength} onChange={value => adjust({ strength: value })} />}
          {enhanced && page.filter !== 'lighten' && <Slider label="پررنگی متن" value={a.threshold} onChange={value => adjust({ threshold: value })} />}
          <Slider label="روشنایی" value={a.brightness} min={-100} max={100} onChange={value => adjust({ brightness: value })} />
          <Slider label="کنتراست" value={a.contrast} min={-100} max={100} onChange={value => adjust({ contrast: value })} />
          {page.filter !== 'bw' && <Slider label="وضوح و تیزی" value={a.sharpness} onChange={value => adjust({ sharpness: value })} />}
          {applyAll && <button type="button" className="work-button" onClick={applyAll}>اعمال به همهٔ صفحات</button>}
        </section>
      </div>
    </aside>
  );
}

export function ImportLanding({ pick, dragging, busy }: { pick: () => void; dragging: boolean; busy: boolean }) {
  return (
    <main className="work-landing">
      <div className="work-import" data-dragging={dragging}>
        <div className="work-import-copy">
          <div className="work-import-icon" aria-hidden="true"><ScanLine size={35} strokeWidth={1.5} /></div>
          <h1>اسکن و آماده‌سازی سند</h1>
          <p>{busy ? 'در حال خواندن فایل‌ها…' : 'عکس، HEIC یا پی‌دی‌اف را اینجا رها کنید.'}</p>
          <button className="work-button work-primary" onClick={pick}><Upload size={18} /> انتخاب فایل</button>
        </div>
      </div>
    </main>
  );
}
