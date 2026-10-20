import { useEffect, useRef, useState } from 'react';
import { checkUpdate, installUpdate, isDesktop } from '../lib/desktop';

/**
 * Checks for a signed release at startup, when the internet reconnects, and
 * every 4 hours. When the editor is empty it installs automatically; otherwise
 * it asks the user to finish or save the unsaved scan first.
 */
export default function AutoUpdateNotice({ hasWork }: { hasWork: boolean }) {
  const [version, setVersion] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const checking = useRef(false);
  const installingRef = useRef(false);
  const hasWorkRef = useRef(hasWork);
  hasWorkRef.current = hasWork;

  useEffect(() => {
    if (!isDesktop()) return;
    let disposed = false;

    const apply = async () => {
      if (installingRef.current || disposed) return;
      installingRef.current = true;
      setInstalling(true);
      setError(null);
      try {
        await installUpdate();
      } catch (err) {
        if (!disposed) setError(`نصب به‌روزرسانی انجام نشد: ${String(err)}`);
      } finally {
        installingRef.current = false;
        if (!disposed) setInstalling(false);
      }
    };

    const check = async () => {
      if (checking.current || installingRef.current || disposed) return;
      checking.current = true;
      try {
        const next = await checkUpdate();
        if (disposed) return;
        setVersion(next);
        if (next && !hasWorkRef.current) await apply();
      } catch (err) {
        // No internet should never stop the scanner from working.
        console.warn('[updater] check failed', err);
      } finally {
        checking.current = false;
      }
    };

    const first = window.setTimeout(() => void check(), 8000);
    const periodic = window.setInterval(() => void check(), 4 * 60 * 60 * 1000);
    const online = () => void check();
    window.addEventListener('online', online);
    // The UI can request installation after the user has finished their work.
    const installClick = () => void apply();
    window.addEventListener('smartscanner-install-update', installClick);
    return () => {
      disposed = true;
      window.clearTimeout(first);
      window.clearInterval(periodic);
      window.removeEventListener('online', online);
      window.removeEventListener('smartscanner-install-update', installClick);
    };
  }, []);

  if ((!version || dismissed) && !error) return null;
  return (
    <div className="relative z-30 mx-4 mt-2 flex flex-wrap items-center justify-center gap-3 rounded-xl border border-teal-300/30 bg-slate-900/95 px-4 py-2 text-sm text-white shadow-lg" dir="rtl">
      <span>{error ?? `نسخه جدید Smart Scanner (${version}) آماده نصب است.`}</span>
      {version && !installing && !dismissed && (
        <button
          type="button"
          className="rounded-lg bg-teal-500 px-3 py-1.5 font-bold text-slate-950"
          onClick={() => {
            if (hasWork && !window.confirm('ابتدا خروجی PDF اسکن‌های فعلی را ذخیره کن؛ نصب آپدیت برنامه را می‌بندد. ادامه می‌دهی؟')) return;
            window.dispatchEvent(new Event('smartscanner-install-update'));
          }}
        >
          نصب آپدیت
        </button>
      )}
      {installing && <span className="text-teal-300">در حال دانلود و نصب نسخه جدید…</span>}
      <button type="button" className="text-slate-300 underline" onClick={() => { setDismissed(true); setError(null); }}>بعداً</button>
    </div>
  );
}
