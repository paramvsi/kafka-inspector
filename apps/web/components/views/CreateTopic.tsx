'use client';
import { formatInt, TOPIC_NAME } from '@ki/core';
import { Button, Dialog, Select, TextField, useToast } from '@ki/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useKafka, useKafkaQuery } from '../../lib/kafka';
import { useWrites } from '../Page';

const RETENTION = [
  { value: '86400000', label: '1 day' },
  { value: '259200000', label: '3 days' },
  { value: '604800000', label: '7 days (cluster default)' },
  { value: '2592000000', label: '30 days' },
  { value: '-1', label: 'Infinite' },
];
const NAME = TOPIC_NAME;

export function CreateTopicDialog({
  open,
  onClose,
  initialName,
}: {
  open: boolean;
  onClose: () => void;
  initialName?: string;
}) {
  const { clusterId, info } = useKafka();
  const writes = useWrites();
  const toast = useToast();
  const router = useRouter();
  const qc = useQueryClient();
  const brokers = useKafkaQuery(['brokers'], (c, id) => c.listBrokers(id), false);
  const online = brokers.data?.filter((b) => b.online).length ?? 3;
  const [name, setName] = useState('');
  const [partitions, setPartitions] = useState('12');
  const [rf, setRf] = useState('3');
  const [retention, setRetention] = useState('604800000');
  const [cleanup, setCleanup] = useState<'delete' | 'compact' | 'compact,delete'>('delete');
  const [overrides, setOverrides] = useState<Array<[string, string]>>([
    ['min.insync.replicas', '2'],
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (open) {
      // every open starts from the defaults, not the last topic's settings
      setName(initialName ?? '');
      setPartitions('12');
      setRf('3');
      setRetention('604800000');
      setCleanup('delete');
      setOverrides([['min.insync.replicas', '2']]);
      setError(undefined);
    }
  }, [open, initialName]);

  const p = Number(partitions),
    r = Number(rf);
  const minIsr = Number(overrides.find(([k]) => k === 'min.insync.replicas')?.[1] ?? 2) || 1;
  const nameErr =
    name && !NAME.test(name)
      ? 'Use letters, numbers, dots, dashes and underscores only.'
      : undefined;
  const pErr = !Number.isInteger(p) || p < 1 || p > 1000 ? 'Between 1 and 1,000.' : undefined;
  const rfErr =
    !Number.isInteger(r) || r < 1
      ? 'At least 1.'
      : r > online
        ? `Only ${online} brokers are online.`
        : undefined;
  const configs = Object.fromEntries([
    ...overrides.filter(([k]) => k.trim()),
    ...(retention !== '604800000' ? [['retention.ms', retention]] : []),
    ...(cleanup !== 'delete' ? [['cleanup.policy', cleanup]] : []),
  ]);
  const cli = `kafka-topics.sh --create --topic ${name || '<name>'} --partitions ${p || '?'} --replication-factor ${r || '?'}${Object.entries(
    configs,
  )
    .map(([k, v]) => ` --config ${k}=${v}`)
    .join('')}`;

  const submit = async () => {
    if (!writes || busy || nameErr || pErr || rfErr || !name) return;
    setBusy(true);
    setError(undefined);
    try {
      await writes.createTopic(clusterId, {
        name,
        partitions: p,
        replicationFactor: r,
        retentionMs: Number(retention),
        cleanupPolicy: cleanup,
        configs,
      });
      await qc.invalidateQueries({ queryKey: [clusterId, 'topics'] });
      toast({
        tone: 'ok',
        title: `Topic ${name} created`,
        body: `${formatInt(p)} partitions · RF ${r}`,
      });
      onClose();
      router.push(`/app/topics/view/?name=${encodeURIComponent(name)}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create topic"
      description={`on ${info.clusters[0]?.name} · ${online} brokers`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {/* a submit button linked to the form, so Enter in any field creates (and a disabled one blocks it) */}
          <Button
            variant="primary"
            type="submit"
            form="ki-create-topic"
            disabled={busy || !name || !!nameErr || !!pErr || !!rfErr}
          >
            {busy ? 'Creating…' : 'Create topic'}
          </Button>
        </>
      }
    >
      <form
        id="ki-create-topic"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <TextField
          label="Name"
          mono
          data-autofocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(undefined); // an error about the old name no longer applies
          }}
          error={nameErr}
          hint="Letters, numbers, dots, dashes and underscores. Can't be renamed later."
          placeholder="shipment-events"
        />
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label="Partitions"
            mono
            inputMode="numeric"
            value={partitions}
            onChange={(e) => setPartitions(e.target.value)}
            error={pErr}
            hint="Can be increased later, never decreased."
          />
          <TextField
            label="Replication factor"
            mono
            inputMode="numeric"
            value={rf}
            onChange={(e) => setRf(e.target.value)}
            error={rfErr}
            hint={
              !rfErr && (
                <span className="text-ok-text">
                  ✓ Fits {online} brokers · survives {Math.max(0, r - minIsr)} broker loss
                  {r - minIsr === 1 ? '' : 'es'}
                </span>
              )
            }
          />
          <Select
            label="Retention"
            value={retention}
            onChange={(e) => setRetention(e.target.value)}
            options={RETENTION}
          />
          <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
            <legend className="mb-1 p-0 text-[12px] font-medium text-ink-muted">
              Cleanup policy
            </legend>
            <div className="flex h-control-md items-center gap-4 text-[13px]">
              {(['delete', 'compact', 'compact,delete'] as const).map((c) => (
                <label key={c} className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="cleanup"
                    className="size-4 accent-copper"
                    checked={cleanup === c}
                    onChange={() => setCleanup(c)}
                  />
                  {c === 'delete' ? 'Delete' : c === 'compact' ? 'Compact' : 'Both'}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <details className="rounded-md border border-line-subtle px-3 py-2 text-[13px]">
          <summary className="cursor-pointer font-semibold">
            Advanced config{' '}
            <span className="font-normal text-ink-muted">
              · {overrides.length} override{overrides.length === 1 ? '' : 's'}
            </span>
          </summary>
          <div className="mt-3 flex flex-col gap-2">
            {overrides.map(([k, v], i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <TextField
                  label="Config"
                  mono
                  value={k}
                  onChange={(e) =>
                    setOverrides(overrides.map((o, j) => (j === i ? [e.target.value, o[1]] : o)))
                  }
                />
                <TextField
                  label="Value"
                  mono
                  value={v}
                  onChange={(e) =>
                    setOverrides(overrides.map((o, j) => (j === i ? [o[0], e.target.value] : o)))
                  }
                />
                <Button
                  variant="ghost"
                  onClick={() => setOverrides(overrides.filter((_, j) => j !== i))}
                  aria-label={`Remove ${k}`}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              className="self-start"
              onClick={() => setOverrides([...overrides, ['', '']])}
            >
              Add override
            </Button>
          </div>
        </details>
        <pre className="m-0 whitespace-pre-wrap break-all rounded-md bg-surface-sunken p-3 font-mono text-[11px] leading-[18px] text-ink-muted">
          {cli}
        </pre>
        {error && (
          <p role="alert" className="m-0 text-[13px] text-crit-text">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
