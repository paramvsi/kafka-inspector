import { expect, test } from 'vitest';
import { MODES } from './index';

test('exposes the three connection modes from ARCHITECTURE', () => {
  expect(MODES).toEqual(['demo', 'agent', 'rest-proxy']);
});
