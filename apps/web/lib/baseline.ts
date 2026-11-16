/** A history point is a "1 h ago" baseline only if it is about an hour old (right after start it's minutes old). */
export const BASELINE_MIN_AGE_MS = 50 * 60_000;

export const hourAgoValue = (p?: [number, number], now = Date.now()) =>
  p && p[0] <= now - BASELINE_MIN_AGE_MS ? p[1] : undefined;

/** Muted until a time still in the future. */
export const isMuted = (a: { mutedUntil?: string }, now = Date.now()) =>
  !!a.mutedUntil && Date.parse(a.mutedUntil) > now;
