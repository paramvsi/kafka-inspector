/** A "not found" (agent 404, or the simulator's "… not found.") will fail the same way every time. */
export const isNotFound = (e: unknown) =>
  (e as { status?: number } | null)?.status === 404 ||
  /not found\.?$/i.test((e as Error)?.message ?? '');

/**
 * Polling after a failure: a not-found with nothing to show stops, so its message stays put instead of
 * flickering with every refetch; any other failure (agent restarting, network blip) keeps polling and recovers.
 */
export function nextPoll<T extends number | false>(
  state: { status: string; data: unknown; error: unknown },
  refreshMs: T,
): T | false {
  return state.status === 'error' && state.data === undefined && isNotFound(state.error)
    ? false
    : refreshMs;
}
