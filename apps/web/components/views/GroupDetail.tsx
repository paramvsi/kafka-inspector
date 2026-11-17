'use client';
import {
  formatClock,
  formatWhen,
  formatEta,
  formatForecast,
  formatInt,
  formatRate,
  type GroupDetail as Detail,
  type GroupPartitionLag,
  shownName,
  formatCount,
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
import { groupBadge, partitionLagText, totalLagTone } from '../../lib/status';
import { axisTime } from '../../lib/axis';
import { shareUrl, useUrl } from '../../lib/url';
import { PageHeader, useReadOnly, useWrites, WriteButton } from '../Page';
import { isNotFound } from '../../lib/poll';
import { useStickyError } from '../../lib/stickyError';
import { sinceRising } from '../../lib/trend';
import { ResetOffsetsDialog } from './ResetOffsets';

export function GroupDetailView() {
  const url = useUrl();
  const canWrite = useWrites();
  const id = url.get('id') ?? '';
  const tab = url.get('tab') === 'members' ? 'members' : 'partitions';
  const { range } = useApp();
  const group = useKafkaQuery(['group', id], (c, cid) => c.getGroup(cid, id), 1000);
  const groupFailed = useStickyError(group, id); // survives re-checks (see lib/stickyError)
  const hist = useKafkaQuery(
    ['group-history', id, range],
    async (c, cid) =>
      (await c.getHistory(cid, { metric: 'lag', scope: 'group', key: id, range }))[0]?.points ?? [],
    5000,
  );
  // "rising since" always from the 1 h series: coarser ranges average the start away (same query as the 1h chart)
  const riseHist = useKafkaQuery(
    ['group-history', id, '1h'],
    async (c, cid) =>
      (await c.getHistory(cid, { metric: 'lag', scope: 'group', key: id, range: '1h' }))[0]
        ?.points ?? [],
    5000,
  );
  const d = group.data;
  // a failed refresh keeps the last data on screen; only a real not-found says "not found"
  // not found wins over the last data: a group deleted elsewhere would otherwise stay on screen looking live
  if (groupFailed && (!d || isNotFound(groupFailed))) {
    return (
      <Card>
        <EmptyState
          title={
            isNotFound(groupFailed)
              ? `Consumer group ${id} not found`
              : `Couldn't load consumer group ${id}`
          }
          actions={
            <Link href="/app/groups/" className="text-copper">
              Back to consumer groups
            </Link>
          }
        >
          {(groupFailed as Error).message}
          {isNotFound(groupFailed) ? '' : ' It retries every few seconds.'}
        </EmptyState>
      </Card>
    );
  }
  if (!d) return <PageHeader title={shownName(id)} mono />;
  const s = d.summary;
  const b = groupBadge(s.status, s.state);
  return (
    <>
      <PageHeader
        title={shownName(id)}
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
      <Kpis d={d} points={riseHist.data ?? []} />
      <LagChart d={d} points={hist.data ?? []} />
      {d.summary.type === 'share' && (
        <Card title="Share group (KIP-932)">
          {d.share ? (
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
          ) : (
            <p className="m-0 text-[13px] text-ink-muted">
              In-flight records and delivery counts aren&apos;t reported by Kafka&apos;s Admin API.
            </p>
          )}
          <p className="m-0 mt-3 text-[12px] text-ink-muted">
            Members share every partition; records are acquired, acknowledged or released
            individually, so there is no committed position to catch up and no forecast.
          </p>
        </Card>
      )}
      <Tabs
        linkAs={Link}
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
        <Partitions key={d.summary.groupId} rows={d.partitions} groupId={d.summary.groupId} />
      ) : (
        <Members d={d} />
      )}
      <ResetOffsetsDialog
        open={url.get('reset') === '1' && !!canWrite} // a deep link can't open it on a read-only cluster
        onClose={() => url.set({ reset: undefined })}
        group={d}
      />
    </>
  );
}

function Actions({ d }: { d: Detail }) {
  const url = useUrl();
  const writes = useWrites();
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const { clusterId } = useKafka();
  const empty = d.summary.members === 0;
  const readOnly = useReadOnly(); // read-only wins: its hint, not "only an empty group"
  return (
    <>
      <CopyButton text={() => shareUrl(location.href, clusterId)} label="Copy link" />
      {empty || readOnly ? (
        <WriteButton
          variant="danger"
          disabled={deleting}
          onClick={async () => {
            if (!writes || deleting) return;
            setDeleting(true); // a second click must not delete again (and then report "not found")
            try {
              await writes.deleteGroup(clusterId, d.summary.groupId);
              toast({ tone: 'ok', title: `Deleted ${d.summary.groupId}` });
              router.push('/app/groups/');
            } catch (e) {
              setDeleting(false);
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

function Kpis({ d, points }: { d: Detail; points: Array<[number, number]> }) {
  const s = d.summary;
  const f = s.forecast;
  // direction from the rates (the forecast's numbers); flat when they match, e.g. a stopped group
  const known = f.consumeRate !== undefined && f.produceRate !== undefined;
  const trend: 'rising' | 'falling' | 'flat' | undefined = known
    ? f.produceRate! > f.consumeRate!
      ? 'rising'
      : f.produceRate! < f.consumeRate!
        ? 'falling'
        : 'flat'
    : s.status === 'warn' || f.kind === 'never'
      ? 'rising'
      : undefined; // rates unknown (first samples, share groups): no trend word rather than a guess
  const rising = trend === 'rising';
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
              : trend
        }
        deltaTone={totalLagTone(s.status, s.totalLag, rising)}
      />
      <KpiCard
        label="Consume rate"
        value={f.consumeRate !== undefined ? formatRate(f.consumeRate) : '—'}
        delta={`${s.members} member${s.members === 1 ? '' : 's'}`}
      />
      <KpiCard
        label={topics ? `Produce rate (${topics})` : 'Produce rate'}
        value={f.produceRate !== undefined ? formatRate(f.produceRate) : '—'}
        delta={
          f.consumeRate !== undefined && f.produceRate !== undefined
            ? f.produceRate > f.consumeRate
              ? 'faster than consumption'
              : f.produceRate < f.consumeRate
                ? 'slower than consumption'
                : 'same as consumption'
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
  const { range } = useApp();
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
            ? `Lag is zero again by ~${formatWhen(zeroAt)}`
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
        xFormat={axisTime(range)}
        yFormat={formatCount}
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
          cell: (r) => (r.committedOffset == null ? '—' : formatInt(r.committedOffset)),
        },
        { key: 'e', header: 'End offset', kind: 'num', cell: (r) => formatInt(r.endOffset) },
        { key: 'l', header: 'Lag', kind: 'num', cell: (r) => partitionLagText(r) },
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
        { key: 'c', header: 'Client id', kind: 'id', cell: (m) => shownName(m.clientId) },
        { key: 'h', header: 'Host', kind: 'id', cell: (m) => shownName(m.host) },
        {
          key: 'id',
          header: 'Member id',
          kind: 'id',
          cell: (m) => <span className="text-ink-muted">{shownName(m.memberId)}</span>,
        },
        {
          key: 'a',
          header: 'Assigned partitions',
          cell: (m) => (
            <span className="font-mono text-[12px]">
              {m.assignments.length}
              {m.assignments.length > 0 && ' · '}
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
