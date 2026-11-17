import { expect, test } from 'vitest';
import { scan } from './filterScan';

test('a filter that throws on some messages skips them and still returns the matches', () => {
  const msgs = [
    { offset: 1, value: { a: { b: 5 } } },
    { offset: 2, value: {} },
    { offset: 3, value: { a: { b: 9 } } },
  ];
  // value.a.b > 4, with a missing on offset 2
  const r = scan((m) => (m.value as { a: { b: number } }).a.b > 4, msgs, 1000);
  expect(r.matches).toEqual([0, 2]);
  expect('error' in r).toBe(false); // not a failed run: the screen must show the two matches
  expect(r.skipped).toBe(1);
  expect(r.skipError).toMatch(/^Offset 2: /);
});
