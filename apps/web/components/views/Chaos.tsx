'use client';
import {
  formatClock,
  formatInt,
  type ChaosActionKind,
  type ClusterEvent,
  type GroupSummary,
  type Incident,
  type Overview,
} from '@ki/core';
import { Button, Card, Checkbox, Select, StatusBadge, TextField, useToast } from '@ki/ui';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useKafka, useKafkaQuery, useStream } from '../../lib/kafka';
import { startTour } from '../Tour';
import { PageHeader } from '../Page';

const ACTIONS: Array<{
  kind: ChaosActionKind;
  title: string;
  text: string;
  target?: 'group' | 'topic' | 'broker';
  default?: string;
  effect: string;
}> = [
  {
    kind: 'crash-consumer',
    title: 'Crash consumer',
    text: 'Group goes Empty, lag climbs, status Stopped, an alert fires.',
    target: 'group',
    default: 'order-service',
    effect: 'all members left',
  },
  {
    kind: 'slow-consumer',
    title: 'Slow consumer',
    text: 'Lag rises steadily, status Warn, forecast changes.',
    target: 'group',
    default: 'payments-sink',
    effect: 'consume rate cut to 60%',
  },
  {
    kind: 'traffic-spike',
    title: 'Traffic spike ×10',
    text: 'Throughput jumps, lag spikes, then recovers.',
    target: 'topic',
    default: '*',
    effect: 'producers at 10× for 2 minutes',
  },
  {
    kind: 'broker-down',
    title: 'Broker down',
    text: 'Under-replicated partitions, leaders move, broker tile turns red.',
    target: 'broker',
    default: '2',
    effect: 'ISR shrank, leaders moved',
  },
  {
    kind: 'rebalance',
    title: 'Rebalance',
    text: 'Group goes Rebalancing, short lag bump, event in the feed.',
    target: 'group',
    default: 'analytics-etl',
    effect: 'members rejoining',
  },
  {
    kind: 'hot-partition',
    title: 'Hot partition',
    text: 'One key floods a partition; skew warning appears.',
    target: 'topic',
    default: 'orders',
    effect: '40% of traffic on one partition',
  },
  {
    kind: 'poison-message',
    title: 'Poison message',
    text: 'A malformed payment stalls fraud-scorer; failures land in payments.dlq. Fix it with Reset offsets → Shift by +1.',
    effect: 'fraud-scorer keeps failing on one offset',
  },
];

export function ChaosView() {
  const { client, info } = useKafka();
  const toast = useToast();
  const qc = useQueryClient();
  const incidents = useKafkaQuery(
    ['incidents'],
    (c) => c.chaos?.incidents() ?? Promise.resolve([] as Incident[]),
    1000,
  );
  const groups = useStream<GroupSummary[]>('lag');
  const overview = useStream<Overview>('metrics');
  const events = useStream<ClusterEvent[]>('events');
  const topics = useKafkaQuery(
    ['topics', 'names'],
    (c, id) => c.listTopics(id, { size: 500 }),
    false,
  );
  const [targets, setTargets] = useState<Record<string, string>>({});
  const settings = useKafkaQuery(
    ['sim-settings'],
    async () => ({ baseTraffic: 1, dailyWave: true, seed: 'kafka-42' }),
    false,
  );
  const [traffic, setTraffic] = useState<number>(1);
  const [wave, setWave] = useState(true);
  const [seed, setSeed] = useState(settings.data?.seed ?? 'kafka-42');

  if (!client.chaos || info.mode !== 'demo') {
    return <PageHeader title="Chaos panel" subtitle="Only available on simulated clusters." />;
  }
  const chaos = client.chaos;
  const running = incidents.data ?? [];
  const label = (k: ChaosActionKind) => ACTIONS.find((a) => a.kind === k)!.title;
  const refresh = () => qc.invalidateQueries({ queryKey: [info.clusters[0]?.id, 'incidents'] });
  const trigger = async (kind: ChaosActionKind, target?: string) => {
    try {
      const inc = await chaos.run({ kind, target });
      toast({
        tone: 'warn',
        title: `${label(kind)} started`,
        body: inc.target && inc.target !== '*' ? `on ${inc.target}` : 'on all topics',
        action: { label: 'Watch on Overview', onClick: () => location.assign('/app/') },
      });
      refresh();
    } catch (e) {
      toast({
        tone: 'crit',
        title: `Couldn't start ${label(kind).toLowerCase()}`,
        body: (e as Error).message,
      });
    }
  };
  const metricFor = (i: Incident) => {
    const g = groups?.find((x) => x.groupId === i.target);
    if (g) return `lag ${formatInt(g.totalLag)}`;
    if (i.kind === 'broker-down') return `${overview?.kpis.underReplicated ?? 0} under-replicated`;
    if (i.kind === 'traffic-spike')
      return `${formatInt(overview?.kpis.messagesInPerSec ?? 0)} msgs/s`;
    return '';
  };
  const chaosEvents = (events ?? [])
    .filter(
      (e) =>
        ['chaos', 'broker-down', 'broker-up', 'rebalance', 'offsets-reset'].includes(e.kind) ||
        e.title.includes('stalled') ||
        e.title.includes('stopped'),
    )
    .slice(0, 8);
  const groupNames = (groups ?? []).map((g) => g.groupId);
  const optionsFor = (t?: 'group' | 'topic' | 'broker') =>
    t === 'group'
      ? groupNames.filter((g) => g !== 'notify-workers').map((g) => ({ value: g, label: g }))
      : t === 'topic'
        ? [
            { value: '*', label: 'all topics' },
            ...(topics.data?.items ?? [])
              .filter((x) => x.messagesInPerSec > 0)
              .map((x) => ({ value: x.name, label: x.name })),
          ]
        : t === 'broker'
          ? [1, 2, 3].map((b) => ({ value: String(b), label: `broker ${b}` }))
          : [];

  return (
    <>
      <PageHeader
        title="Chaos panel"
        subtitle="Break the simulated cluster on purpose and watch the dashboard react. Only available on simulated clusters."
        actions={<Button onClick={() => startTour()}>Start guided tour</Button>}
      />
      {running.map((i) => {
        const a = ACTIONS.find((x) => x.kind === i.kind)!;
        return (
          <div key={i.id} role="status" className="ki-reveal">
            <div className="min-h-0 overflow-hidden">
              <div className="flex items-center gap-3 rounded-lg border border-warn bg-warn-soft px-4 py-3 text-[13px]">
                <span aria-hidden="true" className="size-2 rounded-full bg-warn" />
                <div className="grow">
                  <span className="font-semibold">
                    Running: {a.title}
                    {i.target && i.target !== '*' ? ` on ${i.target}` : ''}
                  </span>
                  <span className="text-ink-muted">
                    {' '}
                    · started {formatClock(i.startedAt)} · {a.effect}
                    {metricFor(i) && ` · ${metricFor(i)}`}
                  </span>
                </div>
                <Link
                  href="/app/"
                  className="inline-flex h-control-sm items-center rounded-md border border-line bg-surface px-3 text-[12px] font-semibold text-ink no-underline hover:bg-surface-hover"
                >
                  Watch on Overview
                </Link>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    await chaos.stop(i.id);
                    refresh();
                  }}
                >
                  Stop
                </Button>
              </div>
            </div>
          </div>
        );
      })}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {ACTIONS.map((a) => {
            const inc = running.find((i) => i.kind === a.kind);
            const target = targets[a.kind] ?? a.default;
            const dur = inc?.endsAt
              ? Date.parse(inc.endsAt) - Date.parse(inc.startedAt)
              : undefined;
            return (
              <article
                key={a.kind}
                className={`relative overflow-hidden rounded-lg border bg-surface p-4 ${inc ? 'border-warn' : 'border-line'} ${a.kind === 'poison-message' ? 'md:col-span-2' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <h2 className="section-title m-0 grow">{a.title}</h2>
                  {inc ? (
                    <StatusBadge status="warn" dot={false}>
                      Running
                    </StatusBadge>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => trigger(a.kind, a.target ? target : undefined)}
                    >
                      Trigger
                    </Button>
                  )}
                </div>
                <p className="m-0 mt-2 text-[13px] text-ink-muted">{a.text}</p>
                {a.target && !inc && (
                  <div className="mt-3 w-[200px]">
                    <Select
                      label={`${a.title} target`}
                      hideLabel
                      value={target}
                      onChange={(e) => setTargets({ ...targets, [a.kind]: e.target.value })}
                      options={optionsFor(a.target)}
                      className="h-control-sm font-mono text-[12px]"
                    />
                  </div>
                )}
                {/* 2 px progress bar while a timed incident runs (MOTION.md "Chaos action triggered") */}
                {inc && (
                  <span
                    aria-hidden="true"
                    className={`absolute bottom-0 left-0 h-[2px] w-full origin-left bg-warn ${dur ? 'ki-progress' : 'ki-progress-indeterminate'}`}
                    style={dur ? { animationDuration: `${dur}ms` } : undefined}
                  />
                )}
              </article>
            );
          })}
        </div>
        <div className="flex flex-col gap-4">
          <Card title="Simulator">
            <div className="flex flex-col gap-3 text-[13px]">
              <label className="flex flex-col gap-2">
                <span className="flex">
                  Base traffic
                  <span className="ml-auto font-mono text-[12px]">{traffic.toFixed(1)}×</span>
                </span>
                <input
                  type="range"
                  min={0.2}
                  max={3}
                  step={0.1}
                  value={traffic}
                  onChange={(e) => setTraffic(Number(e.target.value))}
                  onPointerUp={() => chaos.settings({ baseTraffic: traffic })}
                  onKeyUp={() => chaos.settings({ baseTraffic: traffic })}
                  className="accent-copper"
                />
              </label>
              <Checkbox
                label="Daily wave"
                checked={wave}
                onChange={(e) => {
                  setWave(e.target.checked);
                  void chaos.settings({ dailyWave: e.target.checked });
                }}
              />
              <form
                className="flex items-end gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  await chaos.settings({ seed });
                  toast({ tone: 'info', title: `Reseeded with ${seed}` });
                  qc.invalidateQueries();
                }}
              >
                <div className="grow">
                  <TextField
                    label="Random seed"
                    mono
                    value={seed}
                    onChange={(e) => setSeed(e.target.value)}
                  />
                </div>
                <Button type="submit">Apply</Button>
              </form>
              <Button
                variant="ghost"
                onClick={async () => {
                  await chaos.reset();
                  toast({
                    tone: 'info',
                    title: 'Demo reset',
                    body: 'Your topics, messages and offset resets were cleared.',
                  });
                  qc.invalidateQueries();
                }}
              >
                Reset demo to start
              </Button>
            </div>
          </Card>
          <Card title="Event log">
            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {chaosEvents.length === 0 && (
                <li className="text-[13px] text-ink-muted">Nothing yet. Trigger an action.</li>
              )}
              {chaosEvents.map((e) => (
                <li key={e.id} className="ki-insert flex gap-3 text-[13px]">
                  <span className="font-mono text-[10px] leading-5 text-ink-muted">
                    {formatClock(e.ts)}
                  </span>
                  <span>{e.title}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
