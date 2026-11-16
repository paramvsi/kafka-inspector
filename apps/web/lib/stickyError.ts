import { useRef } from 'react';

/**
 * A query's error that survives its own re-checks. React Query clears `error` (and `failureReason`) while a query
 * with no data refetches, so a not-found screen would drop out for the length of each re-check — remounting the
 * page under it (and, on a topic, restarting a live tail). Kept per key; forgotten once data arrives.
 */
export function useStickyError(q: { error: unknown; data: unknown }, key: string): unknown {
  const last = useRef<{ key: string; error: unknown } | undefined>(undefined);
  if (q.data !== undefined) last.current = undefined;
  else if (q.error) last.current = { key, error: q.error };
  return q.error ?? (last.current?.key === key ? last.current.error : undefined);
}
