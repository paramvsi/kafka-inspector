import { expect, test } from 'vitest';
import { validMaskRules } from './maskRules';

test('malformed stored mask rules are dropped instead of breaking every decode', () => {
  const ok = { id: 'a', name: 'Email', topics: '*', path: '$.email' };
  expect(validMaskRules([1, { name: 'x' }, null, ok, { ...ok, path: 'no-dollar[' }])).toEqual([ok]);
});
