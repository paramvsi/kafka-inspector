'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from './cx';

export type BadgeStatus = 'healthy' | 'warn' | 'stalled' | 'stopped' | 'neutral' | 'info';
const LABEL: Record<BadgeStatus, string> = {
  healthy: 'Healthy',
  warn: 'Warn',
  stalled: 'Stalled',
  stopped: 'Stopped',
  neutral: 'Unknown',
  info: 'Info',
};
const TONE: Record<BadgeStatus, string> = {
  healthy: 'bg-ok-soft text-ok-text',
  warn: 'bg-warn-soft text-warn-text',
  stalled: 'bg-crit-soft text-crit-text',
  stopped: 'bg-crit-soft text-crit-text',
  neutral: 'bg-surface-hover text-ink-muted',
  info: 'bg-copper-soft text-copper-strong',
};
const BAD = new Set<BadgeStatus>(['warn', 'stalled', 'stopped']);

/** Status word + colour (never colour alone). Pulses once when it turns Warn/Stalled/Stopped (MOTION.md). */
export function StatusBadge({
  status,
  children,
  dot = true,
  className,
}: {
  status: BadgeStatus;
  children?: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  const prev = useRef(status);
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    // one pulse when it turns bad, and one when it recovers to Healthy (MOTION.md)
    if (
      prev.current !== status &&
      (BAD.has(status) || (status === 'healthy' && BAD.has(prev.current)))
    )
      setPulse((n) => n + 1);
    prev.current = status;
  }, [status]);
  return (
    <span
      className={cx(
        'relative inline-flex h-[22px] items-center gap-[6px] whitespace-nowrap rounded-sm px-2 text-[12px] font-medium transition-colors duration-fast ease-standard',
        TONE[status],
        className,
      )}
    >
      {dot && <span aria-hidden="true" className="size-[6px] shrink-0 rounded-full bg-current" />}
      {children ?? LABEL[status]}
      {pulse > 0 && (
        <span
          key={pulse}
          aria-hidden="true"
          className="ki-pulse-ring pointer-events-none absolute inset-0 rounded-sm"
        />
      )}
    </span>
  );
}
