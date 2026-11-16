/** The diff pair from a link: only versions the subject has (a registry can have gaps after a delete). */
export function pickVersions(
  have: number[],
  toParam?: string,
  fromParam?: string,
): [number, number] {
  const latest = Math.max(...have);
  const ok = (v: string | undefined, fallback: number) =>
    have.includes(Number(v)) ? Number(v) : fallback;
  const to = ok(toParam, latest);
  const prev = Math.max(...have.filter((v) => v < to), 0) || to;
  const from = ok(fromParam, prev);
  return [from <= to ? from : prev, to]; // a reversed pair (from after to) falls back
}
