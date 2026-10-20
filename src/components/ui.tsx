import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { LoaderCircle, X } from 'lucide-react';

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

export function Spinner({ className = 'w-5 h-5' }: { className?: string }) {
  return <LoaderCircle className={cx('a-spin', className)} />;
}

export function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-on={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cx('switch', disabled && 'opacity-40 pointer-events-none')}
    />
  );
}

export function Slider({
  label,
  value,
  min = 0,
  max = 100,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
}) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <div className="group">
      <div className="mb-0.5 flex items-center justify-between text-[0.78rem]">
        <span className="text-slate-300">{label}</span>
        <span className="tabular-nums text-slate-500 transition group-hover:text-teal-300">{value}</span>
      </div>
      <input
        type="range"
        dir="ltr"
        min={min}
        max={max}
        value={value}
        style={{ '--p': `${p}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
        onDoubleClick={() => onChange(min < 0 ? 0 : Math.round((min + max) / 2))}
      />
    </div>
  );
}

export function Modal({ title, onClose, children, width = 'max-w-xl' }: { title: string; onClose: () => void; children: ReactNode; width?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="a-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className={cx('app-modal-surface a-pop glass flex max-h-[90vh] w-full flex-col overflow-hidden rounded-3xl shadow-2xl shadow-black/60', width)}
        style={{ background: 'rgba(12,18,34,0.92)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="بستن">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300', className)}>
      {children}
    </span>
  );
}

/**
 * Keeps children mounted while they animate out, so popups close as smoothly
 * as they open. CSS: .presence-in / .presence-out (index.css).
 */
export function Presence({ show, children, ms = 220 }: { show: boolean; children: ReactNode; ms?: number }) {
  const [mounted, setMounted] = useState(show);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (show) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    setLeaving(true);
    const t = setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);
  if (!mounted) return null;
  return <div className={leaving ? 'presence-out' : 'presence-in'}>{children}</div>;
}
