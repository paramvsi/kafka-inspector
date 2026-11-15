import avsc from 'avsc';
import { expect, test } from 'vitest';
import { AvroError, AvroType } from '../src/serdes/avro';

const SCHEMA = {
  type: 'record',
  name: 'Order',
  namespace: 'com.example',
  fields: [
    { name: 'id', type: 'string' },
    { name: 'n', type: 'int' },
    { name: 'big', type: 'long' },
    { name: 'f', type: 'float' },
    { name: 'd', type: 'double' },
    { name: 'ok', type: 'boolean' },
    { name: 'raw', type: 'bytes' },
    { name: 'email', type: ['null', 'string'], default: null },
    { name: 'kind', type: { type: 'enum', name: 'Kind', symbols: ['A', 'B', 'C'] } },
    {
      name: 'items',
      type: {
        type: 'array',
        items: {
          type: 'record',
          name: 'Item',
          fields: [
            { name: 'sku', type: 'string' },
            { name: 'qty', type: 'int' },
          ],
        },
      },
    },
    { name: 'tags', type: { type: 'map', values: 'long' } },
    { name: 'fx', type: { type: 'fixed', name: 'Four', size: 4 } },
    { name: 'again', type: 'Item' },
  ],
};
const VALUE = {
  id: 'ord_7c118',
  n: -42,
  big: 1794730476928,
  f: 1.5,
  d: 1290.25,
  ok: true,
  raw: new Uint8Array([1, 2, 255]),
  email: 'mia.123@example.com',
  kind: 'C',
  items: [
    { sku: 'SKU-1182', qty: 2 },
    { sku: 'SKU-0457', qty: 1 },
  ],
  tags: { a: 1, b: -2 },
  fx: new Uint8Array([9, 8, 7, 6]),
  again: { sku: 'x', qty: 0 },
};

test('encodes byte-for-byte like avsc, and decodes avsc output', () => {
  const ours = new AvroType(SCHEMA);
  const theirs = avsc.Type.forSchema(SCHEMA as avsc.Schema);
  const theirValue = { ...VALUE, raw: Buffer.from(VALUE.raw), fx: Buffer.from(VALUE.fx) };
  const bytes = ours.encode(VALUE);
  expect(Buffer.from(bytes)).toEqual(theirs.toBuffer(theirValue));
  const back = ours.decode(new Uint8Array(theirs.toBuffer({ ...theirValue, email: null })));
  expect(back.email).toBeNull();
  expect(back.items[1].sku).toBe('SKU-0457');
  expect(back.tags).toEqual({ a: 1, b: -2 });
  expect(back.big).toBe(1794730476928);
});

test('rejects truncated input, trailing bytes, bad enum/union indexes and invalid values', () => {
  const t = new AvroType(SCHEMA);
  const bytes = t.encode(VALUE);
  expect(() => t.decode(bytes.subarray(0, 9))).toThrow(AvroError);
  expect(() => t.decode(Uint8Array.from([...bytes, 0]))).toThrow('trailing');
  expect(() =>
    new AvroType({ type: 'enum', name: 'E', symbols: ['A'] }).decode(Uint8Array.of(4)),
  ).toThrow('out of range');
  expect(() => new AvroType(['null', 'string']).decode(Uint8Array.of(8))).toThrow('out of range');
  expect(() => new AvroType('long').encode(1.5)).toThrow('invalid long');
  expect(() => new AvroType('double').encode('oops')).toThrow('invalid double');
  expect(() => new AvroType('string').encode(1)).toThrow('invalid string');
  expect(() => new AvroType('boolean').encode('yes')).toThrow('invalid boolean');
  expect(() => new AvroType('bytes').encode('x')).toThrow('invalid bytes');
  expect(() => new AvroType({ type: 'enum', name: 'E', symbols: ['A'] }).encode('Z')).toThrow(
    'enum',
  );
  expect(() => new AvroType(['null', 'int']).encode('x')).toThrow('union');
  expect(() => new AvroType('string').decode(Uint8Array.of(4, 0xff, 0xfe))).toThrow('UTF-8');
});

test('negative block counts (with byte sizes) decode', () => {
  // array of two ints written as one block with count -2 and its byte size
  expect(
    new AvroType({ type: 'array', items: 'int' }).decode(Uint8Array.of(3, 4, 2, 4, 0)),
  ).toEqual([1, 2]);
});

import { fromDisplay, randomValue } from '../src/serdes/avro';

test('fromDisplay turns ISO timestamps into millis and unwraps unions/arrays; rejects bad dates', () => {
  const schema = {
    type: 'record',
    name: 'R',
    fields: [
      { name: 'at', type: { type: 'long', logicalType: 'timestamp-millis' } },
      { name: 'tags', type: { type: 'array', items: 'string' } },
      { name: 'maybe', type: ['null', { type: 'long', logicalType: 'timestamp-millis' }] },
      { name: 'n', type: 'int' },
    ],
  };
  expect(
    fromDisplay(schema, {
      at: '2026-11-15T14:30:00Z',
      tags: ['a'],
      maybe: '2026-01-01T00:00:00Z',
      n: 3,
    }),
  ).toEqual({ at: Date.UTC(2026, 10, 15, 14, 30), tags: ['a'], maybe: Date.UTC(2026, 0, 1), n: 3 });
  expect(fromDisplay(schema, { at: 1, tags: [], maybe: null, n: 1 }).maybe).toBeNull();
  expect(() => fromDisplay(schema, { at: 'not a date', tags: [], maybe: null, n: 1 })).toThrow(
    'valid timestamp',
  );
});

test('randomValue always produces data that encodes under its schema', () => {
  const schema = {
    type: 'record',
    name: 'O',
    fields: [
      { name: 'orderId', type: 'string' },
      { name: 'email', type: ['null', 'string'] },
      { name: 'currency', type: 'string' },
      { name: 'status', type: 'string' },
      { name: 'sku', type: 'string' },
      { name: 'createdAt', type: { type: 'long', logicalType: 'timestamp-millis' } },
      { name: 'updatedAt', type: 'string' },
      { name: 'qty', type: 'int' },
      { name: 'big', type: 'long' },
      { name: 'price', type: 'double' },
      { name: 'ratio', type: 'float' },
      { name: 'ok', type: 'boolean' },
      { name: 'kind', type: { type: 'enum', name: 'K', symbols: ['A', 'B'] } },
      { name: 'items', type: { type: 'array', items: 'int' } },
      { name: 'attrs', type: { type: 'map', values: 'string' } },
      { name: 'nothing', type: 'null' },
      { name: 'other', type: 'string' },
    ],
  };
  const t = new AvroType(schema);
  let seed = 1;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 25; i++) {
    const v = randomValue(schema, rnd);
    expect(() => t.encode(fromDisplay(schema, v))).not.toThrow();
  }
  expect(String(randomValue('string', rnd, 'customerId'))).toMatch(/^cus_/);
  expect(randomValue('fixedish' as unknown as 'null', rnd)).toBeNull();
});

test('longs are exact across the whole 64-bit range (beyond 2^53 as decimal strings)', () => {
  const t = AvroType.parse('"long"');
  const min = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]);
  expect(t.decode(min)).toBe('-9223372036854775808');
  for (const v of ['9007199254740993', '9223372036854775807', '-9223372036854775808'])
    expect(t.decode(t.encode(v))).toBe(v);
  expect(t.decode(t.encode(9007199254740991))).toBe(9007199254740991);
  expect(t.decode(t.encode(-1))).toBe(-1);
  expect(() => t.encode(2 ** 60)).toThrow(AvroError); // already imprecise as a JS number
  expect(() => t.encode('9223372036854775808')).toThrow(AvroError);
});

test('corrupt lengths and block counts fail fast', () => {
  expect(() => AvroType.parse('"bytes"').decode(new Uint8Array([0x01]))).toThrow(
    'negative bytes length',
  );
  const nulls = AvroType.parse('{"type":"array","items":"null"}');
  // block count 2^40 with no data behind it
  expect(() => nulls.decode(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x02]))).toThrow(
    'exceeds the data',
  );
});
