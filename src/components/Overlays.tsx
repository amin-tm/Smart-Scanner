import { useEffect, useMemo } from 'react';
import { CircleAlert, ExternalLink, FolderOpen, UploadCloud, X } from 'lucide-react';
import { faNum, formatBytes } from '../lib/storage';
import type { ExportResult } from '../lib/useScanner';

export function DropOverlay() {
  return (
    <div className="a-fade-in pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-ink/70 backdrop-blur-sm">
      <div className="a-pop flex flex-col items-center gap-4 rounded-[2rem] border-2 border-dashed border-teal-300/80 bg-teal-300/10 px-16 py-14">
        <UploadCloud className="a-float h-16 w-16 text-teal-200" />
        <div className="text-2xl font-extrabold">فایل‌ها را رها کنید</div>
      </div>
    </div>
  );
}

export function ExportOverlay({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const R = 46;
  const C = 2 * Math.PI * R;
  return (
    <div className="overlay-in fixed inset-0 z-[55] flex items-center justify-center bg-[#04070e]/70 backdrop-blur-md">
      <div className="sheet-in glass w-[min(92vw,360px)] rounded-[1.75rem] p-7 text-center" style={{ background: 'rgba(12,18,34,0.92)' }}>
        <div className="relative mx-auto h-32 w-32">
          <div className="absolute inset-3 rounded-full bg-teal-400/10 blur-xl a-pulse" />
          <svg viewBox="0 0 110 110" className="relative h-full w-full -rotate-90">
            <defs>
              <linearGradient id="ring-g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#34d399" />
                <stop offset="1" stopColor="#22d3ee" />
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
              style={{ transition: 'stroke-dashoffset .45s cubic-bezier(.16,1,.3,1)', filter: 'drop-shadow(0 0 6px rgba(45,212,191,.6))' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-black tabular-nums text-white">{faNum(pct)}٪</span>
          </div>
        </div>
        <div className="mt-4 font-bold text-white">در حال ساخت PDF</div>
        <div className="mt-1 text-xs text-slate-400">
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
  const sparks = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        const d = 38 + Math.random() * 22;
        return { dx: Math.cos(a) * d, dy: Math.sin(a) * d, r: (Math.random() - 0.5) * 240, c: ['#34d399', '#2dd4bf', '#22d3ee', '#fde68a'][i % 4] };
      }),
    [],
  );
  const secs = r.ms < 950 ? 'کمتر از یک ثانیه' : `${faNum(Math.round(r.ms / 100) / 10)} ثانیه`;
  return (
    <div className="fixed inset-x-0 bottom-6 z-[58] mx-auto w-[min(94vw,460px)]" style={{ animation: 'toast-in .5s cubic-bezier(.2,.9,.3,1.15) both' }}>
      <div className="glass flex items-center gap-4 rounded-3xl p-4 shadow-2xl shadow-black/60" style={{ background: 'rgba(10,18,32,0.92)' }}>
        <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-300 to-cyan-400">
          {sparks.map((s, i) => (
            <i
              key={i}
              className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full"
              style={{ background: s.c, ['--dx' as string]: `${s.dx}px`, ['--dy' as string]: `${s.dy}px`, ['--r' as string]: `${s.r}deg`, animation: 'burst .8s ease-out both' }}
            />
          ))}
          <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="#03221f" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" strokeDasharray="24" strokeDashoffset="24" style={{ animation: 'draw .5s .15s ease-out forwards' }} />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">PDF آماده شد</div>
          <div className="truncate text-xs text-slate-400" dir="ltr" style={{ textAlign: 'right' }}>
            {r.name}
          </div>
          <div className="mt-0.5 text-[0.7rem] text-slate-500">
            {faNum(r.pages)} صفحه · {formatBytes(r.bytes)} · {secs}
          </div>
          {r.native && (
            <div className="mt-2 flex gap-2">
              <button className="btn !px-3 !py-1.5 text-xs" onClick={onOpen}>
                <ExternalLink className="h-3.5 w-3.5" /> باز کردن
              </button>
              <button className="btn !px-3 !py-1.5 text-xs" onClick={onShow}>
                <FolderOpen className="h-3.5 w-3.5" /> نمایش در پوشه
              </button>
            </div>
          )}
        </div>
        <button className="btn btn-ghost btn-icon self-start !p-1.5" onClick={onClose} aria-label="بستن">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function ErrorToast({ msg, onClose }: { msg: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 9000);
    return () => clearTimeout(t);
  }, [onClose, msg]);
  return (
    <div className="fixed inset-x-0 bottom-6 z-[58] mx-auto w-[min(94vw,440px)]" style={{ animation: 'toast-in .4s ease both' }}>
      <div className="glass flex items-center gap-3 rounded-2xl border-rose-400/30 p-4" style={{ background: 'rgba(40,12,22,0.92)' }}>
        <CircleAlert className="h-6 w-6 shrink-0 text-rose-300" />
        <div className="flex-1 text-sm text-rose-100">{msg}</div>
        <button className="btn btn-ghost btn-icon !p-1.5" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
