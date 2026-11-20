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

test('a record without a timestamp (Kafka -1) or at epoch 0 shows "—", not a 1969/1970 date', async () => {
  const f = (await import('../src/format')) as unknown as {
    formatTimestamp: (t: number | string) => string;
    formatTimeOfDay: (t: number | string) => string;
  };
  // the agent turns Kafka's -1 ("no timestamp", old message formats) into this ISO string
  for (const t of ['1969-12-31T23:59:59.999Z', '1970-01-01T00:00:00Z', -1, 0]) {
    expect(f.formatTimestamp(t), String(t)).toBe('—');
    expect(f.formatTimeOfDay(t), String(t)).toBe('—'); // the table's time column, not an empty cell
  }
  expect(f.formatTimeOfDay('2026-11-16T00:30:01.007Z')).toBe('06:00:01.007');
});
