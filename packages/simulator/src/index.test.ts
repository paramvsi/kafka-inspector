import { expect, test } from 'vitest';
import { SEED, SIM_MODE } from './index';

test('simulator runs in demo mode with the documented seed', () => {
  expect(SEED).toBe('kafka-42');
  expect(SIM_MODE).toBe('demo');
});
