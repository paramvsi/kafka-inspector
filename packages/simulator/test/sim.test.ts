import avro from 'avsc';
import { beforeAll, describe, expect, test } from 'vitest';
import { MemoryStore, Simulator } from '../src';
import { getSchemaById } from '../src/registry';

const LOAD = Date.parse('2026-11-15T14:27:31Z');

function make(store = new MemoryStore(), seed?: string) {
  let now = LOAD;
  const sim = new Simulator({ seed, store, now: () => now });
  return {
    sim,
    init: () => sim.init(),
    advance(seconds: number) {
      for (let i = 0; i < seconds; i++) {
        now += 1000;
        sim.tick(now);
      }
    },
  };
}

describe('seeded cluster', () => {
  const h = make();
  let ms = 0;
  beforeAll(async () => {
    const t0 = performance.now();
    await h.init();
    ms = performance.now() - t0;
  });

  test('back-fill of 24 h stays fast', () => {
    expect(ms).toBeLessThan(2000);
    expect(h.sim.historySize).toBeGreaterThan(1400 + 890);
  });

  test('matches the reference cluster: 42 topics, 186 partitions, 3 brokers, 6 groups', () => {
    const all = h.sim.listTopics({ internal: true, size: 500 });
    expect(all.total).toBe(42);
    expect(all.items.reduce((a, t) => a + t.partitions, 0)).toBe(186);
    expect(h.sim.listTopics({}).total).toBe(39);
    expect(h.sim.listBrokers()).toHaveLength(3);
    expect(h.sim.listGroups()).toHaveLength(6);
  });

  test('opening state reproduces the story', () => {
    const g = Object.fromEntries(h.sim.listGroups().map((x) => [x.groupId, x]));
    expect(g['fraud-scorer']!.status).toBe('stalled');
    expect(g['search-indexer']!.status).toBe('stopped');
    expect(g['search-indexer']!.state).toBe('Empty');
    expect(g['order-service']!.status).toBe('healthy');
    expect(g['notify-workers']!.type).toBe('share');
    expect(g['payments-sink']!.status).toBe('warn');
    expect(g['payments-sink']!.totalLag).toBeGreaterThan(7000);
    expect(g['payments-sink']!.totalLag).toBeLessThan(10000);
    const att = h.sim.getOverview().attention.map((a) => a.title);
    expect(att).toContain('fraud-scorer stalled');
    expect(att).toContain('clickstream partition 3 is hot');
    const k = h.sim.getOverview().kpis;
    expect(k.messagesInPerSec).toBeGreaterThan(38000);
    expect(k.messagesInPerSec).toBeLessThan(58000);
  });

  test('topic health: only clickstream is skewed; 3 topics need attention (clickstream, audit-log, legacy-events)', () => {
    const all = h.sim.listTopics({ size: 500 }).items;
    expect(all.filter((t) => t.health.some((x) => x.id === 'skew')).map((t) => t.name)).toEqual([
      'clickstream',
    ]);
    expect(
      h.sim.listTopics({ view: 'attention', size: 500, sort: 'name' }).items.map((t) => t.name),
    ).toEqual(['audit-log', 'clickstream', 'legacy-events']);
  });

  test('payments-sink then drains and forecasts ~14 min', () => {
    h.advance(60);
    const s = h.sim.listGroups().find((x) => x.groupId === 'payments-sink')!;
    expect(s.status).toBe('healthy');
    expect(s.forecast.kind).toBe('eta');
    expect(s.forecast.seconds! / 60).toBeGreaterThan(9);
    expect(s.forecast.seconds! / 60).toBeLessThan(19);
  });

  test('the stalled partition holds a poison message that fails to decode', () => {
    const gp = h.sim.getGroup('fraud-scorer').partitions.find((p) => p.status === 'stalled')!;
    expect(gp.topic).toBe('payments');
    expect(gp.partition).toBe(7);
    const page = h.sim.browse({
      topic: 'payments',
      partition: 7,
      from: 'offset',
      offset: gp.committedOffset!,
      limit: 1,
    });
    const v = page.messages[0]!.value!;
    expect(v[0]).toBe(0);
    const type = avro.Type.forSchema(
      JSON.parse(getSchemaById(new DataView(v.buffer, v.byteOffset).getInt32(1))!.schema),
    );
    expect(() => type.fromBuffer(Buffer.from(v.slice(5)))).toThrow();
  });
});

describe('messages', () => {
  test('same seed → identical first 1,000 messages of orders', async () => {
    const a = make(),
      b = make();
    await Promise.all([a.init(), b.init()]);
    const read = (s: Simulator) => {
      const out: string[] = [];
      let cursor: string | undefined;
      while (out.length < 1000) {
        const page = s.browse({
          topic: 'orders',
          partition: 0,
          from: 'oldest',
          limit: 500,
          cursor,
        });
        out.push(
          ...page.messages.map(
            (m) => `${m.offset}:${m.timestamp}:${Buffer.from(m.value!).toString('hex')}`,
          ),
        );
        cursor = page.nextCursor;
      }
      return out;
    };
    expect(read(a.sim)).toEqual(read(b.sim));
    const c = make(undefined, 'other-seed');
    await c.init();
    expect(read(c.sim).slice(0, 5)).not.toEqual(read(a.sim).slice(0, 5));
  }, 15_000); // ~0.7 s alone; two back-fills + 1,000 decodes can be slow on a busy machine

  test('Avro messages round-trip through avsc with the registry schema (Confluent wire format)', async () => {
    const h = make();
    await h.init();
    const m = h.sim.browse({ topic: 'orders', partition: 'all', from: 'newest', limit: 5 })
      .messages[0]!;
    const v = m.value!;
    expect(v[0]).toBe(0);
    const id = new DataView(v.buffer, v.byteOffset).getInt32(1, false);
    expect(id).toBe(112);
    const type = avro.Type.forSchema(JSON.parse(getSchemaById(id)!.schema));
    const decoded = type.fromBuffer(Buffer.from(v.slice(5))) as { orderId: string; total: number };
    expect(decoded.orderId).toMatch(/^ord_[0-9a-f]{5}$/);
    expect(new TextDecoder().decode(m.key!)).toBe(decoded.orderId);
    expect(Buffer.from(type.toBuffer(decoded))).toEqual(Buffer.from(v.slice(5)));
  });

  test('newest-first browse is ordered by time across partitions and respects the limit', async () => {
    const h = make();
    await h.init();
    const page = h.sim.browse({ topic: 'orders', partition: 'all', from: 'newest', limit: 100 });
    expect(page.messages).toHaveLength(100);
    const ts = page.messages.map((m) => m.timestamp);
    expect([...ts].sort().reverse()).toEqual(ts);
  });
});

describe('chaos and recovery', () => {
  test('poison → reset offsets shift +1 → fraud-scorer recovers', async () => {
    const h = make();
    await h.init();
    const reset = await h.sim.resetOffsets(
      {
        groupId: 'fraud-scorer',
        topic: 'payments',
        partitions: [7],
        strategy: { kind: 'shift', by: 1 },
      },
      true,
    );
    expect(reset.rows.find((r) => r.partition === 7)!.next).toBe(
      reset.rows.find((r) => r.partition === 7)!.current! + 1,
    );
    expect(reset.applied).toBe(false);
    await h.sim.resetOffsets(
      {
        groupId: 'fraud-scorer',
        topic: 'payments',
        partitions: [7],
        strategy: { kind: 'shift', by: 1 },
      },
      false,
    );
    h.advance(40);
    const g = h.sim.listGroups().find((x) => x.groupId === 'fraud-scorer')!;
    expect(g.status).toBe('healthy');
    const lag1 = g.totalLag;
    h.advance(10);
    expect(h.sim.listGroups().find((x) => x.groupId === 'fraud-scorer')!.totalLag).toBeLessThan(
      lag1,
    );
  });

  test('crash consumer → Empty, then stopped after the window; stop restores it', async () => {
    const h = make();
    await h.init();
    const inc = h.sim.runChaos({ kind: 'crash-consumer', target: 'order-service' });
    h.advance(2);
    expect(h.sim.listGroups().find((x) => x.groupId === 'order-service')!.state).toBe('Empty');
    h.advance(62);
    expect(h.sim.listGroups().find((x) => x.groupId === 'order-service')!.status).toBe('stopped');
    h.sim.stopChaos(inc.id);
    h.advance(12);
    const g = h.sim.listGroups().find((x) => x.groupId === 'order-service')!;
    expect(g.state).toBe('Stable');
  });

  test('broker down → under-replicated partitions, degraded cluster, leaders moved', async () => {
    const h = make();
    await h.init();
    h.sim.runChaos({ kind: 'broker-down', target: '2' });
    h.advance(1);
    const o = h.sim.getOverview();
    expect(o.kpis.underReplicated).toBeGreaterThan(100);
    expect(o.kpis.brokersOnline).toBe(2);
    expect(o.cluster.status).toBe('degraded');
    expect(h.sim.listBrokers().find((b) => b.id === 2)!.leaders).toBe(0);
  });

  test('traffic spike multiplies throughput ×10 and expires after 2 minutes', async () => {
    const h = make();
    await h.init();
    const before = h.sim.getOverview().kpis.messagesInPerSec;
    h.sim.runChaos({ kind: 'traffic-spike' });
    h.advance(1);
    expect(h.sim.getOverview().kpis.messagesInPerSec / before).toBeGreaterThan(8);
    h.advance(121);
    expect(h.sim.listIncidents()).toHaveLength(0);
  });
});

describe('writes and persistence', () => {
  test('created topics and produced messages survive a reload', async () => {
    const store = new MemoryStore();
    const a = make(store);
    await a.init();
    await a.sim.createTopic({ name: 'shipments', partitions: 3, replicationFactor: 3 });
    const res = await a.sim.produce({ topic: 'shipments', key: 'k1', value: '{"hello":"world"}' });
    await expect(
      a.sim.createTopic({ name: 'shipments', partitions: 3, replicationFactor: 3 }),
    ).rejects.toThrow('already exists');
    await expect(
      a.sim.createTopic({ name: 'x', partitions: 1, replicationFactor: 4 }),
    ).rejects.toThrow('between 1 and 3');
    const b = make(store);
    await b.init();
    const page = b.sim.browse({
      topic: 'shipments',
      partition: res.partition,
      from: 'oldest',
      limit: 10,
    });
    expect(page.messages).toHaveLength(1);
    expect(new TextDecoder().decode(page.messages[0]!.value!)).toBe('{"hello":"world"}');
  });
});

describe('topic config edits (F-36)', () => {
  test('overrides apply, reset to default, survive a reload, and are validated', async () => {
    const store = new MemoryStore();
    const a = make(store);
    await a.init();
    const value = (sim: typeof a.sim, n: string) =>
      sim.getTopicConfig('orders').find((c) => c.name === n)!;
    await a.sim.updateTopicConfig('orders', { 'retention.ms': '3600000' });
    expect(value(a.sim, 'retention.ms')).toMatchObject({ value: '3600000', isDefault: false });
    await a.sim.updateTopicConfig('orders', { 'retention.ms': null });
    expect(value(a.sim, 'retention.ms')).toMatchObject({ value: '604800000', isDefault: true });
    await a.sim.updateTopicConfig('orders', { 'segment.ms': '1000' });
    await expect(a.sim.updateTopicConfig('orders', { 'segment.ms': 'soon' })).rejects.toThrow(
      'whole number',
    );
    await expect(a.sim.updateTopicConfig('orders', { 'no.such': '1' })).rejects.toThrow(
      'Unknown topic config',
    );
    const b = make(store);
    await b.init();
    expect(value(b.sim, 'segment.ms')).toMatchObject({ value: '1000', isDefault: false });
  });

  test('create-topic configs show as overrides', async () => {
    const a = make(new MemoryStore());
    await a.init();
    await a.sim.createTopic({
      name: 'shipments',
      partitions: 3,
      replicationFactor: 3,
      configs: { 'compression.type': 'zstd' },
    });
    const c = a.sim.getTopicConfig('shipments').find((x) => x.name === 'compression.type')!;
    expect(c).toMatchObject({ value: 'zstd', isDefault: false });
  });
});

test('resetting a built-in override returns it to the default', async () => {
  const a = make(new MemoryStore());
  await a.init();
  const get = () => a.sim.getTopicConfig('orders').find((c) => c.name === 'max.message.bytes')!;
  expect(get().isDefault).toBe(false);
  await a.sim.updateTopicConfig('orders', { 'max.message.bytes': null });
  expect(get()).toMatchObject({ value: '1048588', isDefault: true });
});

test('deleting a topic a group reads keeps the group readable, and reloads still boot', async () => {
  const store = new MemoryStore();
  const a = make(store);
  await a.init();
  await a.sim.resetOffsets(
    {
      groupId: 'order-service',
      topic: 'orders',
      partitions: [0],
      strategy: { kind: 'shift', by: 1 },
    },
    false,
  );
  await a.sim.deleteTopic('orders');
  expect(() => a.sim.getGroup('order-service')).not.toThrow();
  a.advance(2);
  const b = make(store);
  await b.init(); // replays a reset on a topic that's gone
  expect(b.sim.listTopics({ query: 'orders' }).items.map((t) => t.name)).not.toContain('orders');
});

test('disabling or deleting a rule resolves its firing alerts', async () => {
  const a = make();
  await a.init();
  a.advance(35); // seeded "group stalled" rule fires after 30 s (fraud-scorer)
  const firing = () =>
    a.sim.listAlerts({ state: 'firing' }).filter((e) => e.ruleId === 'r-group-stalled');
  expect(firing().length).toBeGreaterThan(0);
  const rule = a.sim.listAlertRules().find((r) => r.id === 'r-group-stalled')!;
  await a.sim.saveAlertRule({ ...rule, enabled: false });
  a.advance(1);
  expect(firing()).toHaveLength(0);
  await a.sim.saveAlertRule({ ...rule, enabled: true });
  a.advance(35);
  expect(firing().length).toBeGreaterThan(0);
  await a.sim.deleteAlertRule('r-group-stalled');
  expect(firing()).toHaveLength(0);
  expect(a.sim.getOverview().kpis.activeAlerts).toBe(a.sim.listAlerts({ state: 'firing' }).length);
});

test('with two brokers down, bringing one back leaves the other out of ISR and leadership', async () => {
  const a = make();
  await a.init();
  const two = a.sim.runChaos({ kind: 'broker-down', target: '2' });
  a.sim.runChaos({ kind: 'broker-down', target: '3' });
  a.advance(1);
  a.sim.stopChaos(two.id);
  a.advance(1);
  const parts = a.sim.getTopic('orders').partitions;
  expect(parts.every((p) => !p.isr.includes(3) && p.leader !== 3)).toBe(true);
  expect(a.sim.getOverview().kpis.underReplicated).toBeGreaterThan(0);
});

test('history time lookup ignores the gap before a series existed', async () => {
  const { History } = await import('../src/history');
  const h = new History();
  h.push(1000, new Map([['a', 1]]));
  h.push(
    2000,
    new Map([
      ['a', 2],
      ['b', 10],
    ]),
  );
  h.push(
    3000,
    new Map([
      ['a', 3],
      ['b', 20],
    ]),
  );
  expect(h.timeOf('b', 15)).toBe(2500);
  expect(h.timeOf('b', 5)).toBeUndefined();
});

test('reset offsets rejects NaN strategies instead of storing NaN commits', async () => {
  const a = make();
  await a.init();
  const req = (strategy: object) =>
    a.sim.resetOffsets(
      { groupId: 'order-service', topic: 'orders', partitions: [0], strategy } as never,
      true,
    );
  await expect(req({ kind: 'shift', by: NaN })).rejects.toThrow('whole number');
  await expect(req({ kind: 'offset', offset: -1 })).rejects.toThrow('0 or more');
  await expect(req({ kind: 'timestamp', timestamp: 'soon' })).rejects.toThrow('valid date');
});

test('F-38: all six health checks exist, and config edits change them', async () => {
  const a = make(new MemoryStore());
  await a.init();
  const ids = () =>
    new Set(
      a.sim
        .listTopics({ internal: true, size: 500 })
        .items.flatMap((t) => t.health.map((h) => `${h.id}:${t.name}`)),
    );
  for (const id of [
    'rf1:audit-log',
    'no-consumers:legacy-events',
    'skew:clickstream',
    'disk-fill:orders',
  ])
    expect(ids().has(id)).toBe(true);
  await a.sim.updateTopicConfig('payments', { 'retention.ms': '-1', 'min.insync.replicas': '1' });
  expect(ids().has('infinite-retention:payments')).toBe(true);
  expect(ids().has('low-min-isr:payments')).toBe(true);
  await a.sim.updateTopicConfig('payments', { 'retention.ms': null, 'min.insync.replicas': null });
  expect(ids().has('infinite-retention:payments')).toBe(false);
  expect(ids().has('low-min-isr:payments')).toBe(false);
});

test('chaos: the same action on the same target cannot overlap; unknown brokers are refused', async () => {
  const a = make(new MemoryStore());
  await a.init();
  a.sim.runChaos({ kind: 'traffic-spike' });
  expect(() => a.sim.runChaos({ kind: 'traffic-spike' })).toThrow('already running');
  a.sim.runChaos({ kind: 'crash-consumer', target: 'order-service' });
  expect(() => a.sim.runChaos({ kind: 'crash-consumer', target: 'order-service' })).toThrow(
    'already running',
  );
  expect(() => a.sim.runChaos({ kind: 'broker-down', target: '9' })).toThrow('does not exist');
});

test('a created topic has exactly RF replicas, and a broker that is down is not in its ISR', async () => {
  const a = make(new MemoryStore());
  await a.init();
  a.sim.runChaos({ kind: 'broker-down', target: '2' });
  await a.sim.createTopic({ name: 'rf2', partitions: 3, replicationFactor: 2 });
  const parts = a.sim.getTopic('rf2').partitions;
  expect(parts.every((p) => p.replicas.length === 2)).toBe(true);
  expect(parts.every((p) => !p.isr.includes(2) && p.leader !== 2)).toBe(true);
  await expect(
    a.sim.createTopic({ name: 'frac', partitions: 1, replicationFactor: 1.5 }),
  ).rejects.toThrow();
});

test('a saved fix for the poison message survives a reload long after it', async () => {
  const store = new MemoryStore();
  let now = LOAD;
  const first = new Simulator({ store, now: () => now });
  await first.init();
  await first.resetOffsets(
    {
      groupId: 'fraud-scorer',
      topic: 'payments',
      partitions: [7],
      strategy: { kind: 'shift', by: 1 },
    },
    false,
  );
  now = LOAD + 20 * 60_000; // reload 20 minutes later
  const second = new Simulator({ store, now: () => now });
  await second.init();
  expect(second.getGroup('fraud-scorer').summary.status).not.toBe('stalled');
});

test('controller follows the lowest online broker; produce to a leaderless partition is refused', async () => {
  const a = make(new MemoryStore());
  await a.init();
  a.sim.runChaos({ kind: 'broker-down', target: '1' });
  a.sim.runChaos({ kind: 'broker-down', target: '2' });
  a.advance(1);
  expect(a.sim.getOverview().kpis.activeController).toBe(3);
  await a.sim.createTopic({ name: 'one', partitions: 3, replicationFactor: 1 });
  const parts = a.sim.getTopic('one').partitions;
  const dead = parts.find((p) => p.leader === null)!;
  await expect(
    a.sim.produce({ topic: 'one', partition: dead.partition, value: '{}' }),
  ).rejects.toThrow('has no leader');
});
