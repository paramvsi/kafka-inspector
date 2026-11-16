// Formatters for numbers shown in mono with tabular figures (rule 3).
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** 48,213 */
export const formatInt = (n: number) => int.format(Math.round(n) || 0); // || 0: never "-0" or "NaN"

/** 1.2M · 950 · 12.4k */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (Math.round(a) < 1e4) return formatInt(n);
  const steps: Array<[number, string]> = [
    [1e3, 'k'],
    [1e6, 'M'],
    [1e9, 'B'],
  ];
  let k = 0;
  while (k < steps.length - 1 && a >= steps[k + 1]![0]) k++;
  // decide on the rounded value: 999,999 is "1M", not "1000k"
  if (k < steps.length - 1 && Math.abs(Number(trim(n / steps[k]![0]))) >= 1000) k++;
  return `${trim(n / steps[k]![0])}${steps[k]![1]}`;
}
const trim = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1).replace(/\.0$/, ''));

/** 61.4 MB (decimal units, like Kafka tooling). */
export function formatBytes(n: number): string {
  const units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'];
  let v = n;
  let i = 0;
  while (Math.abs(v) >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  // 999,999 B rounds to 1,000 kB (and 999.6 B to 1,000 B): promote to the next unit
  if (i < units.length - 1 && Math.round(Math.abs(v)) >= 1000) {
    v /= 1000;
    i++;
  }
  return `${i === 0 || Math.abs(v) >= 100 ? formatInt(v) : v.toFixed(1).replace(/\.0$/, '')} ${units[i]}`;
}

/** 1,204/s · 4.2/s · <0.1/s (a real trickle never reads as zero) */
export const formatRate = (perSec: number) =>
  !Number.isFinite(perSec)
    ? '—'
    : perSec > 0 && perSec < 0.05
      ? '<0.1/s'
      : `${perSec >= 100 ? formatInt(perSec) : perSec.toFixed(1).replace(/\.0$/, '')}/s`;

/** 6m 12s · 45s · 2h 5m · 3d 4h */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** "12s ago" · "6m ago" · "3h ago" · "2d ago" · "just now" */
export function formatRelative(iso: string | number | undefined, now = Date.now()): string {
  if (iso === undefined) return '—';
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const s = Math.round((now - t) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 172800) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** 14:21 (24 h, UTC-free local display) */
export function formatClock(t: number | string): string {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// fixed English names, not toLocaleDateString: core stays locale-free (newer ICU prints en-GB September as "Sept")
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 14:05 today · 19 Nov 14:05 otherwise (a forecast two days out mustn't read as today) */
export function formatWhen(t: number, now = Date.now()): string {
  const d = new Date(t),
    n = new Date(now);
  if (Number.isNaN(d.getTime())) return '—';
  const today = d.toDateString() === n.toDateString();
  return today ? formatClock(t) : `${d.getDate()} ${MONTHS[d.getMonth()]} ${formatClock(t)}`;
}

/** 2026-11-16 06:00:01.234 in local time (message timestamps; the table shows the time part) */
export function formatTimestamp(t: number | string): string {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Value for <input type="datetime-local">: local wall-clock time, minutes precision ("" for invalid input). */
export function toLocalInput(t: number | string): string {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 12.4% */
export const formatPct = (n: number, digits = 0) => `${n.toFixed(digits)}%`;

/** +4.2% / −3.1% (true minus sign) */
export function formatDelta(pct: number): string {
  if (!Number.isFinite(pct)) return '—';
  const v = Math.abs(pct).toFixed(1);
  if (v === '0.0') return '0.0%'; // no sign on a zero that rounding produced
  return pct > 0 ? `+${v}%` : `−${v}%`;
}

/** Kafka's topic-name rule: letters, digits, ".", "_", "-", at most 249 characters, and not "." or "..". */
export const TOPIC_NAME = /^(?!\.\.?$)[a-zA-Z0-9._-]{1,249}$/;

// bidi overrides/isolates, zero-width and other invisible format characters, and C0/C1 controls
const INVISIBLE = new RegExp(
  // eslint-disable-next-line no-control-regex -- matching control characters is the point: they're made visible
  '[\\u0000-\\u001f\\u007f-\\u009f\\u00ad\\u061c\\u180e\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff]',
  'g',
);

/**
 * A cluster-supplied name (group id, client id, host, alert title) as shown: invisible and direction-changing
 * characters become visible escapes, so "pay‮ements" can't display as another name and two ids that differ
 * only by a zero-width space don't look identical. Display only — links and API calls keep the raw value.
 */
export const shownName = (s: string): string =>
  s.replace(
    INVISIBLE,
    (c) => `\\u{${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}}`,
  );

/** "1 partition" · "3 partitions" */
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
