import { useEffect } from 'react';
import { Plus, X, Layers, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { faNum } from '../lib/storage';
import { cx } from './ui';
import type { Page } from '../lib/types';

export default function PagesDrawer({
  open,
  pages,
  selId,
  onClose,
  onSelect,
  onRemove,
  onMove,
  onAdd,
  onClearAll,
}: {
  open: boolean;
  pages: Page[];
  selId: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onAdd: () => void;
  onClearAll: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-md a-fade-in"
      onMouseDown={onClose}
    >
      <div
        className="glass relative flex flex-col w-full max-w-xl max-h-[85vh] rounded-3xl border border-white/15 bg-slate-950/95 shadow-2xl shadow-black/80 overflow-hidden a-pop"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5 shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-400/15 text-cyan-300">
              <Layers className="h-4 w-4" />
            </div>
            <div className="whitespace-nowrap font-bold text-sm text-slate-100">
              مدیریت صفحات سند ({faNum(pages.length)} صفحه)
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onAdd}
              className="btn btn-ghost !px-3 !py-1.5 text-xs text-teal-300 hover:text-white whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" /> افزودن صفحه
            </button>
            <button
              onClick={onClose}
              className="btn btn-ghost btn-icon !p-1.5 text-slate-400 hover:text-white"
              aria-label="بستن"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Grid of pages */}
        <div className="overflow-y-auto p-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {pages.map((p, i) => {
              const on = p.id === selId;
              const thumb = p.thumbs?.[p.filter] || p.srcUrl;
              return (
                <div
                  key={p.id}
                  onClick={() => {
                    onSelect(p.id);
                  }}
                  className={cx(
                    'group relative aspect-[3/4] rounded-2xl border overflow-hidden cursor-pointer transition-all duration-200 bg-slate-900',
                    on
                      ? 'border-teal-300 ring-2 ring-teal-300/40 shadow-lg shadow-teal-500/20'
                      : 'border-white/10 hover:border-white/30 hover:scale-[1.02]',
                  )}
                >
                  {thumb ? (
                    <img src={thumb} alt="" draggable={false} className="h-full w-full object-cover" />
                  ) : (
                    <div className="shimmer h-full w-full" />
                  )}

                  {/* Page number badge */}
                  <div className="absolute top-2 start-2 flex h-6 px-2 items-center justify-center rounded-full bg-black/75 text-white text-xs font-bold backdrop-blur">
                    {faNum(i + 1)}
                  </div>

                  {/* Controls hover overlay */}
                  <div className="absolute inset-x-0 bottom-0 p-1.5 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent opacity-90 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(p.id);
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded-lg bg-red-500/80 text-white hover:bg-red-500 transition"
                      title="حذف صفحه"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                    <div className="flex items-center gap-1">
                      <button
                        disabled={i === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          onMove(p.id, -1);
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded-lg bg-black/70 text-white hover:bg-teal-500 disabled:opacity-30 transition"
                        title="انتقال به بالا"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        disabled={i === pages.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          onMove(p.id, 1);
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded-lg bg-black/70 text-white hover:bg-teal-500 disabled:opacity-30 transition"
                        title="انتقال به پایین"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/10 px-5 py-3 bg-slate-950/70 shrink-0">
          <button
            onClick={() => {
              if (confirm('آیا از حذف تمام صفحات مطمئن هستید؟')) {
                onClearAll();
                onClose();
              }
            }}
            className="btn btn-ghost !px-3 !py-1.5 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 whitespace-nowrap"
          >
            <Trash2 className="h-3.5 w-3.5" /> پاک‌سازی همه
          </button>
          <button
            onClick={onClose}
            className="btn btn-primary !rounded-xl !px-6 !py-2 text-xs whitespace-nowrap"
          >
            تأیید
          </button>
        </div>
      </div>
    </div>
  );
}
