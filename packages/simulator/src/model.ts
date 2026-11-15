// The seeded demo cluster (docs/SCREENS.md "Sample data story" + values from designs/screens).
import type { GroupState, GroupType } from '@ki/core';

export const CLUSTER = { id: 'prod-eu-1', name: 'prod-eu-1', kafkaVersion: '4.1.0' };
export const DEFAULT_SEED = 'kafka-42';
export const RETENTION_MS = 7 * 24 * 3600 * 1000;

export const BROKERS = [1, 2, 3].map((id) => ({
  id,
  host: `kafka-${id}.prod.internal`,
  port: 9092,
  rack: `eu-west-1${'abc'[id - 1]}`,
  diskTotalBytes: 1_000_000_000_000,
}));

export type Format = 'avro' | 'json-schema' | 'json' | 'text' | 'binary';

export interface TopicDef {
  name: string;
  partitions: number;
  rf: number;
  /** messages/s at the daily mean */
  rate: number;
  avgBytes: number;
  /** size on disk at load, bytes */
  sizeBytes: number;
  format: Format;
  keyFormat?: 'string' | 'int64' | 'uuid';
  subject?: string;
  internal?: boolean;
  /** partition 0's high watermark when the 24 h back-fill starts (load − 24 h); others spread around it */
  endAtLoad: number;
  silentForMs?: number;
  producer?: string;
  retentionMs?: number;
  minIsr?: number;
  /** partition → share override (0..1), e.g. clickstream p3 hot */
  skew?: Record<number, number>;
  cleanup?: 'delete' | 'compact';
  /** user overrides (demo writes): create-topic configs and config edits */
  configs?: Record<string, string | null>;
}

const GB = 1e9;

export const CORE_TOPICS: TopicDef[] = [
  {
    name: 'orders',
    partitions: 24,
    rf: 3,
    rate: 21840,
    avgBytes: 412,
    sizeBytes: 512 * GB,
    format: 'avro',
    keyFormat: 'string',
    subject: 'orders-value',
    endAtLoad: 21_880_000,
    producer: 'web-checkout',
  },
  {
    name: 'payments',
    partitions: 12,
    rf: 3,
    rate: 7511,
    avgBytes: 214,
    sizeBytes: 201 * GB,
    format: 'avro',
    keyFormat: 'string',
    subject: 'payments-value',
    endAtLoad: 7_511_200,
    producer: 'payment-gateway',
  },
  {
    name: 'clickstream',
    partitions: 12,
    rf: 3,
    rate: 14206,
    avgBytes: 380,
    sizeBytes: 402 * GB,
    format: 'json-schema',
    subject: 'clickstream-value',
    endAtLoad: 64_200_000,
    producer: 'tracker-sdk',
    skew: { 3: 0.41 },
  },
  {
    name: 'inventory',
    partitions: 12,
    rf: 3,
    rate: 3092,
    avgBytes: 180,
    sizeBytes: 86 * GB,
    format: 'json',
    keyFormat: 'string',
    subject: 'inventory-value',
    endAtLoad: 3_310_000,
    producer: 'inventory-svc',
  },
  {
    name: 'notifications',
    partitions: 6,
    rf: 3,
    rate: 1564,
    avgBytes: 240,
    sizeBytes: 22 * GB,
    format: 'json',
    subject: 'notifications-value',
    endAtLoad: 4_020_000,
    producer: 'notify-api',
  },
  {
    name: 'payments.dlq',
    partitions: 3,
    rf: 3,
    rate: 4,
    avgBytes: 640,
    sizeBytes: 312e6,
    format: 'json',
    endAtLoad: 162_000,
    producer: 'fraud-scorer',
  },
  {
    name: 'audit-log',
    partitions: 3,
    rf: 1,
    rate: 212,
    avgBytes: 160,
    sizeBytes: 18 * GB,
    format: 'text',
    endAtLoad: 31_400_000,
    producer: 'audit-agent',
  },
  {
    name: 'legacy-events',
    partitions: 6,
    rf: 3,
    rate: 0,
    avgBytes: 96,
    sizeBytes: 4.1 * GB,
    format: 'binary',
    endAtLoad: 1_204_000,
    silentForMs: 9 * 24 * 3600 * 1000,
    producer: 'legacy-batch',
  },
];

// 31 smaller topics so the cluster matches the references: 42 topics, 186 partitions (3 internal).
const FILLER: Array<[string, number, Format, ('string' | 'int64' | 'uuid')?]> = [
  ['deliveries', 2, 'json'],
  ['refunds', 2, 'json'],
  ['user-profiles', 2, 'json', 'string'],
  ['sessions', 2, 'json', 'uuid'],
  ['search-queries', 2, 'json'],
  ['email-events', 2, 'json'],
  ['sms-events', 2, 'json'],
  ['push-events', 2, 'json'],
  ['pricing', 2, 'json', 'string'],
  ['promotions', 2, 'json'],
  ['carts', 2, 'json', 'uuid'],
  ['wishlists', 2, 'json'],
  ['reviews', 2, 'json'],
  ['ratings', 2, 'json'],
  ['returns', 2, 'json'],
  ['warehouse-events', 2, 'json'],
  ['fulfilment', 2, 'json'],
  ['invoices', 2, 'json'],
  ['ledger', 2, 'json'],
  ['fx-rates', 2, 'json', 'string'],
  ['geo-events', 2, 'json'],
  ['device-telemetry', 2, 'json', 'uuid'],
  ['feature-flags', 2, 'json', 'string'],
  ['experiments', 1, 'json'],
  ['recommendations', 1, 'json'],
  ['catalog-updates', 1, 'json', 'string'],
  ['stock-levels', 1, 'json', 'int64'],
  ['supplier-feeds', 1, 'text'],
  ['loyalty-points', 1, 'json', 'int64'],
  ['support-tickets', 1, 'json'],
  ['chat-messages', 1, 'text'],
];

export const FILLER_TOPICS: TopicDef[] = FILLER.map(([name, partitions, format, keyFormat], i) => ({
  name,
  partitions,
  rf: 3,
  rate: 2 + ((i * 7) % 11),
  avgBytes: 200 + ((i * 37) % 300),
  sizeBytes: (0.2 + ((i * 13) % 17) / 10) * GB,
  format,
  keyFormat,
  endAtLoad: 50_000 + i * 12_345,
  producer: 'platform-services',
}));

export const INTERNAL_TOPICS: TopicDef[] = [
  {
    name: '__consumer_offsets',
    partitions: 50,
    rf: 3,
    rate: 40,
    avgBytes: 120,
    sizeBytes: 2.1 * GB,
    format: 'binary',
    internal: true,
    endAtLoad: 900_000,
    cleanup: 'compact',
  },
  {
    name: '__share_group_state',
    partitions: 3,
    rf: 3,
    rate: 2,
    avgBytes: 90,
    sizeBytes: 0.1 * GB,
    format: 'binary',
    internal: true,
    endAtLoad: 40_000,
    cleanup: 'compact',
  },
  {
    name: '_schemas',
    partitions: 1,
    rf: 3,
    rate: 0,
    avgBytes: 600,
    sizeBytes: 0.002 * GB,
    format: 'json',
    internal: true,
    endAtLoad: 42,
    cleanup: 'compact',
  },
];

export const SEED_TOPICS: TopicDef[] = [...CORE_TOPICS, ...FILLER_TOPICS, ...INTERNAL_TOPICS];

export interface GroupDef {
  groupId: string;
  type: GroupType;
  members: number;
  topics: string[];
  /** consume capacity as a multiple of the produce rate */
  capacity: number;
  /** member host prefix */
  hostBase: string;
  initialState?: GroupState;
  /** ms before load when the group stopped committing (Empty groups) */
  stoppedForMs?: number;
}

export const SEED_GROUPS: GroupDef[] = [
  {
    groupId: 'order-service',
    type: 'consumer',
    members: 6,
    topics: ['orders'],
    capacity: 1.6,
    hostBase: '10.0.2.',
  },
  {
    groupId: 'payments-sink',
    type: 'classic',
    members: 3,
    topics: ['orders', 'payments'],
    capacity: 1.0,
    hostBase: '10.0.4.',
  },
  {
    groupId: 'fraud-scorer',
    type: 'consumer',
    members: 2,
    topics: ['payments'],
    capacity: 1.5,
    hostBase: '10.0.6.',
  },
  {
    groupId: 'analytics-etl',
    type: 'consumer',
    members: 4,
    topics: ['clickstream', 'orders', 'audit-log', ...FILLER_TOPICS.map((t) => t.name)],
    capacity: 1.4,
    hostBase: '10.0.8.',
  },
  {
    groupId: 'search-indexer',
    type: 'consumer',
    members: 0,
    topics: ['inventory'],
    capacity: 1.4,
    hostBase: '10.0.9.',
    initialState: 'Empty',
    stoppedForMs: (2 * 60 + 14) * 60 * 1000,
  },
  {
    groupId: 'notify-workers',
    type: 'share',
    members: 8,
    topics: ['notifications'],
    capacity: 1.05,
    hostBase: '10.0.3.',
  },
];

/** payments-sink saw-tooth: a periodic slowdown builds ~9.3k lag that then drains in ~14 min (see DECISIONS). */
export const SINK_CYCLE = {
  periodMs: 16 * 60 * 1000,
  dipMs: 60 * 1000,
  dipDeficit: 155,
  drainSurplus: 11,
  phaseAtLoadMs: 58 * 1000,
};

/** Poison message on payments-7 (story: fraud-scorer stalled for 6m 12s at offset 88,410). */
export const POISON = {
  topic: 'payments',
  partition: 7,
  offset: 88_410,
  group: 'fraud-scorer',
  activeForMsAtLoad: 372_000,
};

/** Messages that are deliberately undecodable (06b). */
export const BAD_SCHEMA_ID = 131;
export const MALFORMED = [{ topic: 'payments', partition: 4, offset: 7_511_202 }];

export const PRODUCERS = [
  'web-checkout',
  'payment-gateway',
  'tracker-sdk',
  'inventory-svc',
  'notify-api',
  'audit-agent',
  'legacy-batch',
  'platform-services',
  'fraud-scorer',
];
