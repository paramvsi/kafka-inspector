import { expect, test } from 'vitest';
import { sinceRising } from './trend';

test('sinceRising: flat is not rising; a rise starts where the flat run ends', () => {
  expect(
    sinceRising([
      [1, 200],
      [2, 200],
      [3, 200],
      [4, 200],
    ]),
  ).toBeUndefined();
  expect(
    sinceRising([
      [1, 0],
      [2, 0],
      [3, 50],
      [4, 90],
    ]),
  ).toBe(2);
  expect(
    sinceRising([
      [1, 90],
      [2, 10],
      [3, 20],
      [4, 30],
    ]),
  ).toBe(2);
  // rising from the first point: the rise began before the window, so no "since"
  expect(
    sinceRising([
      [1, 0],
      [2, 10],
      [3, 20],
    ]),
  ).toBeUndefined();
});
