'use client';
import {
  formatInt,
  toLocalInput,
  type GroupDetail,
  type ResetPreview,
  type ResetStrategy,
} from '@ki/core';
import { Button, DataTable, Dialog, Select, TextField, useToast } from '@ki/ui';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useKafka } from '../../lib/kafka';
import { useWrites } from '../Page';

type Kind = ResetStrategy['kind'];
const KINDS: Array<{ kind: Kind; label: string }> = [
  { kind: 'earliest', label: 'Earliest' },
  { kind: 'latest', label: 'Latest' },
  { kind: 'timestamp', label: 'Time' },
  { kind: 'offset', label: 'Offset' },
  { kind: 'shift', label: 'Shift by' },
];

/** Reset offsets (F-62): scope, strategy, live dry run, then apply. Demo only in v1. */
export function ResetOffsetsDialog({
  open,
  onClose,
  group,
}: {
  open: boolean;
  onClose: () => void;
  group: GroupDetail;
}) {
  const writes = useWrites();
  const toast = useToast();
  const qc = useQueryClient();
  const { clusterId } = useKafka();
  const stalled = group.partitions.find((p) => p.status === 'stalled');
  const topics = group.summary.topics;
  const [topic, setTopic] = useState(stalled?.topic ?? topics[0]!);
  const [scope, setScope] = useState<string>(stalled ? String(stalled.partition) : 'all');
  const [kind, setKind] = useState<Kind>(stalled ? 'shift' : 'latest');
  const [by, setBy] = useState('+1');
  const [offset, setOffset] = useState('');
  const [time, setTime] = useState(() => toLocalInput(Date.now() - 3600e3));
  const [preview, setPreview] = useState<ResetPreview>();
  // the request the shown preview was computed for: Apply only acts on a fresh dry run
  const [previewOf, setPreviewOf] = useState<unknown>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTopic(stalled?.topic ?? topics[0]!);
    setScope(stalled ? String(stalled.partition) : 'all');
    setKind(stalled ? 'shift' : 'latest');
    setTime(toLocalInput(Date.now() - 3600e3)); // "1 hour ago" as of opening, in local time
  }, [open]);

  const strategy = useMemo<ResetStrategy | null>(() => {
    if (kind === 'shift') return Number.isInteger(Number(by)) ? { kind, by: Number(by) } : null;
    if (kind === 'offset')
      return offset && Number.isInteger(Number(offset)) ? { kind, offset: Number(offset) } : null;
    if (kind === 'timestamp')
      return Number.isNaN(Date.parse(time))
        ? null
        : { kind, timestamp: new Date(time).toISOString() };
    return { kind };
  }, [kind, by, offset, time]);
  const req = useMemo(
    () =>
      strategy
        ? {
            groupId: group.summary.groupId,
            topic,
            partitions: scope === 'all' ? ('all' as const) : [Number(scope)],
            strategy,
          }
        : null,
    [strategy, topic, scope, group.summary.groupId],
  );

  useEffect(() => {
    if (!open || !writes || !req) return setPreview(undefined);
    let alive = true;
    const t = setTimeout(
      () =>
        writes
          .resetOffsets(clusterId, req, true)
          .then((p) => {
            if (!alive) return;
            setPreview(p);
            setPreviewOf(req);
            setError(undefined);
          })
          .catch((e) => alive && setError((e as Error).message)),
      150,
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, writes, req, clusterId]);

  const fresh = previewOf === req;
  const changed = preview?.rows.filter((r) => !r.skipped) ?? [];
  const parts = group.partitions
    .filter((p) => p.topic === topic)
    .sort((a, b) => a.partition - b.partition);
  const apply = async () => {
    if (!writes || !req) return;
    setBusy(true);
    try {
      const done = await writes.resetOffsets(clusterId, req, false);
      await qc.invalidateQueries({ queryKey: [clusterId] });
      const n = done.rows.filter((r) => !r.skipped).length; // what was applied, not the preview
      toast({
        tone: 'ok',
        title: `Offsets reset for ${group.summary.groupId}`,
        body: `${n} partition${n === 1 ? '' : 's'} on ${topic}. Members rejoin in a few seconds.`,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const skippedOne =
    kind === 'shift' && stalled && scope === String(stalled.partition) && Number(by) > 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      className="w-[640px]"
      title={
        <>
          Reset offsets · <span className="font-mono">{group.summary.groupId}</span>
        </>
      }
      description="Moves where the group resumes reading. Nothing is deleted from the topic."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            data-tour="apply"
            onClick={apply}
            disabled={busy || !fresh || !changed.length}
          >
            {busy
              ? 'Applying…'
              : `Apply reset to ${changed.length} partition${changed.length === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 rounded-md bg-surface-sunken px-3 py-2 text-[12px]">
          <span aria-hidden="true" className="text-ok">
            ✓
          </span>
          {group.summary.members === 0
            ? 'Group is empty, so offsets can be reset.'
            : `Group must be empty: the simulator pauses its ${group.summary.members} members while it resets. On a real cluster, stop the consumers first.`}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Topic"
            data-autofocus
            value={topic}
            onChange={(e) => {
              setTopic(e.target.value);
              setScope('all');
            }}
            options={topics.map((t) => ({ value: t, label: t }))}
          />
          <Select
            label="Partitions"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            options={[
              { value: 'all', label: `All ${parts.length} partitions` },
              ...parts.map((p) => ({
                value: String(p.partition),
                label: `${p.partition}${p.status === 'stalled' ? ' (stalled)' : p.lag ? ` · lag ${formatInt(p.lag)}` : ''}`,
              })),
            ]}
          />
        </div>
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2 p-0 text-[12px] font-medium text-ink-muted">Reset to</legend>
          <div className="grid grid-cols-5 gap-2">
            {KINDS.map((k) => (
              <label
                key={k.kind}
                className={`flex h-control-md cursor-pointer items-center gap-2 rounded-md border px-3 text-[13px] transition-colors duration-instant ease-standard ${kind === k.kind ? 'border-copper bg-copper-soft font-semibold' : 'border-line bg-surface hover:bg-surface-hover'}`}
              >
                <input
                  type="radio"
                  name="reset-kind"
                  className="size-4 accent-copper"
                  checked={kind === k.kind}
                  onChange={() => setKind(k.kind)}
                />
                {k.label}
              </label>
            ))}
          </div>
        </fieldset>
        {kind === 'shift' && (
          <div className="flex items-end gap-3">
            <div className="w-[100px]">
              <TextField
                label="Shift"
                mono
                value={by}
                onChange={(e) => setBy(e.target.value)}
                error={
                  Number.isInteger(Number(by)) ? undefined : 'Enter a whole number, e.g. 1 or -5.'
                }
              />
            </div>
            {skippedOne && stalled?.committedOffset !== null && (
              <p className="m-0 pb-2 text-[13px] text-ink-muted">
                Skips the message at offset {formatInt(stalled!.committedOffset!)} that the group
                keeps failing on.
              </p>
            )}
          </div>
        )}
        {kind === 'offset' && (
          <div className="w-[200px]">
            <TextField
              label="Offset"
              mono
              inputMode="numeric"
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
            />
          </div>
        )}
        {kind === 'timestamp' && (
          <div className="w-[240px]">
            <TextField
              label="Time"
              type="datetime-local"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              hint="The first offset at or after this time"
            />
          </div>
        )}
        <div>
          {/* the table and Apply's count change after each choice without moving focus: say so */}
          <p role="status" className="sr-only">
            {fresh && preview
              ? `Dry run: ${changed.length} partition${changed.length === 1 ? '' : 's'} will change.`
              : ''}
          </p>
          <div className="mb-2 text-[12px] font-medium text-ink-muted">Dry run</div>
          <DataTable
            caption="Dry run: current and new offsets"
            rows={(preview?.rows ?? []).filter(
              (r) => scope === 'all' || r.partition === Number(scope),
            )}
            rowKey={(r) => String(r.partition)}
            columns={[
              {
                key: 'p',
                header: 'Partition',
                kind: 'id',
                cell: (r) => `${topic} · ${r.partition}`,
              },
              {
                key: 'c',
                header: 'Current',
                kind: 'num',
                cell: (r) => (r.current == null ? '—' : formatInt(r.current)),
              },
              {
                key: 'n',
                header: 'New',
                kind: 'num',
                cell: (r) => (
                  <span className={r.skipped ? 'text-ink-muted' : 'text-copper'}>
                    {formatInt(r.next)}
                  </span>
                ),
              },
              {
                key: 's',
                header: 'Skipped',
                kind: 'num',
                cell: (r) =>
                  r.skipped ? (
                    <span className="text-ink-muted">
                      {r.reason === 'Already at that offset' ? 'no change' : 'not selected'}
                    </span>
                  ) : (
                    formatInt(Math.max(0, r.next - (r.current ?? r.next)))
                  ),
              },
              { key: 'l', header: 'Lag after', kind: 'num', cell: (r) => formatInt(r.lagAfter) },
            ]}
          />
        </div>
        {skippedOne && (
          <p className="m-0 text-[12px] text-ink-muted">
            Tip: send the skipped message to <code className="font-mono">{topic}.dlq</code> first so
            it isn&apos;t lost.{' '}
            <Link
              className="text-copper underline"
              href={`/app/topics/view/?name=${encodeURIComponent(topic)}&tab=messages&msg=${stalled!.partition}:${stalled!.committedOffset}&produce=1&reprocess=${stalled!.partition}:${stalled!.committedOffset}`}
            >
              Reprocess it
            </Link>
          </p>
        )}
        {error && (
          <p role="alert" className="m-0 text-[13px] text-crit-text">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
