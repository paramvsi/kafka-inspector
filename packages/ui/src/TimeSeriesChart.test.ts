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

test('a sparse series (the lag forecast: now and the catch-up time) draws, a dense one beside it is unaffected', () => {
  const lag: Array<[number, number]> = [0, 5, 10, 15, 20].map((s) => [s * 1000, 100]);
  const rows = chartRows([
    { key: 'lag', points: lag },
    {
      key: 'forecast',
      points: [
        [20_000, 100],
        [3_620_000, 0],
      ],
    },
  ]);
  // no row between the two forecast points cuts it: every row from now to the end has a forecast value
  const after = rows.filter((r) => r.t! >= 20_000);
  expect(after.every((r) => typeof r.forecast === 'number')).toBe(true);
});

test('one series’ outage breaks its line even while another series has samples in it', () => {
  const steady: Array<[number, number]> = Array.from({ length: 40 }, (_, i) => [i * 60_000, 1]);
  const a: Array<[number, number]> = [0, 1, 2, 3, 36, 37, 38].map((m) => [m * 60_000, 5]);
  const rows = chartRows([
    { key: 'a', points: a },
    { key: 'b', points: steady },
  ]);
  const inside = rows.filter((r) => r.t! > 3 * 60_000 && r.t! < 36 * 60_000);
  expect(inside.some((r) => r.a === null)).toBe(true); // a's line breaks across its 33 unmeasured minutes
  expect(inside.every((r) => typeof r.b === 'number')).toBe(true); // b's doesn't
});
