import { expect, test } from 'vitest';
import { History } from '../src/history';

test('old chart points keep their values as the window slides (epoch-anchored buckets, like the agent)', () => {
  const h = new History();
  const span = 24 * 3600_000;
  let t = 1_700_000_000_000;
  for (let i = 0; i < 1440 * 2; i++) h.push((t += 60_000), new Map([['k', i % 7]]));
  const before = new Map(h.series('k', t - span));
  h.push((t += 60_000), new Map([['k', 3]]));
  const after = h.series('k', t - span);
  // every bucket that was complete before and still is must be unchanged
  const shared = after.slice(1, -1).filter(([ts]) => before.has(ts));
  expect(shared.length).toBeGreaterThan(100);
  for (const [ts, v] of shared) expect(v).toBe(before.get(ts));
});
