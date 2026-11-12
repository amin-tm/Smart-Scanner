import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, ChevronDown, FolderOpen, Power } from 'lucide-react';
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
        {hint && <div className="mt-0.5 text-xs leading-5 text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  const selected = options.findIndex(option => option.id === value);
  const position = { '--segments': options.length, '--selected': selected } as CSSProperties;
  return (
    <div className="settings-segment" role="group" style={position}>
      <span aria-hidden="true" className="settings-segment-marker" />
      {options.map(option => (
        <button key={option.id} type="button" aria-pressed={value === option.id}
          lang={/^[A-Za-z]/.test(option.label) ? 'en' : undefined}
          onClick={() => onChange(option.id)}>{option.label}</button>
      ))}
    </div>
  );
}

function DefaultFilter({ value, onChange }: {
  value: Settings['defaultFilter'];
  onChange: (value: Settings['defaultFilter']) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = FILTERS.find(filter => filter.id === value);
  return (
    <div className="settings-picker" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }} onKeyDown={event => {
      if (open && event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        event.currentTarget.querySelector('button')?.focus();
      }
    }}>
      <button type="button" className="settings-picker-trigger" aria-label="فیلتر پیش‌فرض" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{current?.label}</span><ChevronDown size={16} />
      </button>
      {open && <div className="settings-picker-options" role="group" aria-label="فیلترهای پیش‌فرض">
        {FILTERS.map(filter => (
          <button type="button" key={filter.id} aria-pressed={filter.id === value} onClick={event => {
            onChange(filter.id);
            event.currentTarget.closest('.settings-picker')?.querySelector('button')?.focus();
            setOpen(false);
          }}><span>{filter.label}</span>{filter.id === value && <Check size={15} />}</button>
        ))}
      </div>}
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
          <DefaultFilter value={s.defaultFilter} onChange={value => onChange({ defaultFilter: value })} />
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
            className="w-36 rounded-xl border border-white/10 bg-ink-2 px-3 py-2 text-sm outline-none focus:border-accent-soft"
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
                <Power className={cx('h-4 w-4', auto ? 'text-accent-soft' : 'text-muted')} />
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
