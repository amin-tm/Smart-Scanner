import { ClipboardPaste, Cpu, Crop, FileDown, FileText, Gauge, ImagePlus, MousePointerClick, ScanLine, ShieldCheck, Sparkles, Upload } from 'lucide-react';
import { cx } from './ui';

/**
 * Looping product demo (pure CSS, GPU-only transforms):
 * tilted phone photo -> corners locked -> scan pass -> page flattened and whitened -> PDF.
 */
function PipelineDemo() {
  const lines = [88, 72, 94, 60, 82, 90, 54, 76, 68];
  return (
    <div className="demo-wrap" aria-hidden>
      <div className="demo-glow" />
      <div className="demo-stage">
        <div className="demo-desk" />
        <div className="demo-paper">
          <div className="demo-shade" />
          <div className="demo-head" />
          <div className="demo-lines">
            {lines.map((w, i) => (
              <span key={i} style={{ width: `${w}%` }} />
            ))}
          </div>
          <div className="demo-table">
            <span /><span /><span /><span /><span /><span />
          </div>
          <svg className="demo-outline" viewBox="0 0 100 100" preserveAspectRatio="none">
            <rect x="0.8" y="0.8" width="98.4" height="98.4" rx="1" pathLength="100" />
          </svg>
          <i className="demo-corner c1" />
          <i className="demo-corner c2" />
          <i className="demo-corner c3" />
          <i className="demo-corner c4" />
          <div className="demo-scan" />
        </div>
        <div className="demo-pdf">
          <FileDown className="h-3.5 w-3.5" /> PDF
        </div>
      </div>

      <div className="demo-steps">
        <span className="demo-step s1"><Crop className="h-3.5 w-3.5" /> تشخیص لبه</span>
        <span className="demo-step s2"><ScanLine className="h-3.5 w-3.5" /> اصلاح پرسپکتیو</span>
        <span className="demo-step s3"><Sparkles className="h-3.5 w-3.5" /> سفیدسازی</span>
      </div>
    </div>
  );
}

const STEPS = [
  { icon: Upload, title: 'بارگذاری', text: 'عکس یا PDF، تکی یا گروهی' },
  { icon: Crop, title: 'برش خودکار', text: 'یافتن کاغذ و صاف‌کردن آن' },
  { icon: FileDown, title: 'خروجی PDF', text: 'زمینه سفید، آماده چاپ' },
];

const SPECS = [
  { icon: ShieldCheck, label: 'پردازش آفلاین' },
  { icon: Cpu, label: 'پردازش موازی' },
  { icon: Gauge, label: 'تا ۳۵۰ DPI' },
];

export default function EmptyState({ onPick, dragging, importing }: { onPick: () => void; dragging: boolean; importing: boolean }) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-hidden px-2 sm:px-4">
      <div className="grid w-full max-w-6xl items-center gap-8 lg:grid-cols-[1.05fr_0.95fr]">
        {/* ------------ copy + upload ------------ */}
        <div className="min-w-0">
          <div className="hero-in flex w-fit items-center gap-2 rounded-full border border-teal-300/25 bg-teal-300/[0.08] px-3 py-1 text-[0.7rem] font-semibold text-teal-200" style={{ animationDelay: '0ms' }}>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-300 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-300" />
            </span>
            موتور بینایی ماشین OpenCV
          </div>

          <h1 className="hero-in mt-4 text-3xl font-black leading-[1.3] tracking-tight text-white sm:text-[2.6rem]" style={{ animationDelay: '70ms' }}>
            اسکن حرفه‌ای اسناد
            <span className="block bg-gradient-to-l from-emerald-300 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
              دقیق، سریع، آماده چاپ
            </span>
          </h1>
          <p className="hero-in mt-3 max-w-lg text-[0.9rem] leading-7 text-slate-400" style={{ animationDelay: '140ms' }}>
            لبه‌های کاغذ به‌صورت خودکار پیدا و برش داده می‌شود، پرسپکتیو اصلاح و پس‌زمینه برای چاپ سفید می‌شود.
          </p>

          {/* drop zone */}
          <div
            onClick={onPick}
            onPointerMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
              e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
            }}
            className={cx('hero-in dropzone group mt-6', dragging && 'is-drag')}
            style={{ animationDelay: '210ms' }}
          >
            <div className="dropzone-border" />
            <div className="relative flex flex-col items-center gap-4 px-5 py-6 sm:flex-row sm:px-6">
              <div className="dz-icon">
                <ImagePlus className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1 text-center sm:text-start">
                <div className="truncate text-[0.98rem] font-bold text-white">{dragging ? 'فایل‌ها را رها کنید' : 'فایل‌ها را اینجا رها کنید'}</div>
                <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5 text-[0.7rem] text-slate-400 sm:justify-start">
                  <span className="kbd"><MousePointerClick className="h-3 w-3" /> کلیک</span>
                  <span className="kbd"><ClipboardPaste className="h-3 w-3" /> Ctrl + V</span>
                  <span className="kbd"><FileText className="h-3 w-3" /> JPG · PNG · PDF</span>
                </div>
              </div>
              <button
                className="btn btn-primary btn-ready !rounded-xl !px-6 !py-3 text-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onPick();
                }}
              >
                <Upload className="h-4 w-4" /> انتخاب فایل
              </button>
            </div>
            {importing && (
              <div className="relative border-t border-white/10 px-6 py-2 text-xs text-teal-200">
                <span className="inline-flex items-center gap-2"><ScanLine className="h-3.5 w-3.5 animate-pulse" /> در حال خواندن فایل…</span>
              </div>
            )}
          </div>

          {/* steps */}
          <div className="mt-5 grid grid-cols-3 gap-2.5">
            {STEPS.map((s, i) => (
              <div key={s.title} className="hero-in step-card" style={{ animationDelay: `${300 + i * 80}ms` }}>
                <div className="flex items-center gap-2">
                  <span className="step-num">{['۱', '۲', '۳'][i]}</span>
                  <s.icon className="h-4 w-4 text-teal-300" />
                </div>
                <div className="mt-2 truncate text-[0.82rem] font-bold text-white">{s.title}</div>
                <div className="mt-0.5 truncate text-[0.68rem] text-slate-500">{s.text}</div>
              </div>
            ))}
          </div>

          <div className="hero-in mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.72rem] text-slate-500" style={{ animationDelay: '560ms' }}>
            {SPECS.map((s) => (
              <span key={s.label} className="inline-flex items-center gap-1.5">
                <s.icon className="h-3.5 w-3.5 text-slate-400" /> {s.label}
              </span>
            ))}
          </div>
        </div>

        {/* ------------ live demo ------------ */}
        <div className="hero-in hidden justify-center lg:flex" style={{ animationDelay: '180ms' }}>
          <PipelineDemo />
        </div>
      </div>
    </div>
  );
}
