import { cx } from './cx';

export type SparkTone = 'ok' | 'warn' | 'crit' | 'chart-1' | 'chart-2' | 'muted';
const STROKE: Record<SparkTone, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  crit: 'var(--crit)',
  'chart-1': 'var(--chart-1)',
  'chart-2': 'var(--chart-2)',
  muted: 'var(--ink-muted)',
};

/** Never animates (MOTION.md). Decorative unless `label` is given. */
export function Sparkline({
  points,
  tone = 'chart-1',
  width = 90,
  height = 18,
  label,
  className,
}: {
  points: number[];
  tone?: SparkTone;
  width?: number;
  height?: number;
  label?: string;
  className?: string;
}) {
  if (points.length < 2)
    return <svg width={width} height={height} aria-hidden="true" className={className} />;
  const min = Math.min(...points),
    max = Math.max(...points),
    span = max - min || 1;
  const step = width / (points.length - 1);
  const d = points
    .map(
      (v, i) =>
        `${(i * step).toFixed(1)},${(max === min ? height / 2 : height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`,
    )
    .join(' ');
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cx('block overflow-visible', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <polyline
        points={d}
        fill="none"
        stroke={STROKE[tone]}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
