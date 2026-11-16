import { expect, test } from 'vitest';
import { sourceLabel } from './configSource';

test('broker-level config is labelled broker, not a topic override', () => {
  expect(sourceLabel({ source: 'dynamic-broker', isDefault: false })).toBe('broker');
  expect(sourceLabel({ source: 'static-broker', isDefault: false })).toBe('broker');
  expect(sourceLabel({ source: 'dynamic-topic', isDefault: false })).toBe('override');
  expect(sourceLabel({ source: 'default', isDefault: true })).toBe('default');
});
