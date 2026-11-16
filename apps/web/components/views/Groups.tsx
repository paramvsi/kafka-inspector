'use client';
import {
  formatInt,
  formatRelative,
  type ClusterEvent,
  type GroupSummary,
  type GroupType,
  shownName,
} from '@ki/core';
import {
  DataTable,
  EmptyState,
  KpiCard,
  SearchInput,
  Select,
  Sparkline,
  StatusBadge,
} from '@ki/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useKafkaQuery, useStream } from '../../lib/kafka';
import { groupBadge, sparkTone } from '../../lib/status';
import { useUrl, useUrlText } from '../../lib/url';
import { PageHeader } from '../Page';

const TYPES: readonly GroupType[] = ['classic', 'consumer', 'share', 'streams', 'unknown'];

export function GroupsView() {
  const url = useUrl();
  const router = useRouter();
  const [q, setQ] = useUrlText('q');
  const t = url.get('type');
  const type = t && TYPES.includes(t as GroupType) ? (t as GroupType) : undefined;
  const live = useStream<GroupSummary[]>('lag');
  const fallback = useKafkaQuery(['groups'], (c, id) => c.listGroups(id), false);
  const events = useStream<ClusterEvent[]>('events');
  const all = live ?? fallback.data ?? [];
  const rows = all.filter(
    (g) => (!type || g.type === type) && (!q || g.groupId.toLowerCase().includes(q.toLowerCase())),
  );
  const count = (s: string[]) => all.filter((g) => s.includes(g.status)).length;
  const rebalances = (events ?? []).filter(
    (e) => e.kind === 'rebalance' && Date.now() - Date.parse(e.ts) < 3600e3,
  ).length;
  const total = all
    .filter((g) => g.type !== 'share' && g.members > 0)
    .reduce((a, g) => a + g.totalLag, 0);
  const stalled = count(['stalled']),
    stopped = count(['stopped']),
    warn = count(['warn']);
  return (
    <>
      <PageHeader
        title="Consumer groups"
        subtitle={
          all.length
            ? `${all.length} groups · ${stalled} stalled · ${warn} warning · ${stopped} stopped · active lag ${formatInt(total)}`
            : '\u00a0' // keeps the line's height so the table below doesn't shift (CLS)
        }
      />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard
          label="Healthy"
          value={count(['healthy'])}
          delta={<StatusBadge status="healthy" />}
        />
        <KpiCard
          label="Warning"
          value={warn}
          delta={warn ? <StatusBadge status="warn" /> : undefined}
        />
        <KpiCard
          label="Stalled or stopped"
          value={stalled + stopped}
          delta={
            stalled + stopped ? <StatusBadge status="stalled">Needs action</StatusBadge> : undefined
          }
        />
        <KpiCard label="Rebalances, 1h" value={rebalances} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          label="Filter groups"
          placeholder="Filter groups"
          shortcut="/"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="w-[160px]">
          <Select
            label="Type"
            hideLabel
            value={type ?? ''}
            onChange={(e) => url.set({ type: e.target.value || undefined })}
            options={[
              { value: '', label: 'All types' },
              { value: 'consumer', label: 'Consumer' },
              { value: 'classic', label: 'Classic' },
              { value: 'share', label: 'Share' },
              { value: 'streams', label: 'Streams' },
            ]}
          />
        </div>
      </div>
      <DataTable
        caption="Consumer groups"
        rows={rows}
        rowKey={(g) => g.groupId}
        onRowClick={(g) => router.push(`/app/groups/view/?id=${encodeURIComponent(g.groupId)}`)}
        empty={
          !live && !fallback.data ? (
            fallback.error ? (
              <EmptyState title="Couldn't list consumer groups">
                {(fallback.error as Error).message} Reload the page to try again.
              </EmptyState>
            ) : (
              <EmptyState title="Loading consumer groups…">{'\u00a0'}</EmptyState>
            )
          ) : (
            <EmptyState title={q || type ? 'No groups match' : 'No consumer groups yet'}>
              {q || type
                ? 'Clear the filter to see every group.'
                : 'Groups appear once a consumer commits offsets.'}
            </EmptyState>
          )
        }
        columns={[
          {
            key: 'g',
            header: 'Consumer group',
            kind: 'id',
            cell: (g) => (
              <Link
                href={`/app/groups/view/?id=${encodeURIComponent(g.groupId)}`}
                onClick={(e) => e.stopPropagation()}
                className="text-ink no-underline hover:text-copper"
              >
                {shownName(g.groupId)}
              </Link>
            ),
          },
          { key: 't', header: 'Type', kind: 'dim', cell: (g) => g.type },
          { key: 's', header: 'State', kind: 'dim', cell: (g) => g.state },
          {
            key: 'topics',
            header: 'Topics',
            kind: 'dim',
            cell: (g) => (
              <span className="font-mono text-[12px]">
                {g.topics.slice(0, 2).join(', ')}
                {g.topics.length > 2 && ` +${g.topics.length - 2}`}
              </span>
            ),
          },
          { key: 'm', header: 'Members', kind: 'num', cell: (g) => g.members },
          { key: 'l', header: 'Lag', kind: 'num', cell: (g) => formatInt(g.totalLag) },
          {
            key: 'trend',
            header: 'Lag, 1h',
            cell: (g) => <Sparkline points={g.trend ?? []} tone={sparkTone(g.status)} />,
          },
          {
            key: 'c',
            header: 'Last commit',
            kind: 'dim',
            cell: (g) =>
              `${g.lastCommitAt && Date.now() - Date.parse(g.lastCommitAt) < 2000 ? 'now' : formatRelative(g.lastCommitAt)}${g.status === 'stalled' ? ' · same offset' : ''}`,
          },
          {
            key: 'h',
            header: 'Health',
            cell: (g) => {
              const b = groupBadge(g.status, g.state);
              return <StatusBadge status={b.status}>{b.label}</StatusBadge>;
            },
          },
        ]}
      />
    </>
  );
}
