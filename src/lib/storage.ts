import { DEFAULT_SETTINGS, type Settings } from './types';

const KEY = 'smart-scanner:settings:v2';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

const p2 = (n: number | string) => String(n).padStart(2, '0');

/** `1404-05-12_10-30-00` (Jalali date, falls back to Gregorian) */
export function timestamp(d = new Date()): string {
  const make = (locale: string) => {
    const parts = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d);
    const g = (t: string) => parts.find((x) => x.type === t)?.value ?? '00';
    return `${g('year')}-${p2(g('month'))}-${p2(g('day'))}_${p2(g('hour'))}-${p2(g('minute'))}-${p2(g('second'))}`;
  };
  try {
    return make('en-US-u-ca-persian-nu-latn');
  } catch {
    return make('en-CA');
  }
}

const fa = new Intl.NumberFormat('fa-IR');
export const faNum = (n: number) => fa.format(n);

export function formatBytes(n: number): string {
  if (n < 1024) return `${faNum(n)} بایت`;
  if (n < 1024 * 1024) return `${faNum(Math.round(n / 1024))} کیلوبایت`;
  return `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(n / 1024 / 1024)} مگابایت`;
}
