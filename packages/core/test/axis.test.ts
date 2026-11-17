import { expect, test } from 'vitest';
import { formatCount } from '../src/format';

// the y-axis formatter of the Overview, TopicDetail, Alerts and GroupDetail charts; the old
// `Math.round(v / 1000)k` labelled 1,500 and 2,000 both "2k" and 1e12 as "1000000000k"
test('every y tick has its own label, and huge values stay short', () => {
  const ticks = [0, 500, 1000, 1500, 2000];
  expect(new Set(ticks.map(formatCount)).size).toBe(ticks.length);
  expect(formatCount(1e12).length).toBeLessThanOrEqual(7);
});
