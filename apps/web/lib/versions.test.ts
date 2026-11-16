import { expect, test } from 'vitest';
import { pickVersions } from './versions';

test('diff pair skips versions the subject lacks and ignores junk params', () => {
  expect(pickVersions([1, 3])).toEqual([1, 3]);
  expect(pickVersions([1, 2, 3], 'abc', '99')).toEqual([2, 3]);
  expect(pickVersions([1, 3], '3', '2')).toEqual([1, 3]);
  expect(pickVersions([4])).toEqual([4, 4]);
});

test('a reversed pair falls back to the version before "to"', () => {
  expect(pickVersions([1, 2, 3, 4], '2', '4')).toEqual([1, 2]);
});
