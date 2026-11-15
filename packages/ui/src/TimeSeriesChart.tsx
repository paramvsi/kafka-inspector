'use client';
// Time series per DESIGN_SYSTEM "Data visualisation" and MOTION.md "Charts": first draw only reveals,
// ticks never animate, crosshair follows the pointer with no easing. Colours are tokens.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export type SeriesColor = 'chart-1' | 'chart-2' | 'chart-3' | 'ok' | 'warn' | 'crit';
export interface ChartSeries {
  key: string;
  label: string;
  points: Array<[number, number]>;
  color: SeriesColor;
  dashed?: boolean;
  area?: boolean;
}

export interface TimeSeriesChartProps {
  series: ChartSeries[];
  height?: number;
  yFormat?: (v: number) => string;
  xFormat?: (t: number) => string;
  /** vertical marker lines, e.g. "now" */
  markers?: Array<{ t: number; label: string }>;
  peak?: { t: number; v: number };
  label: string;
}

function tokenMs(name: string): number {
  if (typeof window === 'undefined') return 0;
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
}

function reducedMotion(): boolean {
  if (typeof window === 'undefined') return true;
  const m = document.documentElement.dataset.motion;
  return m ? m === 'reduced' : matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const clock = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function TimeSeriesChart({
  series,
  height = 200,
  yFormat = (v) => String(Math.round(v)),
  xFormat = clock,
  markers = [],
  peak,
  label,
}: TimeSeriesChartProps) {
  // Animate the first draw only; afterwards new points just append.
  const [animate, setAnimate] = useState(false);
  const drawn = useRef(false);
  useEffect(() => {
    if (!drawn.current && series.some((s) => s.points.length > 1)) {
      drawn.current = true;
      setAnimate(!reducedMotion());
      const t = setTimeout(() => setAnimate(false), tokenMs('--dur-slow') + 50);
      return () => clearTimeout(t);
    }
  }, [series]);

  const rows = useMemo(() => {
    const byT = new Map<number, Record<string, number>>();
    for (const s of series)
      for (const [t, v] of s.points) byT.set(t, { ...(byT.get(t) ?? { t }), [s.key]: v });
    return [...byT.values()].sort((a, b) => a.t! - b.t!);
  }, [series]);
  const duration = tokenMs('--dur-slow');

  return (
    <figure className="m-0" aria-label={label}>
      <div style={{ height }} className="font-mono text-[10px] text-ink-muted">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              {series
                .filter((s) => s.area)
                .map((s) => (
                  <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={`var(--${s.color})`} stopOpacity={0.14} />
                    <stop offset="100%" stopColor={`var(--${s.color})`} stopOpacity={0.12} />
                  </linearGradient>
                ))}
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line-subtle)" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={xFormat}
              stroke="var(--line-strong)"
              tick={{ fill: 'var(--ink-muted)', fontSize: 10 }}
              tickLine={false}
              minTickGap={48}
            />
            <YAxis
              tickFormatter={yFormat}
              stroke="transparent"
              tick={{ fill: 'var(--ink-muted)', fontSize: 10 }}
              width={44}
              tickLine={false}
            />
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: 'var(--line-strong)' }}
              contentStyle={{
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 8,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
              }}
              labelStyle={{ color: 'var(--ink-muted)' }}
              labelFormatter={(t) => xFormat(Number(t))}
              formatter={(v, name) => [
                yFormat(Number(v)),
                series.find((s) => s.key === name)?.label ?? String(name),
              ]}
            />
            {series.map((s) =>
              s.area ? (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stroke={`var(--${s.color})`}
                  strokeWidth={2}
                  fill={`url(#fill-${s.key})`}
                  strokeDasharray={s.dashed ? '5 5' : undefined}
                  dot={false}
                  connectNulls
                  isAnimationActive={animate}
                  animationDuration={duration}
                />
              ) : (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stroke={`var(--${s.color})`}
                  strokeWidth={2}
                  strokeDasharray={s.dashed ? '5 5' : undefined}
                  dot={false}
                  connectNulls
                  isAnimationActive={animate}
                  animationDuration={duration}
                />
              ),
            )}
            {markers.map((m) => (
              <ReferenceLine
                key={`${m.label}-${m.t}`}
                x={m.t}
                stroke="var(--line-strong)"
                strokeDasharray="2 3"
                label={{
                  value: m.label,
                  position: 'insideTopLeft',
                  fill: 'var(--ink-muted)',
                  fontSize: 9,
                }}
              />
            ))}
            {peak && (
              <ReferenceDot
                x={peak.t}
                y={peak.v}
                r={3}
                fill="var(--chart-1)"
                stroke="var(--surface)"
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {/* Screen-reader fallback (WCAG): latest value per series */}
      <figcaption className="sr-only">
        {label}:{' '}
        {series
          .map((s) => `${s.label} ${s.points.length ? yFormat(s.points.at(-1)![1]) : 'no data'}`)
          .join(', ')}
      </figcaption>
    </figure>
  );
}
