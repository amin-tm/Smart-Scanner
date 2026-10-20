/**
 * Slide-in side panel. Animates with transform (GPU, no layout thrashing)
 * so it feels instant on any screen size.
 */
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cx } from './ui';

type Side = 'left' | 'right';

export function Panel({
  open,
  side = 'right',
  onClose,
  width = 'w-[320px] sm:w-[360px]',
  className = '',
  children,
}: {
  open: boolean;
  side?: Side;
  onClose: () => void;
  width?: string;
  className?: string;
  children: React.ReactNode;
}) {
  // ESC closes
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);

  return (
    <div
      className={cx(
        'fixed inset-0 z-[53] pointer-events-none',
        open ? 'pointer-events-auto' : 'hidden',
      )}
      onMouseDown={onClose}
    >
      <div
        className={cx(
          'a-fade-in pointer-events-none absolute inset-0 bg-black/40 backdrop-blur-sm',
          open ? 'pointer-events-auto' : '',
        )}
        onMouseDown={(e) => e.stopPropagation()}
      />
      <div
        className={cx(
          'panel z-50 flex flex-col h-full pointer-events-auto shadow-2xl shadow-black/60',
          side === 'right' ? 'absolute right-0 top-0 bottom-0' : 'absolute left-0 top-0 bottom-0 translate-x-full',
          open && 'translate-x-0',
          width,
          className,
        )}
        style={{
          transition: side === 'right' ? 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)' : 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3.5 shrink-0">
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="بستن">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{children}</div>
      </div>
    </div>
  );
}
