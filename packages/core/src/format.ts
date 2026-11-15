// Formatters for numbers shown in mono with tabular figures (rule 3).
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** 48,213 */
export const formatInt = (n: number) => int.format(Math.round(n));

/** 1.2M · 950 · 12.4k */
export function formatCount(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${trim(n / 1e9)}B`;
  if (a >= 1e6) return `${trim(n / 1e6)}M`;
  if (a >= 1e4) return `${trim(n / 1e3)}k`;
  return formatInt(n);
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
  return `${i === 0 ? formatInt(v) : v.toFixed(1)} ${units[i]}`;
}

/** 1,204/s */
export const formatRate = (perSec: number) =>
  `${perSec >= 100 ? formatInt(perSec) : perSec.toFixed(1).replace(/\.0$/, '')}/s`;

/** 6m 12s · 45s · 2h 5m · 3d 4h */
export function formatDuration(ms: number): string {
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
  const s = Math.round((now - t) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 172800) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Offsets keep full precision with grouping: 21,861,950 */
export const formatOffset = (n: number | null) => (n === null ? '—' : formatInt(n));

/** 14:21 (24 h, UTC-free local display) */
export function formatClock(t: number | string): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 12.4% */
export const formatPct = (n: number, digits = 0) => `${n.toFixed(digits)}%`;

/** +4.2% / −3.1% (true minus sign) */
export function formatDelta(pct: number): string {
  const v = Math.abs(pct).toFixed(1);
  return pct >= 0 ? `+${v}%` : `−${v}%`;
}
