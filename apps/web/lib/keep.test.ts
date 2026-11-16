import { expect, test } from 'vitest';
import { sameEntity } from './keep';

test('previous data is kept for the same entity only', () => {
  expect(sameEntity(['local', 'topic', 'orders'], ['local', 'topic', 'payments'])).toBe(false);
  expect(sameEntity(['local', 'broker-config', 1], ['local', 'broker-config', 2])).toBe(false);
  expect(
    sameEntity(['local', 'group-history', 'g', '1h'], ['local', 'group-history', 'g', '24h']),
  ).toBe(true);
  expect(sameEntity(['local', 'topics', { q: 'a' }], ['local', 'topics', { q: 'ab' }])).toBe(true);
  expect(sameEntity(['a', 'topic', 'orders'], ['b', 'topic', 'orders'])).toBe(false);
  expect(sameEntity(undefined, ['local', 'topic', 'orders'])).toBe(false);
});
