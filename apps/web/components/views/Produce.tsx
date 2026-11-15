'use client';
import { AvroType, formatInt, fromDisplay, randomValue, type SchemaVersion } from '@ki/core';
import { Button, Drawer, Select, TextArea, TextField, useToast } from '@ki/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useKafka, useKafkaQuery } from '../../lib/kafka';
import { decodeMessage, useSchemaLookup } from '../../lib/serdes';
import { useUrl } from '../../lib/url';
import { useWrites } from '../Page';

type Validation = { ok: true; text: string } | { ok: false; text: string } | null;

function validate(schema: SchemaVersion | undefined, text: string): Validation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return schema ? { ok: false, text: `Not valid JSON: ${(e as Error).message}` } : null;
  }
  if (!schema) return null;
  if (schema.type === 'AVRO') {
    try {
      const t = AvroType.parse(schema.schema);
      t.encode(fromDisplay(t.schema, parsed));
      return { ok: true, text: `Valid against ${schema.subject} v${schema.version}` };
    } catch (e) {
      return {
        ok: false,
        text: `Doesn't match ${schema.subject} v${schema.version}: ${(e as Error).message}`,
      };
    }
  }
  const s = JSON.parse(schema.schema) as { required?: string[] };
  const obj = parsed !== null && typeof parsed === 'object' ? (parsed as object) : {};
  const missing = (s.required ?? []).filter((k) => !(k in obj));
  return missing.length
    ? { ok: false, text: `Missing required ${missing.join(', ')}` }
    : { ok: true, text: `Valid against ${schema.subject} v${schema.version}` };
}

function generate(schema: SchemaVersion | undefined): string {
  if (!schema)
    return JSON.stringify(
      { id: `test_${Math.floor(Math.random() * 1e5)}`, at: new Date().toISOString() },
      null,
      2,
    );
  if (schema.type === 'AVRO')
    return JSON.stringify(randomValue(JSON.parse(schema.schema)), null, 2);
  const props =
    (
      JSON.parse(schema.schema) as {
        properties?: Record<string, { type?: string; enum?: string[] }>;
      }
    ).properties ?? {};
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(props).map(([k, v]) => [
        k,
        v.enum
          ? v.enum[0]
          : v.type === 'integer'
            ? Math.floor(Math.random() * 100)
            : `${k}-${Math.floor(Math.random() * 1e4)}`,
      ]),
    ),
    null,
    2,
  );
}

/** Produce drawer (F-50) and reprocess (F-51). Demo only in v1. */
export function ProduceDrawer({
  topic,
  partitions,
  open,
  onClose,
}: {
  topic: string;
  partitions: number;
  open: boolean;
  onClose: () => void;
}) {
  const url = useUrl();
  const writes = useWrites();
  const toast = useToast();
  const qc = useQueryClient();
  const lookup = useSchemaLookup();
  const { clusterId, info } = useKafka();
  const reprocess = url.get('reprocess');
  const [target, setTarget] = useState(topic);
  const topics = useKafkaQuery(
    ['topics', 'names'],
    (c, id) => c.listTopics(id, { size: 500 }),
    false,
  );
  const detail = useKafkaQuery(['topic', target], (c, id) => c.getTopic(id, target), false);
  const subject = detail.data?.schema?.valueSubject;
  const schema = useKafkaQuery(
    ['schema', subject, 'latest'],
    (c, id) => (subject ? c.getSchema(id, subject, 'latest') : Promise.resolve(undefined)),
    false,
  ).data;
  const [partition, setPartition] = useState('auto');
  // Cancel, Esc and backdrop all clear the URL state, so the next plain "Produce message" isn't a reprocess
  const close = () => {
    onClose();
    url.set({ produce: undefined, reprocess: undefined });
  };
  // a partition picked for one topic may not exist on the next
  useEffect(() => setPartition('auto'), [target]);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [generated, setGenerated] = useState(false);
  const [headers, setHeaders] = useState<Array<[string, string]>>([['region', 'eu']]);
  const [count, setCount] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (open) {
      setTarget(topic);
      setError(undefined);
    }
  }, [open, topic]);
  // Prefill from the message being reprocessed
  const [rp, ro] = (reprocess ?? '').split(':').map(Number);
  const source = useKafkaQuery(
    ['message', topic, reprocess],
    (c, id) =>
      reprocess
        ? c.browse(id, { topic, partition: rp!, from: 'offset', offset: ro!, limit: 1 })
        : Promise.resolve(undefined),
    false,
  );
  useEffect(() => {
    const m = source.data?.messages[0];
    if (!open || !m) return;
    decodeMessage(m, 'auto', 'auto', lookup, []).then((d) => {
      setValue(d.value.ok ? JSON.stringify(d.value.value, null, 2) : d.value.hex);
      setKey(d.key.ok && d.key.value !== null ? String(d.key.value) : '');
      setHeaders([
        ...Object.entries(d.headers),
        ['reprocessed-from', `${topic}-${m.partition}@${m.offset}`],
      ]);
    });
  }, [open, source.data, lookup, topic]);
  // a fresh sample per target schema: switching topic doesn't keep the previous topic's JSON
  const [sampledFor, setSampledFor] = useState<string>();
  // only once the target's own detail (and schema) loaded — placeholder data is the previous topic's
  const loaded = detail.data?.summary.name === target && (!subject || schema?.subject === subject);
  const sampleKey = loaded ? `${target}:${subject ?? ''}` : undefined;
  useEffect(() => {
    if (!open) setSampledFor(undefined);
    if (!open || reprocess || !sampleKey || sampleKey === sampledFor) return;
    setSampledFor(sampleKey);
    setValue(generate(subject ? schema : undefined));
  }, [open, reprocess, sampleKey, sampledFor, schema, subject]);

  const v = useMemo(() => validate(schema, value), [schema, value]);
  const n = Math.max(1, Math.min(100, Number(count) || 1));
  const dlq = topics.data?.items.find((t) => t.name === `${topic}.dlq`);
  const parts = target === topic ? partitions : (detail.data?.partitions.length ?? 1);

  const submit = async () => {
    if (!writes || (v && !v.ok)) return;
    setBusy(true);
    setError(undefined);
    try {
      let first: { partition: number; offset: number } | undefined;
      for (let i = 0; i < n; i++) {
        const body = i > 0 && generated ? generate(schema) : value;
        const r = await writes.produce(clusterId, {
          topic: target,
          partition: partition === 'auto' ? undefined : Number(partition),
          key: key || null,
          value: body,
          headers: headers.filter(([k]) => k).map(([k, val]) => ({ key: k, value: val })),
          valueFormat: schema?.type === 'AVRO' ? 'avro' : 'json',
        });
        first ??= r;
      }
      await qc.invalidateQueries({ queryKey: [clusterId] });
      toast({
        tone: 'ok',
        title: `Produced ${n} message${n > 1 ? 's' : ''} to ${target}`,
        body: `partition ${first!.partition} · offset ${formatInt(first!.offset)}`,
        action: {
          label: 'Show in messages',
          onClick: () =>
            url.set(
              {
                tab: 'messages',
                msg: `${first!.partition}:${first!.offset}`,
                live: undefined,
                from: 'offset',
                offset: first!.offset,
                produce: undefined,
                reprocess: undefined,
              },
              'push',
            ),
        },
      });
      onClose();
      url.set({ produce: undefined, reprocess: undefined });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={close}
      title={reprocess ? 'Reprocess message' : 'Produce message'}
      description={
        <>
          to <span className="font-mono">{target}</span> on {info.clusters[0]?.name}
        </>
      }
      footer={
        <>
          <div className="grow" />
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={busy || !value || (v !== null && !v.ok)}
          >
            {busy ? 'Producing…' : `Produce ${n} message${n > 1 ? 's' : ''}`}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {reprocess && (
          <div className="flex items-end gap-2">
            <div className="grow">
              <Select
                label="Target topic"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                options={(topics.data?.items ?? []).map((t) => ({ value: t.name, label: t.name }))}
              />
            </div>
            {dlq && target !== dlq.name && (
              <Button onClick={() => setTarget(dlq.name)}>Send to {dlq.name}</Button>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Partition"
            value={partition}
            onChange={(e) => setPartition(e.target.value)}
            options={[
              { value: 'auto', label: 'Auto (by key)' },
              ...Array.from({ length: parts }, (_, i) => ({
                value: String(i),
                label: `Partition ${i}`,
              })),
            ]}
          />
          <TextField
            label="Key"
            mono
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="ord_test_001"
          />
        </div>
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[12px] font-medium text-ink-muted">Value</span>
            {schema && (
              <span className="rounded-sm bg-surface-hover px-2 py-[2px] text-[11px] text-ink-muted">
                {schema.type === 'AVRO' ? 'Avro' : 'JSON Schema'} · {schema.subject} v
                {schema.version}
              </span>
            )}
            <div className="grow" />
            <Button
              size="sm"
              onClick={() => {
                setValue(generate(schema));
                setGenerated(true);
              }}
            >
              Generate from schema
            </Button>
          </div>
          <TextArea
            label={<span className="sr-only">Value JSON</span>}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setGenerated(false);
            }}
            spellCheck={false}
            className="min-h-[220px]"
          />
          {v && (
            <p
              role="status"
              className={`m-0 mt-2 text-[12px] ${v.ok ? 'text-ok-text' : 'text-crit-text'}`}
            >
              {v.ok ? '✓ ' : ''}
              {v.text}
            </p>
          )}
        </div>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 p-0 text-[12px] font-medium text-ink-muted">Headers</legend>
          {headers.map(([k, val], i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
              <input
                aria-label="Header name"
                value={k}
                onChange={(e) =>
                  setHeaders(headers.map((h, j) => (j === i ? [e.target.value, h[1]] : h)))
                }
                className="h-control-md rounded-md border border-line bg-surface px-3 font-mono text-[12px] text-ink"
              />
              <input
                aria-label="Header value"
                value={val}
                onChange={(e) =>
                  setHeaders(headers.map((h, j) => (j === i ? [h[0], e.target.value] : h)))
                }
                className="h-control-md rounded-md border border-line bg-surface px-3 font-mono text-[12px] text-ink"
              />
              <button
                type="button"
                aria-label={`Remove header ${k}`}
                onClick={() => setHeaders(headers.filter((_, j) => j !== i))}
                className="cursor-pointer border-none bg-transparent px-2 text-ink-muted hover:text-ink"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setHeaders([...headers, ['', '']])}
            className="cursor-pointer self-start border-none bg-transparent p-0 text-[13px] text-copper underline"
          >
            + Add header
          </button>
        </fieldset>
        <div className="flex items-center gap-3">
          <div className="w-[90px]">
            <TextField
              label="Send"
              mono
              inputMode="numeric"
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </div>
          <span className="mt-5 text-[12px] text-ink-muted">
            message(s) · above 1, generated values are new each time
          </span>
        </div>
        {error && (
          <p role="alert" className="m-0 text-[13px] text-crit-text">
            {error}
          </p>
        )}
      </form>
    </Drawer>
  );
}
