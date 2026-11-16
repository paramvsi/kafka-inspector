'use client';
import type { GroupSummary, SubjectSummary, TopicSummary } from '@ki/core';
import { formatCount, formatInt, shownName } from '@ki/core';
import { Kbd, SearchIcon, StatusBadge } from '@ki/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useKafka } from '../lib/kafka';
import { isReducedMotion, setReducedMotion, setTheme } from '../lib/prefs';
import { groupBadge } from '../lib/status';
import { useReadOnly } from './Page';
import { startTour } from './Tour';

interface Item {
  id: string;
  section: 'Topics' | 'Consumer groups' | 'Schemas' | 'Actions';
  label: ReactNode;
  text: string;
  meta?: ReactNode;
  href?: string;
  run?: () => void;
}

function Highlight({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <b className="font-semibold text-ink">{text.slice(i, i + q.length)}</b>
      {text.slice(i + q.length)}
    </>
  );
}

/** ⌘K command palette (F-03). Native <dialog>; `>` prefix shows actions only. */
export function CommandPalette({
  open,
  initial,
  onClose,
}: {
  open: boolean;
  initial?: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const readOnly = useReadOnly();
  const { client, clusterId, info } = useKafka();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  // keep the active option visible while arrowing through a scrolled list
  useEffect(() => {
    document.getElementById(`pal-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  const [data, setData] = useState<{
    topics: TopicSummary[];
    groups: GroupSummary[];
    subjects: SubjectSummary[];
  }>({ topics: [], groups: [], subjects: [] });

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      setQ(initial ?? '');
      setActive(0);
      input.current?.focus();
      Promise.all([
        client.listTopics(clusterId, { size: 500, sort: 'name' }),
        client.listGroups(clusterId),
        client.listSubjects(clusterId).catch(() => []),
      ]).then(([t, g, s]) => setData({ topics: t.items, groups: g, subjects: s }));
    }
    if (!open && d.open) d.close();
  }, [open, initial, client, clusterId]);

  const actionsOnly = q.startsWith('>');
  const term = (actionsOnly ? q.slice(1) : q).trim();
  const items = useMemo(() => {
    const m = (s: string) => !term || s.toLowerCase().includes(term.toLowerCase());
    const rank = (a: Item, b: Item) =>
      Number(!a.text.toLowerCase().startsWith(term.toLowerCase())) -
      Number(!b.text.toLowerCase().startsWith(term.toLowerCase()));
    const out: Item[] = [];
    if (!actionsOnly && term) {
      out.push(
        ...data.topics
          .filter((t) => m(t.name))
          .map<Item>((t) => ({
            id: `t:${t.name}`,
            section: 'Topics',
            text: t.name,
            label: (
              <span className="font-mono">
                <Highlight text={t.name} q={term} />
              </span>
            ),
            meta: `${t.partitions} partitions · ${formatCount(t.messagesInPerSec)}/s`,
            href: `/app/topics/view/?name=${encodeURIComponent(t.name)}`,
          }))
          .sort(rank)
          .slice(0, 5),
      );
      out.push(
        ...data.groups
          .filter((g) => m(g.groupId))
          .map<Item>((g) => {
            const b = groupBadge(g.status, g.state);
            return {
              id: `g:${g.groupId}`,
              section: 'Consumer groups',
              text: g.groupId,
              label: (
                <span className="font-mono">
                  <Highlight text={shownName(g.groupId)} q={term} />
                </span>
              ),
              meta: (
                <span className="flex items-center gap-2">
                  <StatusBadge status={b.status} dot={false}>
                    {b.label}
                  </StatusBadge>
                  lag {formatInt(g.totalLag)}
                </span>
              ),
              href: `/app/groups/view/?id=${encodeURIComponent(g.groupId)}`,
            };
          })
          .sort(rank)
          .slice(0, 5),
      );
      out.push(
        ...data.subjects
          .filter((s) => m(s.subject))
          .map<Item>((s) => ({
            id: `s:${s.subject}`,
            section: 'Schemas',
            text: s.subject,
            label: (
              <span className="font-mono">
                <Highlight text={s.subject} q={term} />
              </span>
            ),
            meta: `v${s.latestVersion} · ${s.type}`,
            href: `/app/schemas/?subject=${encodeURIComponent(s.subject)}`,
          }))
          .sort(rank)
          .slice(0, 3),
      );
    }
    const code = (s: string) => (
      <code className="mx-1 rounded-sm bg-surface-hover px-1 font-mono text-[12px]">{s}</code>
    );
    const actions: Item[] = [];
    if (!readOnly) {
      for (const g of data.groups
        .filter((g) => term && m(g.groupId) && g.type !== 'share')
        .slice(0, 2))
        actions.push({
          id: `a:reset:${g.groupId}`,
          section: 'Actions',
          text: `Reset offsets for ${g.groupId}`,
          label: <>Reset offsets for{code(g.groupId)}…</>,
          href: `/app/groups/view/?id=${encodeURIComponent(g.groupId)}&reset=1`,
        });
      for (const t of data.topics.filter((t) => term && m(t.name) && !t.internal).slice(0, 2))
        actions.push({
          id: `a:produce:${t.name}`,
          section: 'Actions',
          text: `Produce message to ${t.name}`,
          label: <>Produce message to{code(t.name)}…</>,
          href: `/app/topics/view/?name=${encodeURIComponent(t.name)}&produce=1`,
        });
      actions.push({
        id: 'a:create',
        section: 'Actions',
        text: 'Create topic',
        label: 'Create topic…',
        href: '/app/topics/?create=1',
      });
    }
    for (const s of data.subjects
      .filter((s) => term && m(s.subject) && s.latestVersion > 1)
      .slice(0, 1))
      actions.push({
        id: `a:diff:${s.subject}`,
        section: 'Actions',
        text: `Compare schema ${s.subject} versions`,
        label: <>Compare schema{code(s.subject)}versions</>,
        href: `/app/schemas/?subject=${encodeURIComponent(s.subject)}`,
      });
    const pages: Array<[string, string]> = [
      ['Overview', '/app/'],
      ['Brokers', '/app/brokers/'],
      ['Topics', '/app/topics/'],
      ['Consumer groups', '/app/groups/'],
      ['Schemas', '/app/schemas/'],
      ['Topology', '/app/topology/'],
      ['Alerts', '/app/alerts/'],
      ['Clusters', '/app/clusters/'],
      ...(info.mode === 'demo'
        ? ([
            ['Chaos panel', '/app/chaos/'],
            ['Run on your Kafka', '/app/self-host/'],
          ] as Array<[string, string]>)
        : []),
    ];
    actions.push(
      ...pages.map<Item>(([n, href]) => ({
        id: `a:go:${href}`,
        section: 'Actions',
        text: `Go to ${n}`,
        label: `Go to ${n}`,
        href,
      })),
    );
    if (info.mode === 'demo')
      actions.push({
        id: 'a:tour',
        section: 'Actions',
        text: 'Start guided tour',
        label: 'Start guided tour',
        run: () => startTour(),
      });
    actions.push({
      id: 'a:rule',
      section: 'Actions',
      text: 'New alert rule',
      label: 'New alert rule…',
      href: '/app/alerts/?rule=new',
    });
    actions.push({
      id: 'a:dark',
      section: 'Actions',
      text: 'Switch to dark theme',
      label: 'Switch to dark theme',
      run: () => setTheme('dark'),
    });
    actions.push({
      id: 'a:light',
      section: 'Actions',
      text: 'Switch to light theme',
      label: 'Switch to light theme',
      run: () => setTheme('light'),
    });
    actions.push({
      id: 'a:motion',
      section: 'Actions',
      text: 'Toggle reduce motion',
      label: 'Toggle reduce motion',
      run: () => setReducedMotion(!isReducedMotion()),
    });
    out.push(
      ...actions
        .filter(
          (a) =>
            !term ||
            m(a.text) ||
            a.id.startsWith('a:reset') ||
            a.id.startsWith('a:produce') ||
            a.id.startsWith('a:diff'),
        )
        .slice(0, term ? 6 : 14),
    );
    return out;
  }, [term, actionsOnly, data, readOnly, info.mode]);
  // the list can shrink under the selection (live data): clamp it so Enter always has a target
  const sel = Math.max(0, Math.min(active, items.length - 1));

  const run = (it: Item | undefined, newTab = false) => {
    if (!it) return;
    if (it.href && newTab) window.open(it.href, '_blank', 'noopener');
    else if (it.href) router.push(it.href);
    it.run?.();
    onClose();
  };

  return (
    <dialog
      ref={ref}
      aria-label="Command palette"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className="ki-dialog mx-auto mt-[110px] w-[620px] max-w-[calc(100vw-32px)] rounded-lg border border-line bg-surface p-0 text-ink [box-shadow:var(--shadow-popover)]"
    >
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="text-ink-muted">
          <SearchIcon size={16} />
        </span>
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls="ki-palette-list"
          aria-activedescendant={items[sel] ? `pal-${sel}` : undefined}
          aria-label="Search topics, groups, schemas and actions"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive(Math.min(items.length - 1, sel + 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive(Math.max(0, sel - 1));
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              run(items[sel], e.metaKey || e.ctrlKey);
            }
          }}
          placeholder="Search topics, groups, offsets — or > for actions"
          className="grow border-none bg-transparent text-[15px] text-ink placeholder:text-ink-muted"
        />
        <Kbd>Esc</Kbd>
      </div>
      <ul
        id="ki-palette-list"
        role="listbox"
        className="m-0 max-h-[380px] list-none overflow-y-auto p-2"
      >
        {items.length === 0 && (
          <li role="presentation" className="px-3 py-6 text-center text-[13px] text-ink-muted">
            Nothing matches “{term}”.
          </li>
        )}
        {items.map((it, i) => (
          // listbox → option directly (the <li> is only layout); group headers are presentation
          <li key={it.id} role="presentation">
            {(i === 0 || items[i - 1]!.section !== it.section) && (
              <div
                className="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-muted"
                role="presentation"
              >
                {it.section}
              </div>
            )}
            <div
              id={`pal-${i}`}
              role="option"
              aria-selected={i === sel}
              onMouseMove={() => setActive(i)}
              onClick={(e) => run(it, e.metaKey || e.ctrlKey)}
              className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-[13px] ${i === sel ? 'bg-copper-soft' : ''}`}
            >
              <span className="text-ink-muted">{it.label}</span>
              {it.meta && <span className="text-[12px] text-ink-muted">{it.meta}</span>}
              {i === sel && (
                <span className="ml-auto">
                  <Kbd>↵</Kbd>
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[12px] text-ink-muted">
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> move
        </span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd> open
        </span>
        <span className="flex items-center gap-1">
          <Kbd>⌘↵</Kbd> open in new tab
        </span>
        <span className="ml-auto">Type &gt; for actions only</span>
      </div>
    </dialog>
  );
}
