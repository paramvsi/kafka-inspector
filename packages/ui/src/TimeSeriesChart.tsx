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
    }
  }, [series]);
  // its own effect: a live tick during the first draw must not cancel the switch-off
  useEffect(() => {
    if (!animate) return;
    const t = setTimeout(() => setAnimate(false), tokenMs('--dur-slow') + 50);
    return () => clearTimeout(t);
  }, [animate]);

  const rows = useMemo(() => chartRows(series), [series]);
  const duration = tokenMs('--dur-slow');
  const tMin = rows[0]?.t ?? 0,
    tMax = rows.at(-1)?.t ?? 0;

  return (
    <figure className="m-0" aria-label={label}>
      <div style={{ height }} className="font-mono text-[10px] text-ink-muted">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 32, bottom: 0, left: 0 }}>
            {/* right: half a date label */}
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
              // not "preserveEnd" (the default): a dated last label ("17 Nov 00:50") pinned to the edge runs past it
              interval="preserveStart"
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
                  dot={s.points.length === 1 ? { r: 3, fill: `var(--${s.color})` } : false} // one point has no line to draw
                  connectNulls={false} // chartRows fills alignment holes and leaves real gaps empty
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
                  dot={s.points.length === 1 ? { r: 3, fill: `var(--${s.color})` } : false} // one point has no line to draw
                  connectNulls={false} // chartRows fills alignment holes and leaves real gaps empty
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
                  // near the right edge the label goes to the line's left, so it isn't cut off
                  position: m.t > tMin + 0.8 * (tMax - tMin) ? 'insideTopRight' : 'insideTopLeft',
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

/**
 * The chart's rows: one per timestamp, every series' value at it. Time with no samples for far longer than the usual
 * spacing (the agent was down, the cluster unreachable) gets an empty row, so the line breaks there instead of
 * joining across data nobody measured (rule 7). A series missing only because another series has a point at that
 * time takes the straight line between its neighbours — what Recharts' connectNulls drew before, minus the gaps.
 */
export function chartRows(
  series: { key: string; points: Array<[number, number]> }[],
): Array<Record<string, number | null>> {
  const byT = new Map<number, Record<string, number | null>>();
  for (const s of series)
    for (const [t, v] of s.points) byT.set(t, { ...(byT.get(t) ?? { t }), [s.key]: v });
  const rows = [...byT.values()].sort((a, b) => a.t! - b.t!);
  // the usual spacing: the median step of the longest series (a merged timeline of offset series has tiny steps)
  const longest = series.reduce<[number, number][]>(
    (m, s) => (s.points.length > m.length ? s.points : m),
    [],
  );
  const steps = longest
    .slice(1)
    .map(([t], i) => t - longest[i]![0])
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  const step = steps[Math.floor(steps.length / 2)];
  const out: Array<Record<string, number | null>> = [];
  for (const r of rows) {
    const prev = out.at(-1);
    if (step && prev && r.t! - prev.t! > 3 * step)
      out.push({ t: prev.t! + step, ...Object.fromEntries(series.map((s) => [s.key, null])) });
    out.push(r);
  }
  // alignment holes: between two values of the same series with no gap row in between
  for (const s of series) {
    let last = -1;
    for (let i = 0; i < out.length; i++) {
      const v = out[i]![s.key];
      if (v === null) last = -1;
      else if (typeof v === 'number') {
        if (last >= 0 && i - last > 1) {
          const [t0, v0, t1] = [out[last]!.t!, out[last]![s.key] as number, out[i]!.t!];
          for (let j = last + 1; j < i; j++)
            out[j]![s.key] = v0 + ((v - v0) * (out[j]!.t! - t0)) / (t1 - t0 || 1);
        }
        last = i;
      }
    }
  }
  return out;
}
