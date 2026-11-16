import { expect, test } from 'vitest';
import { hourAgoValue, isMuted } from './baseline';

test('a baseline must be about an hour old; mutes end at their time', () => {
  const now = 10 * 3_600_000;
  expect(hourAgoValue([now - 3_600_000, 5], now)).toBe(5);
  expect(hourAgoValue([now - 20 * 60_000, 5], now)).toBeUndefined();
  expect(isMuted({ mutedUntil: new Date(now + 1000).toISOString() }, now)).toBe(true);
  expect(isMuted({ mutedUntil: new Date(now - 1000).toISOString() }, now)).toBe(false);
  expect(isMuted({}, now)).toBe(false);
});
