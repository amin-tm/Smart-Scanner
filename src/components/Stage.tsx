import { useEffect, useRef, useState, type ButtonHTMLAttributes, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import {
  Check,
  Crop,
  Eye,
  Maximize2,
  RotateCcw,
  RotateCw,
  ScanLine,
  Trash2,
  Undo2,
  Wand2,
  ZoomIn,
  ZoomOut,
  Palette,
  Layers,
} from 'lucide-react';
import CropEditor from './CropEditor';
import { cx } from './ui';
import { displayOf } from '../lib/useScanner';
import { faNum } from '../lib/storage';
import { FULL_QUAD, FILTERS, type Page, type Quad } from '../lib/types';

function Tool({
  icon,
  label,
  active,
  danger,
  motion,
  className,
  children,
  ...rest
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  danger?: boolean;
  motion?: 'crop' | 'rotate-left' | 'rotate-right' | 'eye' | 'zoom' | 'trash' | 'undo' | 'wand' | 'full' | 'confirm';
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cx(
        'btn stage-tool',
        active && 'btn-active',
        danger && 'stage-tool-danger',
        className,
      )}
      aria-label={label}
      data-tooltip={label}
      data-motion={motion}
      {...rest}
    >
      {icon}
      <span className="sr-only">{children ?? label}</span>
    </button>
  );
}

export default function Stage({
  page,
  crop,
  setCrop,
  pageIndex,
  totalPages,
  onRetryPreview,
  onQuad,
  onRotate,
  onDelete,
  onOpenFilters,
  onOpenPages,
}: {
  page: Page;
  crop: boolean;
  setCrop: (v: boolean) => void;
  pageIndex: number;
  totalPages: number;
  onRetryPreview: () => void;
  onQuad: (q: Quad) => void;
  onRotate: (dir: 1 | -1) => void;
  onDelete: () => void;
  onOpenFilters: () => void;
  onOpenPages: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [compare, setCompare] = useState(false);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setCompare(false);
  }, [page.id, crop]);

  const d = displayOf(page);
  const ready = page.status === 'ready';

  useEffect(() => {
    const el = boxRef.current;
    if (!el || crop) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => {
        const nz = Math.min(5, Math.max(1, z * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
        if (nz === 1) setPan({ x: 0, y: 0 });
        return nz;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [crop, ready]);

  const down = (e: RPointerEvent) => {
    if (zoom <= 1) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const move = (e: RPointerEvent) => {
    const s = dragRef.current;
    if (s) setPan({ x: s.px + e.clientX - s.x, y: s.py + e.clientY - s.y });
  };
  const up = () => (dragRef.current = null);

  if (!ready) {
    return (
      <div className="checker relative flex h-full items-center justify-center overflow-hidden p-5">
        {page.status === 'error' ? (
          <div className="a-fade-up text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-300">
              <ScanLine className="h-7 w-7" />
            </div>
            <p className="font-semibold text-rose-200 whitespace-nowrap">این فایل پردازش نشد</p>
            <p className="mt-1 text-xs text-muted whitespace-nowrap">{page.error}</p>
            <button className="btn mt-4 whitespace-nowrap" onClick={onDelete}>
              <Trash2 className="h-4 w-4" /> حذف
            </button>
          </div>
        ) : (
          <div className="snap-import-preview">
            <div className={`snap-processing snap-glass-loading${pageIndex === 0 ? ' snap-first-import' : ''}`} role="status">
              {pageIndex === 0 && <div className="snap-processing-icon" aria-hidden="true"><ScanLine size={32} /><i /></div>}
              <div><ScanLine className="stage-scan-indicator size-4" aria-hidden="true" /> در حال پردازش سند</div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const curFilterLabel = FILTERS.find((f) => f.id === page.filter)?.label || 'فیلتر';

  return (
    <div className="desktop-stage relative h-full overflow-hidden rounded-2xl border border-white/10">
      <div className="desktop-toolbar">
        <div
          className="desktop-tool-group"
        >
          {crop ? (
            <>
              <Tool
                icon={<Wand2 className="h-4 w-4 text-accent-soft" />}
                label="تشخیص خودکار لبه"
                motion="wand"
                onClick={() => page.autoQuad && onQuad(page.autoQuad)}
                disabled={!page.autoQuad}
              />
              <Tool
                icon={<Maximize2 className="h-4 w-4" />}
                label="تمام تصویر"
                motion="full"
                onClick={() => onQuad(FULL_QUAD)}
              />
              <div className="mx-1 h-5 w-px bg-white/15 shrink-0" />
              <Tool icon={<Check className="h-4 w-4" strokeWidth={3} />}
                label="تأیید برش" motion="confirm" onClick={() => setCrop(false)} />
            </>
          ) : (
            <>
              {/* Crop editor toggle */}
              <Tool
                icon={<Crop className="h-4 w-4" />}
                label="برش لبه‌ها"
                motion="crop"
                onClick={() => setCrop(true)}
              />

              {/* Filter popup trigger */}
              <Tool
                icon={<Palette className="h-4 w-4 text-accent-soft" />}
                label="فیلتر و رنگ جادویی"
                onClick={onOpenFilters}
                className="work-compact-filter !bg-brand/10 hover:!bg-brand/20 !border-accent-soft/30"
              >
                <span>فیلتر: {curFilterLabel}</span>
              </Tool>

              <div className="mx-0.5 h-5 w-px bg-white/15 shrink-0" />

              {/* Rotations */}
              <Tool
                icon={<RotateCcw className="h-4 w-4" />}
                label="چرخش چپ"
                motion="rotate-left"
                aria-label="چرخش چپ"
                onClick={() => onRotate(-1)}
              ><span className="desktop-tool-text">چرخش چپ</span></Tool>
              <Tool
                icon={<RotateCw className="h-4 w-4" />}
                label="چرخش راست"
                motion="rotate-right"
                aria-label="چرخش راست"
                onClick={() => onRotate(1)}
              ><span className="desktop-tool-text">چرخش راست</span></Tool>

              {/* Compare original */}
              <Tool
                icon={<Eye className="h-4 w-4" />}
                label="نگه‌دارید برای دیدن اصلی"
                motion="eye"
                active={compare}
                onPointerDown={() => setCompare(true)}
                onPointerUp={() => setCompare(false)}
                onPointerLeave={() => setCompare(false)}
              >
                <span className="hidden sm:inline">مقایسه</span>
              </Tool>

              <div className="mx-0.5 h-5 w-px bg-white/15 shrink-0" />

              {/* Pages drawer popup trigger */}
              <Tool
                icon={<Layers className="h-4 w-4 text-accent-soft" />}
                label="لیست و مدیریت صفحات"
                className="work-compact-pages"
                onClick={onOpenPages}
              >
                <span>صفحه {faNum(pageIndex + 1)} از {faNum(totalPages)}</span>
              </Tool>

              <div className="mx-0.5 h-5 w-px bg-white/15 shrink-0" />

              {/* Zoom controls */}
              <Tool
                icon={<ZoomOut className="h-4 w-4" />}
                label="کوچک‌نمایی"
                motion="zoom"
                onClick={() => setZoom((z) => Math.max(1, z / 1.35))}
                disabled={zoom <= 1}
              >
                <span className="sr-only">کوچک‌نمایی</span>
              </Tool>
              <Tool
                icon={<ZoomIn className="h-4 w-4" />}
                label="بزرگ‌نمایی"
                motion="zoom"
                onClick={() => setZoom((z) => Math.min(5, z * 1.35))}
              >
                <span className="sr-only">بزرگ‌نمایی</span>
              </Tool>
              {zoom > 1 && (
                <Tool
                  icon={<Undo2 className="h-4 w-4" />}
                  label="اندازه ۱۰۰٪"
                motion="undo"
                  onClick={() => {
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                  }}
                >
                  <span className="sr-only">بازنشانی زوم</span>
                </Tool>
              )}

              {/* Delete */}
              <Tool
                icon={<Trash2 className="h-4 w-4" />}
                label="حذف صفحه"
                motion="trash"
                onClick={onDelete}
                danger
              >
                <span className="hidden sm:inline">حذف</span>
              </Tool>
            </>
          )}
        </div>
      </div>

      <div className="desktop-canvas">
        <span className="stage-page-number">صفحهٔ {faNum(pageIndex + 1)}</span>
        {page.autoCropPending && !compare && (
          <div className="snap-processing stage-processing snap-glass-loading" role="status">
            <div><ScanLine className="stage-scan-indicator size-4" aria-hidden="true" /> در حال پردازش سند</div>
          </div>
        )}
      {crop ? (
        <CropEditor page={page} onCommit={onQuad} />
      ) : (
        <div
          ref={boxRef}
          className="checker absolute inset-0 flex items-center justify-center overflow-hidden p-4 sm:p-6"
          style={{ cursor: zoom > 1 ? 'grab' : 'zoom-in' }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onDoubleClick={() => {
            setZoom((z) => (z > 1 ? 1 : 2.5));
            setPan({ x: 0, y: 0 });
          }}
        >
          {d && (!d.stale || compare) && (
            <img
              key={compare ? 'orig' : 'out'}
              src={compare && page.srcUrl ? page.srcUrl : d.url}
              alt=""
              draggable={false}
              className="a-fade-in paper-shadow max-h-full max-w-full select-none rounded-[3px] bg-white object-contain"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transition: dragRef.current ? 'none' : 'transform .18s ease-out',
                opacity: d.stale && !compare ? 0.85 : 1,
              }}
            />
          )}
          {!compare && !page.autoCropPending && (d?.stale || !d) && (
            <div className="snap-processing stage-processing snap-glass-loading" role="status">
              <div>
                {page.previewErrorRev === page.rev ? (
                  <button type="button" onClick={onRetryPreview}>پیش‌نمایش آماده نشد · تلاش دوباره</button>
                ) : <><ScanLine className="stage-scan-indicator size-4" aria-hidden="true" /> در حال به‌روزرسانی</>}
              </div>
            </div>
          )}
          {compare && (
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-black/70 border border-white/20 px-4 py-1.5 text-xs text-white backdrop-blur whitespace-nowrap">
              عکس اولیه (بدون فیلتر و پرسپکتیو)
            </div>
          )}
        </div>
      )}

      </div>
      {crop && (
        <div className="desktop-crop-help">
          <div className="a-fade-up rounded-full bg-ink-2/85 border border-white/15 px-4 py-1.5 text-xs text-paper backdrop-blur text-center">
            گوشه‌ها را بکشید · دستگیره وسط هر ضلع فقط همان خط را جابه‌جا می‌کند
          </div>
        </div>
      )}
    </div>
  );
}
