'use client';
import {
  DECODE_OPTIONS,
  formatInt,
  formatRate,
  toHex,
  formatTimestamp,
  shownName,
  toLocalInput,
  type RawMessage,
  type RawMessagePage,
  type SavedFilter,
  type TopicSummary,
} from '@ki/core';
import { Button, Card, Checkbox, EmptyState, Kbd, Select, TextField, useToast } from '@ki/ui';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
import { exportBody } from '../../lib/csv';
import { findMsg, parseMsgParam } from '../../lib/msgParam';
import { keepFocus } from '../../lib/focus';
import { onReconnect } from '../../lib/reconnect';
import { runFilter, type FilterResult } from '../../lib/filter';
import { useApp } from '../../lib/app';
import { useKafka, useKafkaQuery } from '../../lib/kafka';
import { useQueryClient } from '@tanstack/react-query';
import { useLocal } from '../../lib/local';
import {
  decodeMessage,
  msgId,
  useMaskRules,
  useSchemaLookup,
  type DecodedMessage,
  keyText,
} from '../../lib/serdes';
import { useUrl, useUrlText, pick } from '../../lib/url';
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
] as const;

const FROMS = FROM.map((o) => o.value);

const time = (iso: string) => formatTimestamp(iso).slice(11); // HH:MM:SS.mmm
/** A table cell's text from producer-written data: capped (a 10 MB value would otherwise be laid out in full in
 * every row) and with invisible / direction-changing characters shown as escapes. */
const cellText = (s: string): string => shownName(s.length > 300 ? `${s.slice(0, 300)}…` : s);

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

const OFFSET_RANGE = 'Enter a whole number from 0 to 9,007,199,254,740,991.';
/** An offset as typed or linked: digits only and exactly representable, else null (no rounding, no clamping). */
function wholeOffset(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}
export function MessagesTab({ topic, partitions }: { topic: string; partitions: number }) {
  const toast = useToast();
  const url = useUrl();
  const { client, clusterId, info } = useKafka();
  const lookup = useSchemaLookup();
  const [rules, setRules] = useMaskRules();
  // a hand-edited or stale link falls back to the defaults instead of crashing the tab
  const from = pick(url.get('from'), FROMS, 'newest');
  const pRaw = url.get('p') ?? '';
  const p = /^\d+$/.test(pRaw) && (!partitions || Number(pRaw) < partitions) ? pRaw : 'all';
  const decoders = DECODE_OPTIONS.map((o) => o.value);
  const valueAs = pick(url.get('dv'), decoders, 'auto');
  const keyAs = pick(url.get('dk'), decoders, 'auto');
  const live = url.get('live') === '1';
  const expr = url.get('filter') ?? '';
  const cols = (url.get('cols') ?? '').split(',').filter(Boolean);
  const regex = url.get('search');
  const msgRef = parseMsgParam(url.get('msg'));
  // opening adds one history entry (Back closes the drawer); closing undoes that entry instead of leaving a
  // second copy of the page behind it. A drawer opened from a link has no entry of ours to undo.
  const pushedMsg = useRef(false);
  const openMsg = (id: string) => {
    const first = !url.get('msg');
    url.set({ msg: id }, first ? 'push' : 'replace');
    if (first) pushedMsg.current = true;
  };
  const closeMsg = () => {
    if (pushedMsg.current) {
      pushedMsg.current = false;
      history.back();
    } else url.set({ msg: undefined });
  };
  const jsRef = useRef<HTMLInputElement>(null);
  const quickRef = useRef<HTMLDivElement>(null);
  const [draftExpr, setDraftExpr] = useState(expr);
  const [offset, setOffset] = useState(url.get('offset') ?? '');
  const [ts, setTs] = useState(() => toLocalInput(url.get('ts') ?? '', true));
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
  // a start that still needs its field reads nothing yet (and the agent would refuse it). A link's offset is read
  // as written or not at all: Number() rounded 2^53 + 1 and turned -5 into 0, reading from where the link doesn't say.
  const startOffset = wholeOffset(url.get('offset') ?? '0');
  const needs =
    regex !== undefined
      ? undefined
      : from === 'offset' && startOffset === null
        ? OFFSET_RANGE
        : from === 'timestamp' && !url.get('ts')
          ? 'Pick a date and time to read from.'
          : from === 'group' && !group && groups.data
            ? `No consumer group reads ${topic} yet. Start from another position.`
            : undefined;
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
            offset: startOffset ?? 0,
            timestamp: url.get('ts'),
            group,
            limit: 100,
          }),
    false,
    // groups still loading, or a partition number before the topic's partition count is known: wait
    !needs &&
      !(regex === undefined && from === 'group' && !group) &&
      !(/^\d+$/.test(pRaw) && !partitions),
  );
  // another start, partition or position is another request: the previous page's rows (React Query's
  // same-topic placeholder) must not stand in for it, nor its cursor feed Load more
  const pageData = page.isPlaceholderData ? undefined : page.data;
  const pageLoading = page.isLoading || (page.isPlaceholderData && page.isFetching);
  const pageRef = useRef(pageData);
  useEffect(() => {
    pageRef.current = pageData;
    setExtra([]);
    setExtraScanned(0);
    setLoadError(undefined); // a new first page: an old "couldn't load more" no longer applies
    setCursor(pageData?.nextCursor);
  }, [pageData]);

  // ── live tail ──
  const [ring, setRing] = useState<RawMessage[]>([]);
  const [paused, setPaused] = useState(false);
  const [tailError, setTailError] = useState<string>();
  const [unseen, setUnseen] = useState(0);
  const [gap, setGap] = useState<string>();
  const atTop = useRef(true);
  // a new tail (topic/partition/live) starts empty; Resume continues the same list
  useEffect(() => {
    setRing([]);
    setTailError(undefined);
    setPaused(false); // a new tail runs; only Resume continues a paused one
    setUnseen(0);
    setGap(undefined);
  }, [live, topic, p]);
  // a reconnect restarts the tail from now: say so, or the list reads as continuous across the gap
  useEffect(
    () =>
      live
        ? onReconnect(client, () =>
            setGap(
              `Reconnected at ${new Date().toLocaleTimeString()}: messages produced while disconnected aren't in this list. Browse the topic to see them.`,
            ),
          )
        : undefined,
    [client, live],
  );
  const appLive = useApp().live; // the top bar's Live: paused there freezes the tail too
  useEffect(() => {
    if (!live || paused || !appLive) return;
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
  }, [appLive, live, paused, client, clusterId, topic, p]);

  // stable identity: the decode and filter effects key on it
  const raws = useMemo(
    () => (live ? ring : [...(pageData?.messages ?? []), ...extra]),
    [live, ring, pageData, extra],
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
      // trim only what's no longer listed: evicting rows still on screen left holes the effect never refills
      // (raws didn't change), so filters and quick filters stopped matching after ~40 Load more pages
      if (cache.current.size > RING * 2) {
        const listed = new Set(raws.map(msgId));
        for (const k of [...cache.current.keys()]) if (!listed.has(k)) cache.current.delete(k);
      }
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
        const key = d.key.ok && d.key.value !== null ? keyText(d.key) : '';
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
  // the drawer is a native dialog: closing returns focus to the row that opened it, which a live tail or a scroll
  // may have unmounted (virtualised) — then focus falls to <body>; land on the message list instead
  const drawerOpen = !!msgRef;
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !drawerOpen) keepFocus(scroller.current);
    wasOpen.current = drawerOpen;
  }, [drawerOpen]);
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

  const selected = findMsg(rows, msgRef) ?? findMsg(raws, msgRef);
  const [savedFilters, saveFilter] = useSavedFilters();
  const [maskOpen, setMaskOpen] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);

  // one request at a time, and a page that comes back after the list changed is dropped
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const loadMore = async () => {
    if (!cursor || loading) return;
    const base = pageData;
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
      setLoadError(
        `Couldn't load more messages: ${(e as Error).message} Choose Load more to try again.`,
      );
    } finally {
      setLoading(false);
    }
  };

  const exportAs = (kind: 'json' | 'csv') => {
    const { body, skipped } = exportBody(rows, (m) => cache.current.get(msgId(m)), kind);
    if (skipped)
      toast({
        tone: 'warn',
        title: `${skipped} ${skipped === 1 ? 'message was' : 'messages were'} left out of the export`,
        body: 'They were still decoding. Export again in a moment to include them.',
      });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      // a BOM tells Excel the CSV is UTF-8 (otherwise é, €, 日本 open garbled)
      new Blob([kind === 'csv' ? `\uFEFF${body}` : body], {
        type: kind === 'json' ? 'application/json' : 'text/csv;charset=utf-8',
      }),
    );
    // rule 7: generated messages say so in the file name once they leave the page
    const tag = info.mode === 'demo' ? '-simulated' : '';
    a.download = `${topic}${tag}-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.${kind}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 0); // after the download has started
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
            options={[...FROM]}
          />
        </div>
        {from === 'offset' && (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (wholeOffset(offset) !== null) url.set({ offset: offset.trim() });
            }}
          >
            <div className="w-[150px]">
              <TextField
                label="Offset"
                mono
                value={offset}
                onChange={(e) => setOffset(e.target.value)}
                inputMode="numeric"
                error={offset.trim() && wholeOffset(offset) === null ? OFFSET_RANGE : undefined}
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
          ref={jsRef}
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
          <span
            className="whitespace-nowrap text-[12px] text-ink-muted"
            role={live ? undefined : 'status'} // a live tail changes the counts every tick: don't re-announce them
          >
            <span className="font-mono tabular-nums">{formatInt(filter.matches.length)}</span> of{' '}
            <span className="font-mono tabular-nums">{formatInt(filter.scanned)}</span> scanned
            match
            {filter.timedOut && ' · stopped at the 50 ms budget'}
            {!!filter.skipped && (
              <span className="text-warn-text" title={filter.skipError}>
                {' · '}
                <span className="font-mono tabular-nums">{formatInt(filter.skipped)}</span> skipped
                (the filter failed on them; first:{' '}
                <span className="font-mono">{filter.skipError}</span>)
              </span>
            )}
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
              jsRef.current?.focus(); // this button goes away once the URL update lands (later than keepFocus's frame)
            }}
          >
            Clear
          </Button>
        )}
        {expr && naming === null && (
          <Button size="sm" variant="ghost" onClick={() => setNaming('')}>
            Save filter
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
                  keepFocus(jsRef.current);
                }
                if (e.key === 'Escape') {
                  setNaming(null);
                  keepFocus(jsRef.current);
                }
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

      <div
        ref={quickRef}
        className="flex flex-wrap items-end gap-2"
        role="group"
        aria-label="Quick filters"
      >
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
            <span className="pb-2 text-[12px] text-ink-muted" role={live ? undefined : 'status'}>
              <span className="font-mono tabular-nums">{formatInt(rows.length)}</span> of{' '}
              <span className="font-mono tabular-nums">{formatInt(jsRows.length)}</span> shown
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                url.set({ fk: undefined, fh: undefined, ft: undefined });
                quickRef.current?.querySelector('input')?.focus(); // "Key contains"; this button goes away with the filters
              }}
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
                e.key === 'Enter' &&
                url.set({ search: (e.target as HTMLInputElement).value || '.*' })
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
      {regex !== undefined && pageData?.note && (
        // a partial search must not read as complete (topics skipped by the cap or the time budget)
        <p role="status" className="m-0 text-[12px] text-ink-muted">
          {pageData.note}
        </p>
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
            <span className="font-mono tabular-nums">{formatInt(unseen)}</span> new — jump
          </button>
        )}
        <div
          ref={scroller}
          tabIndex={0}
          aria-label={
            regex !== undefined
              ? `Messages in topics matching ${regex || '.*'}`
              : `Messages in ${topic}`
          }
          className="max-h-[calc(100vh-330px)] min-h-[200px] overflow-auto"
          onScroll={(e) => {
            atTop.current = e.currentTarget.scrollTop < 8;
            if (atTop.current) setUnseen(0);
          }}
        >
          <table
            className="w-full border-separate border-spacing-0 text-[13px]"
            aria-rowcount={rows.length + 1} // + the header row; only ~20 body rows are in the DOM
          >
            <caption className="sr-only">Messages in {topic}</caption>
            <thead className="sticky top-0 z-[1]">
              <tr aria-rowindex={1}>
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
                    aria-rowindex={vi.index + 2}
                    style={{ height: ROW_H }}
                    onClick={() => openMsg(regex != null ? msgId(m) : `${m.partition}:${m.offset}`)}
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
                          openMsg(regex != null ? msgId(m) : `${m.partition}:${m.offset}`);
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
                            cellText(keyText(d.key))
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
                          ? cellText(JSON.stringify((d.shown as Record<string, unknown>)[c]) ?? '')
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
                        <span className="text-ink-muted">{cellText(pv.text)}</span>
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
          {live && gap && (
            <p role="status" className="m-0 px-4 py-3 text-[12px] text-ink-muted">
              {gap}
            </p>
          )}
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
                    : needs
                      ? 'Choose where to start'
                      : page.error
                        ? "Couldn't read messages"
                        : pageLoading
                          ? 'Loading messages…'
                          : 'No messages here'
              }
            >
              {expr || quickOn
                ? `None of the ${formatInt(raws.length)} loaded messages match. Loosen the filters or load more.`
                : live
                  ? `${topic} gets ${formatRate(rate)}. New messages appear at the top.`
                  : needs
                    ? needs
                    : page.error
                      ? regex !== undefined
                        ? `${(page.error as Error).message} Fix the pattern and search again.`
                        : `${(page.error as Error).message} Try another start position, or try again.`
                      : from === 'offset'
                        ? `No messages at or after offset ${formatInt(startOffset ?? 0)} in ${p === 'all' ? 'any partition' : `partition ${p}`}. Pick an earlier offset or Newest.`
                        : regex !== undefined
                          ? `No messages found in topics matching ${regex || '.*'}. Check the pattern, or search from Oldest.`
                          : from === 'timestamp'
                            ? `No messages at or after ${formatTimestamp(url.get('ts') ?? '')} in ${p === 'all' ? 'any partition' : `partition ${p}`}. Pick an earlier time or Newest.`
                            : `${p === 'all' ? 'This topic has' : `Partition ${p} has`} no messages in its retention window.`}
            </EmptyState>
          )}
        </div>
        {!live && regex === undefined && (
          <div className="flex items-center gap-3 border-t border-line-subtle px-4 py-2 text-[12px] text-ink-muted">
            <span>
              <span className="font-mono tabular-nums">{formatInt(rows.length)}</span>{' '}
              {rows.length === 1 ? 'message' : 'messages'} ·{' '}
              <span className="font-mono tabular-nums">
                {formatInt((pageData?.scanned ?? 0) + extraScanned)}
              </span>{' '}
              scanned
            </span>
            <div className="grow" />
            <Button
              size="sm"
              variant="ghost"
              onClick={
                () => url.set({ search: '.*' }) /* '' deletes the key: .* is "every topic" */
              }
            >
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
        topic={msgRef?.topic ?? topic}
        raw={selected}
        msgRef={msgRef}
        valueAs={valueAs}
        keyAs={keyAs}
        onClose={closeMsg}
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
  const [stored, setLocal] = useLocal<SavedFilter[]>('ki-saved-filters', []);
  // entries without a string name and expression (hand-edited, older) are dropped, not trusted
  const local = stored.filter(
    (f) => !!f && typeof f === 'object' && typeof f.name === 'string' && typeof f.expr === 'string',
  );
  const fromAgent = useKafkaQuery(['saved-filters'], (c) =>
    c.savedFilters ? c.savedFilters.list() : Promise.resolve([]),
  );
  if (!remote) return [local, (f) => setLocal([...local.filter((x) => x.name !== f.name), f])];
  return [
    fromAgent.data ?? [],
    (f) =>
      void remote
        .save(f)
        .then(() => qc.invalidateQueries({ queryKey: [clusterId, 'saved-filters'] }))
        .catch((e: Error) =>
          toast({ tone: 'crit', title: `Couldn't save filter ${f.name}`, body: e.message }),
        ),
  ];
}
