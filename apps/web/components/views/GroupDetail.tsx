'use client';
import {
  formatClock,
  formatEta,
  formatForecast,
  formatInt,
  formatRate,
  type GroupDetail as Detail,
  type GroupPartitionLag,
} from '@ki/core';
import {
  Button,
  Card,
  CopyButton,
  DataTable,
  EmptyState,
  KpiCard,
  StatusBadge,
  Tabs,
  useToast,
} from '@ki/ui';
import { TimeSeriesChart } from '../Chart';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApp } from '../../lib/app';
import { useKafka, useKafkaQuery } from '../../lib/kafka';
import { groupBadge } from '../../lib/status';
import { useUrl } from '../../lib/url';
import { PageHeader, useWrites, WriteButton } from '../Page';
import { ResetOffsetsDialog } from './ResetOffsets';

export function GroupDetailView() {
  const url = useUrl();
  const id = url.get('id') ?? '';
  const tab = url.get('tab') === 'members' ? 'members' : 'partitions';
  const { range } = useApp();
  const group = useKafkaQuery(['group', id], (c, cid) => c.getGroup(cid, id), 1000);
  const hist = useKafkaQuery(
    ['group-history', id, range],
    async (c, cid) =>
      (await c.getHistory(cid, { metric: 'lag', scope: 'group', key: id, range }))[0]?.points ?? [],
    5000,
  );
  const d = group.data;
  if (group.error) {
    return (
      <Card>
        <EmptyState
          title={`Consumer group ${id} not found`}
          actions={
            <Link href="/app/groups/" className="text-copper">
              Back to consumer groups
            </Link>
          }
        >
          {(group.error as Error).message}
        </EmptyState>
      </Card>
    );
  }
  if (!d) return <PageHeader title={id} mono />;
  const s = d.summary;
  const b = groupBadge(s.status, s.state);
  return (
    <>
      <PageHeader
        title={id}
        mono
        badges={
          <>
            <span data-tour="status">
              <StatusBadge status={b.status}>{b.label}</StatusBadge>
            </span>
            <span className="rounded-sm bg-surface-hover px-2 py-[3px] text-[12px] text-ink-muted">
              {s.type} · {s.state} · {s.members} member{s.members === 1 ? '' : 's'}
            </span>
          </>
        }
        actions={<Actions d={d} />}
      />
      <Kpis d={d} points={hist.data ?? []} />
      <LagChart d={d} points={hist.data ?? []} />
      {d.share && (
        <Card title="Share group (KIP-932)">
          <dl className="m-0 grid grid-cols-3 gap-4 text-[13px]">
            <div>
              <dt className="text-ink-muted">Records in flight</dt>
              <dd className="m-0 font-mono">{formatInt(d.share.inFlight)}</dd>
            </div>
            <div>
              {/* from the group's data, not an assumed default */}
              <dt className="text-ink-muted">Delivery count</dt>
              <dd className="m-0 font-mono">{formatInt(d.share.deliveryCount)}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Acquisition lock</dt>
              <dd className="m-0 font-mono">{d.share.acquisitionLockMs / 1000} s</dd>
            </div>
          </dl>
          <p className="m-0 mt-3 text-[12px] text-ink-muted">
            Members share every partition; records are acquired, acknowledged or released
            individually, so there is no committed position to catch up and no forecast.
          </p>
        </Card>
      )}
      <Tabs
        label="Group sections"
        active={tab}
        items={[
          {
            key: 'partitions',
            label: `Partitions · ${d.partitions.length}`,
            href: url.hrefWith({ tab: undefined }),
          },
          {
            key: 'members',
            label: `Members · ${d.members.length}`,
            href: url.hrefWith({ tab: 'members' }),
          },
        ]}
      />
      {tab === 'partitions' ? (
        <Partitions rows={d.partitions} groupId={d.summary.groupId} />
      ) : (
        <Members d={d} />
      )}
      <ResetOffsetsDialog
        open={url.get('reset') === '1'}
        onClose={() => url.set({ reset: undefined })}
        group={d}
      />
    </>
  );
}

function Actions({ d }: { d: Detail }) {
  const url = useUrl();
  const writes = useWrites();
  const toast = useToast();
  const router = useRouter();
  const { clusterId } = useKafka();
  const empty = d.summary.members === 0;
  return (
    <>
      <CopyButton text={() => location.href} label="Copy link" />
      {empty ? (
        <WriteButton
          variant="danger"
          onClick={async () => {
            if (!writes) return;
            try {
              await writes.deleteGroup(clusterId, d.summary.groupId);
              toast({ tone: 'ok', title: `Deleted ${d.summary.groupId}` });
              router.push('/app/groups/');
            } catch (e) {
              toast({
                tone: 'crit',
                title: "Couldn't delete the group",
                body: (e as Error).message,
              });
            }
          }}
        >
          Delete group
        </WriteButton>
      ) : (
        <Button variant="danger" disabled title="Only an empty group (no members) can be deleted.">
          Delete group
        </Button>
      )}
      {d.summary.type !== 'share' && (
        <WriteButton variant="primary" data-tour="reset" onClick={() => url.set({ reset: 1 })}>
          Reset offsets
        </WriteButton>
      )}
    </>
  );
}

function sinceRising(points: Array<[number, number]>): number | undefined {
  if (points.length < 3) return undefined;
  for (let i = points.length - 1; i > 0; i--)
    if (points[i - 1]![1] > points[i]![1]) return points[i]![0];
  return points[0]![0];
}

function Kpis({ d, points }: { d: Detail; points: Array<[number, number]> }) {
  const s = d.summary;
  const f = s.forecast;
  const rising = s.status === 'warn' || f.kind === 'never';
  const from = rising ? sinceRising(points) : undefined;
  const topics = s.topics.length > 2 ? `${s.topics.length} topics` : s.topics.join(' + ');
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <KpiCard
        label="Total lag"
        value={formatInt(s.totalLag)}
        numeric={s.totalLag}
        delta={
          s.totalLag === 0
            ? 'caught up'
            : rising
              ? from
                ? `rising since ${formatClock(from)}`
                : 'rising'
              : 'falling'
        }
        deltaTone={s.totalLag === 0 ? 'ok' : rising ? 'warn' : 'ok'}
      />
      <KpiCard
        label="Consume rate"
        value={f.consumeRate !== undefined ? formatRate(f.consumeRate) : '—'}
        delta={`${s.members} member${s.members === 1 ? '' : 's'}`}
      />
      <KpiCard
        label={`Produce rate (${topics})`}
        value={f.produceRate !== undefined ? formatRate(f.produceRate) : '—'}
        delta={
          f.consumeRate !== undefined && f.produceRate !== undefined
            ? f.produceRate > f.consumeRate
              ? 'faster than consumption'
              : 'slower than consumption'
            : undefined
        }
        deltaTone={
          f.produceRate !== undefined &&
          f.consumeRate !== undefined &&
          f.produceRate > f.consumeRate
            ? 'warn'
            : 'ok'
        }
      />
      <KpiCard
        label="Catch-up forecast"
        value={
          f.kind === 'eta'
            ? formatEta(f.seconds!)
            : f.kind === 'caught-up'
              ? '0'
              : f.kind === 'never'
                ? 'Never'
                : '—'
        }
        delta={
          f.kind === 'eta'
            ? 'if rates hold'
            : f.kind === 'never'
              ? 'won’t catch up at current rates'
              : f.kind === 'caught-up'
                ? 'caught up'
                : 'not applicable'
        }
        deltaTone={f.kind === 'never' ? 'warn' : 'ok'}
      />
    </div>
  );
}

function LagChart({ d, points }: { d: Detail; points: Array<[number, number]> }) {
  const s = d.summary;
  const f = s.forecast;
  const now = points.at(-1)?.[0] ?? Date.now();
  const lagColor =
    s.status === 'warn'
      ? 'warn'
      : s.status === 'stalled' || s.status === 'stopped'
        ? 'crit'
        : 'chart-1';
  const forecast: Array<[number, number]> =
    f.kind === 'eta' && f.seconds
      ? [
          [now, s.totalLag],
          [now + f.seconds * 1000, 0],
        ]
      : [];
  const zeroAt = f.kind === 'eta' && f.seconds ? now + f.seconds * 1000 : undefined;
  return (
    <Card
      title={
        <span className="flex items-center gap-4">
          Lag and forecast
          <span className="inline-flex items-center gap-[6px] text-[12px] font-normal text-ink-muted">
            <span
              aria-hidden="true"
              className="h-[2px] w-3"
              style={{ background: `var(--${lagColor})` }}
            />
            lag
          </span>
          {forecast.length > 0 && (
            <span className="inline-flex items-center gap-[6px] text-[12px] font-normal text-ink-muted">
              <span aria-hidden="true" className="h-0 w-3 border-t-2 border-dashed border-ok" />
              forecast
            </span>
          )}
        </span>
      }
      actions={
        <span className="font-mono text-[10px] text-ink-muted">
          {zeroAt
            ? `Lag is zero again by ~${formatClock(zeroAt)}`
            : f.kind === 'never'
              ? 'Won’t catch up at current rates'
              : f.kind === 'caught-up'
                ? 'Caught up'
                : ''}
        </span>
      }
    >
      <TimeSeriesChart
        label={`Lag for ${s.groupId}`}
        height={180}
        yFormat={(v) =>
          v >= 1e6
            ? `${(v / 1e6).toFixed(1)}M`
            : v >= 1000
              ? `${Math.round(v / 1000)}k`
              : String(Math.round(v))
        }
        markers={forecast.length ? [{ t: now, label: 'now' }] : []}
        series={[
          { key: 'lag', label: 'lag', points, color: lagColor, area: true },
          ...(forecast.length
            ? [
                {
                  key: 'forecast',
                  label: 'forecast',
                  points: forecast,
                  color: 'ok' as const,
                  dashed: true,
                },
              ]
            : []),
        ]}
      />
    </Card>
  );
}

function Partitions({ rows, groupId }: { rows: GroupPartitionLag[]; groupId: string }) {
  const [all, setAll] = useState(false);
  const big = rows.filter((r) => r.lag >= 200 || r.status !== 'healthy');
  const shown = all || big.length === 0 ? rows : big;
  return (
    <DataTable
      caption="Lag by partition"
      rows={shown}
      rowKey={(r) => `${r.topic}-${r.partition}`}
      rowAttrs={(r) => (r.status === 'stalled' ? { 'data-tour': 'stalled' } : {})}
      footer={
        !all && rows.length > shown.length ? (
          <button
            type="button"
            onClick={() => setAll(true)}
            className="cursor-pointer border-none bg-transparent p-0 text-[13px] text-ink-muted underline hover:text-ink"
          >
            + {rows.length - shown.length} partitions with lag under 200 · show all {rows.length}
          </button>
        ) : undefined
      }
      columns={[
        {
          key: 'tp',
          header: 'Topic · partition',
          kind: 'id',
          cell: (r) => (
            <Link
              href={`/app/topics/view/?name=${encodeURIComponent(r.topic)}&tab=messages&p=${r.partition}&from=group&group=${encodeURIComponent(groupId)}`}
              className="text-ink no-underline hover:text-copper"
            >
              {r.topic} · {r.partition}
            </Link>
          ),
        },
        {
          key: 'm',
          header: 'Member',
          kind: 'id',
          cell: (r) =>
            r.clientId ? (
              `${r.clientId} · ${r.host}`
            ) : (
              <span className="text-ink-muted">unassigned</span>
            ),
        },
        {
          key: 'c',
          header: 'Committed',
          kind: 'num',
          cell: (r) => (r.committedOffset === null ? '—' : formatInt(r.committedOffset)),
        },
        { key: 'e', header: 'End offset', kind: 'num', cell: (r) => formatInt(r.endOffset) },
        { key: 'l', header: 'Lag', kind: 'num', cell: (r) => formatInt(r.lag) },
        {
          key: 's',
          header: 'Status',
          cell: (r) => <StatusBadge status={r.status === 'unknown' ? 'neutral' : r.status} />,
        },
      ]}
    />
  );
}

function Members({ d }: { d: Detail }) {
  return (
    <DataTable
      caption="Members"
      rows={d.members}
      rowKey={(m) => m.memberId}
      empty={
        <EmptyState title="No members">
          The group is empty. Its committed offsets are kept until it is deleted or they expire.
        </EmptyState>
      }
      columns={[
        { key: 'c', header: 'Client id', kind: 'id', cell: (m) => m.clientId },
        { key: 'h', header: 'Host', kind: 'id', cell: (m) => m.host },
        {
          key: 'id',
          header: 'Member id',
          kind: 'id',
          cell: (m) => <span className="text-ink-muted">{m.memberId}</span>,
        },
        {
          key: 'a',
          header: 'Assigned partitions',
          cell: (m) => (
            <span className="font-mono text-[12px]">
              {m.assignments.length} ·{' '}
              {m.assignments
                .slice(0, 4)
                .map((a) => `${a.topic}-${a.partition}`)
                .join(', ')}
              {m.assignments.length > 4 && ' …'}
            </span>
          ),
        },
      ]}
    />
  );
}

export { formatForecast };
