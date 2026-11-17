import { expect, test } from 'vitest';
import { chartRows } from './TimeSeriesChart';

test('an outage (no samples for far longer than the usual spacing) breaks the line instead of joining it', () => {
  const pts: Array<[number, number]> = [0, 60, 120, 180].map((t) => [t * 1000, 5]);
  pts.push([7200_000, 9], [7260_000, 9]); // two hours with nothing stored, then samples again
  const rows = chartRows([{ key: 'lag', points: pts }]);
  const gap = rows.find((r) => r.t! > 180_000 && r.t! < 7200_000);
  expect(gap).toBeDefined();
  expect(gap!.lag).toBeNull();
});

test('two series sampled at slightly different times still draw continuous lines (no gap between them)', () => {
  const rows = chartRows([
    {
      key: 'a',
      points: [
        [0, 1],
        [60_000, 2],
        [120_000, 3],
      ],
    },
    {
      key: 'b',
      points: [
        [1_000, 1],
        [61_000, 2],
        [121_000, 3],
      ],
    },
  ]);
  for (const r of rows.slice(1, -1)) {
    expect(typeof r.a).toBe('number');
    expect(typeof r.b).toBe('number');
  }
});
