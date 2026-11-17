'use client';
import {
  formatClock,
  formatCount,
  formatInt,
  shownName,
  type Topology,
  type TopologyNode,
} from '@ki/core';
import { Button, Card, EmptyState, SearchInput } from '@ki/ui';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../lib/app';
import { useKafka, useKafkaQuery } from '../../lib/kafka';
import { useStickyError } from '../../lib/stickyError';
import { useUrlText } from '../../lib/url';
import { PageHeader } from '../Page';
import { LoadingRows, useConnection } from '../Shell';

const W = 1040,
  NODE_W = 200,
  NODE_H = 44,
  ROW = 80,
  TOP = 64;
const COLS3 = { producer: 30, topic: 420, group: 810 };
const COLS2 = { producer: -1, topic: 30, group: 420 };
const GROUP_ORDER = [
  'order-service',
  'payments-sink',
  'fraud-scorer',
  'analytics-etl',
  'search-indexer',
  'notify-workers',
];

function layout(t: Topology) {
  const pos = new Map<string, { x: number; y: number }>();
  const topics = t.nodes.filter((n) => n.kind === 'topic');
  // no producer nodes (self-hosted: the Admin API doesn't expose them) → two columns that fit at 1280
  const COL = t.nodes.some((n) => n.kind === 'producer') ? COLS3 : COLS2;
  topics.sort((a, b) => Number(a.label.endsWith('.dlq')) - Number(b.label.endsWith('.dlq')));
  topics.forEach((n, i) => pos.set(n.id, { x: COL.topic, y: TOP + i * ROW }));
  const producers = t.nodes.filter((n) => n.kind === 'producer');
  producers.forEach((n, i) => {
    const target = t.edges.find((e) => e.from === n.id)?.to;
    pos.set(n.id, { x: COL.producer, y: target ? pos.get(target)!.y : TOP + i * ROW });
  });
  const groups = t.nodes
    .filter((n) => n.kind === 'group')
    .sort(
      (a, b) => (GROUP_ORDER.indexOf(a.label) + 1 || 99) - (GROUP_ORDER.indexOf(b.label) + 1 || 99),
    );
  groups.forEach((n, i) => pos.set(n.id, { x: COL.group, y: TOP + i * ROW }));
  const rows = Math.max(topics.length, groups.length, producers.length);
  return {
    pos,
    height: TOP + rows * ROW + 30,
    col: COL,
    w: COL === COLS3 ? W : COLS2.group + NODE_W + 30,
  };
}

const STATUS_BOX: Record<string, string> = {
  healthy: 'border-line',
  neutral: 'border-dashed border-line-strong',
  warn: 'border-warn bg-warn-soft',
  stalled: 'border-crit bg-crit-soft',
  // no dimming class: the inline opacity (1, or 0.3 off-filter) always wins, and a faded crit tag would fail AA
  stopped: 'border-line',
  unknown: 'border-line',
};
const DOT: Record<string, string> = {
  healthy: 'bg-ok',
  warn: 'bg-warn',
  stalled: 'bg-crit',
  stopped: 'bg-crit',
  neutral: 'bg-line-strong',
  unknown: 'bg-line-strong',
};

export function TopologyView() {
  const { info } = useKafka();
  const data = useKafkaQuery(['topology'], (c, id) => c.getTopology(id), 2000);
  const failed = useStickyError(data, 'topology');
  const [highlight, setHighlight] = useUrlText('highlight');
  const q = highlight.toLowerCase();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [visible, setVisible] = useState(true);
  const { live } = useApp(); // paused Live: the flow stops moving too
  // reconnecting: the map shows the last values it had, so it stops flowing and says so (as Overview does)
  const connection = useConnection();
  const stale = connection.state === 'reconnecting';
  useEffect(() => {
    // Stop continuous animation when the tab is hidden (MOTION.md principle 7)
    const on = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  const t = data.data;
  const { pos, height, col, w } = useMemo(
    () => (t ? layout(t) : { pos: new Map(), height: 400, col: COLS3, w: W }),
    [t],
  );
  if (!t)
    return (
      <>
        <PageHeader
          title="Topology"
          subtitle="Producers → topics → consumer groups · line width = messages per second"
        />
        <Card>
          {failed ? (
            <EmptyState title="Couldn't load the topology">
              {(failed as Error).message} It retries every few seconds.
            </EmptyState>
          ) : (
            <LoadingRows label="Loading topology…" />
          )}
        </Card>
      </>
    );
  const max = Math.max(1, ...t.edges.map((e) => e.rate));
  const width = (r: number) => 1.5 + (6 * Math.log10(1 + r)) / Math.log10(1 + max);
  const nodeById = new Map(t.nodes.map((n) => [n.id, n]));
  const match = (n?: TopologyNode) => !q || !!n?.label.toLowerCase().includes(q);
  const edgeMatch = (from: string, to: string) =>
    !q || match(nodeById.get(from)) || match(nodeById.get(to));
  const dlq = t.edges.find((e) => e.kind === 'dlq');
  return (
    <>
      <PageHeader
        title="Topology"
        subtitle={`${info.mode !== 'demo' ? 'Topics → consumer groups (the Admin API doesn’t expose producers)' : 'Producers → topics → consumer groups'} · line width = messages per second`}
        actions={
          <>
            <SearchInput
              label="Highlight a topic or group"
              placeholder="Highlight a topic or group"
              shortcut="/"
              value={highlight}
              onChange={(e) => setHighlight(e.target.value)}
            />
            <Button onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))} aria-label="Zoom out">
              −
            </Button>
            <Button onClick={() => setZoom((z) => Math.min(2.5, z + 0.2))} aria-label="Zoom in">
              +
            </Button>
            <Button
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
            >
              Fit to screen
            </Button>
          </>
        }
      />
      {stale && (
        <p className="m-0 text-[13px] text-ink-muted">
          Showing last known values from {formatClock(connection.since ?? Date.now())}. The map
          updates again when the connection returns.
        </p>
      )}
      {q && t.nodes.length > 0 && !t.nodes.some((n) => match(n)) && (
        <p role="status" className="m-0 text-[13px] text-ink-muted">
          Nothing matches “{highlight}”.
        </p>
      )}
      {t.nodes.length === 0 ? (
        <Card>
          <EmptyState title="Nothing to draw yet">
            Topics and consumer groups appear once they have traffic.
          </EmptyState>
        </Card>
      ) : (
        <div
          className="relative cursor-grab touch-none overflow-hidden rounded-lg border border-line bg-surface [background-image:radial-gradient(var(--line-subtle)_1px,transparent_1px)] [background-size:16px_16px] active:cursor-grabbing"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('a,button')) return;
            drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) =>
            drag.current && setPan({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y })
          }
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          <div
            className="origin-top-left"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          >
            <div className="relative mx-auto" style={{ width: w, height }}>
              {(['producer', 'topic', 'group'] as const)
                .filter((k) => col[k] >= 0)
                .map((k) => (
                  <div
                    key={k}
                    className="absolute top-6 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-muted"
                    style={{ left: col[k] }}
                  >
                    {k === 'producer' ? 'Producers' : k === 'topic' ? 'Topics' : 'Consumer groups'}
                  </div>
                ))}
              {/* the lines are drawn for the eye only: this is who feeds whom, and how fast, for everyone else */}
              <ul aria-label="Connections" className="sr-only">
                {t.edges.map((e) => {
                  const name = (id: string) => t.nodes.find((n) => n.id === id)?.label ?? id;
                  return (
                    <li key={`${e.from}>${e.to}`}>
                      {name(e.from)} → {name(e.to)} · {formatInt(e.rate)} messages / s
                      {e.kind === 'dlq' ? ' (dead letters)' : ''}
                    </li>
                  );
                })}
              </ul>
              <svg width={w} height={height} className="absolute inset-0" aria-hidden="true">
                {t.edges.map((e) => {
                  const a = pos.get(e.from),
                    b = pos.get(e.to);
                  if (!a || !b) return null;
                  const target = nodeById.get(e.to);
                  const source = nodeById.get(e.from);
                  const x1 = a.x + NODE_W,
                    y1 = a.y + NODE_H / 2;
                  const x2 = e.kind === 'dlq' ? b.x + NODE_W : b.x,
                    y2 = b.y + NODE_H / 2;
                  const d =
                    e.kind === 'dlq'
                      ? `M ${a.x + NODE_W / 2} ${a.y + NODE_H} C ${a.x} ${y2 + 40}, ${x2 + 160} ${y2}, ${x2} ${y2}`
                      : `M ${x1} ${y1} C ${x1 + 90} ${y1}, ${x2 - 90} ${y2}, ${x2} ${y2}`;
                  const status =
                    e.kind === 'consume'
                      ? target?.status
                      : e.kind === 'dlq'
                        ? 'stalled'
                        : 'healthy';
                  const color =
                    e.kind === 'produce'
                      ? 'var(--chart-1)'
                      : e.kind === 'dlq'
                        ? 'var(--crit)'
                        : status === 'warn'
                          ? 'var(--warn)'
                          : status === 'stalled'
                            ? 'var(--crit)'
                            : status === 'stopped' || status === 'neutral'
                              ? 'var(--line-strong)'
                              : 'var(--chart-2)';
                  const flowing =
                    e.rate > 0 &&
                    status !== 'stalled' &&
                    status !== 'stopped' &&
                    (e.kind !== 'consume' || source);
                  // speed scales with rate, clamped to 0.5×–3× (MOTION.md "Topology edges")
                  const speed = Math.min(3, Math.max(0.5, Math.log10(1 + e.rate) / 2));
                  const dim = !edgeMatch(e.from, e.to);
                  return (
                    <g
                      key={`${e.from}-${e.to}`}
                      className="transition-opacity duration-fast ease-standard"
                      style={{ opacity: dim ? 0.3 : 1 }}
                    >
                      <path
                        d={d}
                        fill="none"
                        stroke={color}
                        strokeOpacity={e.kind === 'produce' ? 0.55 : 0.8}
                        strokeWidth={e.kind === 'dlq' ? 1.5 : width(e.rate)}
                        strokeDasharray={
                          e.kind === 'dlq'
                            ? '5 5'
                            : status === 'stopped'
                              ? '2 5'
                              : status === 'stalled'
                                ? '5 4'
                                : undefined
                        }
                      />
                      {flowing && visible && live && !stale && (
                        <path
                          d={d}
                          fill="none"
                          stroke={color}
                          strokeWidth={Math.max(1, width(e.rate) / 2)}
                          strokeDasharray="3 14"
                          className={`ki-flow ${e.kind === 'dlq' ? 'ki-flow-slow' : ''}`}
                          style={{
                            animationDuration: `calc(var(--pulse-period) / ${speed.toFixed(2)})`,
                          }}
                        />
                      )}
                    </g>
                  );
                })}
              </svg>
              {t.nodes.map((n) => {
                const p = pos.get(n.id);
                if (!p) return null;
                const href =
                  n.kind === 'topic'
                    ? `/app/topics/view/?name=${encodeURIComponent(n.label)}`
                    : n.kind === 'group'
                      ? `/app/groups/view/?id=${encodeURIComponent(n.label)}`
                      : undefined;
                const tag = n.note ?? (n.kind === 'topic' ? `${formatCount(n.rate)}/s` : '');
                const body = (
                  <>
                    {n.kind === 'group' && (
                      <span
                        aria-hidden="true"
                        className={`size-[7px] shrink-0 rounded-full ${DOT[n.status]}`}
                      />
                    )}
                    <span className="truncate">{shownName(n.label)}</span>
                    <span
                      className={`ml-auto shrink-0 text-[10px] tabular-nums ${n.status === 'stalled' || n.status === 'stopped' ? 'text-crit-text' : n.status === 'warn' ? 'text-warn-text' : 'text-ink-muted'}`}
                    >
                      {tag}
                    </span>
                    {n.kind !== 'producer' && n.status !== 'healthy' && n.status !== 'neutral' && (
                      <span className="sr-only">, {n.status}</span>
                    )}
                  </>
                );
                const cls = `absolute flex items-center gap-2 rounded-md border bg-surface px-3 font-mono text-[12px] text-ink no-underline transition-opacity duration-fast ease-standard ${STATUS_BOX[n.kind === 'producer' ? 'healthy' : n.status] ?? 'border-line'} ${n.label.endsWith('.dlq') ? 'border-dashed' : ''}`;
                const style = {
                  left: p.x,
                  top: p.y,
                  width: NODE_W,
                  height: NODE_H,
                  opacity: match(n) ? 1 : 0.3,
                };
                return href ? (
                  <Link
                    key={n.id}
                    href={href}
                    className={`${cls} hover:border-copper`}
                    style={style}
                    data-node={n.label}
                  >
                    {body}
                    {n.status === 'stalled' && (
                      <span
                        key="ring"
                        aria-hidden="true"
                        className="ki-pulse-ring pointer-events-none absolute inset-0 rounded-md text-crit"
                      />
                    )}
                  </Link>
                ) : (
                  <div key={n.id} className={cls} style={style} data-node={n.label}>
                    {body}
                  </div>
                );
              })}
              {dlq && (
                <div
                  className="absolute text-[12px] text-crit-text"
                  style={{ left: col.group + 20, top: (pos.get(dlq.to)?.y ?? 0) + NODE_H + 14 }}
                >
                  {nodeById.get(dlq.from)?.label} writes failures to {nodeById.get(dlq.to)?.label}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
