import { useState, useEffect } from 'react';
import { Check, ChevronDown, Layers, RotateCcw, SlidersHorizontal, Sparkles, X, Wand2 } from 'lucide-react';
import { Slider, cx } from './ui';
import { DEFAULT_ADJUST, FILTERS, type Adjust, type FilterId, type Page } from '../lib/types';

export default function FilterModal({
  open,
  page,
  pageCount,
  onClose,
  onFilter,
  onAdjust,
  onResetAdjust,
  onApplyAll,
}: {
  open: boolean;
  page: Page;
  pageCount: number;
  onClose: () => void;
  onFilter: (f: FilterId) => void;
  onAdjust: (a: Partial<Adjust>) => void;
  onResetAdjust: () => void;
  onApplyAll: () => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const a = page.adjust;
  const showText = page.filter !== 'original' && page.filter !== 'lighten';
  const changed = (Object.keys(DEFAULT_ADJUST) as (keyof Adjust)[]).some((k) => DEFAULT_ADJUST[k] !== a[k]);
  const magic = FILTERS[0];
  const rest = FILTERS.slice(1);
  const current = FILTERS.find((f) => f.id === page.filter);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-md a-fade-in"
      onMouseDown={onClose}
    >
      <div
        className="glass relative flex flex-col w-full max-w-lg max-h-[90vh] rounded-3xl border border-white/15 bg-slate-950/90 shadow-2xl shadow-black/80 overflow-hidden a-pop"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header - Single line */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5 shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-teal-400/15 text-teal-300">
              <Wand2 className="h-4 w-4" />
            </div>
            <div className="whitespace-nowrap font-bold text-sm text-slate-100">فیلتر تصویر و رنگ جادویی</div>
          </div>
          <button
            onClick={onClose}
            className="btn btn-ghost btn-icon !p-1.5 text-slate-400 hover:text-white"
            aria-label="بستن"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-5 space-y-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* HERO BUTTON: Magic Color (Always strictly 1 line, no wrapping!) */}
          <button
            onClick={() => onFilter('magic')}
            title="رنگ جادویی: پس‌زمینه ۱۰۰٪ سفید چاپی"
            className={cx(
              'group relative flex items-center gap-3 w-full rounded-2xl border p-3 text-start transition-all duration-200',
              page.filter === 'magic'
                ? 'border-teal-300 bg-gradient-to-l from-teal-400/20 via-teal-300/10 to-transparent shadow-[0_0_0_2px_rgba(45,212,191,0.3),0_8px_24px_-6px_rgba(45,212,191,0.4)]'
                : 'border-white/15 bg-white/[0.04] hover:border-teal-300/50 hover:bg-white/[0.08]',
            )}
          >
            <div className="relative h-14 w-11 shrink-0 overflow-hidden rounded-xl bg-slate-900 border border-white/10 shadow">
              {page.thumbs?.magic ? (
                <img src={page.thumbs.magic} alt="" draggable={false} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
              ) : (
                <div className="shimmer h-full w-full" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 shrink-0 text-teal-300" />
                <span className="whitespace-nowrap text-sm font-extrabold text-teal-100">{magic.label}</span>
                <span className="whitespace-nowrap rounded-full bg-gradient-to-l from-emerald-300 to-cyan-400 px-2 py-0.5 text-[0.6rem] font-bold text-slate-950 shadow">
                  پیش‌فرض چاپ
                </span>
              </div>
              <div className="mt-1 whitespace-nowrap truncate text-xs text-slate-400">
                سفیدسازی ۱۰۰٪ پس‌زمینه، متن پررنگ و شفاف
              </div>
            </div>
            <div
              className={cx(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition',
                page.filter === 'magic' ? 'bg-teal-300 text-slate-950 shadow' : 'border border-white/20 text-transparent',
              )}
            >
              <Check className="h-3.5 w-3.5" strokeWidth={3.5} />
            </div>
          </button>

          {/* Horizontal scroll of all other filters (Single Line, Never Wraps) */}
          <div>
            <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
              <span className="whitespace-nowrap font-medium">سایر فیلترها</span>
              <span className="whitespace-nowrap text-[0.68rem] text-slate-500 truncate max-w-[200px]">
                {current?.label}: {current?.hint}
              </span>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-2 pt-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {rest.map((f) => {
                const on = page.filter === f.id;
                return (
                  <button
                    key={f.id}
                    onClick={() => onFilter(f.id)}
                    className={cx(
                      'group relative shrink-0 flex flex-col items-center w-[74px] p-1 rounded-xl border transition-all duration-200',
                      on
                        ? 'border-teal-300 bg-teal-400/15 shadow-[0_0_0_2px_rgba(45,212,191,0.25)]'
                        : 'border-white/10 bg-white/[0.03] hover:border-white/30 hover:bg-white/[0.07]',
                    )}
                  >
                    <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-slate-900 border border-white/10">
                      {page.thumbs?.[f.id] ? (
                        <img src={page.thumbs[f.id]} alt="" draggable={false} className="h-full w-full object-cover" />
                      ) : (
                        <div className="shimmer h-full w-full" />
                      )}
                      {on && (
                        <div className="absolute top-1 end-1 flex h-4 w-4 items-center justify-center rounded-full bg-teal-300 text-slate-950 shadow">
                          <Check className="h-2.5 w-2.5" strokeWidth={4} />
                        </div>
                      )}
                    </div>
                    <span className={cx('mt-1 whitespace-nowrap text-[0.7rem] font-bold', on ? 'text-teal-200' : 'text-slate-300')}>
                      {f.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Collapsible fine adjustments */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-3 text-xs font-bold text-slate-200 hover:bg-white/5 transition"
            >
              <span className="flex items-center gap-2 whitespace-nowrap">
                <SlidersHorizontal className="h-4 w-4 text-teal-300" />
                <span>تنظیمات دقیق (روشنایی، کنتراست، وضوح)</span>
                {changed && <span className="h-2 w-2 rounded-full bg-teal-300" />}
              </span>
              <ChevronDown className={cx('h-4 w-4 text-slate-400 transition-transform duration-200', showAdvanced && 'rotate-180')} />
            </button>
            {showAdvanced && (
              <div className="p-4 pt-1 border-t border-white/10 space-y-3 a-fade-in">
                {page.filter !== 'original' && (
                  <Slider label="شدت فیلتر" value={a.strength} onChange={(v) => onAdjust({ strength: v })} />
                )}
                {showText && (
                  <Slider label="پررنگی متن" value={a.threshold} onChange={(v) => onAdjust({ threshold: v })} />
                )}
                <Slider label="روشنایی" value={a.brightness} min={-100} max={100} onChange={(v) => onAdjust({ brightness: v })} />
                <Slider label="کنتراست" value={a.contrast} min={-100} max={100} onChange={(v) => onAdjust({ contrast: v })} />
                {page.filter !== 'bw' && (
                  <Slider label="وضوح و تیزی" value={a.sharpness} onChange={(v) => onAdjust({ sharpness: v })} />
                )}
                {changed && (
                  <button
                    onClick={onResetAdjust}
                    className="btn btn-ghost !py-1 text-xs text-slate-400 hover:text-white whitespace-nowrap"
                  >
                    <RotateCcw className="h-3 w-3" /> بازنشانی مقادیر به پیش‌فرض
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-2 border-t border-white/10 px-5 py-3 bg-slate-950/70 shrink-0">
          {pageCount > 1 ? (
            <button
              onClick={onApplyAll}
              className="btn btn-ghost !px-3 !py-2 text-xs text-slate-300 hover:text-white whitespace-nowrap"
            >
              <Layers className="h-3.5 w-3.5 text-teal-300" />
              <span>اعمال روی همه صفحات</span>
            </button>
          ) : <div />}
          <button
            onClick={onClose}
            className="btn btn-primary !rounded-xl !px-6 !py-2 text-xs whitespace-nowrap"
          >
            تأیید و بستن
          </button>
        </div>
      </div>
    </div>
  );
}
