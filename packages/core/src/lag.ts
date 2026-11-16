// Lag evaluation and catch-up forecast (docs/ARCHITECTURE.md "Lag evaluation"). Shared by the simulator,
// the web app and — ported to Java — the agent; test/lag-vectors.json is run by both (rule 9).
import type { Forecast, GroupState, LagStatus } from './types';

export interface LagSample {
  /** epoch ms */
  t: number;
  committed: number | null;
  end: number;
}

export interface LagWindow {
  samples: LagSample[];
  /** epoch ms of the latest commit by the group for this partition (even if the offset did not move) */
  lastCommitAt?: number | null;
  /** epoch ms */
  now: number;
  /** window duration in ms (demo 10 s, agent 5 min) */
  windowMs: number;
}

const lagOf = (s: LagSample) => (s.committed === null ? null : Math.max(0, s.end - s.committed));

/** Least-squares slope of lag over time (lag per ms). */
function slope(points: Array<[number, number]>): number {
  const n = points.length;
  if (n < 2) return 0;
  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0;
  for (const [x, y] of points) {
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const d = n * sxx - sx * sx;
  return d === 0 ? 0 : (n * sxy - sx * sy) / d;
}

export function evaluateLag(w: LagWindow): LagStatus {
  const known = w.samples.filter((s) => s.committed !== null);
  // 1. No samples, or committed always null → unknown.
  if (known.length === 0) return 'unknown';

  const first = known[0]!;
  const last = known[known.length - 1]!;
  const lags = known.map((s) => lagOf(s)!);
  const firstLag = lags[0]!;
  const lastLag = lags[lags.length - 1]!;
  const commitAge = w.lastCommitAt == null ? Infinity : w.now - w.lastCommitAt;

  // 2. No commit within the window while behind → stopped.
  if (commitAge > w.windowMs && lastLag > 0) return 'stopped';

  // 3. Committed offset frozen across the whole window, behind, but commits still arriving → stalled.
  if (
    known.length > 1 &&
    known.every((s) => s.committed === first.committed) &&
    lastLag > 0 &&
    commitAge <= w.windowMs
  ) {
    return 'stalled';
  }

  // 4. Caught up at some point, or lag shrinking → healthy.
  if (lags.some((l) => l === 0) || lastLag < firstLag) return 'healthy';

  // 5. Consuming but lag growing → warn.
  const advanced = last.committed! > first.committed!;
  let strictlyIncreasing = lags.length > 1;
  for (let i = 1; i < lags.length; i++) if (lags[i]! <= lags[i - 1]!) strictlyIncreasing = false;
  const netUpWithSlope =
    lastLag > firstLag && slope(known.map((s, i) => [s.t - first.t, lags[i]!])) > 0;
  if (advanced && (strictlyIncreasing || netUpWithSlope)) return 'warn';

  // 6. Otherwise healthy.
  return 'healthy';
}

const SEVERITY: LagStatus[] = ['stopped', 'stalled', 'warn', 'healthy'];

/** A group event is raised when a group turns stalled or stopped — not when it moves between the two (recovery). */
export function becameStuck(prev: LagStatus | undefined, next: LagStatus): boolean {
  const stuck = (s: LagStatus | undefined) => s === 'stalled' || s === 'stopped';
  return prev !== undefined && stuck(next) && !stuck(prev);
}

/** Group roll-up: worst partition wins; partitions with unknown status are ignored unless all are unknown. */
export function rollupStatus(statuses: LagStatus[]): LagStatus {
  for (const s of SEVERITY) if (statuses.includes(s)) return s;
  return 'unknown';
}

/** Group states shown with the neutral badge instead of a lag status. */
export function isNeutralState(state: GroupState): boolean {
  return (
    state === 'Empty' ||
    state === 'PreparingRebalance' ||
    state === 'CompletingRebalance' ||
    state === 'Assigning' ||
    state === 'Reconciling' ||
    state === 'Dead'
  );
}

/** Catch-up forecast over the same window. Rates are per second. */
export function forecast(samples: LagSample[]): Forecast {
  const known = samples.filter((s) => s.committed !== null);
  if (known.length === 0) return { kind: 'unknown' };
  const first = known[0]!;
  const last = known[known.length - 1]!;
  const lag = lagOf(last)!;
  const dt = (last.t - first.t) / 1000;
  // rates are kept for caught-up partitions too, so a group's totals include every partition
  if (lag === 0)
    return dt > 0
      ? {
          kind: 'caught-up',
          consumeRate: Math.max(0, last.committed! - first.committed!) / dt,
          produceRate: Math.max(0, last.end - first.end) / dt,
        }
      : { kind: 'caught-up' };
  if (dt <= 0) return { kind: 'unknown' };
  const consumeRate = Math.max(0, last.committed! - first.committed!) / dt;
  const produceRate = Math.max(0, last.end - first.end) / dt;
  if (consumeRate > produceRate) {
    return { kind: 'eta', seconds: lag / (consumeRate - produceRate), consumeRate, produceRate };
  }
  return { kind: 'never', consumeRate, produceRate };
}

/** Group forecast: rates are summed for display, the ETA is the slowest partition's (a group is caught up when its last partition is); a partition that is `never` with lag > 0 makes the group `never`; `unknown` partitions are ignored. */
export function combineForecasts(parts: Array<{ lag: number; forecast: Forecast }>): Forecast {
  const known = parts.filter((p) => p.forecast.kind !== 'unknown');
  if (known.length === 0) return { kind: 'unknown' };
  const lag = known.reduce((a, p) => a + p.lag, 0);
  const consumeRate = known.reduce((a, p) => a + (p.forecast.consumeRate ?? 0), 0);
  const produceRate = known.reduce((a, p) => a + (p.forecast.produceRate ?? 0), 0);
  if (lag === 0) return { kind: 'caught-up', consumeRate, produceRate };
  if (known.some((p) => p.forecast.kind === 'never' && p.lag > 0))
    return { kind: 'never', consumeRate, produceRate };
  // The group catches up when its slowest partition does.
  const seconds = Math.max(...known.map((p) => p.forecast.seconds ?? 0));
  return { kind: 'eta', seconds, consumeRate, produceRate };
}

/** "under a minute" · "~14 min" · "~3 h" (ARCHITECTURE "Forecast" format). */
export function formatEta(seconds: number): string {
  if (seconds < 60) return 'under a minute';
  const min = Math.round(seconds / 60);
  if (min < 120) return `~${min} min`;
  return `~${Math.round(seconds / 3600)} h`;
}

export function formatForecast(f: Forecast): string {
  switch (f.kind) {
    case 'caught-up':
      return 'Caught up';
    case 'eta':
      return formatEta(f.seconds ?? 0);
    case 'never':
      return "Won't catch up";
    default:
      return '—';
  }
}
