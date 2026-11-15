import { expect, test } from 'vitest';
import { checkCompatibility, diffFields } from '../src/schema-compat';

const f = (name: string, type: unknown, extra = {}) => ({ name, type, ...extra });
const rec = (fields: unknown[]) => JSON.stringify({ type: 'record', name: 'Order', fields });
const V3 = rec([
  f('orderId', 'string'),
  f('total', 'float'),
  f('channel', 'string'),
  f('createdAt', 'long'),
]);
const V4 = rec([
  f('orderId', 'string'),
  f('total', 'double'),
  f('items', { type: 'array', items: 'string' }, { default: [] }),
  f('email', ['null', 'string'], { default: null }),
  f('createdAt', 'long'),
]);

test('orders-value v3 → v4: backward compatible, not forward (channel removed without a default)', () => {
  expect(checkCompatibility('AVRO', V3, V4, 'BACKWARD')).toEqual({
    compatible: true,
    messages: [],
  });
  const fwd = checkCompatibility('AVRO', V3, V4, 'FORWARD');
  expect(fwd.compatible).toBe(false);
  expect(fwd.messages.join(' ')).toContain('channel is missing');
  expect(checkCompatibility('AVRO', V3, V4, 'FULL').compatible).toBe(false);
  expect(checkCompatibility('AVRO', V3, V4, 'NONE').compatible).toBe(true);
});

test('adding a field without a default breaks backward compatibility', () => {
  const r = checkCompatibility(
    'AVRO',
    V3,
    rec([
      f('orderId', 'string'),
      f('total', 'float'),
      f('channel', 'string'),
      f('createdAt', 'long'),
      f('region', 'string'),
    ]),
    'BACKWARD',
  );
  expect(r.compatible).toBe(false);
  expect(r.messages[0]).toContain('region');
});

test('type changes: promotions allowed, narrowing and union mismatches rejected, enums checked', () => {
  expect(checkCompatibility('AVRO', '"int"', '"long"', 'BACKWARD').compatible).toBe(true);
  expect(checkCompatibility('AVRO', '"long"', '"int"', 'BACKWARD').compatible).toBe(false);
  expect(checkCompatibility('AVRO', '"string"', '["null","int"]', 'BACKWARD').compatible).toBe(
    false,
  );
  expect(
    checkCompatibility('AVRO', '["null","string"]', '["null","string","int"]', 'BACKWARD')
      .compatible,
  ).toBe(true);
  const e1 = JSON.stringify({ type: 'enum', name: 'E', symbols: ['A', 'B'] });
  const e2 = JSON.stringify({ type: 'enum', name: 'E', symbols: ['A'] });
  expect(checkCompatibility('AVRO', e1, e2, 'BACKWARD').compatible).toBe(false);
  expect(
    checkCompatibility(
      'AVRO',
      JSON.stringify({ type: 'map', values: 'int' }),
      JSON.stringify({ type: 'map', values: 'long' }),
      'BACKWARD',
    ).compatible,
  ).toBe(true);
  expect(checkCompatibility('AVRO', '{', V4, 'BACKWARD').messages[0]).toContain('not valid JSON');
});

test('JSON Schema: newly required breaks backward; removed required breaks forward; type change reported', () => {
  const a = JSON.stringify({
    properties: { a: { type: 'string' }, b: { type: 'integer' } },
    required: ['a'],
  });
  const b = JSON.stringify({
    properties: { a: { type: 'string' }, c: { type: 'string' } },
    required: ['a', 'c'],
  });
  expect(checkCompatibility('JSON', a, b, 'BACKWARD').compatible).toBe(false);
  expect(checkCompatibility('JSON', b, a, 'FORWARD').compatible).toBe(false);
  expect(
    checkCompatibility(
      'JSON',
      a,
      JSON.stringify({ properties: { a: { type: 'number' } }, required: ['a'] }),
      'BACKWARD',
    ).messages[0],
  ).toContain('changed type');
  expect(checkCompatibility('JSON', a, a, 'FULL').compatible).toBe(true);
  expect(checkCompatibility('PROTOBUF', '', '', 'BACKWARD').compatible).toBe(false);
});

test('field diff lists added, removed and changed fields', () => {
  const d = diffFields('AVRO', V3, V4);
  expect(d.filter((x) => x.change === 'added').map((x) => x.field)).toEqual(['items', 'email']);
  expect(d.filter((x) => x.change === 'removed').map((x) => x.field)).toEqual(['channel']);
  expect(d.find((x) => x.field === 'total')).toMatchObject({
    change: 'changed',
    from: 'float',
    to: 'double',
  });
  expect(
    diffFields(
      'JSON',
      JSON.stringify({ properties: { a: { type: 'string' } } }),
      JSON.stringify({ properties: { b: {} } }),
    ).map((x) => x.change),
  ).toEqual(['added', 'removed']);
});
