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
