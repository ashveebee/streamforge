import { getLocale, t } from '@/i18n';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/** A number with a fixed count of decimals, in the active language (1.5 / 1,5). */
function fixed(n: number, digits: number) {
  return new Intl.NumberFormat(getLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

export function bytes(n: number | undefined, digits = 1) {
  if (n === undefined || !Number.isFinite(n)) return '—';
  if (n === 0) return '0 B';
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(Math.abs(n)) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${fixed(v, v >= 100 || i === 0 ? 0 : digits)} ${UNITS[i]}`;
}

export function speed(n: number | undefined) {
  if (!n) return '0 B/s';
  return `${bytes(n)}/s`;
}

/** Network rates in bits, as people expect for link speed. */
export function bitrate(bytesPerSec: number | undefined) {
  if (!bytesPerSec) return '0 bps';
  const bits = bytesPerSec * 8;
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps'];
  const i = Math.min(units.length - 1, Math.floor(Math.log10(bits) / 3));
  return `${fixed(bits / 1000 ** i, i ? 1 : 0)} ${units[i]}`;
}

export function compact(n: number | undefined) {
  if (n === undefined || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(getLocale(), { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function num(n: number | undefined) {
  if (n === undefined || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(getLocale()).format(n);
}

export function pct(n: number | undefined, digits = 0) {
  if (n === undefined || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(getLocale(), { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

/** 5423000 → "1:30:23" */
export function clock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

export function duration(ms: number) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const rtfCache = new Map<string, Intl.RelativeTimeFormat>();
function rtfFor(locale: string) {
  let f = rtfCache.get(locale);
  if (!f) rtfCache.set(locale, (f = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })));
  return f;
}

export function relative(iso: string | number | undefined) {
  if (iso === undefined) return '—';
  const at = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(at)) return '—';
  const diff = (at - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return diff < 0 ? t('time.justNow') : t('time.inAMoment');
  const rtf = rtfFor(getLocale());
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), 'month');
  return rtf.format(Math.round(diff / (86400 * 365)), 'year');
}

export function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(d) - start(today)) / 86400000);
  if (Math.abs(days) <= 1) {
    // "today", "tomorrow", "yesterday" in the active language, capitalised.
    const s = rtfFor(getLocale()).format(days, 'day');
    return s.charAt(0).toLocaleUpperCase(getLocale()) + s.slice(1);
  }
  return d.toLocaleDateString(getLocale(), { weekday: 'long', month: 'short', day: 'numeric' });
}

export function timeOfDay(iso: string) {
  return new Date(iso).toLocaleTimeString(getLocale(), { hour: 'numeric', minute: '2-digit' });
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 5) return t('time.greeting.evening');
  if (h < 12) return t('time.greeting.morning');
  if (h < 18) return t('time.greeting.afternoon');
  return t('time.greeting.evening');
}

export function episodeCode(season?: number, episode?: number) {
  if (season === undefined && episode === undefined) return undefined;
  return `S${String(season ?? 0).padStart(2, '0')}E${String(episode ?? 0).padStart(2, '0')}`;
}
