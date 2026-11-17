import { expect, test } from 'vitest';
import type { GroupState, LagStatus } from '@ki/core';
import { healthyGroups, totalLagTone } from './status';

const g = (status: LagStatus, state: GroupState) => ({ status, state });

test('the Healthy card counts groups whose badge says healthy, not Empty or Rebalancing ones', () => {
  expect(
    healthyGroups([
      g('healthy', 'Stable'),
      g('healthy', 'Empty'),
      g('healthy', 'PreparingRebalance'),
      g('unknown', 'Empty'),
    ]),
  ).toBe(1);
});

test('a stalled or stopped group with lag never shows its Total lag in green', () => {
  expect(totalLagTone('stalled', 500, false)).toBe('warn');
  expect(totalLagTone('stopped', 500, false)).toBe('warn');
  expect(totalLagTone('healthy', 500, false)).toBe('ok');
  expect(totalLagTone('stalled', 0, false)).toBe('ok');
});
