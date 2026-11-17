// Lag status / group state → badge (status word always shown; neutral states use the neutral badge).
import type { GroupState, LagStatus } from '@ki/core';
import type { BadgeStatus, SparkTone } from '@ki/ui';

export function groupBadge(
  status: LagStatus,
  state: GroupState,
): { status: BadgeStatus; label: string } {
  if (
    state === 'PreparingRebalance' ||
    state === 'CompletingRebalance' ||
    state === 'Assigning' ||
    state === 'Reconciling'
  )
    return { status: 'neutral', label: 'Rebalancing' };
  if (state === 'Empty' && (status === 'healthy' || status === 'unknown'))
    return { status: 'neutral', label: 'Empty' };
  if (state === 'Dead') return { status: 'neutral', label: 'Dead' };
  if (status === 'unknown') return { status: 'neutral', label: 'Unknown' };
  return {
    status,
    label:
      status === 'healthy'
        ? 'Healthy'
        : status === 'warn'
          ? 'Warn'
          : status === 'stalled'
            ? 'Stalled'
            : 'Stopped',
  };
}

export function sparkTone(status: LagStatus): SparkTone {
  return status === 'warn'
    ? 'warn'
    : status === 'stalled' || status === 'stopped'
      ? 'crit'
      : status === 'healthy'
        ? 'ok'
        : 'muted';
}

export const READ_ONLY_HINT = 'Read-only in this version. Writes to real clusters arrive in v2.';

/** Groups the "Healthy" card counts: those whose row badge says healthy — an Empty or Rebalancing group isn't. */
export function healthyGroups(gs: { status: LagStatus; state: GroupState }[]): number {
  return gs.filter((g) => groupBadge(g.status, g.state).status === 'healthy').length;
}

/** The Total lag card's tone: a stalled or stopped group with lag is never green, whatever the trend says. */
export function totalLagTone(status: string, totalLag: number, rising: boolean): 'ok' | 'warn' {
  if (totalLag === 0) return 'ok';
  return rising || status === 'stalled' || status === 'stopped' ? 'warn' : 'ok';
}
