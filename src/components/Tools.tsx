import { useState } from 'react';
import { Check, ChevronDown, Layers, RotateCcw, SlidersHorizontal, Sparkles } from 'lucide-react';
import { Slider, cx } from './ui';
import { DEFAULT_ADJUST, FILTERS, type Adjust, type FilterId, type Page } from '../lib/types';

export default function Tools({
  page,
  pageCount,
  onFilter,
  onAdjust,
  onResetAdjust,
  onApplyAll,
}: {
  page: Page;
  pageCount: number;
  onFilter: (f: FilterId) => void;
  onAdjust: (a: Partial<Adjust>) => void;
  onResetAdjust: () => void;
  onApplyAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const a = page.adjust;
  const disabled = page.status !== 'ready';
  const showText = page.filter !== 'original' && page.filter !== 'lighten';
  const changed = (Object.keys(DEFAULT_ADJUST) as (keyof Adjust)[]).some((k) => DEFAULT_ADJUST[k] !== a[k]);
  const magic = FILTERS[0];
  const rest = FILTERS.slice(1);
  const current = FILTERS.find((f) => f.id === page.filter);

  return (
    <div className={cx('flex min-h-0 flex-col gap-2.5', disabled && 'pointer-events-none opacity-50')}>
      {/* ---------- Header: current filter ---------- */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-100 leading-none">فیلتر تصویر</h3>
          <span className="truncate text-[0.66rem] leading-none text-slate-500">{current?.hint}</span>
        </div>

        {/* ---------- HERO: Magic Color (single row, never wraps) ---------- */}
        <button
          onClick={() => onFilter('magic')}
          title="رنگ جادویی: پس‌زمینه کاملاً سفید چاپی، رنگ زنده و متن تیز"
          className={cx(
            'a-fade-up group relative flex items-center gap-2.5 overflow-hidden rounded-xl border p-2.5 text-start transition-all duration-300',
            page.filter === 'magic'
              ? 'border-teal-300/80 bg-gradient-to-l from-teal-300/20 to-cyan-400/[0.08] shadow-[0_0_0_3px_rgba(45,212,191,0.15),0_10px_28px_-10px_rgba(45,212,191,0.55)]'
              : 'border-teal-300/30 bg-teal-300/[0.05] hover:-translate-y-0.5 hover:border-teal-300/70 hover:bg-teal-300/10 hover:shadow-[0_10px_28px_-10px_rgba(45,212,191,0.4)]',
          )}
        >
          <span className="relative h-11 w-9 shrink-0 overflow-hidden rounded-lg bg-slate-900">
            {page.thumbs?.magic ? (
              <img src={page.thumbs.magic} alt="" draggable={false} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
            ) : (
              <span className="shimmer block h-full w-full" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 shrink-0 text-teal-200" />
              <span className="text-[0.8rem] font-extrabold text-teal-100 leading-none">{magic.label}</span>
              <span className="rounded-full bg-gradient-to-l from-emerald-300 to-cyan-400 px-2 py-0.5 text-[0.58rem] font-extrabold text-slate-900 shadow leading-none whitespace-nowrap">
                پیش‌فرض چاپ
              </span>
            </span>
            <span className="mt-0.5 block truncate text-[0.66rem] leading-5 text-slate-400 whitespace-nowrap">پس‌زمینه سفید، آماده چاپ</span>
          </span>
          <span
            className={cx(
              'flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition',
              page.filter === 'magic' ? 'bg-teal-300 text-slate-900 shadow' : 'border border-white/20',
            )}
          >
            <Check className="h-3 w-3" strokeWidth={3.5} />
          </span>
        </button>

        {/* ---------- Rest of filters: strictly single horizontal row ---------- */}
        <div className="mt-1.5 flex flex-nowrap gap-1.5 overflow-x-auto pb-1.5 scrollbar-hide -mb-1.5">
          <span className="text-[0.66rem] text-slate-500 shrink-0 whitespace-nowrap mt-0.5">سایر فیلترها:</span>
          {rest.map((f, i) => {
            const on = page.filter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => onFilter(f.id)}
                title={`${f.label} — ${f.hint}`}
                className={cx(
                  'a-fade-up shrink-0 relative overflow-hidden rounded-xl border p-0.5 text-center transition-all duration-200',
                  on
                    ? 'border-teal-300/80 bg-teal-300/10 shadow-[0_0_0_2px_rgba(45,212,191,0.18),0_6px_16px_-6px_rgba(45,212,191,0.5)]'
                    : 'border-white/10 bg-white/[0.03] hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.07]',
                )}
                style={{ animationDelay: `${60 + i * 35}ms` }}
              >
                <span className="relative block aspect-[3/4] overflow-hidden rounded-lg bg-slate-900">
                  {page.thumbs?.[f.id] ? (
                    <img src={page.thumbs[f.id]} alt="" draggable={false} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                  ) : (
                    <span className="shimmer block h-full w-full" />
                  )}
                  {on && (
                    <span className="a-pop absolute end-0.5 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-teal-300 text-slate-900 shadow">
                      <Check className="h-2 w-2" strokeWidth={4} />
                    </span>
                  )}
                </span>
                <span className={cx('block px-0 pb-0.5 pt-1 text-[0.56rem] font-bold leading-tight whitespace-nowrap', on ? 'text-teal-200' : 'text-slate-400')}>
                  {f.label}
                </span>
              </button>
            );
          })}
        </div>

        {pageCount > 1 && (
          <button className="btn mt-2 w-full !py-1.5 text-[0.7rem] whitespace-nowrap" onClick={onApplyAll}>
            <Layers className="h-3.5 w-3.5" /> اعمال این فیلتر روی همه‌ی صفحات
          </button>
        )}
      </section>

      {/* ---------- Precise adjustments — collapsible ---------- */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.03]">
        <button className="flex w-full items-center justify-between px-3.5 py-2.5 text-[0.82rem] font-bold" onClick={() => setOpen((o) => !o)}>
          <span className="flex items-center gap-2 whitespace-nowrap">
            <SlidersHorizontal className="h-4 w-4 text-teal-300" /> تنظیمات دقیق
            {changed && <span className="h-1.5 w-1.5 rounded-full bg-teal-300" />}
          </span>
          <ChevronDown className={cx('h-4 w-4 text-slate-400 transition-transform duration-300', open && 'rotate-180')} />
        </button>
        <div className={cx('grid transition-all duration-300 ease-out', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
          <div className="overflow-hidden">
            <div className="flex flex-col gap-2 px-3.5 pb-3 pt-1">
              {page.filter !== 'original' && <Slider label="شدت فیلتر" value={a.strength} onChange={(v) => onAdjust({ strength: v })} />}
              {showText && <Slider label="پررنگی متن" value={a.threshold} onChange={(v) => onAdjust({ threshold: v })} />}
              <Slider label="روشنایی" value={a.brightness} min={-100} max={100} onChange={(v) => onAdjust({ brightness: v })} />
              <Slider label="کنتراست" value={a.contrast} min={-100} max={100} onChange={(v) => onAdjust({ contrast: v })} />
              {page.filter !== 'bw' && <Slider label="وضوح و تیزی" value={a.sharpness} onChange={(v) => onAdjust({ sharpness: v })} />}
              <button className="btn btn-ghost !justify-start !px-0 !py-1 text-xs text-slate-400 hover:text-slate-100 whitespace-nowrap" disabled={!changed} onClick={onResetAdjust}>
                <RotateCcw className="h-3.5 w-3.5" /> بازنشانی تنظیمات
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
