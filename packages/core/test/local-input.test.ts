// datetime-local inputs read their value as local time: the default must be local too, not UTC
process.env.TZ = 'Asia/Kolkata';
import { expect, test } from 'vitest';
import { toLocalInput } from '../src/format';

test('round-trips through a datetime-local value in a non-UTC zone', () => {
  const hourAgo = Date.parse('2026-11-16T00:30:00Z');
  expect(toLocalInput(hourAgo)).toBe('2026-11-16T06:00');
  expect(new Date(toLocalInput(hourAgo)).getTime()).toBe(hourAgo);
  expect(toLocalInput('soon')).toBe('');
});

test('the old UTC slice lands hours away from the intended time', () => {
  const hourAgo = Date.parse('2026-11-16T00:30:00Z');
  const old = new Date(hourAgo).toISOString().slice(0, 16);
  expect(new Date(old).getTime()).not.toBe(hourAgo);
});

test('formatTimestamp shows local date, time and milliseconds', async () => {
  const { formatTimestamp } = await import('../src/format');
  expect(formatTimestamp('2026-11-16T00:30:01.007Z')).toBe('2026-11-16 06:00:01.007');
  expect(formatTimestamp('nope')).toBe('—');
});
