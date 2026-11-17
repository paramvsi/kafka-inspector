import { expect, test, vi } from 'vitest';

// serdes.ts imports the React provider (a .tsx file the lib test run doesn't compile); decodeMessage doesn't use it
vi.mock('./kafka', () => ({ useKafka: () => ({}) }));
import type { MaskRule, RawMessage } from '@ki/core';
import { decodeMessage } from './serdes';

const rule: MaskRule = {
  id: 'c',
  name: 'Cards',
  topics: 'payments',
  path: '$.card',
  action: 'mask',
};

test('"Show as text" of a non-JSON body on a masked topic hides the raw text, as the hex view does', async () => {
  // an Avro-framed body (magic byte, schema id, then Avro): its strings are plain UTF-8 inside the bytes
  const body = new Uint8Array([
    0,
    0,
    0,
    0,
    7,
    0x20,
    ...new TextEncoder().encode('4111111111111111'),
  ]);
  const m = {
    topic: 'payments',
    partition: 0,
    offset: 1,
    timestamp: '2026-01-01T00:00:00Z',
    key: null,
    value: body,
    headers: [],
  } as unknown as RawMessage;
  const d = await decodeMessage(m, 'text', 'auto', undefined, [rule]);
  expect(String(d.shown)).not.toContain('4111111111111111');
  expect(String(d.shown)).toMatch(/Raw bytes hidden/);
});

test('a JSON body shown as text is still masked field by field, not hidden', async () => {
  const body = new TextEncoder().encode(JSON.stringify({ card: '4111111111111111', total: 5 }));
  const m = {
    topic: 'payments',
    partition: 0,
    offset: 2,
    timestamp: '2026-01-01T00:00:00Z',
    key: null,
    value: body,
    headers: [],
  } as unknown as RawMessage;
  const d = await decodeMessage(m, 'text', 'auto', undefined, [rule]);
  expect(String(d.shown)).not.toContain('4111111111111111');
  expect(String(d.shown)).toContain('total');
});
