import { expect, test } from 'vitest';
import { partitionLagText } from './status';

test('a partition the group never committed to has unknown lag, not 0 (it would read as caught up)', () => {
  expect(partitionLagText({ committedOffset: null, lag: 0 })).toBe('—');
  expect(partitionLagText({ committedOffset: 900, lag: 1234 })).toBe('1,234');
  expect(partitionLagText({ committedOffset: 5, lag: 0 })).toBe('0');
});
