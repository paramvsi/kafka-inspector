import { expect, test } from 'vitest';
import { formatBytes, type GroupState, type LagStatus } from '@ki/core';
import {
  healthyGroups,
  partitionLagText,
  resetSkipLabel,
  totalLagTone,
  totalSizeText,
} from './status';

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

test('a partition the group never committed to has unknown lag, not 0 (it would read as caught up)', () => {
  expect(partitionLagText({ committedOffset: null, lag: 0 })).toBe('—');
  expect(partitionLagText({ committedOffset: 900, lag: 1234 })).toBe('1,234');
  expect(partitionLagText({ committedOffset: 5, lag: 0 })).toBe('0');
});

test('the Topics total size never shows unknown sizes as 0', () => {
  expect(totalSizeText([{ sizeBytes: 1024 }, { sizeBytes: 2048 }])).toBe(formatBytes(3072));
  expect(totalSizeText([{ sizeBytes: null }, {}])).toBe('size unknown'); // agent can't DescribeLogDirs: not "0 B"
  expect(totalSizeText([{ sizeBytes: 1024 }, { sizeBytes: null }])).toBe(
    `at least ${formatBytes(1024)}`, // a lower bound, said so
  );
});

test('a skipped reset row says why: a leaderless partition was selected, it just can’t be reset', () => {
  expect(resetSkipLabel('Already at that offset')).toBe('no change');
  expect(resetSkipLabel('Not selected')).toBe('not selected');
  expect(resetSkipLabel('No leader: its brokers are down. Bring one back, then reset.')).toBe(
    'no leader',
  );
  expect(resetSkipLabel('Something new the agent says')).toBe('Something new the agent says');
});
