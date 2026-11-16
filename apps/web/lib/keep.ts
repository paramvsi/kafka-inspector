/**
 * Keep showing the previous result while a query refetches under a new key — but only for the same entity.
 * Keys are [clusterId, kind, entity?, ...params]: a different topic, group or broker id (a string or number in
 * the entity slot) must not show the last one's data under the new name; a changed filter or range may.
 */
export function sameEntity(
  prev: readonly unknown[] | undefined,
  next: readonly unknown[],
): boolean {
  if (!prev || prev[0] !== next[0] || prev[1] !== next[1]) return false;
  const a = prev[2],
    b = next[2];
  const id = (v: unknown) => typeof v === 'string' || typeof v === 'number';
  return !(id(a) || id(b)) || a === b;
}
