// The simulator's own Schema Registry: 9 subjects (designs/screens/Schemas.dc.html).
import type { SchemaVersion, SubjectSummary } from '@ki/core';

const rec = (name: string, fields: unknown[]) =>
  JSON.stringify({ type: 'record', name, namespace: 'com.example', fields }, null, 2);
const f = (name: string, type: unknown, extra: Record<string, unknown> = {}) => ({
  name,
  type,
  ...extra,
});
const ts = { type: 'long', logicalType: 'timestamp-millis' };
const items = {
  type: 'array',
  items: { type: 'record', name: 'Item', fields: [f('sku', 'string'), f('qty', 'int')] },
};

const ORDERS = [
  rec('Order', [
    f('orderId', 'string'),
    f('customerId', 'string'),
    f('total', 'float'),
    f('currency', 'string'),
    f('createdAt', ts),
  ]),
  rec('Order', [
    f('orderId', 'string'),
    f('customerId', 'string'),
    f('total', 'float'),
    f('currency', 'string'),
    f('status', 'string', { default: 'NEW' }),
    f('createdAt', ts),
  ]),
  rec('Order', [
    f('orderId', 'string'),
    f('customerId', 'string'),
    f('total', 'float'),
    f('currency', 'string'),
    f('channel', 'string'),
    f('status', 'string', { default: 'NEW' }),
    f('createdAt', ts),
  ]),
  rec('Order', [
    f('orderId', 'string'),
    f('customerId', 'string'),
    f('total', 'double'),
    f('currency', 'string'),
    f('status', 'string', { default: 'NEW' }),
    f('items', items, { default: [] }),
    f('email', ['null', 'string'], { default: null }),
    f('createdAt', ts),
  ]),
];

const PAYMENTS = [1, 2, 3, 4, 5, 6, 7].map((v) =>
  rec('Payment', [
    f('paymentId', 'string'),
    f('amount', 'double'),
    f('method', 'string'),
    f('currency', 'string'),
    ...(v >= 3 ? [f('merchantId', 'string', { default: '' })] : []),
    ...(v >= 5 ? [f('orderId', ['null', 'string'], { default: null })] : []),
    ...(v >= 7 ? [f('createdAt', 'string', { default: '' })] : []),
  ]),
);

const json = (title: string, props: Record<string, unknown>, required: string[]) =>
  JSON.stringify(
    {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title,
      type: 'object',
      properties: props,
      required,
    },
    null,
    2,
  );

const CLICK = [
  json(
    'Click',
    {
      sessionId: { type: 'string' },
      userId: { type: 'string' },
      page: { type: 'string' },
      event: { type: 'string' },
      ts: { type: 'string' },
    },
    ['sessionId', 'event'],
  ),
  json(
    'Click',
    {
      sessionId: { type: 'string' },
      userId: { type: 'string' },
      page: { type: 'string' },
      event: { type: 'string', enum: ['view', 'click', 'add_to_cart', 'checkout'] },
      ts: { type: 'string' },
      ua: { type: 'string' },
    },
    ['sessionId', 'event'],
  ),
];
const INVENTORY = [1, 2, 3].map((v) =>
  json(
    'Stock',
    {
      sku: { type: 'string' },
      warehouse: { type: 'string' },
      delta: { type: 'integer' },
      ...(v >= 2 ? { onHand: { type: 'integer' } } : {}),
      ...(v >= 3 ? { reason: { type: 'string' } } : {}),
    },
    ['sku', 'delta'],
  ),
);

interface Subject {
  subject: string;
  type: SchemaVersion['type'];
  compatibility: SubjectSummary['compatibility'];
  ids: number[];
  schemas: string[];
  dates: string[];
}

export const SUBJECTS: Subject[] = [
  {
    subject: 'orders-value',
    type: 'AVRO',
    compatibility: 'BACKWARD',
    ids: [12, 31, 64, 112],
    schemas: ORDERS,
    dates: ['2026-03-02', '2026-06-18', '2026-10-12', '2026-11-02'],
  },
  {
    subject: 'payments-value',
    type: 'AVRO',
    compatibility: 'BACKWARD',
    ids: [20, 41, 58, 77, 90, 104, 128],
    schemas: PAYMENTS,
    dates: [
      '2026-01-10',
      '2026-02-14',
      '2026-04-01',
      '2026-05-20',
      '2026-07-08',
      '2026-09-01',
      '2026-10-28',
    ],
  },
  {
    subject: 'clickstream-value',
    type: 'JSON',
    compatibility: 'BACKWARD',
    ids: [33, 101],
    schemas: CLICK,
    dates: ['2026-03-30', '2026-10-01'],
  },
  {
    subject: 'inventory-value',
    type: 'JSON',
    compatibility: 'FULL',
    ids: [15, 52, 88],
    schemas: INVENTORY,
    dates: ['2026-01-20', '2026-05-02', '2026-08-15'],
  },
  {
    subject: 'notifications-value',
    type: 'JSON',
    compatibility: 'BACKWARD',
    ids: [70],
    schemas: [
      json(
        'Notification',
        { userId: { type: 'string' }, channel: { type: 'string' }, template: { type: 'string' } },
        ['userId', 'channel'],
      ),
    ],
    dates: ['2026-06-30'],
  },
  {
    subject: 'orders-key',
    type: 'AVRO',
    compatibility: 'FULL',
    ids: [13],
    schemas: [JSON.stringify('string')],
    dates: ['2026-03-02'],
  },
  {
    subject: 'payments-key',
    type: 'AVRO',
    compatibility: 'FULL',
    ids: [21],
    schemas: [JSON.stringify('string')],
    dates: ['2026-01-10'],
  },
  {
    subject: 'inventory-key',
    type: 'AVRO',
    compatibility: 'FULL',
    ids: [16],
    schemas: [JSON.stringify('string')],
    dates: ['2026-01-20'],
  },
  {
    subject: 'payments.dlq-value',
    type: 'JSON',
    compatibility: 'NONE',
    ids: [95],
    schemas: [
      json(
        'DeadLetter',
        {
          originalTopic: { type: 'string' },
          originalPartition: { type: 'integer' },
          originalOffset: { type: 'integer' },
          error: { type: 'string' },
        },
        ['originalTopic', 'error'],
      ),
    ],
    dates: ['2026-08-20'],
  },
];

export function listSubjects(): SubjectSummary[] {
  return SUBJECTS.map((s) => ({
    subject: s.subject,
    latestVersion: s.ids.length,
    type: s.type,
    compatibility: s.compatibility,
    versions: s.ids.map((_, i) => i + 1),
  }));
}

export function getSchema(subject: string, version: number | 'latest'): SchemaVersion | undefined {
  const s = SUBJECTS.find((x) => x.subject === subject);
  if (!s) return undefined;
  const v = version === 'latest' ? s.ids.length : version;
  if (v < 1 || v > s.ids.length) return undefined;
  return {
    subject,
    version: v,
    id: s.ids[v - 1]!,
    type: s.type,
    schema: s.schemas[v - 1]!,
    registeredAt: s.dates[v - 1],
  };
}

export function getSchemaById(id: number): SchemaVersion | undefined {
  for (const s of SUBJECTS) {
    const i = s.ids.indexOf(id);
    if (i >= 0) return getSchema(s.subject, i + 1);
  }
  return undefined;
}

export const latestId = (subject: string) => getSchema(subject, 'latest')!.id;
