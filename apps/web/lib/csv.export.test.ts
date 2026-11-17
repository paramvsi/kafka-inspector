import { expect, test } from 'vitest';
import type { RawMessage } from '@ki/core';
import { exportBody } from './csv';
import type { DecodedMessage } from './serdes';

const raw = (offset: number) =>
  ({ topic: 't', partition: 0, offset, timestamp: 1 }) as unknown as RawMessage;
const hex = {
  raw: raw(1),
  id: 't:0:1',
  key: { ok: true, format: 'text', value: 'k1', text: 'k1' },
  value: { ok: true, format: 'hex', value: 'de ad be ef', text: 'de ad be ef' },
  shown: 'de ad be ef',
  masked: [],
  headers: {},
} as unknown as DecodedMessage;

test('the export says how each key and value was decoded (hex bytes never pass for text)', () => {
  const csv = exportBody([raw(1)], () => hex, 'csv').body.split('\n');
  expect(csv[0]).toBe('topic,partition,offset,timestamp,key,key_format,value,value_format');
  expect(csv[1]).toBe('t,0,1,1,k1,text,de ad be ef,hex');
  const json = JSON.parse(exportBody([raw(1)], () => hex, 'json').body);
  expect(json[0]).toMatchObject({ keyFormat: 'text', valueFormat: 'hex' });
});

test('rows still decoding are left out and counted, not exported as blanks', () => {
  const out = exportBody([raw(1), raw(2)], (m) => (m.offset === 1 ? hex : undefined), 'json');
  expect(JSON.parse(out.body)).toHaveLength(1);
  expect(out.skipped).toBe(1);
});
