import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleArrowDown, RefreshCw } from 'lucide-react';
import { checkUpdate, installUpdate, isDesktop } from '../lib/desktop';
import { version as currentVersion } from '../../src-tauri/tauri.conf.json';
import { Modal, Presence, Spinner } from './ui';

export default function AutoUpdateNotice({ open, onClose, hasWork }: {
  open: boolean;
  onClose: () => void;
  hasWork: boolean;
}) {
  const desktop = isDesktop();
  const [version, setVersion] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'checking' | 'checked' | 'installing'>('idle');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const running = useRef(false);

  const check = useCallback(async () => {
    if (!desktop || running.current) return;
    running.current = true;
    setStatus('checking');
    setError('');
    try {
      setVersion(await checkUpdate());
      setStatus('checked');
    } catch {
      setError('بررسی نسخهٔ جدید انجام نشد. دوباره تلاش کنید.');
      setStatus('idle');
    } finally {
      running.current = false;
    }
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    const refresh = () => { void check(); };
    const first = window.setTimeout(refresh, 8000);
    const periodic = window.setInterval(refresh, 4 * 60 * 60 * 1000);
    window.addEventListener('online', refresh);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(periodic);
      window.removeEventListener('online', refresh);
    };
  }, [desktop, check]);

  useEffect(() => { if (open && status === 'idle' && !error) void check(); }, [open, status, error, check]);
  useEffect(() => { if (!open) setConfirm(false); }, [open]);

  const install = async () => {
    if (!desktop || running.current) return;
    if (hasWork && !confirm) { setConfirm(true); return; }
    running.current = true;
    setStatus('installing');
    setError('');
    setConfirm(false);
    try {
      if (!(await installUpdate())) setVersion(null);
    } catch {
      setError('دانلود یا نصب نسخهٔ جدید انجام نشد. دوباره تلاش کنید.');
    } finally {
      running.current = false;
      setStatus('checked');
    }
  };

  const busy = status === 'checking' || status === 'installing';
  const message = !desktop ? 'بررسی و نصب به‌روزرسانی در برنامهٔ ویندوز انجام می‌شود.'
    : status === 'checking' ? 'در حال بررسی نسخهٔ جدید…'
    : status === 'installing' ? 'در حال دانلود و نصب…'
    : version ? 'نسخهٔ جدید آمادهٔ نصب است.'
    : status === 'checked' ? 'ScanLite به‌روز است.' : '';

  return (
    <Presence show={open}>
      <Modal title="به‌روزرسانی ScanLite" width="snap-dialog-update" onClose={onClose}>
        <div className="work-update-card">
          <span className="work-update-icon" aria-hidden="true"><CircleArrowDown size={25} /></span>
          <div>
            <strong>نسخهٔ نصب‌شده <bdi>{currentVersion}</bdi></strong>
            {version && <div>نسخهٔ جدید <bdi>{version}</bdi></div>}
            <p role="status">{message}</p>
          </div>
        </div>
        {error && <p className="work-update-message" role="alert">{error}</p>}
        {confirm && <p className="work-update-message">نصب، برنامه را می‌بندد. اگر سند فعلی را ذخیره کرده‌اید، نصب را تأیید کنید.</p>}
        {desktop && <div className="work-update-actions">
          {confirm && <button className="work-button" onClick={() => setConfirm(false)}>انصراف</button>}
          {!confirm && <button className="work-button" disabled={busy} onClick={() => void check()}>
            {status === 'checking' ? <Spinner className="size-4" /> : <RefreshCw size={16} />} بررسی نسخهٔ جدید
          </button>}
          {version && <button className="work-button work-primary" disabled={busy} onClick={() => void install()}>
            {confirm ? 'تأیید نصب' : 'دانلود و نصب'}
          </button>}
        </div>}
      </Modal>
    </Presence>
  );
}
