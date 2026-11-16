import { expect, test } from 'vitest';
import { nextPoll } from './poll';

test('only a not-found with no data stops polling; transient failures keep polling', () => {
  const err = (error: unknown) => ({ status: 'error', data: undefined, error });
  expect(nextPoll(err(new Error('Topic nope not found.')), 1000)).toBe(false);
  expect(nextPoll(err(Object.assign(new Error('x'), { status: 404 })), 1000)).toBe(false);
  expect(
    nextPoll(err(Object.assign(new Error('The agent answered 502.'), { status: 502 })), 1000),
  ).toBe(1000);
  expect(nextPoll(err(new TypeError('Failed to fetch')), 1000)).toBe(1000);
  expect(
    nextPoll({ status: 'error', data: [1], error: new Error('Topic x not found.') }, 1000),
  ).toBe(1000);
});
