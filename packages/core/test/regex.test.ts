import { expect, test } from 'vitest';
import { safeRegex } from '../src/regex';

test('catastrophic and oversized regexes are refused with the agent’s messages; ordinary ones work', () => {
  expect(() => safeRegex('(a+)+$')).toThrow('takes too long');
  expect(() => safeRegex('(\\w*)*x')).toThrow('takes too long');
  expect(() => safeRegex('x'.repeat(201))).toThrow('limited to 200 characters');
  expect(() => safeRegex('(')).toThrow('Invalid regular expression: (');
  expect(safeRegex('^orders\\.(eu|us)-[0-9]+$').test('orders.eu-12')).toBe(true);
  expect(safeRegex('pay(ments)?').test('payments')).toBe(true);
});
