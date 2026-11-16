'use client';
import {
  DECODE_OPTIONS,
  formatInt,
  formatRate,
  toHex,
  formatTimestamp,
  toLocalInput,
  type RawMessage,
  type RawMessagePage,
  type SavedFilter,
  type TopicSummary,
} from '@ki/core';
import { Button, Card, Checkbox, EmptyState, Kbd, Select, TextField, useToast } from '@ki/ui';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
import { csvCell } from '../../lib/csv';
import { runFilter, type FilterResult } from '../../lib/filter';
import { useKafka, useKafkaQuery } from '../../lib/kafka';
import { useQueryClient } from '@tanstack/react-query';
import { useLocal } from '../../lib/local';
import {
  decodeMessage,
  msgId,
  useMaskRules,
  useSchemaLookup,
  type DecodedMessage,
} from '../../lib/serdes';
import { useUrl, useUrlText } from '../../lib/url';
import { MaskingDialog } from './Masking';
import { MessageDrawer } from './MessageDrawer';

const RING = 2000; // live tail ring buffer (ARCHITECTURE perf budgets)
const ROW_H = 41;
const FROM = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'offset', label: 'From offset' },
  { value: 'timestamp', label: 'From time' },
  { value: 'group', label: 'Group position' },
];

const FROMS = ['newest', 'oldest', 'offset', 'timestamp', 'group'] as const;
const pick = <T extends string>(v: string | undefined, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

const time = (iso: string) => formatTimestamp(iso).slice(11); // HH:MM:SS.mmm

function preview(
  d: DecodedMessage | undefined,
  raw: RawMessage,
): { text: string; failed?: boolean } {
  if (!d) return { text: '…' };
  if (!d.value.ok) return { text: d.value.hex.slice(0, 48), failed: true };
  const v = d.shown;
  return {
    text:
      v === null
        ? 'null'
        : typeof v === 'string' || typeof v === 'number'
          ? String(v) // NaN / Infinity stay visible
          : (JSON.stringify(v) ?? String(raw.sizeBytes)),
  };
}

export function MessagesTab({ topic, partitions }: { topic: string; partitions: number }) {
  const url = useUrl();
  const { client, clusterId } = useKafka();
  const lookup = useSchemaLookup();
  const [rules, setRules] = useMaskRules();
  // a hand-edited or stale link falls back to the defaults instead of crashing the tab
  const from = pick(url.get('from'), FROMS, 'newest');
  const p = /^\d+$/.test(url.get('p') ?? '') ? url.get('p')! : 'all';
  const decoders = DECODE_OPTIONS.map((o) => o.value);
  const valueAs = pick(url.get('dv'), decoders, 'auto');
  const keyAs = pick(url.get('dk'), decoders, 'auto');
  const live = url.get('live') === '1';
  const expr = url.get('filter') ?? '';
  const cols = (url.get('cols') ?? '').split(',').filter(Boolean);
  const regex = url.get('search');
  const msgParam = /^\d+:\d+$/.test(url.get('msg') ?? '') ? url.get('msg')! : undefined;
  const [draftExpr, setDraftExpr] = useState(expr);
  const [offset, setOffset] = useState(url.get('offset') ?? '');
  const [ts, setTs] = useState(() => toLocalInput(url.get('ts') ?? ''));
  const [extra, setExtra] = useState<RawMessage[]>([]);
  const [extraScanned, setExtraScanned] = useState(0); // scanned by Load more pages
  const [cursor, setCursor] = useState<string | undefined>();

  const groups = useKafkaQuery(['groups'], (c, id) => c.listGroups(id), false);
  const group = url.get('group') ?? groups.data?.find((g) => g.topics.includes(topic))?.groupId;
  const summary = useKafkaQuery(
    ['topic-summary', topic],
    async (c, id) => (await c.getTopic(id, topic)).summary as TopicSummary,
    2000,
  );

  // ── browse (not live) ──
  const page = useKafkaQuery<RawMessagePage>(
    ['browse', topic, from, p, url.get('offset'), url.get('ts'), group, regex, url.get('sample')],
    (c, id) =>
      regex !== undefined
        ? c.search(id, {
            topicRegex: regex || '.*',
            from: from === 'oldest' ? 'oldest' : 'newest',
            limit: 100,
            sample: url.get('sample') === '1',
          })
        : c.browse(id, {
            topic,
            partition: p === 'all' ? 'all' : Number(p),
            from,
            offset: Number(url.get('offset') ?? 0),
            timestamp: url.get('ts'),
            group,
            limit: 100,
          }),
    false,
  );
  const pageRef = useRef(page.data);
  useEffect(() => {
    pageRef.current = page.data;
    setExtra([]);
    setExtraScanned(0);
    setCursor(page.data?.nextCursor);
  }, [page.data]);

  // ── live tail ──
  const [ring, setRing] = useState<RawMessage[]>([]);
  const [paused, setPaused] = useState(false);
  const [tailError, setTailError] = useState<string>();
  const [unseen, setUnseen] = useState(0);
  const atTop = useRef(true);
  // a new tail (topic/partition/live) starts empty; Resume continues the same list
  useEffect(() => {
    setRing([]);
    setTailError(undefined);
    setPaused(false); // a new tail runs; only Resume continues a paused one
    setUnseen(0);
  }, [live, topic, p]);
  useEffect(() => {
    if (!live || paused) return;
    return client.tail(
      clusterId,
      { topic, partition: p === 'all' ? 'all' : Number(p), maxRate: 50 },
      (batch) => {
        setTailError(undefined);
        setRing((r) => [...batch.reverse(), ...r].slice(0, RING));
        if (!atTop.current) setUnseen((n) => n + batch.length);
      },
      (message) => setTailError(message),
    );
  }, [live, paused, client, clusterId, topic, p]);

  // stable identity: the decode and filter effects key on it
  const raws = useMemo(
    () => (live ? ring : [...(page.data?.messages ?? []), ...extra]),
    [live, ring, page.data, extra],
  );

  // ── decode (async, cached per message + format) ──
  const cache = useRef(new Map<string, DecodedMessage>());
  const [, bump] = useState(0);
  useEffect(() => {
    cache.current.clear();
    bump((n) => n + 1);
  }, [valueAs, keyAs, rules]);
  useEffect(() => {
    let alive = true;
    const todo = raws.filter((m) => !cache.current.has(msgId(m)));
    if (!todo.length) return;
    Promise.all(todo.map((m) => decodeMessage(m, valueAs, keyAs, lookup, rules))).then((ds) => {
      if (!alive) return;
      for (const d of ds) cache.current.set(d.id, d);
      if (cache.current.size > RING * 2)
        for (const k of [...cache.current.keys()].slice(0, cache.current.size - RING))
          cache.current.delete(k);
      bump((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [raws, valueAs, keyAs, lookup, rules]);

  // ── JS filter ──
  // the result is tied to the exact list it indexes: after a live/partition/start change it is stale
  const [filterState, setFilter] = useState<{ r: FilterResult; of: RawMessage[] } | null>(null);
  const filter = filterState && filterState.of === raws ? filterState.r : null;
  const decodedList = raws.map((m) => cache.current.get(msgId(m)));
  const ready = decodedList.every(Boolean);
  useEffect(() => {
    if (!expr) {
      setFilter(null);
      return;
    }
    if (!ready) return;
    const inputs = decodedList.map((d) => ({
      key: d!.key.ok ? d!.key.value : null,
      value: d!.shown ?? null,
      headers: d!.headers,
      partition: d!.raw.partition,
      offset: d!.raw.offset,
      timestamp: d!.raw.timestamp,
    }));
    let alive = true;
    const of = raws;
    runFilter(expr, inputs).then((r) => alive && setFilter({ r, of }));
    return () => {
      alive = false;
    };
  }, [expr, raws, ready]);
  const jsRows = !expr
    ? raws
    : filter && !filter.error
      ? filter.matches.map((i) => raws[i]!).filter(Boolean)
      : []; // error, or still filtering this list

  // ── quick filters (F-42): key contains, header name[=value], text anywhere; combine with the JS filter ──
  const [qKey, setQKey] = useUrlText('fk');
  const [qHeader, setQHeader] = useUrlText('fh');
  const [ftText, setFt] = useUrlText('ft');
  const qText = ftText.toLowerCase();
  const quickOn = !!(qKey || qHeader || qText);
  const rows = quickOn
    ? jsRows.filter((m) => {
        const d = cache.current.get(msgId(m));
        if (!d) return false; // not decoded yet: shown once it is
        const key = d.key.ok && d.key.value !== null ? String(d.key.value) : '';
        if (qKey && !key.includes(qKey)) return false;
        if (qHeader) {
          const [name, ...rest] = qHeader.split('=');
          const want = rest.join('=');
          const has = Object.entries(d.headers).some(
            ([k, v]) => k === name!.trim() && (!rest.length || v === want.trim()),
          );
          if (!has) return false;
        }
        if (qText) {
          const shown = typeof d.shown === 'string' ? d.shown : JSON.stringify(d.shown ?? '');
          if (!`${key} ${shown}`.toLowerCase().includes(qText)) return false;
        }
        return true;
      })
    : jsRows;

  // ── virtual table ──
  const scroller = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });
  const rate = summary.data?.messagesInPerSec ?? 0;
  const animateRows = live && rate < 20;

  const columnKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const d of decodedList.slice(0, 50))
      if (d?.shown && typeof d.shown === 'object' && !Array.isArray(d.shown))
        Object.keys(d.shown as object).forEach((k) => keys.add(k));
    return [...keys];
  }, [decodedList]);

  const selected = msgParam
    ? (rows.find((m) => `${m.partition}:${m.offset}` === msgParam) ??
      raws.find((m) => `${m.partition}:${m.offset}` === msgParam))
    : undefined;
  const [savedFilters, saveFilter] = useSavedFilters();
  const [maskOpen, setMaskOpen] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);

  // one request at a time, and a page that comes back after the list changed is dropped
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const loadMore = async () => {
    if (!cursor || loading) return;
    const base = page.data;
    setLoading(true);
    setLoadError(undefined);
    try {
      const next = await client.browse(clusterId, {
        topic,
        partition: p === 'all' ? 'all' : Number(p),
        from,
        cursor,
        limit: 100,
      });
      if (pageRef.current !== base) return;
      setExtra((x) => [...x, ...next.messages]);
      setExtraScanned((n) => n + next.scanned);
      setCursor(next.nextCursor);
    } catch (e) {
      setLoadError(`Couldn't load more messages: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const exportAs = (kind: 'json' | 'csv') => {
    const items = rows.map((m) => {
      const d = cache.current.get(msgId(m));
      return {
        topic: m.topic,
        partition: m.partition,
        offset: m.offset,
        timestamp: m.timestamp,
        key: d?.key.ok ? d.key.value : null,
        value: d?.value.ok ? d.shown : { decodeError: d && !d.value.ok ? d.value.reason : null },
        headers: d?.headers ?? {},
      };
    });
    const body =
      kind === 'json'
        ? JSON.stringify(items, null, 2)
        : [
            'topic,partition,offset,timestamp,key,value',
            ...items.map((i) =>
              [i.topic, i.partition, i.offset, i.timestamp, i.key, i.value].map(csvCell).join(','),
            ),
          ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([body], { type: kind === 'json' ? 'application/json' : 'text/csv' }),
    );
    a.download = `${topic}-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.${kind}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-[150px]">
          <Select
            label="Start from"
            hideLabel
            value={from}
            onChange={(e) =>
              url.set({
                from: e.target.value === 'newest' ? undefined : e.target.value,
                live: undefined,
              })
            }
            options={FROM}
          />
        </div>
        {from === 'offset' && (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              url.set({ offset });
            }}
          >
            <div className="w-[150px]">
              <TextField
                label="Offset"
                mono
                value={offset}
                onChange={(e) => setOffset(e.target.value)}
                inputMode="numeric"
              />
            </div>
            <Button type="submit">Go</Button>
          </form>
        )}
        {from === 'timestamp' && (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const at = new Date(ts);
              if (!Number.isNaN(at.getTime())) url.set({ ts: at.toISOString() });
            }}
          >
            <div className="w-[220px]">
              <TextField
                label="From time"
                type="datetime-local"
                step="1"
                value={ts}
                onChange={(e) => setTs(e.target.value)}
              />
            </div>
            <Button type="submit">Go</Button>
          </form>
        )}
        {from === 'group' && (
          <div className="w-[180px]">
            <Select
              label="Group"
              hideLabel
              value={group ?? ''}
              onChange={(e) => url.set({ group: e.target.value })}
              options={(groups.data ?? [])
                .filter((g) => g.topics.includes(topic))
                .map((g) => ({ value: g.groupId, label: g.groupId }))}
            />
          </div>
        )}
        <div className="w-[150px]">
          <Select
            label="Partition"
            hideLabel
            value={p}
            onChange={(e) => url.set({ p: e.target.value === 'all' ? undefined : e.target.value })}
            options={[
              { value: 'all', label: 'All partitions' },
              ...Array.from({ length: partitions }, (_, i) => ({
                value: String(i),
                label: `Partition ${i}`,
              })),
            ]}
          />
        </div>
        <div className="w-[190px]">
          <Select
            label="Decode value as"
            hideLabel
            value={valueAs}
            onChange={(e) =>
              url.set({ dv: e.target.value === 'auto' ? undefined : e.target.value })
            }
            options={DECODE_OPTIONS.map((o) => ({ value: o.value, label: `Value: ${o.label}` }))}
          />
        </div>
        <div className="w-[160px]">
          <Select
            label="Decode key as"
            hideLabel
            value={keyAs}
            onChange={(e) =>
              url.set({ dk: e.target.value === 'auto' ? undefined : e.target.value })
            }
            options={DECODE_OPTIONS.map((o) => ({ value: o.value, label: `Key: ${o.label}` }))}
          />
        </div>
        <label
          className={`inline-flex h-control-md cursor-pointer items-center gap-2 rounded-md border px-3 text-[13px] font-semibold ${live ? 'border-copper bg-copper-soft' : 'border-line bg-surface'}`}
        >
          <input
            type="checkbox"
            className="size-4 accent-copper"
            checked={live}
            onChange={(e) =>
              url.set({
                live: e.target.checked ? 1 : undefined,
                from: undefined,
                search: undefined,
              })
            }
          />
          Live tail
        </label>
        {live && (
          <Button variant="ghost" size="sm" onClick={() => setPaused(!paused)}>
            {paused ? 'Resume' : 'Pause'}
          </Button>
        )}
        <span className="font-mono text-[11px] text-ink-muted">
          {formatRate(rate)}
          {live && ` · showing ${Math.min(50, Math.round(rate))}/s`}
        </span>
        <div className="grow" />
        <ColumnPicker
          keys={columnKeys}
          cols={cols}
          onChange={(c) => url.set({ cols: c.join(',') })}
        />
        <Button size="sm" onClick={() => setMaskOpen(true)}>
          Masking · {rules.length}
        </Button>
        <Button size="sm" onClick={() => exportAs('json')}>
          Export JSON
        </Button>
        <Button size="sm" onClick={() => exportAs('csv')}>
          Export CSV
        </Button>
      </div>

      <form
        className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          url.set({ filter: draftExpr || undefined });
        }}
      >
        <span className="font-mono text-[11px] font-medium text-copper" aria-hidden="true">
          JS
        </span>
        <input
          aria-label="JavaScript filter over key, value, headers, partition, offset, timestamp"
          value={draftExpr}
          onChange={(e) => setDraftExpr(e.target.value)}
          placeholder="value.total > 500 && headers.region === 'eu'"
          className="min-w-0 grow border-none bg-transparent font-mono text-[12px] text-ink placeholder:text-ink-muted"
        />
        {filter?.error ? (
          <span role="alert" className="text-[12px] text-crit-text">
            {filter.error}
          </span>
        ) : filter ? (
          <span className="whitespace-nowrap text-[12px] text-ink-muted" role="status">
            {formatInt(filter.matches.length)} of {formatInt(filter.scanned)} scanned match
            {filter.timedOut && ' · stopped at the 50 ms budget'}
          </span>
        ) : (
          <span className="hidden text-[12px] text-ink-muted md:inline">
            <Kbd>↵</Kbd> to apply
          </span>
        )}
        {expr && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraftExpr('');
              url.set({ filter: undefined });
            }}
          >
            Clear
          </Button>
        )}
        {expr && naming === null && (
          <Button size="sm" variant="ghost" onClick={() => setNaming('')}>
            Save
          </Button>
        )}
        {naming !== null && (
          <span className="flex items-center gap-1">
            <input
              aria-label="Filter name"
              autoFocus
              value={naming}
              onChange={(e) => setNaming(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (naming.trim()) saveFilter({ name: naming.trim(), expr });
                  setNaming(null);
                }
                if (e.key === 'Escape') setNaming(null);
              }}
              placeholder="Name, then Enter"
              className="h-control-sm w-[140px] rounded-md border border-line bg-surface px-2 text-[12px] text-ink"
            />
          </span>
        )}
        {savedFilters.length > 0 && (
          <div className="w-[160px]">
            <Select
              label="Saved filters"
              hideLabel
              value=""
              onChange={(e) => {
                const f = savedFilters.find((x) => x.name === e.target.value);
                if (f) {
                  setDraftExpr(f.expr);
                  url.set({ filter: f.expr });
                }
              }}
              options={[
                { value: '', label: 'Saved filters…' },
                ...savedFilters.map((f) => ({ value: f.name, label: f.name })),
              ]}
            />
          </div>
        )}
      </form>

      <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Quick filters">
        <div className="w-[180px]">
          <TextField
            label="Key contains"
            mono
            value={qKey}
            onChange={(e) => setQKey(e.target.value)}
            placeholder="ord_"
          />
        </div>
        <div className="w-[200px]">
          <TextField
            label="Header"
            mono
            value={qHeader}
            onChange={(e) => setQHeader(e.target.value)}
            placeholder="region=eu"
          />
        </div>
        <div className="w-[220px]">
          <TextField
            label="Text contains"
            value={ftText}
            onChange={(e) => setFt(e.target.value)}
            placeholder="key or value text"
          />
        </div>
        {quickOn && (
          <>
            <span className="pb-2 text-[12px] text-ink-muted" role="status">
              {formatInt(rows.length)} of {formatInt(jsRows.length)} shown
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => url.set({ fk: undefined, fh: undefined, ft: undefined })}
            >
              Clear quick filters
            </Button>
          </>
        )}
      </div>

      {regex !== undefined && (
        <div className="flex items-end gap-2">
          <div className="w-[280px]">
            <TextField
              label="Search topics matching (regex)"
              mono
              defaultValue={regex}
              onKeyDown={(e) =>
                e.key === 'Enter' && url.set({ search: (e.target as HTMLInputElement).value })
              }
            />
          </div>
          <Checkbox
            label="Sample across partitions"
            checked={url.get('sample') === '1'}
            onChange={(e) => url.set({ sample: e.target.checked ? 1 : undefined })}
          />
          <Button variant="ghost" onClick={() => url.set({ search: undefined, sample: undefined })}>
            Back to {topic}
          </Button>
        </div>
      )}

      <Card padded={false} className="relative">
        {live && unseen > 0 && (
          <button
            type="button"
            onClick={() => {
              scroller.current?.scrollTo({ top: 0 });
              setUnseen(0);
            }}
            className="ki-toast absolute left-1/2 top-12 z-10 -translate-x-1/2 cursor-pointer rounded-full border border-copper bg-surface px-3 py-1 text-[12px] font-semibold text-copper [box-shadow:var(--shadow-popover)]"
          >
            {formatInt(unseen)} new — jump
          </button>
        )}
        <div
          ref={scroller}
          tabIndex={0}
          aria-label={`Messages in ${topic}`}
          className="max-h-[calc(100vh-330px)] min-h-[200px] overflow-auto"
          onScroll={(e) => {
            atTop.current = e.currentTarget.scrollTop < 8;
            if (atTop.current) setUnseen(0);
          }}
        >
          <table
            className="w-full border-separate border-spacing-0 text-[13px]"
            aria-rowcount={rows.length}
          >
            <caption className="sr-only">Messages in {topic}</caption>
            <thead className="sticky top-0 z-[1]">
              <tr>
                {regex !== undefined && <Th>Topic</Th>}
                <Th right>Offset</Th>
                <Th right>P</Th>
                <Th>Time</Th>
                <Th>Key</Th>
                {cols.map((c) => (
                  <Th key={c}>{c}</Th>
                ))}
                <Th>Value</Th>
              </tr>
            </thead>
            <tbody>
              {v.getVirtualItems()[0] && (
                <tr style={{ height: v.getVirtualItems()[0]!.start }} aria-hidden="true" />
              )}
              {v.getVirtualItems().map((vi) => {
                const m = rows[vi.index]!;
                const d = cache.current.get(msgId(m));
                const pv = preview(d, m);
                const isSel = selected && msgId(selected) === msgId(m);
                return (
                  <tr
                    key={msgId(m)}
                    style={{ height: ROW_H }}
                    onClick={() => url.set({ msg: `${m.partition}:${m.offset}` }, 'push')}
                    className={`cursor-pointer ${animateRows ? 'ki-fade-in' : ''} ${isSel ? '[&>td]:bg-copper-soft' : '[&>td]:hover:bg-surface-hover'}`}
                  >
                    {regex !== undefined && <Td mono>{m.topic}</Td>}
                    <Td mono right>
                      {/* keyboard and screen-reader path into the drawer; the row click is the mouse shortcut */}
                      <button
                        type="button"
                        className="cursor-pointer border-none bg-transparent p-0 font-mono text-[12px] tabular-nums text-ink hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          url.set({ msg: `${m.partition}:${m.offset}` }, 'push');
                        }}
                      >
                        {formatInt(m.offset)}
                        <span className="sr-only">, open message on partition {m.partition}</span>
                      </button>
                    </Td>
                    <Td mono right>
                      {m.partition}
                    </Td>
                    <Td mono>{time(m.timestamp)}</Td>
                    <Td mono>
                      {d ? (
                        d.key.ok ? (
                          d.key.value === null ? (
                            <span className="text-ink-muted">null</span>
                          ) : (
                            String(d.key.value)
                          )
                        ) : (
                          <span className="text-crit-text">undecodable</span>
                        )
                      ) : (
                        '…'
                      )}
                    </Td>
                    {cols.map((c) => (
                      <Td key={c} mono>
                        {d?.shown && typeof d.shown === 'object'
                          ? (JSON.stringify((d.shown as Record<string, unknown>)[c]) ?? '')
                          : ''}
                      </Td>
                    ))}
                    <Td mono wide>
                      {pv.failed ? (
                        <span className="flex items-center gap-3">
                          <span className="font-sans font-semibold text-crit-text">
                            Decode failed
                          </span>
                          <span className="text-ink-muted">{pv.text}…</span>
                        </span>
                      ) : (
                        <span className="text-ink-muted">{pv.text}</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
              {v.getVirtualItems().length > 0 && (
                <tr
                  style={{ height: v.getTotalSize() - v.getVirtualItems().at(-1)!.end }}
                  aria-hidden="true"
                />
              )}
            </tbody>
          </table>
          {live && tailError && (
            <p role="alert" className="m-0 px-4 py-3 text-[13px] text-crit-text">
              {tailError} Switch off Live tail to browse, or try again.
            </p>
          )}
          {rows.length === 0 && !(live && tailError) && (
            <EmptyState
              title={
                expr || quickOn
                  ? 'No messages match the filter'
                  : live
                    ? 'Waiting for messages…'
                    : page.isLoading
                      ? 'Loading messages…'
                      : 'No messages here'
              }
            >
              {expr || quickOn
                ? `None of the ${formatInt(raws.length)} messages scanned match. Loosen the filters or load more.`
                : live
                  ? `${topic} gets ${formatRate(rate)}. New messages appear at the top.`
                  : 'This partition has no messages in its retention window.'}
            </EmptyState>
          )}
        </div>
        {!live && regex === undefined && (
          <div className="flex items-center gap-3 border-t border-line-subtle px-4 py-2 text-[12px] text-ink-muted">
            <span>
              {formatInt(raws.length)} messages ·{' '}
              {formatInt((page.data?.scanned ?? 0) + extraScanned)} scanned
            </span>
            <div className="grow" />
            <Button size="sm" variant="ghost" onClick={() => url.set({ search: '' })}>
              Search other topics
            </Button>
            {loadError && (
              <span role="alert" className="text-[12px] text-crit-text">
                {loadError}
              </span>
            )}
            <Button size="sm" disabled={!cursor || loading} onClick={loadMore}>
              {loading ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </Card>
      <MessageDrawer
        topic={topic}
        raw={selected}
        msgParam={msgParam}
        valueAs={valueAs}
        keyAs={keyAs}
        onClose={() => url.set({ msg: undefined })}
      />
      <MaskingDialog
        open={maskOpen}
        onClose={() => setMaskOpen(false)}
        rules={rules}
        onChange={setRules}
      />
    </div>
  );
}

const Th = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
  <th
    scope="col"
    className={`whitespace-nowrap border-b border-line bg-surface-sunken px-4 py-[10px] text-[12px] font-normal text-ink-muted ${right ? 'text-right' : 'text-left'}`}
  >
    {children}
  </th>
);
const Td = ({
  children,
  mono,
  right,
  wide,
}: {
  children: React.ReactNode;
  mono?: boolean;
  right?: boolean;
  wide?: boolean;
}) => (
  <td
    className={`border-b border-line-subtle px-4 ${mono ? 'font-mono text-[12px]' : ''} ${right ? 'text-right tabular-nums' : ''} ${wide ? 'max-w-0 w-full truncate' : 'whitespace-nowrap'}`}
  >
    {children}
  </td>
);

function ColumnPicker({
  keys,
  cols,
  onChange,
}: {
  keys: string[];
  cols: string[];
  onChange: (c: string[]) => void;
}) {
  return (
    <>
      <Button size="sm" popoverTarget="ki-cols">
        Columns{cols.length ? ` · ${cols.length}` : ''}
      </Button>
      <div
        id="ki-cols"
        popover="auto"
        className="ki-popover w-[220px] rounded-lg border border-line bg-surface p-3 [box-shadow:var(--shadow-popover)]"
        style={{ top: 200, right: 120 }}
      >
        <div className="mb-2 text-[12px] font-medium text-ink-muted">
          Show JSON fields as columns
        </div>
        {keys.length === 0 && (
          <p className="m-0 text-[12px] text-ink-muted">No JSON object fields in these messages.</p>
        )}
        <div className="flex max-h-[260px] flex-col gap-1 overflow-auto">
          {keys.map((k) => (
            <Checkbox
              key={k}
              label={<span className="font-mono text-[12px]">{k}</span>}
              checked={cols.includes(k)}
              onChange={(e) =>
                onChange(e.target.checked ? [...cols, k] : cols.filter((c) => c !== k))
              }
            />
          ))}
        </div>
      </div>
    </>
  );
}

export { toHex };

/** F-04: saved filters in the agent DB when the client offers it, else per-browser localStorage (demo). */
function useSavedFilters(): [SavedFilter[], (f: SavedFilter) => void] {
  const { client, clusterId } = useKafka();
  const qc = useQueryClient();
  const toast = useToast();
  const remote = client.savedFilters;
  const [local, setLocal] = useLocal<SavedFilter[]>('ki-saved-filters', []);
  const fromAgent = useKafkaQuery(['saved-filters'], (c) =>
    c.savedFilters ? c.savedFilters.list() : Promise.resolve([]),
  );
  if (!remote) return [local, (f) => setLocal([...local.filter((x) => x.name !== f.name), f])];
  return [
    fromAgent.data ?? [],
    (f) =>
      // the name travels in the URL path, where a "/" is rejected before it reaches the agent
      f.name.includes('/')
        ? toast({
            tone: 'crit',
            title: `Couldn't save filter ${f.name}`,
            body: 'Filter names can’t contain “/”. Rename it and save again.',
          })
        : void remote
            .save(f)
            .then(() => qc.invalidateQueries({ queryKey: [clusterId, 'saved-filters'] }))
            .catch((e: Error) =>
              toast({ tone: 'crit', title: `Couldn't save filter ${f.name}`, body: e.message }),
            ),
  ];
}
