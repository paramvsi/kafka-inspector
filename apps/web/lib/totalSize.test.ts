import { formatBytes } from '@ki/core';
import { expect, test } from 'vitest';
import { totalSizeText } from './status';

test('the Topics total size never shows unknown sizes as 0', () => {
  expect(totalSizeText([{ sizeBytes: 1024 }, { sizeBytes: 2048 }])).toBe(formatBytes(3072));
  expect(totalSizeText([{ sizeBytes: null }, {}])).toBe('size unknown'); // agent can't DescribeLogDirs: not "0 B"
  expect(totalSizeText([{ sizeBytes: 1024 }, { sizeBytes: null }])).toBe(
    `at least ${formatBytes(1024)}`, // a lower bound, said so
  );
});
