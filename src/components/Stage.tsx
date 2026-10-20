import { useEffect, useRef, useState, type ButtonHTMLAttributes, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import {
  Check,
  Crop,
  Eye,
  Maximize2,
  RotateCcw,
  RotateCw,
  ScanLine,
  Sparkles,
  Trash2,
  Undo2,
  Wand2,
  ZoomIn,
  ZoomOut,
  Palette,
  Layers,
} from 'lucide-react';
import CropEditor from './CropEditor';
import { cx, Spinner } from './ui';
import { displayOf } from '../lib/useScanner';
import { faNum } from '../lib/storage';
import { FULL_QUAD, FILTERS, type FilterId, type Page, type Quad } from '../lib/types';

function PrintReadyBadge({ filter }: { filter: FilterId }) {
  const white = filter === 'magic' || filter === 'gray' || filter === 'bw';
  const label =
    filter === 'magic'
      ? 'رنگ جادویی · ۱۰۰٪ سفید چاپی'
      : filter === 'gray' || filter === 'bw'
      ? 'سفید چاپی'
      : filter === 'noshadow'
      ? 'بدون سایه'
      : filter === 'lighten'
      ? 'روشن'
      : 'بدون سفیدسازی';

  return (
    <div className="pointer-events-none absolute bottom-4 end-4 z-10">
      <div
        className={cx(
          'a-fade-in flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[0.7rem] font-bold backdrop-blur whitespace-nowrap shadow-lg',
          white
            ? 'border-teal-300/60 bg-teal-400/20 text-teal-100 shadow-teal-500/30'
            : 'border-white/15 bg-black/60 text-slate-300',
        )}
      >
        {white && <Sparkles className="h-3.5 w-3.5 text-teal-300" />}
        <span>{label}</span>
      </div>
    </div>
  );
}

function Tool({
  icon,
  label,
  active,
  danger,
  className,
  children,
  ...rest
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  danger?: boolean;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cx(
        'btn btn-ghost !gap-1.5 !px-2.5 !py-1.5 sm:!px-3 sm:!py-2 text-[0.78rem] whitespace-nowrap shrink-0 transition-all duration-150',
        active && 'btn-active',
        danger && 'hover:!bg-rose-500/20 hover:!text-rose-200',
        className,
      )}
      title={label}
      {...rest}
    >
      {icon}
      <span className="whitespace-nowrap">{children ?? label}</span>
    </button>
  );
}

export default function Stage({
  page,
  crop,
  setCrop,
  pageIndex,
  totalPages,
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
      <div className="checker relative flex h-full items-center justify-center overflow-hidden rounded-3xl border border-white/10 p-6">
        {page.status === 'error' ? (
          <div className="a-fade-up text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-300">
              <ScanLine className="h-7 w-7" />
            </div>
            <p className="font-semibold text-rose-200 whitespace-nowrap">این فایل پردازش نشد</p>
            <p className="mt-1 text-xs text-slate-400 whitespace-nowrap">{page.error}</p>
            <button className="btn mt-4 whitespace-nowrap" onClick={onDelete}>
              <Trash2 className="h-4 w-4" /> حذف
            </button>
          </div>
        ) : (
          <div className="a-fade-up relative flex flex-col items-center justify-center p-8 rounded-2xl border border-white/15 bg-slate-900/80 backdrop-blur-md shadow-2xl">
            <div className="relative mb-4 h-24 w-20 overflow-hidden rounded-xl border border-teal-300/30 bg-white/10">
              <div className="shimmer absolute inset-0" />
              <div className="scan-line" />
            </div>
            <div className="flex items-center gap-2 text-sm font-bold text-teal-200 whitespace-nowrap">
              <Spinner className="h-4 w-4" />
              <span>در حال تشخیص هوشمند لبه‌ها و سفیدسازی...</span>
            </div>
            <div className="mt-1 text-xs text-slate-400 whitespace-nowrap">
              لطفاً چند لحظه شکیبا باشید
            </div>
          </div>
        )}
      </div>
    );
  }

  const curFilterLabel = FILTERS.find((f) => f.id === page.filter)?.label || 'فیلتر';

  return (
    <div className="a-fade-in relative h-full overflow-hidden rounded-3xl border border-white/10">
      {crop ? (
        <CropEditor page={page} onCommit={onQuad} />
      ) : (
        <div
          ref={boxRef}
          className="checker absolute inset-0 flex items-center justify-center overflow-hidden px-4 pb-4 pt-[4.25rem] sm:px-8 sm:pb-8"
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
          {d && (
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
          {(d?.stale || !d) && (
            <div className="a-fade-in absolute left-1/2 top-16 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1.5 text-xs text-teal-100 backdrop-blur whitespace-nowrap">
              <span className="inline-flex items-center gap-2">
                <Spinner className="h-3.5 w-3.5" /> در حال به‌روزرسانی
              </span>
            </div>
          )}
          {compare && (
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-black/70 border border-white/20 px-4 py-1.5 text-xs text-white backdrop-blur whitespace-nowrap">
              عکس اولیه (بدون فیلتر و پرسپکتیو)
            </div>
          )}
          {!compare && <PrintReadyBadge filter={page.filter} />}
        </div>
      )}

      {/* Floating Toolbar — Single row, clean, responsive, never breaks into 2 lines */}
      <div className="absolute inset-x-0 top-3 z-20 flex justify-center px-2">
        <div
          className="glass a-fade-up flex items-center gap-1 rounded-2xl p-1.5 shadow-2xl shadow-black/70 border border-white/15 overflow-x-auto max-w-[98vw] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ background: 'rgba(10, 16, 30, 0.85)' }}
        >
          {crop ? (
            <>
              <Tool
                icon={<Wand2 className="h-4 w-4 text-teal-300" />}
                label="تشخیص خودکار لبه"
                onClick={() => page.autoQuad && onQuad(page.autoQuad)}
                disabled={!page.autoQuad}
              />
              <Tool
                icon={<Maximize2 className="h-4 w-4" />}
                label="تمام تصویر"
                onClick={() => onQuad(FULL_QUAD)}
              />
              <div className="mx-1 h-5 w-px bg-white/15 shrink-0" />
              <button
                className="btn btn-primary !rounded-xl !px-4 !py-1.5 text-xs whitespace-nowrap"
                onClick={() => setCrop(false)}
              >
                <Check className="h-4 w-4" strokeWidth={3} /> تأیید برش
              </button>
            </>
          ) : (
            <>
              {/* Filter popup trigger */}
              <Tool
                icon={<Palette className="h-4 w-4 text-teal-300" />}
                label="فیلتر و رنگ جادویی"
                onClick={onOpenFilters}
                className="!bg-teal-400/10 hover:!bg-teal-400/20 !border-teal-300/30"
              >
                <span>فیلتر: {curFilterLabel}</span>
              </Tool>

              <div className="mx-0.5 h-5 w-px bg-white/15 shrink-0" />

              {/* Crop editor toggle */}
              <Tool
                icon={<Crop className="h-4 w-4" />}
                label="برش دستی لبه‌ها"
                onClick={() => setCrop(true)}
              />

              {/* Rotations */}
              <Tool
                icon={<RotateCcw className="h-4 w-4" />}
                label="چرخش چپ"
                onClick={() => onRotate(-1)}
              />
              <Tool
                icon={<RotateCw className="h-4 w-4" />}
                label="چرخش راست"
                onClick={() => onRotate(1)}
              />

              {/* Compare original */}
              <Tool
                icon={<Eye className="h-4 w-4" />}
                label="نگه‌دارید برای دیدن اصلی"
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
                icon={<Layers className="h-4 w-4 text-cyan-300" />}
                label="لیست و مدیریت صفحات"
                onClick={onOpenPages}
              >
                <span>صفحه {faNum(pageIndex + 1)} از {faNum(totalPages)}</span>
              </Tool>

              <div className="mx-0.5 h-5 w-px bg-white/15 shrink-0" />

              {/* Zoom controls */}
              <Tool
                icon={<ZoomOut className="h-4 w-4" />}
                label="کوچک‌نمایی"
                onClick={() => setZoom((z) => Math.max(1, z / 1.35))}
                disabled={zoom <= 1}
              >
                <span className="sr-only">کوچک‌نمایی</span>
              </Tool>
              <Tool
                icon={<ZoomIn className="h-4 w-4" />}
                label="بزرگ‌نمایی"
                onClick={() => setZoom((z) => Math.min(5, z * 1.35))}
              >
                <span className="sr-only">بزرگ‌نمایی</span>
              </Tool>
              {zoom > 1 && (
                <Tool
                  icon={<Undo2 className="h-4 w-4" />}
                  label="اندازه ۱۰۰٪"
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
                onClick={onDelete}
                danger
              >
                <span className="hidden sm:inline">حذف</span>
              </Tool>
            </>
          )}
        </div>
      </div>

      {crop && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4">
          <div className="a-fade-up rounded-full bg-slate-950/85 border border-white/15 px-4 py-1.5 text-xs text-slate-200 backdrop-blur shadow-xl whitespace-nowrap">
            گوشه‌ها را بکشید · دستگیره وسط هر ضلع فقط همان خط را جابه‌جا می‌کند
          </div>
        </div>
      )}
    </div>
  );
}
