'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from './cx';

export type Tone = 'ok' | 'warn' | 'crit' | 'neutral';
// Text uses the -text tokens (AA contrast on surface in both themes); dots and lines use the base tokens.
const TONE: Record<Tone, string> = {
  ok: 'text-ok-text',
  warn: 'text-warn-text',
  crit: 'text-crit-text',
  neutral: 'text-ink-muted',
};

/**
 * Value-changed flash (MOTION.md "Live data"): instant swap, then a copper tint fades out when the value moved
 * more than `threshold` (10%) since the last tick. At most one flash per 5 s.
 */
export function useValueFlash(value: number | undefined, threshold = 0.1): number {
  const last = useRef(value);
  const lastFlash = useRef(0);
  const [n, setN] = useState(0);
  useEffect(() => {
    const prev = last.current;
    last.current = value;
    if (prev === undefined || value === undefined) return;
    const moved = Math.abs(value - prev) / Math.max(Math.abs(prev), 1);
    const now = Date.now();
    if (moved > threshold && now - lastFlash.current > 5000) {
      lastFlash.current = now;
      setN((x) => x + 1);
    }
  }, [value, threshold]);
  return n;
}

export function KpiCard({
  label,
  value,
  numeric,
  delta,
  deltaTone = 'neutral',
  loading,
  stale,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  numeric?: number;
  delta?: ReactNode;
  deltaTone?: Tone;
  loading?: boolean;
  stale?: boolean;
  className?: string;
}) {
  const flash = useValueFlash(numeric);
  return (
    <div
      className={cx(
        'relative min-w-0 overflow-hidden rounded-lg border border-line bg-surface p-4',
        className,
      )}
    >
      {flash > 0 && (
        <span
          key={flash}
          aria-hidden="true"
          className="ki-flash pointer-events-none absolute inset-0"
        />
      )}
      <div className="relative text-[13px] text-ink-muted">{label}</div>
      <div
        className={cx(
          'relative mt-2 flex items-baseline gap-2 transition-opacity duration-base ease-standard',
          stale && 'opacity-50',
        )}
      >
        {loading ? (
          <span className="ki-skeleton block h-7 w-28 rounded-sm" />
        ) : (
          <>
            <span className="font-mono text-[22px] font-medium leading-7 tabular-nums">
              {value}
            </span>
            {delta && <span className={cx('text-[12px]', TONE[deltaTone])}>{delta}</span>}
            {stale && <span className="text-[12px] text-ink-muted">stale</span>}
          </>
        )}
      </div>
    </div>
  );
}
