import { useEffect } from 'react';
import { CircleAlert, ExternalLink, FolderOpen, UploadCloud, X } from 'lucide-react';
import { faNum, formatBytes } from '../lib/storage';
import type { ExportResult } from '../lib/useScanner';

export function DropOverlay() {
  return (
    <div className="a-fade-in pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-ink/70 backdrop-blur-sm">
      <div className="a-pop flex flex-col items-center gap-4 rounded-[2rem] border-2 border-dashed border-accent-soft/80 bg-accent-soft/10 px-16 py-14">
        <UploadCloud className="a-float h-16 w-16 text-accent-soft" />
        <div className="text-2xl font-extrabold">فایل‌ها را رها کنید</div>
      </div>
    </div>
  );
}

export function ExportOverlay({ done, total, format }: { done: number; total: number; format: ExportResult['format'] }) {
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const R = 46;
  const C = 2 * Math.PI * R;
  return (
    <div className="overlay-in fixed inset-0 z-[55] flex items-center justify-center bg-[#191919]/70 backdrop-blur-md">
      <div className="sheet-in glass snap-glass-loading w-[min(92vw,360px)] rounded-[1.75rem] p-7 text-center">
        <div className="relative mx-auto h-32 w-32">
          <div className="absolute inset-3 rounded-full bg-brand/10 blur-xl a-pulse" />
          <svg viewBox="0 0 110 110" className="relative h-full w-full -rotate-90">
            <defs>
              <linearGradient id="ring-g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#efefef" />
                <stop offset="1" stopColor="#dedede" />
              </linearGradient>
            </defs>
            <circle cx="55" cy="55" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="7" />
            <circle
              cx="55"
              cy="55"
              r={R}
              fill="none"
              stroke="url(#ring-g)"
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - Math.max(0.04, pct / 100))}
              style={{ transition: 'stroke-dashoffset .45s cubic-bezier(.16,1,.3,1)', filter: 'drop-shadow(0 0 6px rgba(239, 239, 239,.6))' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-black tabular-nums text-white">{faNum(pct)}٪</span>
          </div>
        </div>
        <div className="mt-4 font-bold text-white">{format === 'pdf' ? 'در حال ساخت پی‌دی‌اف' : 'در حال آماده‌سازی عکس'}</div>
        <div className="mt-1 text-xs text-muted">
          صفحه {faNum(Math.min(done + 1, total))} از {faNum(total)}
        </div>
      </div>
    </div>
  );
}

export function ResultToast({ r, onClose, onOpen, onShow }: { r: ExportResult; onClose: () => void; onOpen: () => void; onShow: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 20000);
    return () => clearTimeout(t);
  }, [onClose, r]);
  const label = r.format === 'pdf' ? 'پی‌دی‌اف آماده شد' : 'عکس آماده شد';
  return (
    <div className="snap-notice snap-notice-result" role="status">
      <svg viewBox="0 0 24 24" className="snap-notice-icon" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5l4.5 4.5L19 7.5" strokeDasharray="24" style={{ animation: 'draw .35s ease-out both' }} />
      </svg>
      <strong>{label}</strong>
      <bdi className="snap-notice-text" title={r.name}>{r.name}</bdi>
      <span className="snap-notice-meta">{faNum(r.pages)} صفحه · {formatBytes(r.bytes)}</span>
      {r.native && <>
        <button className="btn snap-notice-action" title="باز کردن" aria-label="باز کردن" onClick={onOpen}>
          <ExternalLink size={16} /><span>باز کردن</span>
        </button>
        <button className="btn snap-notice-action" title="نمایش در پوشه" aria-label="نمایش در پوشه" onClick={onShow}>
          <FolderOpen size={16} /><span>نمایش در پوشه</span>
        </button>
      </>}
      <button className="btn snap-notice-action" onClick={onClose} aria-label="بستن"><X size={16} /></button>
    </div>
  );
}

export function ErrorToast({ msg, onClose }: { msg: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 9000);
    return () => clearTimeout(t);
  }, [onClose, msg]);
  return (
    <div className="snap-notice snap-notice-error" role="alert">
      <CircleAlert className="snap-notice-icon" />
      <span className="snap-notice-text" title={msg}>{msg}</span>
      <button className="btn snap-notice-action" onClick={onClose} aria-label="بستن"><X size={16} /></button>
    </div>
  );
}
