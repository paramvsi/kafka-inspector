import { describe, expect, test } from 'vitest';
import {
  combineForecasts,
  evaluateLag,
  forecast,
  formatEta,
  formatForecast,
  rollupStatus,
  type LagSample,
} from '../src/lag';
import vectors from './lag-vectors.json';

type Vector = {
  name: string;
  samples: LagSample[];
  lastCommitAt: number | null;
  now: number;
  windowMs: number;
  expect: { status: string; forecast: { kind: string; seconds?: number } };
};

describe('lag vectors (shared with the Java agent)', () => {
  test('there are at least 20', () => expect(vectors.length).toBeGreaterThanOrEqual(20));

  test.each((vectors as Vector[]).map((v) => [v.name, v] as const))('%s', (_name, v) => {
    expect(
      evaluateLag({
        samples: v.samples,
        lastCommitAt: v.lastCommitAt,
        now: v.now,
        windowMs: v.windowMs,
      }),
    ).toBe(v.expect.status);
    const f = forecast(v.samples);
    expect(f.kind).toBe(v.expect.forecast.kind);
    if (v.expect.forecast.seconds !== undefined)
      expect(f.seconds).toBeCloseTo(v.expect.forecast.seconds, 3);
  });
});

test('group roll-up: stopped > stalled > warn > healthy; unknown only when nothing else', () => {
  expect(rollupStatus(['healthy', 'warn', 'stalled'])).toBe('stalled');
  expect(rollupStatus(['healthy', 'stopped', 'stalled'])).toBe('stopped');
  expect(rollupStatus(['healthy', 'unknown'])).toBe('healthy');
  expect(rollupStatus(['unknown'])).toBe('unknown');
  expect(rollupStatus([])).toBe('unknown');
});

test('forecast format per ARCHITECTURE', () => {
  expect(formatEta(59)).toBe('under a minute');
  expect(formatEta(14 * 60 + 10)).toBe('~14 min');
  expect(formatEta(119 * 60)).toBe('~119 min');
  expect(formatEta(3 * 3600)).toBe('~3 h');
  expect(formatForecast({ kind: 'never' })).toBe("Won't catch up");
  expect(formatForecast({ kind: 'caught-up' })).toBe('Caught up');
});

test('group forecast: any partition that never catches up makes the group never; else slowest partition', () => {
  expect(combineForecasts([{ lag: 0, forecast: { kind: 'caught-up' } }]).kind).toBe('caught-up');
  expect(
    combineForecasts([
      { lag: 10, forecast: { kind: 'eta', seconds: 5, consumeRate: 3, produceRate: 1 } },
      { lag: 90, forecast: { kind: 'eta', seconds: 50, consumeRate: 4, produceRate: 2 } },
    ]),
  ).toEqual({ kind: 'eta', seconds: 50, consumeRate: 7, produceRate: 3 });
  expect(
    combineForecasts([
      { lag: 10, forecast: { kind: 'eta', seconds: 5 } },
      { lag: 5, forecast: { kind: 'never' } },
    ]).kind,
  ).toBe('never');
});

test('group rates include caught-up partitions (payments-sink-style: lag on a few partitions only)', () => {
  const s = (t: number, committed: number, end: number) => ({ t, committed, end });
  const caughtUp = forecast([s(0, 0, 0), s(10_000, 1000, 1000)]); // 100/s in and out, no lag
  expect(caughtUp).toMatchObject({ kind: 'caught-up', consumeRate: 100, produceRate: 100 });
  const behind = forecast([s(0, 0, 500), s(10_000, 1000, 1500)]);
  const g = combineForecasts([
    { lag: 0, forecast: caughtUp },
    { lag: 500, forecast: behind },
  ]);
  expect(g.produceRate).toBeCloseTo(200);
  expect(g.consumeRate).toBeCloseTo(200);
});
