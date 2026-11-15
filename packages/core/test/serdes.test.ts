import { describe, expect, test } from 'vitest';
import { AvroType } from '../src/serdes/avro';
import {
  cachedLookup,
  decode,
  fromBase64,
  hexDump,
  toBase64,
  type SchemaLookup,
} from '../src/serdes/decode';
import { applyMasks, isValidMaskPath, MASKED, topicMatches } from '../src/serdes/mask';
import type { SchemaVersion } from '../src/types';

const enc = new TextEncoder();
const ORDER = JSON.stringify({
  type: 'record',
  name: 'O',
  fields: [
    { name: 'orderId', type: 'string' },
    { name: 'createdAt', type: { type: 'long', logicalType: 'timestamp-millis' } },
    { name: 'items', type: { type: 'array', items: 'string' } },
  ],
});
const REG: Record<number, SchemaVersion> = {
  112: { subject: 'orders-value', version: 4, id: 112, type: 'AVRO', schema: ORDER },
  33: { subject: 'clickstream-value', version: 1, id: 33, type: 'JSON', schema: '{}' },
  7: { subject: 'p-value', version: 1, id: 7, type: 'PROTOBUF', schema: '' },
};
const lookup: SchemaLookup = async (id) => REG[id];
const frame = (id: number, payload: Uint8Array) => {
  const b = new Uint8Array(5 + payload.length);
  new DataView(b.buffer).setInt32(1, id);
  b.set(payload, 5);
  return b;
};

describe('auto-detect order: registry header → JSON → text → hex', () => {
  test('Avro via registry, with logical timestamp as ISO', async () => {
    const r = await decode(
      frame(
        112,
        new AvroType(JSON.parse(ORDER)).encode({
          orderId: 'ord_1',
          createdAt: Date.UTC(2026, 10, 15, 14, 27, 31),
          items: ['a'],
        }),
      ),
      'auto',
      lookup,
    );
    expect(r).toMatchObject({
      ok: true,
      format: 'avro',
      value: { orderId: 'ord_1', createdAt: '2026-11-15T14:27:31Z' },
      schema: { id: 112, subject: 'orders-value', version: 4 },
    });
  });
  test('JSON Schema via registry', async () => {
    expect(await decode(frame(33, enc.encode('{"a":1}')), 'auto', lookup)).toMatchObject({
      ok: true,
      format: 'json-schema',
      value: { a: 1 },
    });
  });
  test('plain JSON, text, binary and null', async () => {
    expect(await decode(enc.encode(' {"x":[1,2]} '), 'auto', lookup)).toMatchObject({
      format: 'json',
      value: { x: [1, 2] },
    });
    expect(await decode(enc.encode('{not json'), 'auto', lookup)).toMatchObject({ format: 'text' });
    expect(
      await decode(enc.encode('2026-11-15 user=mia action=login'), 'auto', lookup),
    ).toMatchObject({ format: 'text' });
    expect(await decode(Uint8Array.of(0xff, 0xfe, 0x01), 'auto', lookup)).toMatchObject({
      format: 'hex',
      value: 'ff fe 01',
    });
    expect(await decode(Uint8Array.of(1, 2, 3), 'auto', lookup)).toMatchObject({ format: 'hex' });
    expect(await decode(null, 'auto', lookup)).toMatchObject({
      ok: true,
      format: 'null',
      value: null,
    });
  });
});

describe('decode errors are values with annotated hex (F-46)', () => {
  test('unknown schema id', async () => {
    const r = await decode(frame(131, Uint8Array.of(1, 2)), 'auto', lookup);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.detail).toContain('schema id 131');
    expect(r.schemaId).toBe(131);
    expect(r.annotations).toEqual([
      { start: 0, end: 1, label: 'magic byte' },
      { start: 1, end: 5, label: 'schema id (131)' },
    ]);
    expect(r.hex.startsWith('00 00 00 00 83')).toBe(true);
  });
  test('truncated Avro payload', async () => {
    const r = await decode(frame(112, Uint8Array.of(10, 0x6f)), 'auto', lookup);
    expect(r).toMatchObject({
      ok: false,
      tried: 'Avro',
      reason: "Couldn't decode the value as Avro",
    });
  });
  test('short buffer with magic byte falls back to content detection; forced Avro explains the header', async () => {
    expect(await decode(Uint8Array.of(0, 1, 2), 'auto', lookup)).toMatchObject({
      ok: true,
      format: 'hex',
    });
    expect(await decode(Uint8Array.of(0, 1, 2), 'avro', lookup)).toMatchObject({
      ok: false,
      reason: 'No Schema Registry header',
    });
    expect(await decode(enc.encode('{}'), 'json-schema', lookup)).toMatchObject({ ok: false });
  });
  test('JSON Schema payload that is not JSON, and Protobuf (v2)', async () => {
    expect(await decode(frame(33, enc.encode('nope')), 'auto', lookup)).toMatchObject({
      ok: false,
      tried: 'JSON Schema',
    });
    expect(await decode(frame(7, enc.encode('x')), 'auto', lookup)).toMatchObject({
      ok: false,
      tried: 'Protobuf',
    });
  });
});

describe('explicit formats', () => {
  test('numbers, uuid, base64, hex, json, text', async () => {
    const b8 = new Uint8Array(8);
    new DataView(b8.buffer).setBigInt64(0, 1234567890123n);
    expect(await decode(b8, 'int64', lookup)).toMatchObject({ value: '1234567890123' });
    new DataView(b8.buffer).setFloat64(0, 3.5);
    expect(await decode(b8, 'double', lookup)).toMatchObject({ value: 3.5 });
    expect(await decode(Uint8Array.of(0, 0, 1, 0), 'int32', lookup)).toMatchObject({ value: 256 });
    expect(await decode(Uint8Array.of(1), 'int32', lookup)).toMatchObject({ ok: false });
    expect(await decode(Uint8Array.of(1), 'int64', lookup)).toMatchObject({ ok: false });
    expect(await decode(Uint8Array.of(1), 'double', lookup)).toMatchObject({ ok: false });
    const u = Uint8Array.from({ length: 16 }, (_, i) => i);
    expect(await decode(u, 'uuid', lookup)).toMatchObject({
      value: '00010203-0405-0607-0809-0a0b0c0d0e0f',
    });
    expect(
      await decode(enc.encode('3F2504E0-4F89-11D3-9A0C-0305E82C3301'), 'uuid', lookup),
    ).toMatchObject({ value: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' });
    expect(await decode(enc.encode('nope'), 'uuid', lookup)).toMatchObject({ ok: false });
    expect(await decode(Uint8Array.of(104, 105), 'base64', lookup)).toMatchObject({
      value: 'aGk=',
    });
    expect(await decode(Uint8Array.of(1, 255), 'hex', lookup)).toMatchObject({ value: '01 ff' });
    expect(await decode(enc.encode('[1]'), 'json', lookup)).toMatchObject({ value: [1] });
    expect(await decode(enc.encode('x'), 'json', lookup)).toMatchObject({ ok: false });
    expect(await decode(Uint8Array.of(0xff), 'text', lookup)).toMatchObject({ ok: false });
    expect(await decode(enc.encode('héllo'), 'text', lookup)).toMatchObject({ value: 'héllo' });
  });
});

test('base64 round trip, hex dump lines, cached lookups remember misses', async () => {
  expect(fromBase64(toBase64(Uint8Array.of(0, 1, 254)))).toEqual(Uint8Array.of(0, 1, 254));
  const lines = hexDump(enc.encode('....pay_0e19.....@.card.'), 16);
  expect(lines).toHaveLength(2);
  expect(lines[0]!.ascii).toBe('....pay_0e19....');
  let calls = 0;
  const lk = cachedLookup(async (id) => {
    calls++;
    if (id === 1) throw new Error('404');
    return REG[112]!;
  });
  await lk(1);
  await lk(1);
  expect(await lk(112)).toBe(REG[112]);
  expect(calls).toBe(2);
});

test('a failed schema lookup is retried after 30 s instead of sticking until reload', async () => {
  let t = 0;
  let up = false;
  let calls = 0;
  const lk = cachedLookup(
    async () => {
      calls++;
      if (!up) throw new Error('503');
      return REG[112]!;
    },
    () => t,
  );
  expect(await lk(112)).toBeUndefined();
  up = true;
  t = 10_000;
  expect(await lk(112)).toBeUndefined(); // still within the miss window
  t = 31_000;
  expect(await lk(112)).toBe(REG[112]);
  expect(calls).toBe(2);
});

test('masking: mask, replace, remove, wildcards, topic globs', () => {
  const v = {
    email: 'a@b.c',
    card: { number: '4111' },
    items: [{ sku: 'x' }, { sku: 'y' }],
    name: null,
  };
  const r = applyMasks(v, 'orders', [
    { id: '1', name: 'emails', topics: 'orders.*', path: '$.email', action: 'mask' },
    {
      id: '2',
      name: 'cards',
      topics: '*',
      path: '$.card.number',
      action: 'replace',
      replacement: 'XXXX',
    },
    { id: '3', name: 'skus', topics: 'orders', path: '$.items[*].sku', action: 'remove' },
    { id: '4', name: 'other', topics: 'payments', path: '$.email', action: 'remove' },
    { id: '5', name: 'nulls', topics: '*', path: '$.name', action: 'mask' },
  ]);
  expect(r.value).toEqual({ email: MASKED, card: { number: 'XXXX' }, items: [{}, {}], name: null });
  expect(r.applied.map((a) => a.path)).toEqual([
    '$.email',
    '$.card.number',
    '$.items[0].sku',
    '$.items[1].sku',
  ]);
  expect(v.email).toBe('a@b.c');
  expect(applyMasks('text', 'orders', []).value).toBe('text');
  expect(topicMatches('orders.*', 'orders.eu')).toBe(true);
  expect(topicMatches('orders.*', 'orders')).toBe(true);
  expect(topicMatches('orders.*', 'ordersx')).toBe(false);
});

test('logical types inside unions, maps and named references are shown too', async () => {
  const schema = JSON.stringify({
    type: 'record',
    name: 'Evt',
    namespace: 'com.acme',
    fields: [
      { name: 'at', type: ['null', { type: 'long', logicalType: 'timestamp-millis' }] },
      { name: 'blob', type: ['null', 'bytes'] },
      {
        name: 'times',
        type: { type: 'map', values: { type: 'long', logicalType: 'timestamp-millis' } },
      },
      {
        name: 'first',
        type: {
          type: 'record',
          name: 'Stamp',
          fields: [{ name: 't', type: { type: 'long', logicalType: 'timestamp-millis' } }],
        },
      },
      { name: 'second', type: 'com.acme.Stamp' },
    ],
  });
  const t = AvroType.parse(schema);
  const ms = Date.parse('2026-11-16T01:02:03Z');
  const payload = t.encode({
    at: ms,
    blob: Uint8Array.of(1, 2, 3),
    times: { a: ms },
    first: { t: ms },
    second: { t: ms },
  });
  const reg: SchemaLookup = async () => ({ subject: 'e', version: 1, id: 9, type: 'AVRO', schema });
  const r = await decode(frame(9, payload), 'auto', reg);
  expect(r.ok && r.value).toEqual({
    at: '2026-11-16T01:02:03Z',
    blob: toBase64(Uint8Array.of(1, 2, 3)),
    times: { a: '2026-11-16T01:02:03Z' },
    first: { t: '2026-11-16T01:02:03Z' },
    second: { t: '2026-11-16T01:02:03Z' },
  });
});

test('without a Schema Registry a leading 0x00 is plain data, and registry formats say why they fail', async () => {
  const int64Key = Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 5);
  const auto = await decode(int64Key, 'auto', undefined);
  expect(auto.ok).toBe(true);
  const avro = await decode(int64Key, 'avro', undefined);
  expect(avro.ok).toBe(false);
  if (!avro.ok) expect(avro.reason).toBe('No Schema Registry configured');
});

test('mask paths: indices and quoted keys work, invalid paths are rejected, arrays close up, own keys only', () => {
  const rule = (path: string, action: 'mask' | 'remove' = 'mask') => ({
    id: 'r',
    name: 'r',
    topics: '*',
    path,
    action,
  });
  const v = { items: [{ sku: 'a' }, { sku: 'b' }], 'a.b': 1, tags: ['x', 'y'] };
  expect((applyMasks(v, 't', [rule('$.items[0].sku')]).value as typeof v).items).toEqual([
    { sku: MASKED },
    { sku: 'b' },
  ]);
  expect((applyMasks(v, 't', [rule("$['a.b']")]).value as Record<string, unknown>)['a.b']).toBe(
    MASKED,
  );
  expect((applyMasks(v, 't', [rule('$.tags[*]', 'remove')]).value as typeof v).tags).toEqual([]);
  expect(() => applyMasks(v, 't', [rule('$.tags.length')])).not.toThrow();
  expect((applyMasks(v, 't', [rule('$.tags.length')]).value as typeof v).tags).toEqual(['x', 'y']);
  expect(isValidMaskPath('$.items[0].sku')).toBe(true);
  expect(isValidMaskPath('$.items[')).toBe(false);
  expect(isValidMaskPath('$..x')).toBe(false);
});

test('a NaN or Infinity double previews as itself, not "null"', async () => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, Number.NaN);
  const r = await decode(b, 'double', undefined);
  expect(r.ok && r.text).toBe('NaN');
  new DataView(b.buffer).setFloat64(0, Number.NEGATIVE_INFINITY);
  const r2 = await decode(b, 'double', undefined);
  expect(r2.ok && r2.text).toBe('-Infinity');
});
