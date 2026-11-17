'use client';
import {
  formatBytes,
  formatClock,
  formatDelta,
  formatForecast,
  formatInt,
  formatRelative,
  type GroupSummary,
  type Overview as OverviewData,
  type Series,
  shownName,
} from '@ki/core';
import { AlertItem, Button, Card, DataTable, KpiCard, Sparkline, StatusBadge } from '@ki/ui';
import { TimeSeriesChart } from '../Chart';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '../../lib/app';
import { axisTime } from '../../lib/axis';
import { hourAgoValue } from '../../lib/baseline';
import { useKafka, useKafkaQuery, useStream } from '../../lib/kafka';
import { groupBadge, sparkTone } from '../../lib/status';
import { BootStatus, PageSkeleton, useConnection } from '../Shell';
import { useRetryWhenReachable } from '../Disconnected';

export function OverviewView() {
  const { preview, range } = useApp();
  const { info } = useKafka();
  const data = useStream<OverviewData>('metrics');
  const connection = useConnection(); // before any early return (rules of hooks)
  const history = useKafkaQuery(
    ['history', 'cluster', range],
    async (c, id) => {
      const [inn, out] = await Promise.all([
        c.getHistory(id, { metric: 'messagesIn', scope: 'cluster', range }),
        c.getHistory(id, { metric: 'messagesOut', scope: 'cluster', range }),
      ]);
      return { inn: inn[0]?.points ?? [], out: out[0]?.points ?? [] };
    },
    5000,
  );
  const hourAgo = useKafkaQuery(
    ['history', 'cluster-1h'],
    async (c, id) => {
      const [m, b] = await Promise.all([
        c.getHistory(id, { metric: 'messagesIn', scope: 'cluster', range: '1h' }),
        c.getHistory(id, { metric: 'bytesIn', scope: 'cluster', range: '1h' }),
      ]);
      return { m: hourAgoValue(m[0]?.points[0]), b: hourAgoValue(b[0]?.points[0]) };
    },
    30_000,
  );

  if (preview === 'loading' || !data) {
    return (
      <>
        <h1 className="sr-only">Overview</h1>
        <BootStatus
          text={`Connecting to ${info.clusters[0]?.name ?? 'cluster'} · fetching cluster metadata`}
        />
        <PageSkeleton />
      </>
    );
  }

  const stale = connection.state === 'reconnecting';
  const k = data.kpis;
  const pct = (now: number, then?: number) => (then ? ((now - then) / then) * 100 : undefined);
  const dm = pct(k.messagesInPerSec, hourAgo.data?.m);
  const db = pct(k.bytesInPerSec, hourAgo.data?.b);
  return (
    <>
      <h1 className="sr-only">Overview</h1>
      {stale && (
        <p className="m-0 text-[13px] text-ink-muted">
          Showing last known values from {formatClock(connection.since ?? Date.now())}. Live updates
          and actions are paused until the connection returns.
        </p>
      )}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard
          label="Messages in / s"
          value={formatInt(k.messagesInPerSec)}
          numeric={k.messagesInPerSec}
          delta={dm !== undefined && !stale ? formatDelta(dm) : undefined}
          deltaTone={dm !== undefined && dm >= 0 ? 'ok' : 'neutral'}
          stale={stale}
        />
        <KpiCard
          label="Bytes in / s"
          value={formatBytes(k.bytesInPerSec)}
          numeric={k.bytesInPerSec}
          delta={db !== undefined && !stale ? formatDelta(db) : undefined}
          deltaTone={db !== undefined && db >= 0 ? 'ok' : 'neutral'}
          stale={stale}
        />
        <KpiCard
          label="Total consumer lag"
          value={formatInt(k.totalLag)}
          numeric={k.totalLag}
          delta={stale ? undefined : k.lagTrend}
          deltaTone={k.lagTrend === 'rising' ? 'warn' : k.lagTrend === 'falling' ? 'ok' : 'neutral'}
          stale={stale}
        />
        <KpiCard
          label="Under-replicated partitions"
          value={stale ? '—' : formatInt(k.underReplicated)}
          numeric={k.underReplicated}
          delta={stale ? 'unknown' : `of ${formatInt(k.totalPartitions)}`}
          deltaTone={k.underReplicated > 0 && !stale ? 'crit' : 'neutral'}
          stale={stale}
        />
      </div>
      {/* F-10: the rest of the cluster health tiles */}
      <div
        className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5"
        aria-label="Cluster health"
        role="group"
      >
        <KpiCard
          label="Brokers online"
          value={`${formatInt(k.brokersOnline)} of ${formatInt(k.brokersTotal)}`}
          numeric={k.brokersOnline}
          delta={
            k.brokersOnline < k.brokersTotal
              ? `${k.brokersTotal - k.brokersOnline} offline`
              : 'all online'
          }
          deltaTone={k.brokersOnline < k.brokersTotal ? 'crit' : 'ok'}
          stale={stale}
        />
        <KpiCard
          label="Offline partitions"
          value={formatInt(k.offlinePartitions)}
          numeric={k.offlinePartitions}
          delta={k.offlinePartitions > 0 ? 'no leader' : 'all have a leader'}
          deltaTone={k.offlinePartitions > 0 ? 'crit' : 'ok'}
          stale={stale}
        />
        <KpiCard
          label="Under min ISR"
          value={formatInt(k.underMinIsr)}
          numeric={k.underMinIsr}
          delta={k.underMinIsr > 0 ? 'writes with acks=all fail' : 'all above min ISR'}
          deltaTone={k.underMinIsr > 0 ? 'crit' : 'ok'}
          stale={stale}
        />
        <KpiCard
          label="Active controller"
          value={k.activeController == null ? 'none' : `broker ${k.activeController}`}
          delta={k.activeController == null ? 'no controller elected' : undefined}
          deltaTone={k.activeController == null ? 'crit' : 'neutral'}
          stale={stale}
        />
        <KpiCard
          label="Active alerts"
          value={formatInt(k.activeAlerts)}
          numeric={k.activeAlerts}
          delta={k.activeAlerts > 0 ? 'firing' : 'none firing'}
          deltaTone={k.activeAlerts > 0 ? 'warn' : 'ok'}
          stale={stale}
        />
      </div>
      {stale ? (
        <ConnectionChecks brokers={k.brokersTotal} mode={info.mode} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
            <Throughput
              key={range}
              inn={history.data?.inn ?? []}
              out={history.data?.out ?? []}
              events={data.events}
            />
            <NeedsAttention data={data} />
          </div>
          <GroupTable groups={data.groups} />
          <RecentEvents data={data} />
        </>
      )}
    </>
  );
}

function Throughput({
  inn,
  out,
  events,
}: {
  inn: Series['points'];
  out: Series['points'];
  events: OverviewData['events'];
}) {
  const { range } = useApp();
  const from = inn[0]?.[0] ?? Date.now();
  // Annotate rebalances, chaos and broker changes inside the visible range
  const markers = events
    .filter(
      (e) =>
        [
          'rebalance',
          'chaos',
          'group-stalled',
          'broker-down',
          'broker-up',
          'offsets-reset',
        ].includes(e.kind) && Date.parse(e.ts) >= from,
    )
    .slice(0, 6)
    .map((e) => ({
      t: Date.parse(e.ts),
      label:
        e.kind === 'rebalance'
          ? 'rebalance'
          : e.kind === 'offsets-reset'
            ? 'reset'
            : e.kind === 'group-stalled'
              ? 'stalled'
              : e.kind.startsWith('broker')
                ? e.kind.replace('-', ' ')
                : 'chaos',
    }));
  const peak = inn.reduce<[number, number] | null>((m, p) => (!m || p[1] > m[1] ? p : m), null);
  const legend = (color: string, label: string) => (
    <span className="inline-flex items-center gap-[6px] text-[12px] text-ink-muted">
      <span aria-hidden="true" className="h-[2px] w-3" style={{ background: `var(--${color})` }} />
      {label}
    </span>
  );
  return (
    <Card
      className="ki-fade-in"
      title={
        <span className="flex items-center gap-4">
          Throughput {legend('chart-1', 'in')} {legend('chart-2', 'out')}
        </span>
      }
      actions={
        peak && (
          <span className="font-mono text-[10px] text-ink-muted">
            peak {formatInt(peak[1])}/s at {formatClock(peak[0])}
          </span>
        )
      }
    >
      <TimeSeriesChart
        label="Throughput, messages per second"
        height={180}
        xFormat={axisTime(range)}
        yFormat={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)))}
        peak={peak ? { t: peak[0], v: peak[1] } : undefined}
        markers={markers}
        series={[
          { key: 'in', label: 'in', points: inn, color: 'chart-1', area: true },
          { key: 'out', label: 'out', points: out, color: 'chart-2' },
        ]}
      />
    </Card>
  );
}

function NeedsAttention({ data }: { data: OverviewData }) {
  const router = useRouter();
  const items = data.attention.slice(0, 4);
  const first = items.find((i) => i.action);
  return (
    <Card
      title="Needs attention"
      data-tour="attention"
      actions={
        <Link href="/app/alerts/" className="text-[13px] text-copper underline">
          All alerts
        </Link>
      }
      className="flex flex-col"
    >
      {items.length === 0 ? (
        <p className="m-0 text-[13px] text-ink-muted">
          Nothing needs attention. Every group is keeping up and all partitions are in sync.
        </p>
      ) : (
        <div>
          {items.map((a) => (
            <AlertItem
              key={a.id}
              severity={a.severity}
              title={shownName(a.title)}
              detail={a.detail}
              time={formatClock(a.since)}
              href={a.href}
              linkAs={Link}
            />
          ))}
        </div>
      )}
      {first && (
        <Button variant="primary" className="mt-3 w-full" onClick={() => router.push(first.href)}>
          {first.action}
        </Button>
      )}
    </Card>
  );
}

export function GroupTable({
  groups,
  caption = 'Consumer groups, problems first',
}: {
  groups: GroupSummary[];
  caption?: string;
}) {
  const router = useRouter();
  return (
    <DataTable
      caption={caption}
      rows={groups}
      rowKey={(g) => g.groupId}
      onRowClick={(g) => router.push(`/app/groups/view/?id=${encodeURIComponent(g.groupId)}`)}
      columns={[
        {
          key: 'id',
          header: 'Consumer group',
          kind: 'id',
          cell: (g) => (
            <Link
              href={`/app/groups/view/?id=${encodeURIComponent(g.groupId)}`}
              className="text-ink no-underline hover:text-copper"
              onClick={(e) => e.stopPropagation()}
            >
              {shownName(g.groupId)}
            </Link>
          ),
        },
        { key: 'type', header: 'Type', kind: 'dim', cell: (g) => g.type },
        { key: 'members', header: 'Members', kind: 'num', cell: (g) => formatInt(g.members) },
        { key: 'lag', header: 'Lag', kind: 'num', cell: (g) => formatInt(g.totalLag) },
        {
          key: 'trend',
          header: 'Lag, 1h',
          cell: (g) => <Sparkline points={g.trend ?? []} tone={sparkTone(g.status)} />,
        },
        {
          key: 'eta',
          header: 'Catch-up',
          kind: 'dim',
          cell: (g) =>
            g.forecast.kind === 'caught-up' || g.forecast.kind === 'unknown'
              ? '—'
              : formatForecast(g.forecast),
        },
        {
          key: 'status',
          header: 'Status',
          cell: (g) => {
            const b = groupBadge(g.status, g.state);
            return <StatusBadge status={b.status}>{b.label}</StatusBadge>;
          },
        },
      ]}
    />
  );
}

function RecentEvents({ data }: { data: OverviewData }) {
  const DOT = { crit: 'bg-crit', warn: 'bg-warn', info: 'bg-line-strong' };
  return (
    <Card title="Recent events">
      <ol className="m-0 list-none p-0">
        {data.events.slice(0, 8).map((e) => (
          <li
            key={e.id}
            className="ki-insert flex items-start gap-3 border-b border-line-subtle py-2 text-[13px] last:border-b-0"
          >
            <span
              aria-hidden="true"
              className={`mt-[7px] size-[6px] shrink-0 rounded-full ${DOT[e.severity]}`}
            />
            <span className="w-[52px] shrink-0 font-mono text-[11px] leading-5 text-ink-muted">
              {formatClock(e.ts)}
            </span>
            <span className="min-w-0 grow">
              {e.title}
              {e.detail && <span className="text-ink-muted"> · {e.detail}</span>}
            </span>
            <span className="shrink-0 text-[12px] text-ink-muted">{formatRelative(e.ts)}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** Only what the browser actually knows: it can't see brokers while the agent is unreachable. */
function ConnectionChecks({ brokers, mode }: { brokers: number; mode: string }) {
  const [retry, retryNote] = useRetryWhenReachable();
  const online = typeof navigator === 'undefined' || navigator.onLine;
  const row = (state: 'Done' | 'Failed' | 'Waiting', text: React.ReactNode) => (
    <li className="flex items-center gap-3">
      <StatusBadge
        status={state === 'Done' ? 'healthy' : state === 'Failed' ? 'stalled' : 'neutral'}
        dot={false}
      >
        {state}
      </StatusBadge>
      <span>{text}</span>
    </li>
  );
  return (
    <Card className="flex justify-center py-16">
      <div className="max-w-[420px]">
        <h2 className="section-title m-0 mb-4">What we&apos;ve checked</h2>
        <ul className="m-0 flex list-none flex-col gap-3 p-0 text-[13px]">
          {row(online ? 'Done' : 'Failed', online ? 'Browser is online' : 'Browser is offline')}
          {row(
            'Failed',
            <>
              {mode === 'agent' ? 'Agent at ' : 'Agent connection (preview) at '}
              <code className="font-mono text-[12px]">
                {typeof location === 'undefined' ? '' : location.host}
              </code>{' '}
              did not answer
            </>,
          )}
          {row(
            'Waiting',
            <>
              {formatInt(brokers)} broker{brokers === 1 ? '' : 's'}, checked once the agent answers
            </>,
          )}
        </ul>
        <p className="mt-4 text-[12px] text-ink-muted">
          Is the agent still running? Check its container with{' '}
          <code className="font-mono">docker ps</code> and start it again, or switch to the
          simulated cluster to keep exploring.
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="primary" onClick={retry}>
            Retry now
          </Button>
          {retryNote && (
            <span role="status" className="self-center text-[12px] text-ink">
              {retryNote}
            </span>
          )}
          <Button onClick={() => location.assign('/app/')}>Switch to simulated cluster</Button>
        </div>
      </div>
    </Card>
  );
}
