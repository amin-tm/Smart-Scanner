import { useEffect, useState, type ReactNode } from 'react';
import { FolderOpen, Power } from 'lucide-react';
import { Modal, Toggle, cx } from './ui';
import { chooseDir, getAutostart, isDesktop, setAutostart, setBackgroundMode } from '../lib/desktop';
import { FILTERS, QUALITY, type PageSizeId, type QualityId, type Settings } from '../lib/types';

const SIZES: { id: PageSizeId; label: string }[] = [
  { id: 'a4', label: 'A4' },
  { id: 'a5', label: 'A5' },
  { id: 'a3', label: 'A3' },
  { id: 'letter', label: 'Letter' },
  { id: 'legal', label: 'Legal' },
  { id: 'fit', label: 'اندازه‌ی تصویر' },
];

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        {hint && <div className="mt-0.5 text-xs leading-5 text-slate-500">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap justify-end gap-1 rounded-xl bg-black/30 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={cx('rounded-lg px-3 py-1.5 text-xs font-semibold transition', value === o.id ? 'bg-teal-300 text-slate-900 shadow' : 'text-slate-400 hover:text-white')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function SettingsDialog({ s, onChange, onClose }: { s: Settings; onChange: (c: Partial<Settings>) => void; onClose: () => void }) {
  const desktop = isDesktop();
  const [auto, setAuto] = useState(false);
  useEffect(() => {
    if (desktop) void getAutostart().then(setAuto);
  }, [desktop]);

  return (
    <Modal title="تنظیمات" onClose={onClose}>
      <div className="divide-y divide-white/5">
        <Row title="کیفیت خروجی" hint={QUALITY[s.quality].hint}>
          <Seg<QualityId> value={s.quality} onChange={(v) => onChange({ quality: v })} options={(Object.keys(QUALITY) as QualityId[]).map((id) => ({ id, label: QUALITY[id].label }))} />
        </Row>
        <Row title="اندازه‌ی کاغذ PDF">
          <Seg<PageSizeId> value={s.pageSize} onChange={(v) => onChange({ pageSize: v })} options={SIZES} />
        </Row>
        <Row title="فیلتر پیش‌فرض" hint="برای هر عکس جدید">
          <select
            value={s.defaultFilter}
            onChange={(e) => onChange({ defaultFilter: e.target.value as Settings['defaultFilter'] })}
            className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-teal-300"
          >
            {FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </Row>
        <Row title="تشخیص خودکار لبه‌ها" hint="سند داخل عکس خودکار پیدا و صاف می‌شود">
          <Toggle on={s.autoDetect} onChange={(v) => onChange({ autoDetect: v })} />
        </Row>
        <Row title="پاک‌سازی حاشیه‌ها" hint="حذف سایه و لکه‌ی کناره‌های صفحه">
          <Toggle on={s.cleanEdges} onChange={(v) => onChange({ cleanEdges: v })} />
        </Row>
        <Row title="پاک‌کردن لیست بعد از ساخت PDF" hint="برای شروع سریع کار بعدی">
          <Toggle on={s.clearAfterExport} onChange={(v) => onChange({ clearAfterExport: v })} />
        </Row>
        <Row title="پیشوند نام فایل">
          <input
            type="text"
            value={s.filePrefix}
            onChange={(e) => onChange({ filePrefix: e.target.value })}
            dir="ltr"
            className="w-36 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-teal-300"
          />
        </Row>

        {desktop && (
          <>
            <Row title="پوشه‌ی ذخیره‌ی PDF" hint={s.saveDir || 'پیش‌فرض'}>
              <button
                className="btn !py-2 text-xs"
                onClick={async () => {
                  const d = await chooseDir(s.saveDir);
                  if (d) onChange({ saveDir: d });
                }}
              >
                <FolderOpen className="h-4 w-4" /> تغییر
              </button>
            </Row>
            <Row title="باز شدن خودکار PDF بعد از ساخت">
              <Toggle on={s.openAfterSave} onChange={(v) => onChange({ openAfterSave: v })} />
            </Row>
            <Row title="ماندن در پس‌زمینه" hint="با بستن پنجره، برنامه در سینی سیستم می‌ماند و بار بعد فوری باز می‌شود">
              <Toggle
                on={s.runInBackground}
                onChange={(v) => {
                  onChange({ runInBackground: v });
                  void setBackgroundMode(v);
                }}
              />
            </Row>
            <Row title="اجرا همراه با ویندوز" hint="بی‌صدا در پس‌زمینه بالا می‌آید تا همیشه آماده باشد">
              <div className="flex items-center gap-2">
                <Power className={cx('h-4 w-4', auto ? 'text-teal-300' : 'text-slate-600')} />
                <Toggle
                  on={auto}
                  onChange={async (v) => {
                    const r = await setAutostart(v);
                    setAuto(r ?? v);
                    onChange({ autostart: r ?? v });
                  }}
                />
              </div>
            </Row>
          </>
        )}
      </div>
    </Modal>
  );
}
