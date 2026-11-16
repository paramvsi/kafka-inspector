'use client';
import {
  formatBytes,
  formatInt,
  formatRelative,
  type TopicQuery,
  type TopicSummary,
} from '@ki/core';
import {
  Banner,
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  SearchInput,
  SegmentedControl,
  Select,
  Sparkline,
  StatusBadge,
} from '@ki/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useKafkaQuery } from '../../lib/kafka';
import { useLocal } from '../../lib/local';
import { useUrl, useUrlText } from '../../lib/url';
import { PageHeader, useReadOnly, WriteButton } from '../Page';
import { CreateTopicDialog } from './CreateTopic';

const PAGE = 25;
const looksLikeRegex = (q: string) => /[\^$*+?()[\]{}|\\]/.test(q);

export function healthBadge(t: TopicSummary) {
  const worst =
    t.health.find((h) => h.severity === 'crit') ?? t.health.find((h) => h.severity === 'warn');
  if (t.underReplicated > 0)
    return <StatusBadge status="stalled">{t.underReplicated} under-replicated</StatusBadge>;
  if (worst)
    return (
      <StatusBadge status={worst.severity === 'crit' ? 'stalled' : 'warn'}>
        {worst.message}
      </StatusBadge>
    );
  if (t.health.some((h) => h.id === 'no-consumers'))
    return <StatusBadge status="neutral">No consumers</StatusBadge>;
  return <StatusBadge status="healthy" />;
}

export function TopicsView() {
  const url = useUrl();
  const router = useRouter();
  const readOnly = useReadOnly();
  const [q, setQ] = useUrlText('q', { page: undefined });
  const view = (url.get('view') as TopicQuery['view']) ?? 'all';
  const internal = url.get('internal') === '1';
  const sort = (url.get('sort') as TopicQuery['sort']) ?? 'issues';
  const page = Number(url.get('page') ?? 1);
  const [starred, setStarred] = useLocal<string[]>('ki-starred-topics', []);
  const filterRef = useRef<HTMLInputElement>(null);

  const all = useKafkaQuery(
    ['topics', 'all-internal'],
    (c, id) => c.listTopics(id, { internal: true, size: 500 }),
    5000,
  );
  const list = useKafkaQuery(
    ['topics', q, view, internal, sort, page, starred],
    (c, id) =>
      c.listTopics(id, {
        query: q || undefined,
        regex: looksLikeRegex(q),
        internal,
        view,
        starred,
        sort,
        page,
        size: PAGE,
      }),
    2000,
  );

  // "/" focuses the page filter (F-06)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        filterRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const everything = all.data?.items ?? [];
  const visible = everything.filter((t) => !t.internal);
  const internalCount = everything.length - visible.length;
  const attention = visible.filter(
    (t) =>
      t.underReplicated > 0 ||
      t.health.some((h) => h.severity !== 'info' || h.id === 'no-consumers'),
  ).length;
  const total = everything.reduce((a, t) => a + (t.sizeBytes ?? 0), 0);
  const parts = everything.reduce((a, t) => a + t.partitions, 0);
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  const toggleStar = (name: string) =>
    setStarred(starred.includes(name) ? starred.filter((s) => s !== name) : [...starred, name]);

  return (
    <>
      <PageHeader
        title="Topics"
        subtitle={
          all.data
            ? `${everything.length} topics · ${formatInt(parts)} partitions · ${formatBytes(total)} · ${attention} need attention`
            : '\u00a0' // keeps the line's height so the table below doesn't shift (CLS)
        }
        actions={
          <WriteButton variant="primary" onClick={() => url.set({ create: 1 })}>
            Create topic
          </WriteButton>
        }
      />
      {readOnly && (
        <Banner tone="info" title="Read-only cluster.">
          Browsing works as usual. Creating, deleting and producing are disabled in this version.
        </Banner>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          label="Filter topics"
          placeholder="Filter by name or regex"
          shortcut="/"
          ref={filterRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <SegmentedControl
          label="View"
          options={[
            { value: 'all', label: 'All' },
            { value: 'attention', label: 'Needs attention' },
            { value: 'starred', label: 'Starred' },
          ]}
          value={view}
          onChange={(v) => url.set({ view: v === 'all' ? undefined : v, page: undefined })}
        />
        <Checkbox
          label="Hide internal topics"
          checked={!internal}
          onChange={(e) => url.set({ internal: e.target.checked ? undefined : 1, page: undefined })}
        />
        <div className="grow" />
        <div className="w-[210px]">
          <Select
            label="Sort"
            hideLabel
            value={sort}
            onChange={(e) =>
              url.set({ sort: e.target.value === 'issues' ? undefined : e.target.value })
            }
            options={[
              { value: 'issues', label: 'Sorted by: issues first' },
              { value: 'name', label: 'Sorted by: name' },
              { value: 'rate', label: 'Sorted by: in / s' },
              { value: 'size', label: 'Sorted by: size' },
            ]}
          />
        </div>
      </div>
      {data && data.total === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState
            title={
              q
                ? `No topics match “${q}”`
                : view === 'starred'
                  ? 'No starred topics yet'
                  : view === 'attention'
                    ? 'Nothing needs attention'
                    : 'No topics yet'
            }
            actions={
              q ? (
                <>
                  <Button onClick={() => url.set({ q: undefined })}>Clear filter</Button>
                  {!internal && (
                    <Button onClick={() => url.set({ internal: 1 })}>
                      Include internal topics
                    </Button>
                  )}
                  {!readOnly && /^[a-zA-Z0-9._-]+$/.test(q) && (
                    <Button variant="primary" onClick={() => url.set({ create: 1, name: q })}>
                      Create “{q}”
                    </Button>
                  )}
                </>
              ) : view === 'starred' ? (
                <Button onClick={() => url.set({ view: undefined })}>Show all topics</Button>
              ) : view !== 'attention' && !readOnly ? (
                <Button variant="primary" onClick={() => url.set({ create: 1 })}>
                  Create topic
                </Button>
              ) : null
            }
          >
            {q ? (
              <>
                Nothing in the {visible.length} visible topics
                {!internal && `, and ${internalCount} internal topics are hidden`}. Check the
                spelling, try a regex such as <code className="font-mono">{q.slice(0, 4)}.*</code>,
                or create the topic.
              </>
            ) : view === 'starred' ? (
              'Star a topic with the ☆ next to its name to keep it here.'
            ) : view === 'attention' ? (
              'Every topic is replicated, consumed and evenly spread.'
            ) : internal ? (
              'This cluster has no topics.'
            ) : (
              'This cluster has no topics apart from internal ones.'
            )}
          </EmptyState>
        </div>
      ) : (
        <DataTable
          caption="Topics"
          rows={data?.items ?? []}
          rowKey={(t) => t.name}
          onRowClick={(t) => router.push(`/app/topics/view/?name=${encodeURIComponent(t.name)}`)}
          footer={
            <div className="flex items-center gap-3">
              <span>
                Showing {data?.items.length ?? 0} of {data?.total ?? 0}
                {!internal && internalCount > 0 && ` · ${internalCount} internal topics hidden`}
              </span>
              <div className="grow" />
              <Button
                size="sm"
                variant="ghost"
                disabled={page <= 1}
                onClick={() => url.set({ page: page - 1 === 1 ? undefined : page - 1 })}
              >
                Previous
              </Button>
              <span className="font-mono text-[11px]">
                Page {page} of {pages}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={page >= pages}
                onClick={() => url.set({ page: page + 1 })}
              >
                Next
              </Button>
            </div>
          }
          columns={[
            {
              key: 'name',
              header: 'Topic',
              kind: 'id',
              cell: (t) => (
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={starred.includes(t.name) ? `Unstar ${t.name}` : `Star ${t.name}`}
                    aria-pressed={starred.includes(t.name)}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleStar(t.name);
                    }}
                    className={`-m-1 inline-flex size-6 cursor-pointer items-center justify-center border-none bg-transparent p-0 text-[13px] ${starred.includes(t.name) ? 'text-copper' : 'text-ink-subtle hover:text-ink'}`}
                  >
                    {starred.includes(t.name) ? '★' : '☆'}
                  </button>
                  <Link
                    href={`/app/topics/view/?name=${encodeURIComponent(t.name)}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-ink no-underline hover:text-copper"
                  >
                    {t.name}
                  </Link>
                </span>
              ),
            },
            { key: 'p', header: 'Partitions', kind: 'num', cell: (t) => t.partitions },
            { key: 'rf', header: 'RF', kind: 'num', cell: (t) => t.replicationFactor },
            {
              key: 'size',
              header: 'Size',
              kind: 'num',
              cell: (t) => formatBytes(t.sizeBytes ?? 0),
            },
            {
              key: 'rate',
              header: 'In / s',
              kind: 'num',
              cell: (t) => formatInt(t.messagesInPerSec),
            },
            {
              key: 'trend',
              header: 'Trend, 1h',
              cell: (t) => (
                <Sparkline points={t.trend ?? []} tone={t.messagesInPerSec ? 'chart-1' : 'muted'} />
              ),
            },
            { key: 'groups', header: 'Groups', kind: 'num', cell: (t) => t.consumerGroups },
            {
              key: 'last',
              header: 'Last message',
              kind: 'dim',
              cell: (t) =>
                t.lastMessageAt && Date.now() - Date.parse(t.lastMessageAt) < 2000
                  ? 'now'
                  : formatRelative(t.lastMessageAt),
            },
            { key: 'health', header: 'Health', cell: healthBadge },
          ]}
        />
      )}
      <CreateTopicDialog
        open={url.get('create') === '1' && !readOnly}
        initialName={url.get('name')}
        onClose={() => url.set({ create: undefined, name: undefined })}
      />
    </>
  );
}
