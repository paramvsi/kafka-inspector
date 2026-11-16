import { expect, test } from 'vitest';
import { axisTime } from './axis';

test('24h and 7d chart axes carry the date; shorter ranges only the time', () => {
  const t = Date.UTC(2026, 10, 14, 9, 5);
  expect(axisTime('7d')(t)).toMatch(/\d+ Nov \d\d:\d\d/);
  expect(axisTime('1h')(t)).toMatch(/^\d\d:\d\d$/);
});
