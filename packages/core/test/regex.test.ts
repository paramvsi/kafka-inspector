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

test('a quantified group nested inside another is refused; quantifiers in classes and exact counts are not', () => {
  expect(() => safeRegex('^(([a-z])+.)+[A-Z]([a-z])+$')).toThrow('takes too long');
  expect(() => safeRegex('((a+)b)*')).toThrow('takes too long');
  expect(safeRegex('(\\d{3})+').test('123456')).toBe(true);
  expect(safeRegex('([+-]?\\d)+').test('+1-2')).toBe(true);
  expect(safeRegex('(\\(x\\))+').test('(x)(x)')).toBe(true);
});

test('an exact count on a group repeats it like +: (.*a){12}x is refused; \\d{4} on an atom still passes', () => {
  expect(() => safeRegex('(.*a){12}x')).toThrow('takes too long');
  expect(() => safeRegex('(a+){3}$')).toThrow('takes too long');
  expect(() => safeRegex('^\\d{4}-\\d{2}$')).not.toThrow();
  expect(() => safeRegex('^(\\d{4}-)?orders$')).not.toThrow();
});
