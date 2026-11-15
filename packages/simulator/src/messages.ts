// Messages as a pure function of (seed, topic, partition, offset) — nothing is stored (ARCHITECTURE "Simulator").
// Avro and JSON Schema topics use the real Confluent wire format so the browser decoder path is exercised.
import type { RawMessage } from '@ki/core';
import { AvroType } from '@ki/core/avro';
import { BAD_SCHEMA_ID, type TopicDef } from './model';
import { hash, hex, pick, rng } from './prng';
import { getSchemaById, latestId } from './registry';

const enc = new TextEncoder();
const avroTypes = new Map<number, AvroType>();
function avroType(id: number): AvroType {
  let t = avroTypes.get(id);
  if (!t) {
    t = AvroType.parse(getSchemaById(id)!.schema);
    avroTypes.set(id, t);
  }
  return t;
}

/** Confluent wire format: 0x00, schema id (big-endian int32), payload. */
export function frame(schemaId: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + payload.length);
  out[0] = 0;
  new DataView(out.buffer).setInt32(1, schemaId, false);
  out.set(payload, 5);
  return out;
}

const CURRENCIES = ['EUR', 'EUR', 'EUR', 'EUR', 'AED', 'GBP', 'USD'];
const REGIONS = ['eu', 'eu', 'eu', 'me', 'us'];
const NAMES = [
  'amira',
  'lukas',
  'sofia',
  'omar',
  'chen',
  'priya',
  'jonas',
  'elena',
  'yusuf',
  'mia',
];

type Body = {
  key: Uint8Array | null;
  value: Uint8Array | null;
  headers: Array<{ key: string; value: Uint8Array }>;
};
const h = (key: string, value: string) => ({ key, value: enc.encode(value) });

function keyBytes(def: TopicDef, r: () => number, fallback: string): Uint8Array | null {
  switch (def.keyFormat) {
    case 'int64': {
      const b = new Uint8Array(8);
      new DataView(b.buffer).setBigInt64(0, BigInt(Math.floor(r() * 1e9)), false);
      return b;
    }
    case 'uuid': {
      const b = new Uint8Array(16);
      for (let i = 0; i < 16; i++) b[i] = Math.floor(r() * 256);
      b[6] = (b[6]! & 0x0f) | 0x40;
      b[8] = (b[8]! & 0x3f) | 0x80;
      return b;
    }
    case 'string':
      return enc.encode(fallback);
    default:
      return r() < 0.3 ? null : enc.encode(fallback);
  }
}

function body(def: TopicDef, p: number, offset: number, ts: number, r: () => number): Body {
  const iso = new Date(ts).toISOString().replace(/\.\d{3}Z$/, 'Z');
  switch (def.name) {
    case 'orders': {
      const orderId = `ord_${hex(r, 5)}`;
      const items = Array.from({ length: 1 + Math.floor(r() * 3) }, () => ({
        sku: `SKU-${String(Math.floor(r() * 9999)).padStart(4, '0')}`,
        qty: 1 + Math.floor(r() * 3),
      }));
      const value = {
        orderId,
        customerId: `cus_${String(Math.floor(r() * 99999)).padStart(5, '0')}`,
        total: Math.round(r() * 250000) / 100 + 5,
        currency: pick(r, CURRENCIES),
        status: pick(r, ['PAID', 'PAID', 'PAID', 'PENDING', 'SHIPPED']),
        items,
        email: r() < 0.8 ? `${pick(r, NAMES)}.${Math.floor(r() * 900 + 100)}@example.com` : null,
        createdAt: ts,
      };
      const id = latestId('orders-value');
      return {
        key: enc.encode(orderId),
        value: frame(id, avroType(id).encode(value)),
        headers: [
          h('region', pick(r, REGIONS)),
          h('source', pick(r, ['web', 'web', 'app'])),
          h('trace-id', hex(r, 16)),
        ],
      };
    }
    case 'payments': {
      const paymentId = `pay_${hex(r, 4)}`;
      const value = {
        paymentId,
        amount: Math.round(r() * 200000) / 100 + 1,
        method: pick(r, ['card', 'card', 'wallet', 'bank']),
        currency: pick(r, CURRENCIES),
        merchantId: `merc_${Math.floor(r() * 90 + 10)}`,
        orderId: r() < 0.9 ? `ord_${hex(r, 5)}` : null,
        createdAt: iso,
      };
      const id = latestId('payments-value');
      return {
        key: enc.encode(paymentId),
        value: frame(id, avroType(id).encode(value)),
        headers: [
          h('region', pick(r, REGIONS)),
          h('gateway', pick(r, ['adyen-sim', 'stripe-sim'])),
        ],
      };
    }
    case 'clickstream': {
      const value = {
        sessionId: `s_${hex(r, 8)}`,
        userId: `u_${Math.floor(r() * 500000)}`,
        page: pick(r, ['/', '/search', '/product', '/cart', '/checkout']),
        event: pick(r, ['view', 'view', 'view', 'click', 'add_to_cart', 'checkout']),
        ts: iso,
        ua: pick(r, ['ios', 'android', 'web']),
      };
      // hot partition 3 gets the anonymous traffic — every key hashes there
      return {
        key: p === 3 ? enc.encode('anonymous') : enc.encode(value.sessionId),
        value: frame(latestId('clickstream-value'), enc.encode(JSON.stringify(value))),
        headers: [],
      };
    }
    case 'inventory': {
      const sku = `SKU-${String(Math.floor(r() * 9999)).padStart(4, '0')}`;
      const value = {
        sku,
        warehouse: pick(r, ['DXB-1', 'AMS-2', 'FRA-1']),
        delta: Math.floor(r() * 21) - 10,
        onHand: Math.floor(r() * 500),
        reason: pick(r, ['sale', 'restock', 'return', 'audit']),
      };
      return { key: enc.encode(sku), value: enc.encode(JSON.stringify(value)), headers: [] };
    }
    case 'notifications': {
      const channel = pick(r, ['email', 'push', 'sms']);
      const value = {
        userId: `u_${Math.floor(r() * 500000)}`,
        channel,
        template: pick(r, ['order-confirmed', 'shipped', 'payment-failed', 'promo']),
      };
      return {
        key: null,
        value: enc.encode(JSON.stringify(value)),
        headers: [h('channel', channel)],
      };
    }
    case 'payments.dlq': {
      const value = {
        originalTopic: 'payments',
        originalPartition: Math.floor(r() * 12),
        originalOffset: Math.floor(r() * 7_000_000),
        error: pick(r, [
          'SchemaNotFound: id 131',
          'AvroTypeException: unexpected EOF',
          'FraudModelTimeout',
        ]),
        failedAt: iso,
      };
      return {
        key: null,
        value: enc.encode(JSON.stringify(value)),
        headers: [h('error.class', 'org.apache.kafka.common.errors.SerializationException')],
      };
    }
    case 'audit-log': {
      const line = `${iso} user=${pick(r, NAMES)} action=${pick(r, ['login', 'update', 'delete', 'export'])} resource=${pick(r, ['customer', 'order', 'report'])}/${Math.floor(r() * 99999)} ip=10.${Math.floor(r() * 255)}.${Math.floor(r() * 255)}.${Math.floor(r() * 255)}`;
      return { key: null, value: enc.encode(line), headers: [] };
    }
    default: {
      if (def.format === 'binary') {
        const b = new Uint8Array(24 + Math.floor(r() * 64));
        for (let i = 0; i < b.length; i++) b[i] = Math.floor(r() * 256);
        return { key: null, value: b, headers: [] };
      }
      if (def.format === 'text') {
        return {
          key: null,
          value: enc.encode(`${iso} ${def.name} record ${offset} ${hex(r, 12)}`),
          headers: [],
        };
      }
      const value = {
        id: `${def.name.slice(0, 3)}_${hex(r, 6)}`,
        at: iso,
        amount: Math.round(r() * 10000) / 100,
        flag: r() < 0.5,
      };
      return {
        key: keyBytes(def, r, value.id),
        value: enc.encode(JSON.stringify(value)),
        headers: [],
      };
    }
  }
}

/** A payments message whose header points at a schema id the registry doesn't have (06b). */
function malformed(r: () => number, ts: number): Body {
  const id = latestId('payments-value');
  const payload = avroType(id).encode({
    paymentId: `pay_${hex(r, 4)}`,
    amount: 742.5,
    method: 'card',
    currency: 'AED',
    merchantId: 'merc_21',
    orderId: null,
    createdAt: new Date(ts).toISOString(),
  });
  return {
    key: enc.encode(`pay_${hex(r, 4)}`),
    value: frame(BAD_SCHEMA_ID, payload),
    headers: [h('region', 'me')],
  };
}

/** A poison message: valid magic byte and schema id, truncated Avro payload. */
function poison(r: () => number, ts: number): Body {
  const ok = malformed(r, ts);
  const v = frame(latestId('payments-value'), ok.value!.slice(5, 14));
  return { key: ok.key, value: v, headers: [h('region', 'eu')] };
}

export interface Overlay {
  malformed: (topic: string, p: number, offset: number) => boolean;
  poisoned: (topic: string, p: number, offset: number) => boolean;
  produced?: RawMessage;
}

export function generateMessage(
  seed: string,
  def: TopicDef,
  partition: number,
  offset: number,
  ts: number,
  overlay?: Overlay,
): RawMessage {
  if (overlay?.produced) return overlay.produced;
  const timestamp = Math.floor(ts);
  const r = rng(hash(seed, def.name, partition, offset));
  const b = overlay?.poisoned(def.name, partition, offset)
    ? poison(r, timestamp)
    : overlay?.malformed(def.name, partition, offset)
      ? malformed(r, timestamp)
      : body(def, partition, offset, timestamp, r);
  const sizeBytes =
    (b.key?.length ?? 0) +
    (b.value?.length ?? 0) +
    b.headers.reduce((a, x) => a + x.key.length + x.value.length, 0);
  return {
    topic: def.name,
    partition,
    offset,
    timestamp: new Date(timestamp).toISOString(),
    key: b.key,
    value: b.value,
    headers: b.headers,
    sizeBytes,
  };
}

/** Deterministic sprinkling of undecodable messages: ~1 in 5,000 on payments. */
export const isMalformed = (seed: string, topic: string, p: number, offset: number) =>
  topic === 'payments' && hash(seed, 'bad', p, offset) % 5000 === 0;
