/** Start of the current rise: the last run that never falls, minus its flat start. Flat → undefined. */
export function sinceRising(points: Array<[number, number]>): number | undefined {
  if (points.length < 3) return undefined;
  let i = points.length - 1;
  while (i > 0 && points[i - 1]![1] <= points[i]![1]) i--;
  while (i < points.length - 1 && points[i + 1]![1] === points[i]![1]) i++;
  return i < points.length - 1 ? points[i]![0] : undefined;
}
