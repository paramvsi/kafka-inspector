'use client';
import { isNoRegistry } from '../../lib/poll';
import { fieldsOf, type Field } from '../../lib/schemaFields';
import { pickVersions } from '../../lib/versions';
import {
  checkCompatibility,
  diffFields,
  type CompatibilityResult,
  type FieldChange,
  type SchemaVersion,
} from '@ki/core';
import { Button, Card, Dialog, EmptyState, Select, StatusBadge, TextArea } from '@ki/ui';
import Link from 'next/link';
import { useState } from 'react';
import { useKafka, useKafkaQuery } from '../../lib/kafka';
import { useUrl } from '../../lib/url';

function align(a: Field[], b: Field[], changes: FieldChange[]) {
  const kind = (n: string) => changes.find((c) => c.field === n)?.change ?? 'same';
  const rows: Array<{ left?: Field; right?: Field; kind: FieldChange['change'] }> = [];
  let j = 0;
  for (const f of a) {
    if (kind(f.name) === 'removed') {
      rows.push({ left: f, kind: 'removed' });
      continue;
    }
    const at = b.findIndex((x) => x.name === f.name);
    while (j < at) {
      if (kind(b[j]!.name) === 'added') rows.push({ right: b[j], kind: 'added' });
      j++;
    }
    rows.push({ left: f, right: b[at], kind: kind(f.name) });
    j = at + 1;
  }
  for (; j < b.length; j++)
    if (kind(b[j]!.name) === 'added') rows.push({ right: b[j], kind: 'added' });
  return rows;
}

const TONE: Record<string, string> = {
  removed: 'bg-crit-soft',
  added: 'bg-ok-soft',
  changed: 'bg-warn-soft',
  same: '',
};

export function SchemasView() {
  const url = useUrl();
  const { client, clusterId } = useKafka();
  const subjects = useKafkaQuery(['subjects'], (c, id) => c.listSubjects(id), false);
  const subject = url.get('subject') ?? subjects.data?.[0]?.subject;
  const s = subjects.data?.find((x) => x.subject === subject);
  const latest = s?.latestVersion ?? 1;
  const [from, to] = pickVersions(s?.versions ?? [latest], url.get('to'), url.get('from'));
  const versions = useKafkaQuery(
    ['schema-pair', subject, from, to],
    async (c, id) =>
      subject
        ? Promise.all([c.getSchema(id, subject, from), c.getSchema(id, subject, to)])
        : undefined,
    false,
  );
  // another pair is another comparison: never the previous pair's diff and verdicts under the new selectors
  const [a, b] = (versions.isPlaceholderData ? undefined : versions.data) ?? [];
  // "Start from the latest version" seeds the latest, whichever pair is being compared
  const newest = useKafkaQuery(
    ['schema', subject, latest],
    async (c, id) => (subject ? c.getSchema(id, subject, latest) : undefined),
    false,
  );
  const label = (v: number) => {
    const dt = v === from ? a?.registeredAt : v === to ? b?.registeredAt : undefined;
    return `v${v}${dt ? ` · ${new Date(dt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}${v === latest ? ' (latest)' : ''}`;
  };
  const changes = a && b ? diffFields(a.type, a.schema, b.schema) : [];
  const backward = a && b ? checkCompatibility(a.type, a.schema, b.schema, 'BACKWARD') : undefined;
  const forward = a && b ? checkCompatibility(a.type, a.schema, b.schema, 'FORWARD') : undefined;
  const count = (k: FieldChange['change']) => changes.filter((c) => c.change === k).length;
  return (
    <div className="-m-6 flex min-h-[calc(100vh-56px)]">
      <nav aria-label="Subjects" className="w-[240px] shrink-0 border-r border-line p-3">
        <h1 className="sr-only">Schemas</h1>
        <h2 className="m-0 px-2 pb-3 text-[15px] font-semibold">
          Subjects · {subjects.data?.length ?? 0}
        </h2>
        <ul className="m-0 flex list-none flex-col gap-[2px] p-0">
          {subjects.data?.map((x) => (
            <li key={x.subject}>
              <Link
                href={`/app/schemas/?subject=${encodeURIComponent(x.subject)}`}
                aria-current={x.subject === subject ? 'page' : undefined}
                className="flex items-center rounded-[6px] px-2 py-2 font-mono text-[12px] text-ink no-underline hover:bg-surface-hover aria-[current=page]:bg-surface-hover"
              >
                <span className="truncate">{x.subject}</span>
                <span className="ml-auto text-[10px] text-ink-subtle">v{x.latestVersion}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex min-w-0 grow flex-col gap-4 p-6">
        {subjects.error && isNoRegistry(subjects.error) ? (
          // no registry configured (NO_SCHEMA_REGISTRY): its message says which variable to set
          <EmptyState title="No Schema Registry">{(subjects.error as Error).message}</EmptyState>
        ) : subjects.error ? (
          <EmptyState title="Couldn't load schemas">{(subjects.error as Error).message}</EmptyState>
        ) : !subjects.data ? (
          <EmptyState title="Loading subjects…">{'\u00a0'}</EmptyState>
        ) : !s && subject && subjects.data?.length ? (
          <EmptyState title={`Subject ${subject} not found`}>
            It may have been deleted. Pick a subject from the list.
          </EmptyState>
        ) : !s ? (
          <EmptyState title="No schemas">This cluster has no Schema Registry subjects.</EmptyState>
        ) : (
          <>
            <header className="flex flex-wrap items-center gap-3">
              <h2 className="m-0 font-mono text-[24px] font-medium">{s.subject}</h2>
              <span className="rounded-sm bg-surface-hover px-2 py-[3px] text-[12px] text-ink-muted">
                {s.type === 'AVRO' ? 'Avro' : s.type === 'JSON' ? 'JSON Schema' : 'Protobuf'}
              </span>
              <span className="rounded-sm bg-surface-hover px-2 py-[3px] font-mono text-[11px] text-ink-muted">
                {s.compatibility}
              </span>
              <div className="grow" />
              <Button onClick={() => url.set({ check: 1 })}>Check a new version</Button>
            </header>
            {latest > 1 ? (
              <>
                <div className="flex flex-wrap items-center gap-3 text-[13px]">
                  <span className="text-ink-muted">Compare</span>
                  <div className="w-[170px]">
                    <Select
                      label="From version"
                      hideLabel
                      value={String(from)}
                      onChange={(e) => url.set({ from: e.target.value })}
                      options={s.versions
                        .filter((v) => v < to)
                        .map((v) => ({ value: String(v), label: label(v) }))}
                    />
                  </div>
                  <span aria-hidden="true" className="text-ink-muted">
                    →
                  </span>
                  <div className="w-[190px]">
                    <Select
                      label="To version"
                      hideLabel
                      value={String(to)}
                      onChange={(e) => url.set({ to: e.target.value })}
                      options={s.versions
                        .filter((v) => v > from)
                        .map((v) => ({ value: String(v), label: label(v) }))}
                    />
                  </div>
                  <div className="grow" />
                  {a && (
                    <span className="text-[12px]">
                      <span className="text-ok-text">
                        +{count('added')} field{count('added') === 1 ? '' : 's'}
                      </span>
                      <span className="text-ink-muted"> · </span>
                      <span className="text-crit-text">
                        −{count('removed')} field{count('removed') === 1 ? '' : 's'}
                      </span>
                      <span className="text-ink-muted"> · </span>
                      <span className="text-warn-text">{count('changed')} changed</span>
                    </span>
                  )}
                </div>
                {versions.error && !versions.data && (
                  <EmptyState title={`Couldn't load v${from} and v${to}`}>
                    {(versions.error as Error).message} Pick other versions, or try again.
                  </EmptyState>
                )}
                {a && b && (
                  <div className="overflow-hidden rounded-lg border border-line bg-surface">
                    <div className="grid grid-cols-2 border-b border-line bg-surface-sunken font-mono text-[12px] text-ink-muted">
                      <div className="px-4 py-2">v{a.version}</div>
                      <div className="border-l border-line px-4 py-2">v{b.version}</div>
                    </div>
                    <table className="w-full table-fixed border-collapse font-mono text-[12px] leading-5">
                      <caption className="sr-only">
                        Field diff between v{a.version} and v{b.version}
                      </caption>
                      <tbody>
                        {align(fieldsOf(a), fieldsOf(b), changes).map((r, i) => (
                          <tr key={i}>
                            <td
                              className={`break-all px-4 py-[2px] align-top ${r.left && r.kind !== 'same' && r.kind !== 'added' ? TONE[r.kind] : ''}`}
                            >
                              {r.left?.line}
                              {r.kind === 'removed' && <span className="sr-only"> (removed)</span>}
                            </td>
                            <td
                              className={`break-all border-l border-line px-4 py-[2px] align-top ${r.right && r.kind !== 'same' && r.kind !== 'removed' ? TONE[r.kind] : ''}`}
                            >
                              {r.right?.line}
                              {r.kind === 'added' && <span className="sr-only"> (added)</span>}
                              {r.kind === 'changed' && <span className="sr-only"> (changed)</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {a && b && backward && forward && (
                  <Verdict a={a} b={b} changes={changes} backward={backward} forward={forward} />
                )}
              </>
            ) : versions.error && !versions.data ? (
              <EmptyState title={`Couldn't load v${latest}`}>
                {(versions.error as Error).message} Try again in a moment.
              </EmptyState>
            ) : (
              versions.data && (
                <pre
                  tabIndex={0}
                  className="m-0 overflow-auto rounded-lg border border-line bg-surface p-4 font-mono text-[12px]"
                >
                  {b?.schema ?? a?.schema}
                </pre>
              )
            )}
          </>
        )}
      </div>
      {s && (
        <CheckDialog
          open={url.get('check') === '1'}
          onClose={() => url.set({ check: undefined })}
          key={s.subject} // a fresh dialog per subject: no text or result carried over
          subject={s.subject}
          onCheck={(schema) => client.checkCompatibility(clusterId, s.subject, schema)}
          seed={newest.data?.schema ?? ''}
          mode={s.compatibility}
        />
      )}
    </div>
  );
}

function Verdict({
  a,
  b,
  changes,
  backward,
  forward,
}: {
  a: SchemaVersion;
  b: SchemaVersion;
  changes: FieldChange[];
  backward: CompatibilityResult;
  forward: CompatibilityResult;
}) {
  if (backward.checked === false)
    return (
      <Card
        title={
          <span className="flex items-center gap-3">
            Compatibility <StatusBadge status="neutral">Not checked</StatusBadge>
          </span>
        }
      >
        <p className="m-0 text-[13px] leading-5 text-ink-muted">{backward.messages[0]}</p>
      </Card>
    );
  const code = (s: string) => <code className="font-mono text-[12px] text-ink">{s}</code>;
  const join = (xs: React.ReactNode[]) =>
    xs.flatMap((x, i) => (i === 0 ? [x] : i === xs.length - 1 ? [' and ', x] : [', ', x]));
  const added = changes.filter((c) => c.change === 'added' && c.hasDefault);
  const promos = changes.filter((c) => c.change === 'changed');
  const removedNoDefault = changes.filter((c) => c.change === 'removed' && !c.hasDefault);
  return (
    <Card
      title={
        <span className="flex items-center gap-3">
          Compatibility{' '}
          <StatusBadge status={backward.compatible ? 'healthy' : 'warn'}>
            {backward.compatible ? 'Backward compatible' : 'Not backward compatible'}
          </StatusBadge>
          <StatusBadge status={forward.compatible ? 'healthy' : 'warn'}>
            {forward.compatible ? 'Forward compatible' : 'Not forward compatible'}
          </StatusBadge>
        </span>
      }
    >
      <p className="m-0 text-[13px] leading-5 text-ink-muted">
        {backward.compatible ? (
          <>
            New consumers (v{b.version}) can read old messages
            {(added.length > 0 || promos.length > 0) && ': '}
            {added.length > 0 && (
              <>
                {join(added.map((c) => <span key={c.field}>{code(c.field)}</span>))}{' '}
                {added.length === 1 ? 'has a default' : 'have defaults'}
              </>
            )}
            {added.length > 0 && promos.length > 0 && ', and '}
            {promos.length > 0 && (
              <>
                {join(promos.map((c) => <span key={c.field}>{code(`${c.from} → ${c.to}`)}</span>))}{' '}
                {promos.length === 1 ? 'is a safe promotion' : 'are safe promotions'}
              </>
            )}
            .
          </>
        ) : (
          <>
            New consumers (v{b.version}) can&apos;t read old messages:{' '}
            {backward.messages
              .map((m) => m.replace(/^Backward: new consumers can't read old messages — /, ''))
              .join(' ')}
          </>
        )}{' '}
        {forward.compatible ? (
          <>Old consumers (v{a.version}) can read new messages.</>
        ) : removedNoDefault.length ? (
          <>
            Old consumers (v{a.version}) can&apos;t read new messages because{' '}
            {join(removedNoDefault.map((c) => <span key={c.field}>{code(c.field)}</span>))}{' '}
            {removedNoDefault.length === 1 ? 'was' : 'were'} removed without a default.
          </>
        ) : (
          <>
            Old consumers (v{a.version}) can&apos;t read new messages:{' '}
            {forward.messages
              .map((m) => m.replace(/^Forward: old consumers can't read new messages — /, ''))
              .join(' ')}
          </>
        )}
      </p>
    </Card>
  );
}

function CheckDialog({
  open,
  onClose,
  subject,
  onCheck,
  seed,
  mode,
}: {
  open: boolean;
  onClose: () => void;
  subject: string;
  onCheck: (schema: string) => Promise<CompatibilityResult>;
  seed: string;
  mode: string;
}) {
  const [text, setText] = useState('');
  // a result belongs to the exact text it was checked for: edits made during the request hide it
  const [checked, setChecked] = useState<{ r: CompatibilityResult; text: string } | null>(null);
  const result = checked && checked.text === text ? checked.r : null;
  const setResult = (r: CompatibilityResult | null, forText = text) =>
    setChecked(r ? { r, text: forText } : null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        <>
          Check a new version of <span className="font-mono">{subject}</span>
        </>
      }
      description={`Checked against the latest version with the subject's ${mode} rule. Read-only: nothing is registered.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            disabled={busy || !text.trim()}
            onClick={async () => {
              setBusy(true);
              const sent = text;
              try {
                setResult(await onCheck(sent), sent);
              } catch (e) {
                // the check didn't run (registry down, timeout): that's "not checked", never "not compatible"
                setResult(
                  {
                    compatible: false,
                    checked: false,
                    messages: [`Couldn't run the check: ${(e as Error).message}`],
                  },
                  sent,
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Checking…' : 'Check compatibility'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextArea
          label="Candidate schema"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null);
          }}
          placeholder={seed.slice(0, 200)}
          spellCheck={false}
        />
        <Button size="sm" className="self-start" onClick={() => setText(seed)}>
          Start from the latest version
        </Button>
        {result && (
          <div
            role="status"
            className={`rounded-md p-3 text-[13px] ${result.checked === false ? 'bg-surface-hover' : result.compatible ? 'bg-ok-soft' : 'bg-crit-soft'}`}
          >
            <div className="font-semibold">
              {result.checked === false
                ? 'Not checked'
                : result.compatible
                  ? 'Compatible'
                  : 'Not compatible'}
            </div>
            {result.messages.length > 0 && (
              <ul className="m-0 mt-1 pl-4">
                {result.messages.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
