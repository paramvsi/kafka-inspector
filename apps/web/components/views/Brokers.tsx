'use client';
import { formatBytes, formatInt, formatPct } from '@ki/core';
import { Card, DataTable, Drawer, SearchInput, StatusBadge } from '@ki/ui';
import { useState } from 'react';
import { useKafkaQuery } from '../../lib/kafka';
import { useUrl } from '../../lib/url';
import { PageHeader } from '../Page';

const KEY = [
  'num.partitions',
  'default.replication.factor',
  'min.insync.replicas',
  'log.retention.hours',
  'auto.create.topics.enable',
];

export function BrokersView() {
  const url = useUrl();
  const brokers = useKafkaQuery(['brokers'], (c, id) => c.listBrokers(id), 2000);
  const overview = useKafkaQuery(['overview-static'], (c, id) => c.getOverview(id), 10_000);
  const selected = Number(url.get('broker') ?? brokers.data?.find((b) => b.isController)?.id ?? 1);
  const config = useKafkaQuery(['broker-config', selected], (c, id) =>
    c.getBrokerConfig(id, selected),
  );
  const [q, setQ] = useState('');
  const list = brokers.data ?? [];
  const totalLeaders = list.reduce((a, b) => a + b.leaders, 0) || 1;
  const controller = list.find((b) => b.isController);
  const online = list.filter((b) => b.online).length;
  const flagged = list.filter((b) => b.leaders / totalLeaders > 0.4);
  const all = config.data ?? [];
  return (
    <>
      <PageHeader
        title="Brokers"
        subtitle={
          list.length
            ? `${online} online${online < list.length ? ` · ${list.length - online} offline` : ''} · KRaft · controller on broker ${controller?.id ?? '—'} · Kafka ${overview.data?.cluster.kafkaVersion ?? ''}`
            : '\u00a0' // keeps the line's height so the table below doesn't shift (CLS)
        }
      />
      <DataTable
        caption="Brokers"
        rows={list}
        rowKey={(b) => String(b.id)}
        onRowClick={(b) => url.set({ broker: b.id })}
        rowClassName={(b) => (b.id === selected ? '[&>td]:bg-surface-hover' : undefined)}
        columns={[
          {
            key: 'id',
            header: 'Broker',
            cell: (b) => (
              <span className="flex items-center gap-2">
                {/* keyboard path to the broker's settings; the row click is the mouse shortcut */}
                <button
                  type="button"
                  aria-pressed={b.id === selected}
                  onClick={(e) => {
                    e.stopPropagation();
                    url.set({ broker: b.id });
                  }}
                  className="cursor-pointer border-none bg-transparent p-0 font-mono text-[12px] tabular-nums text-ink hover:underline"
                >
                  {b.id}
                  <span className="sr-only">, show settings</span>
                </button>
                {b.isController && (
                  <StatusBadge status="neutral" dot={false}>
                    controller
                  </StatusBadge>
                )}
              </span>
            ),
          },
          { key: 'host', header: 'Host', kind: 'id', cell: (b) => `${b.host}:${b.port}` },
          { key: 'rack', header: 'Rack', kind: 'dim', cell: (b) => b.rack ?? '—' },
          { key: 'p', header: 'Partitions', kind: 'num', cell: (b) => formatInt(b.partitions) },
          { key: 'l', header: 'Leaders', kind: 'num', cell: (b) => formatInt(b.leaders) },
          {
            key: 'in',
            header: 'In / s',
            kind: 'num',
            cell: (b) => formatBytes(b.bytesInPerSec ?? 0),
          },
          {
            key: 'disk',
            header: 'Disk used',
            kind: 'num',
            // not reported (agent without DescribeLogDirs) → a dash, never invented numbers
            cell: (b) =>
              b.diskUsedBytes == null
                ? '—'
                : b.diskTotalBytes
                  ? `${formatBytes(b.diskUsedBytes)} · ${formatPct((b.diskUsedBytes / b.diskTotalBytes) * 100)}`
                  : formatBytes(b.diskUsedBytes),
          },
          {
            key: 'status',
            header: 'Status',
            cell: (b) =>
              b.online ? (
                <StatusBadge status="healthy">Online</StatusBadge>
              ) : (
                <StatusBadge status="stopped">Offline</StatusBadge>
              ),
          },
        ]}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Leader balance">
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {list.map((b) => {
              const share = (b.leaders / totalLeaders) * 100;
              return (
                <li
                  key={b.id}
                  className="grid grid-cols-[70px_1fr_48px] items-center gap-3 text-[13px]"
                >
                  <span className="text-ink-muted">broker {b.id}</span>
                  <span
                    className="h-2 overflow-hidden rounded-full bg-surface-hover"
                    aria-hidden="true"
                  >
                    <span
                      className={`block h-full origin-left rounded-full transition-transform duration-base ease-standard ${share > 40 ? 'bg-warn' : 'bg-chart-2'}`}
                      style={{ transform: `scaleX(${share / 100})` }}
                    />
                  </span>
                  <span className="text-right font-mono text-[12px] tabular-nums">
                    {formatPct(share)}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="m-0 mt-4 text-[12px] text-ink-muted">
            {flagged.length
              ? `Broker ${flagged.map((b) => b.id).join(', ')} leads more than 40% of partitions. Run a preferred leader election to rebalance.`
              : 'Balanced. A broker leading more than 40% of partitions is flagged.'}
          </p>
        </Card>
        <Card
          title={`Broker ${selected} · key config`}
          actions={
            <button
              type="button"
              onClick={() => url.set({ settings: 1 })}
              className="cursor-pointer border-none bg-transparent p-0 text-[13px] text-copper underline"
            >
              All {all.length} settings
            </button>
          }
        >
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-[13px]">
            {KEY.map((k) => {
              const e = all.find((x) => x.name === k);
              return (
                <div key={k} className="contents">
                  <dt className="font-mono text-[12px] text-ink-muted">{k}</dt>
                  <dd className="m-0 text-right font-mono text-[12px]">
                    {e?.value ?? '—'}
                    {k === 'auto.create.topics.enable' && e?.value === 'true' && (
                      <span className="font-sans text-warn-text"> · review</span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </Card>
      </div>
      <Drawer
        open={url.get('settings') === '1'}
        onClose={() => url.set({ settings: undefined })}
        title={`Broker ${selected} · all settings`}
        description="Read-only. Editing broker config arrives in v2."
      >
        <SearchInput
          label="Filter settings"
          placeholder="Filter settings"
          shortcut={null}
          className="mb-3 w-full"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <table className="w-full text-[12px]">
          <caption className="sr-only">Broker settings</caption>
          <thead>
            <tr className="text-left text-ink-muted">
              <th scope="col" className="pb-2 font-normal">
                Name
              </th>
              <th scope="col" className="pb-2 font-normal">
                Value
              </th>
              <th scope="col" className="pb-2 font-normal">
                Source
              </th>
            </tr>
          </thead>
          <tbody>
            {all
              .filter((e) => e.name.includes(q))
              .map((e) => (
                <tr key={e.name} className="border-t border-line-subtle">
                  <td className="py-1 pr-2 font-mono">{e.name}</td>
                  <td
                    className={`py-1 pr-2 font-mono ${e.isDefault ? 'text-ink-muted' : 'text-ink'}`}
                  >
                    {e.isSensitive ? '******' : (e.value ?? 'null')}
                  </td>
                  <td className="py-1 text-ink-muted">{e.source}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </Drawer>
    </>
  );
}
