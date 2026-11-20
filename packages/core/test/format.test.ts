import { expect, test } from 'vitest';
import {
  schemaTypeLabel,
  formatBytes,
  formatCount,
  formatDelta,
  formatDuration,
  formatInt,
  formatRate,
  formatRelative,
} from '../src/format';

test('formatters', () => {
  expect(formatInt(48213.4)).toBe('48,213');
  expect(formatCount(1_234_567)).toBe('1.2M');
  expect(formatCount(12_480)).toBe('12.5k');
  expect(formatCount(950)).toBe('950');
  expect(formatBytes(61_400_000)).toBe('61.4 MB');
  expect(formatBytes(512)).toBe('512 B');
  expect(formatRate(8180.2)).toBe('8,180/s');
  expect(formatRate(2.5)).toBe('2.5/s');
  expect(formatDuration(372_000)).toBe('6m 12s');
  expect(formatDuration(45_000)).toBe('45s');
  expect(formatDuration(7_500_000)).toBe('2h 5m');
  expect(formatRelative(1000, 1000 + 12_000)).toBe('12s ago');
  expect(formatRelative(1000, 1000 + 3_600_000 * 3)).toBe('3h ago');
  expect(formatDelta(4.21)).toBe('+4.2%');
  expect(formatDelta(-3.1)).toBe('−3.1%');
});

import { formatClock, formatPct, formatWhen, shownName } from '../src/format';
test('more formatters', () => {
  expect(formatBytes(1_250_000_000_000)).toBe('1.3 TB');
  expect(formatCount(2_500_000_000)).toBe('2.5B');
  expect(formatCount(150_000)).toBe('150k');
  expect(formatDuration(3 * 86400e3 + 4 * 3600e3)).toBe('3d 4h');
  expect(formatRelative(undefined)).toBe('—');
  expect(formatRelative(1000, 2000)).toBe('just now');
  expect(formatRelative(0, 3 * 86400e3)).toBe('3d ago');
  expect(formatRelative('1970-01-01T00:01:00Z', 120_000)).toBe('1m ago');
  expect(formatPct(41.2)).toBe('41%');
  expect(formatClock(new Date(2026, 0, 1, 9, 5).getTime())).toBe('09:05');
});

test('rounding never shows 1000 of a unit, -0 or NaN', () => {
  expect(formatCount(999_999)).toBe('1M');
  expect(formatCount(999_999_999)).toBe('1B');
  expect(formatCount(9_999.6)).toBe('10k');
  expect(formatBytes(999_999)).toBe('1 MB');
  expect(formatBytes(999_400)).toBe('999 kB');
  expect(formatInt(-0.4)).toBe('0');
  expect(formatInt(Number.NaN)).toBe('—'); // never "NaN", and not a zero either (rule 7)
});

test('invalid durations and times show a dash, not NaN', () => {
  expect(formatDuration(Number.NaN)).toBe('—');
  expect(formatRelative('not a date')).toBe('—');
});

test('formatCount shows a dash for NaN and Infinity', () => {
  expect(formatCount(Number.NaN)).toBe('—');
  expect(formatCount(Number.POSITIVE_INFINITY)).toBe('—');
});

test('a trickle never reads as zero; deltas have no signed zero or NaN', () => {
  expect(formatRate(0.03)).toBe('<0.1/s');
  expect(formatRate(0)).toBe('0/s');
  expect(formatRate(NaN)).toBe('—');
  expect(formatDelta(-0.04)).toBe('0.0%');
  expect(formatDelta(NaN)).toBe('—');
  expect(formatDelta(4.2)).toBe('+4.2%');
  expect(formatDelta(-3.1)).toBe('−3.1%');
});

test('999.6 B promotes to 1 kB; an invalid time is a dash, not NaN:NaN', () => {
  expect(formatBytes(999.6)).toBe('1 kB');
  expect(formatBytes(999)).toBe('999 B');
  expect(formatClock('not a date')).toBe('—');
  expect(formatClock(Number.NaN)).toBe('—');
});

test('shownName makes bidi overrides and zero-width characters visible; ordinary names are unchanged', () => {
  expect(shownName('payments‮prod')).toBe('payments\\u{202E}prod');
  expect(shownName('fraud​scorer')).toBe('fraud\\u{200B}scorer');
  expect(shownName('order-service_v2.east')).toBe('order-service_v2.east');
  expect(shownName('naïve-grüppe')).toBe('naïve-grüppe');
});

test('formatWhen shows the date when the time is not today', () => {
  const now = new Date(2026, 10, 17, 10, 0).getTime();
  expect(formatWhen(new Date(2026, 10, 17, 12, 5).getTime(), now)).toBe('12:05');
  expect(formatWhen(new Date(2026, 10, 19, 12, 0).getTime(), now)).toBe('19 Nov 12:00');
});

test('schemaTypeLabel names all three registry types', () => {
  expect(schemaTypeLabel('AVRO')).toBe('Avro');
  expect(schemaTypeLabel('JSON')).toBe('JSON Schema');
  expect(schemaTypeLabel('PROTOBUF')).toBe('Protobuf');
});

test('unknown values read "—", never "0 B", "NaN%" or "~NaN h"', async () => {
  const { formatBytes, formatPct, formatEta } = await import('../src');
  for (const v of [NaN, Infinity, -Infinity]) {
    expect(formatBytes(v)).toBe('—');
    expect(formatPct(v)).toBe('—');
    expect(formatEta(v)).toBe('—');
  }
});

test('rounding never reports full, empty or "-0" when it isn\'t; counts go to T; an unknown integer is "—"', async () => {
  const { formatPct, formatCount, formatInt, formatRate } = await import('../src');
  expect(formatPct(99.95)).toBe('99%'); // a disk that isn't full doesn't read "100%"
  expect(formatPct(99.95, 1)).toBe('99.9%');
  expect(formatPct(100)).toBe('100%');
  expect(formatPct(0.04)).toBe('<1%'); // non-zero isn't "0%"
  expect(formatPct(0.04, 1)).toBe('<0.1%');
  expect(formatPct(0)).toBe('0%');
  expect(formatPct(-0.04)).toBe('0%');
  expect(formatCount(1e12)).toBe('1T');
  expect(formatCount(999_999_999_999)).toBe('1T');
  expect(formatInt(NaN)).toBe('—');
  expect(formatRate(-0.04)).toBe('0/s');
});

test('duration boundaries: a minute reads in minutes, a day stays in hours until 48 h', () => {
  expect(formatDuration(59_000)).toBe('59s');
  expect(formatDuration(60_000)).toBe('1m 0s');
  expect(formatDuration(86_400_000)).toBe('24h 0m'); // "1d 0h" only from 48 h: a day-and-a-bit reads in hours
  expect(formatDuration(47 * 3_600_000)).toBe('47h 0m');
  expect(formatDuration(48 * 3_600_000)).toBe('2d 0h');
});
