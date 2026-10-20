import { AlertCircle, ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { cx } from './ui';
import { faNum } from '../lib/storage';
import type { Page } from '../lib/types';

export default function Rail({
  pages,
  selId,
  onSelect,
  onRemove,
  onMove,
  onAdd,
}: {
  pages: Page[];
  selId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto overflow-y-hidden p-1.5 lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:p-1">
      {pages.map((p, i) => {
        const on = p.id === selId;
        const thumb = p.thumbs?.[p.filter];
        return (
          <div
            key={p.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(p.id)}
            onKeyDown={(e) => e.key === 'Enter' && onSelect(p.id)}
            className={cx(
              'a-slide-in group relative aspect-[3/4] w-[72px] shrink-0 cursor-pointer overflow-hidden rounded-2xl border bg-slate-900/70 transition duration-200 lg:w-full lg:aspect-[3/2]',
              on ? 'border-teal-300 shadow-[0_0_0_3px_rgba(45,212,191,0.2),0_8px_24px_-8px_rgba(45,212,191,0.5)]' : 'border-white/10 hover:-translate-y-0.5 hover:border-white/30',
            )}
            style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
          >
            {thumb ? (
              <img src={thumb} alt="" draggable={false} className="h-full w-full object-cover" />
            ) : p.status === 'error' ? (
              <div className="flex h-full flex-col items-center justify-center gap-1 text-rose-300">
                <AlertCircle className="h-5 w-5" />
                <span className="text-[0.65rem]">خطا</span>
              </div>
            ) : (
              <>
                <div className="shimmer h-full w-full" />
                {p.status === 'working' && <div className="scan-line" />}
              </>
            )}
            <span className="absolute bottom-1 end-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-black/70 px-1 text-[0.6rem] font-bold tabular-nums backdrop-blur">
              {faNum(i + 1)}
            </span>
            <div className="absolute inset-x-1 top-1 flex justify-between opacity-0 transition group-hover:opacity-100">
              <button
                className="flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-slate-200 backdrop-blur hover:bg-rose-500"
                onClick={(e) => { e.stopPropagation(); onRemove(p.id); }}
                title="حذف"
              >
                <X className="h-2.5 w-2.5" />
              </button>
              <div className="flex gap-0.5">
                <button
                  className="flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-slate-200 backdrop-blur hover:bg-teal-500 disabled:opacity-30"
                  disabled={i === 0}
                  onClick={(e) => { e.stopPropagation(); onMove(p.id, -1); }}
                  title="بالاتر"
                >
                  <ArrowUp className="h-2.5 w-2.5" />
                </button>
                <button
                  className="flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-slate-200 backdrop-blur hover:bg-teal-500 disabled:opacity-30"
                  disabled={i === pages.length - 1}
                  onClick={(e) => { e.stopPropagation(); onMove(p.id, 1); }}
                  title="پایین‌تر"
                >
                  <ArrowDown className="h-2.5 w-2.5" />
                </button>
              </div>
            </div>
          </div>
        );
      })}
      <button
        onClick={onAdd}
        className="group flex aspect-[3/4] w-[72px] shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-white/20 text-slate-400 transition hover:border-teal-300/70 hover:bg-teal-300/5 hover:text-teal-200 lg:w-full lg:aspect-[3/2]"
      >
        <Plus className="h-5 w-5 transition group-hover:rotate-90" />
        <span className="text-[0.65rem]">افزودن</span>
      </button>
    </div>
  );
}
