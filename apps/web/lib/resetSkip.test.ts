import { expect, test } from 'vitest';
import { resetSkipLabel } from './status';

test('a skipped reset row says why: a leaderless partition was selected, it just can’t be reset', () => {
  expect(resetSkipLabel('Already at that offset')).toBe('no change');
  expect(resetSkipLabel('Not selected')).toBe('not selected');
  expect(resetSkipLabel('No leader: its brokers are down. Bring one back, then reset.')).toBe(
    'no leader',
  );
  expect(resetSkipLabel('Something new the agent says')).toBe('Something new the agent says');
});
