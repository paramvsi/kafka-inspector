/** A "not found" (agent 404, or the simulator's "… not found.") will fail the same way every time. */
const isNotFound = (e: unknown) =>
  (e as { status?: number } | null)?.status === 404 ||
  /not found\.?$/i.test((e as Error)?.message ?? '');

/** How often a not-found is re-checked: a topic created a moment ago appears after the agent's next sample. */
export const NOT_FOUND_RECHECK_MS = 10_000;

/**
 * Polling after a failure: a not-found with nothing to show re-checks slowly (it may exist soon — a link to a
 * topic created seconds ago), any other failure (agent restarting, network blip) keeps the normal rate.
 */
export function nextPoll(
  state: { status: string; data: unknown; error: unknown },
  refreshMs: number | false,
): number | false {
  if (refreshMs === false) return false;
  return state.status === 'error' && state.data === undefined && isNotFound(state.error)
    ? Math.max(refreshMs, NOT_FOUND_RECHECK_MS)
    : refreshMs;
}
