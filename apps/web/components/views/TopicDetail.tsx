'use client';
import {
  formatBytes,
  formatDelta,
  formatInt,
  formatPct,
  formatRelative,
  type ConfigEntry,
  type PartitionInfo,
  type TopicDetail as Detail,
} from '@ki/core';
import {
  Button,
  Card,
  CopyButton,
  DataTable,
  Dialog,
  EmptyState,
  KpiCard,
  StatusBadge,
  Tabs,
  TextField,
  useToast,
} from '@ki/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { TimeSeriesChart } from '../Chart';
import Link from 'next/link';
import { useApp } from '../../lib/app';
import { useKafka, useKafkaQuery } from '../../lib/kafka';
import { groupBadge } from '../../lib/status';
import { useUrl } from '../../lib/url';
import { PageHeader, useWrites, WriteButton } from '../Page';
import { MessagesTab } from './Messages';
import { ProduceDrawer } from './Produce';
import { healthBadge } from './Topics';

const TABS = ['overview', 'messages', 'partitions', 'consumers', 'config', 'schema'] as const;
type Tab = (typeof TABS)[number];

export function TopicDetailView() {
  const url = useUrl();
  const canWrite = useWrites();
  const name = url.get('name') ?? '';
  const tab = (TABS as readonly string[]).includes(url.get('tab') ?? '')
    ? (url.get('tab') as Tab)
    : 'overview';
  const topic = useKafkaQuery(
    ['topic', name],
    (c, id) => c.getTopic(id, name),
    tab === 'messages' ? 5000 : 2000,
  );
  const subject = topic.data?.schema?.valueSubject;
  const latest = useKafkaQuery(
    ['schema', subject, 'latest'],
    (c, id) => (subject ? c.getSchema(id, subject, 'latest') : Promise.resolve(undefined)),
    false,
  );
  const hourAgo = useKafkaQuery(
    ['topic-1h', name],
    async (c, id) =>
      (await c.getHistory(id, { metric: 'messagesIn', scope: 'topic', key: name, range: '1h' }))[0]
        ?.points[0]?.[1],
    30_000,
  );

  if (!name)
    return (
      <EmptyState
        title="No topic selected"
        actions={<Link href="/app/topics/">Back to topics</Link>}
      />
    );
  if (topic.error) {
    return (
      <>
        <PageHeader title={name} mono />
        <Card>
          <EmptyState
            title={`Topic ${name} not found`}
            actions={
              <Link href="/app/topics/" className="text-copper">
                Back to topics
              </Link>
            }
          >
            {(topic.error as Error).message} It may have been deleted, or the link points at another
            cluster.
          </EmptyState>
        </Card>
      </>
    );
  }
  const d = topic.data;
  const s = d?.summary;
  const href = (t: Tab) =>
    url.hrefWith({ tab: t === 'overview' ? undefined : t, msg: undefined, produce: undefined });
  const schemaChip = d?.schema?.valueSubject && latest.data && (
    <span className="rounded-sm bg-surface-hover px-2 py-[3px] text-[12px] text-ink-muted">
      {latest.data.type === 'AVRO' ? 'Avro' : 'JSON Schema'} · {d.schema.valueSubject} v
      {latest.data.version}
    </span>
  );
  return (
    <>
      <PageHeader
        title={name}
        mono
        badges={
          <>
            {s && healthBadge(s)}
            {schemaChip}
          </>
        }
        actions={
          <>
            <CopyButton text={() => location.href} label="Copy link" />
            <Button variant="ghost" onClick={() => url.set({ tab: 'config' })}>
              Edit config
            </Button>
            <WriteButton onClick={() => url.set({ produce: 1 })}>Produce message</WriteButton>
            <Button variant="primary" onClick={() => url.set({ tab: 'messages' })}>
              Browse messages
            </Button>
          </>
        }
      />
      <Tabs
        linkAs={Link}
        label="Topic sections"
        active={tab}
        items={TABS.map((t) => ({
          key: t,
          href: href(t),
          label:
            t === 'consumers'
              ? `Consumers · ${d?.consumers.length ?? 0}`
              : t[0]!.toUpperCase() + t.slice(1),
        }))}
      />
      {d && tab === 'overview' && <OverviewTab d={d} hourAgo={hourAgo.data} />}
      {d && tab === 'partitions' && <PartitionTable parts={d.partitions} all />}
      {d && tab === 'consumers' && <ConsumersTab d={d} />}
      {/* keyed by topic: no edit dialog or drafts carry over from the previous topic */}
      {tab === 'config' && <ConfigTab key={name} name={name} />}
      {d && tab === 'schema' && <SchemaTab d={d} />}
      {tab === 'messages' && (
        <MessagesTab key={name} topic={name} partitions={d?.partitions.length ?? 0} />
      )}
      <ProduceDrawer
        topic={name}
        partitions={d?.partitions.length ?? 1}
        open={url.get('produce') === '1' && !!canWrite} // a deep link can't open it on a read-only cluster
        onClose={() => url.set({ produce: undefined })}
      />
    </>
  );
}

/** "7-day retention" · "36-hour retention" · "infinite retention", from retention.ms */
function retentionLabel(ms: string | null | undefined): string | undefined {
  if (ms == null) return undefined;
  const n = Number(ms);
  if (n < 0) return 'infinite retention';
  if (n % 86_400_000 === 0) return `${n / 86_400_000}-day retention`;
  if (n % 3_600_000 === 0) return `${n / 3_600_000}-hour retention`;
  return `${Math.round(n / 60_000)}-minute retention`;
}

function OverviewTab({ d, hourAgo }: { d: Detail; hourAgo?: number }) {
  const s = d.summary;
  // real values from the topic's config, never assumed defaults
  const cfg = useKafkaQuery(['topic-config', s.name], (c, id) => c.getTopicConfig(id, s.name));
  const cfgValue = (n: string) => cfg.data?.find((c) => c.name === n)?.value;
  const retention = retentionLabel(cfgValue('retention.ms'));
  const minIsr = cfgValue('min.insync.replicas');
  const urp = s.underReplicated;
  const last = s.lastMessageAt ? (Date.now() - Date.parse(s.lastMessageAt)) / 1000 : undefined;
  const delta = hourAgo ? ((s.messagesInPerSec - hourAgo) / hourAgo) * 100 : undefined;
  const shares = d.partitions.map((p) => p.sharePct ?? 0);
  const maxDev = shares.length
    ? Math.max(...shares.map((x) => Math.abs(x - 100 / shares.length)))
    : 0;
  return (
    <>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard
          label="Messages in / s"
          value={formatInt(s.messagesInPerSec)}
          numeric={s.messagesInPerSec}
          delta={delta !== undefined ? formatDelta(delta) : undefined}
          deltaTone={delta !== undefined && delta >= 0 ? 'ok' : 'neutral'}
        />
        <KpiCard label="Size on disk" value={formatBytes(s.sizeBytes ?? 0)} delta={retention} />
        <KpiCard
          label="Partitions · RF"
          value={`${s.partitions} · ${s.replicationFactor}`}
          delta={urp ? `${urp} under-replicated` : 'all in sync'}
          deltaTone={urp ? 'crit' : 'ok'}
        />
        <KpiCard
          label="Last message"
          value={
            last === undefined
              ? '—'
              : last < 60
                ? `${last.toFixed(1)} s`
                : formatRelative(s.lastMessageAt).replace(' ago', '')
          }
          delta={last === undefined ? 'nothing produced yet' : 'ago'}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex min-w-0 flex-col gap-4">
          <PartitionTable parts={d.partitions} maxDev={maxDev} />
          <TopicThroughput name={s.name} />
        </div>
        <div className="flex flex-col gap-4">
          <Card title="Health checks">
            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px]">
              {s.replicationFactor >= 3 ? (
                <Check ok>Replication factor {s.replicationFactor} (min 2)</Check>
              ) : null}
              {s.health.map((h) => (
                <Check key={h.id} ok={false} severity={h.severity} detail={h.fix}>
                  {h.id === 'disk-fill'
                    ? `${retention ? `${retention[0]!.toUpperCase()}${retention.slice(1)}` : 'Retention'}, ${formatBytes(s.sizeBytes ?? 0)}`
                    : h.message}
                  {h.id === 'disk-fill' && (
                    <div className="text-[12px] text-ink-muted">{h.message} at current rate</div>
                  )}
                </Check>
              ))}
              {!s.health.some((h) => h.id === 'low-min-isr') &&
                s.replicationFactor > 1 &&
                minIsr !== undefined && <Check ok>min.insync.replicas = {minIsr}</Check>}
              {!s.health.some((h) => h.id === 'skew') && d.partitions.length > 1 && (
                <Check ok>Partition skew {formatPct(maxDev, 1)}</Check>
              )}
            </ul>
          </Card>
          <Card title="Consumers">
            {d.consumers.length === 0 ? (
              <p className="m-0 text-[13px] text-ink-muted">No consumer group reads this topic.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {d.consumers.map((c) => {
                  const b = groupBadge(c.status, c.state);
                  return (
                    <li key={c.groupId} className="flex items-center justify-between gap-3">
                      <Link
                        href={`/app/groups/view/?id=${encodeURIComponent(c.groupId)}`}
                        className="font-mono text-[12px] text-ink no-underline hover:text-copper"
                      >
                        {c.groupId}
                      </Link>
                      <StatusBadge status={b.status}>
                        <span className="font-mono tabular-nums">{formatInt(c.lag)}</span>
                        <span className="sr-only"> behind, {b.label}</span>
                      </StatusBadge>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Check({
  ok,
  severity,
  detail,
  children,
}: {
  ok: boolean;
  severity?: 'warn' | 'crit' | 'info';
  detail?: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-2" title={detail}>
      <span
        aria-hidden="true"
        className={
          ok
            ? 'text-ok'
            : severity === 'crit'
              ? 'text-crit'
              : severity === 'warn'
                ? 'text-warn'
                : 'text-copper'
        }
      >
        {ok ? '✓' : '!'}
      </span>
      <span className="sr-only">{ok ? 'Pass:' : 'Check:'}</span>
      <div>{children}</div>
    </li>
  );
}

export function PartitionTable({
  parts,
  all,
  maxDev,
}: {
  parts: PartitionInfo[];
  all?: boolean;
  maxDev?: number;
}) {
  const rows = all ? parts : parts.slice(0, 4);
  const max = Math.max(...parts.map((p) => p.sharePct ?? 0), 1);
  return (
    <DataTable
      caption="Partitions"
      rows={rows}
      rowKey={(p) => String(p.partition)}
      footer={
        !all && parts.length > 4
          ? `+ ${parts.length - 4} more partitions · ${maxDev !== undefined && maxDev < 2 ? `evenly spread, max skew ${formatPct(maxDev, 1)}` : 'see the Partitions tab'}`
          : undefined
      }
      columns={[
        { key: 'p', header: 'Partition', kind: 'id', cell: (p) => p.partition },
        {
          key: 'leader',
          header: 'Leader',
          kind: 'id',
          cell: (p) =>
            p.leader == null ? <StatusBadge status="stopped">offline</StatusBadge> : `b${p.leader}`,
        },
        {
          key: 'isr',
          header: 'ISR',
          kind: 'id',
          cell: (p) => (
            <span className={p.isr.length < p.replicas.length ? 'text-crit-text' : undefined}>
              {p.isr.join(',')}
            </span>
          ),
        },
        { key: 'low', header: 'Low', kind: 'num', cell: (p) => formatInt(p.lowWatermark) },
        { key: 'high', header: 'High', kind: 'num', cell: (p) => formatInt(p.highWatermark) },
        {
          key: 'share',
          header: 'Share of traffic',
          cell: (p) => (
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-[6px] w-[64px] overflow-hidden rounded-full bg-surface-hover"
              >
                <span
                  className={`block h-full origin-left ${(p.sharePct ?? 0) > 2 * (100 / parts.length) && parts.length > 2 ? 'bg-warn' : 'bg-chart-1'}`}
                  style={{ transform: `scaleX(${(p.sharePct ?? 0) / max})` }}
                />
              </span>
              <span className="font-mono text-[11px] tabular-nums text-ink-muted">
                {p.sharePct == null ? '—' : formatPct(p.sharePct, 1)}
              </span>
            </span>
          ),
        },
        ...(all
          ? [
              {
                key: 'last',
                header: 'Last message',
                kind: 'dim' as const,
                cell: (p: PartitionInfo) => formatRelative(p.lastMessageAt),
              },
            ]
          : []),
      ]}
    />
  );
}

function ConsumersTab({ d }: { d: Detail }) {
  return (
    <DataTable
      caption="Consumer groups reading this topic"
      rows={d.consumers}
      rowKey={(c) => c.groupId}
      empty={
        <EmptyState title="No consumers">
          No consumer group has committed offsets for this topic.
        </EmptyState>
      }
      columns={[
        {
          key: 'g',
          header: 'Consumer group',
          kind: 'id',
          cell: (c) => (
            <Link
              href={`/app/groups/view/?id=${encodeURIComponent(c.groupId)}`}
              className="text-ink no-underline hover:text-copper"
            >
              {c.groupId}
            </Link>
          ),
        },
        { key: 't', header: 'Type', kind: 'dim', cell: (c) => c.type },
        { key: 's', header: 'State', kind: 'dim', cell: (c) => c.state },
        { key: 'l', header: 'Lag on this topic', kind: 'num', cell: (c) => formatInt(c.lag) },
        {
          key: 'h',
          header: 'Status',
          cell: (c) => {
            const b = groupBadge(c.status, c.state);
            return <StatusBadge status={b.status}>{b.label}</StatusBadge>;
          },
        },
      ]}
    />
  );
}

function ConfigTab({ name }: { name: string }) {
  const cfg = useKafkaQuery(['topic-config', name], (c, id) => c.getTopicConfig(id, name));
  const writes = useWrites();
  const [editing, setEditing] = useState<ConfigEntry>();
  const rows = [...(cfg.data ?? [])].sort(
    (a, b) => Number(a.isDefault) - Number(b.isDefault) || a.name.localeCompare(b.name),
  );
  const overrides = rows.filter((r) => !r.isDefault).length;
  return (
    <>
      <DataTable
        caption="Topic configuration"
        rows={rows}
        rowKey={(c) => c.name}
        footer={
          writes
            ? `${overrides} overrides`
            : `${overrides} overrides · editing topic config arrives with write support on real clusters (v2)`
        }
        columns={[
          {
            key: 'n',
            header: 'Config',
            kind: 'id',
            cell: (c) => (
              <span className={c.isDefault ? 'text-ink-muted' : 'font-medium text-ink'}>
                {c.name}
              </span>
            ),
          },
          {
            key: 'v',
            header: 'Value',
            kind: 'id',
            cell: (c) => (
              <span className={c.isDefault ? 'text-ink-muted' : 'text-copper'}>
                {c.isSensitive ? '******' : c.value}
              </span>
            ),
          },
          {
            key: 's',
            header: 'Source',
            cell: (c) =>
              c.isDefault ? (
                <span className="text-ink-muted">default</span>
              ) : (
                <StatusBadge status="info" dot={false}>
                  override
                </StatusBadge>
              ),
          },
          ...(writes
            ? [
                {
                  key: 'e',
                  header: <span className="sr-only">Actions</span>,
                  cell: (c: ConfigEntry) =>
                    c.readOnly || c.isSensitive ? null : (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Edit ${c.name}`}
                        onClick={() => setEditing(c)}
                      >
                        Edit
                      </Button>
                    ),
                },
              ]
            : []),
        ]}
      />
      <EditConfigDialog topic={name} entry={editing} onClose={() => setEditing(undefined)} />
    </>
  );
}

function EditConfigDialog({
  topic,
  entry,
  onClose,
}: {
  topic: string;
  entry?: ConfigEntry;
  onClose: () => void;
}) {
  const { clusterId } = useKafka();
  const writes = useWrites();
  const toast = useToast();
  const qc = useQueryClient();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<string>();
  // reset the field each time a different entry opens
  if (entry && shown !== entry.name) {
    setShown(entry.name);
    setValue(entry.value ?? '');
    setError(undefined);
  }
  const close = () => {
    setShown(undefined);
    onClose();
  };
  const save = async (next: string | null) => {
    if (!writes || !entry) return;
    setBusy(true);
    setError(undefined);
    try {
      await writes.updateTopicConfig(clusterId, topic, { [entry.name]: next });
      await qc.invalidateQueries({ queryKey: [clusterId, 'topic-config', topic] });
      toast({
        tone: 'ok',
        title: `Config changed on ${topic}`,
        body: `${entry.name} = ${next ?? 'default'}`,
      });
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={!!entry}
      onClose={close}
      title="Edit config"
      description={entry ? `${entry.name} on ${topic}` : undefined}
      footer={
        <>
          {entry && !entry.isDefault && (
            <Button variant="ghost" disabled={busy} onClick={() => void save(null)}>
              Reset to default
            </Button>
          )}
          <span className="grow" />
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || !value.trim() || value === entry?.value}
            onClick={() => void save(value.trim())}
          >
            {busy ? 'Saving…' : 'Save config'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim() && value !== entry?.value) void save(value.trim());
        }}
      >
        <TextField
          label={entry?.name ?? 'Value'}
          mono
          data-autofocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={error}
          hint="Applies on the simulated cluster immediately and shows in Recent events."
        />
        <p className="m-0 font-mono text-[12px] text-ink-muted">
          kafka-configs.sh --alter --entity-type topics --entity-name {topic} --add-config{' '}
          {entry?.name}={value || '<value>'}
        </p>
      </form>
    </Dialog>
  );
}

function SchemaTab({ d }: { d: Detail }) {
  const subject = d.schema?.valueSubject;
  const latest = useKafkaQuery(['schema', subject, 'latest'], (c, id) =>
    subject ? c.getSchema(id, subject, 'latest') : Promise.resolve(undefined),
  );
  if (!subject)
    return (
      <Card>
        <EmptyState title="No schema linked">
          This topic has no <code className="font-mono">{d.summary.name}-value</code> subject in the
          registry. Messages are decoded by content.
        </EmptyState>
      </Card>
    );
  const v = latest.data;
  return (
    <Card
      title={<span className="font-mono">{subject}</span>}
      actions={
        v && (
          <Link
            className="text-[13px] text-copper underline"
            href={`/app/schemas/?subject=${encodeURIComponent(subject)}${v.version > 1 ? `&from=${v.version - 1}&to=${v.version}` : ''}`}
          >
            Compare versions
          </Link>
        )
      }
    >
      {v && (
        <>
          <p className="m-0 mb-3 text-[13px] text-ink-muted">
            {v.type} · version {v.version} · id <span className="font-mono">{v.id}</span>
            {d.schema?.keySubject && (
              <>
                {' '}
                · key subject <span className="font-mono">{d.schema.keySubject}</span>
              </>
            )}
          </p>
          <pre
            tabIndex={0}
            className="m-0 max-h-[420px] overflow-auto rounded-md bg-surface-sunken p-3 font-mono text-[12px] leading-[18px]"
          >
            {v.schema}
          </pre>
        </>
      )}
    </Card>
  );
}

function TopicThroughput({ name }: { name: string }) {
  const { range } = useApp();
  const h = useKafkaQuery(
    ['topic-history', name, range],
    async (c, id) =>
      (await c.getHistory(id, { metric: 'messagesIn', scope: 'topic', key: name, range }))[0]
        ?.points ?? [],
    5000,
  );
  return (
    <Card title="Messages in / s" className="ki-fade-in" key={range}>
      <TimeSeriesChart
        label={`Messages in per second on ${name}`}
        height={140}
        yFormat={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)))}
        series={[{ key: 'in', label: 'in', points: h.data ?? [], color: 'chart-1', area: true }]}
      />
    </Card>
  );
}
