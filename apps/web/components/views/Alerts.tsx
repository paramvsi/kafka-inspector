'use client';
import {
  formatClock,
  formatDuration,
  formatInt,
  type AlertEvent,
  type AlertMetric,
  type AlertRule,
  type AlertRuleInput,
  type GroupSummary,
  type Severity,
} from '@ki/core';
import {
  Button,
  Card,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  SegmentedControl,
  Select,
  StatusBadge,
  TextField,
  useToast,
} from '@ki/ui';
import { TimeSeriesChart } from '../Chart';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAttempt } from '../../lib/attempt';
import { axisTime } from '../../lib/axis';
import { useKafka, useKafkaQuery, useStream } from '../../lib/kafka';
import { useUrl } from '../../lib/url';
import { PageHeader } from '../Page';

const METRICS: Array<{
  value: AlertMetric;
  label: string;
  unit?: string;
  scope: 'group' | 'topic' | 'broker' | 'cluster';
}> = [
  { value: 'lag', label: 'Consumer lag', unit: 'is above', scope: 'group' },
  { value: 'group-status', label: 'Group status', scope: 'group' },
  { value: 'topic-silent', label: 'Topic silent', scope: 'topic' },
  {
    value: 'under-replicated',
    label: 'Under-replicated partitions',
    unit: 'is above',
    scope: 'cluster',
  },
  { value: 'broker-offline', label: 'Broker offline', scope: 'broker' },
  { value: 'dlq-receiving', label: 'DLQ receiving messages', scope: 'topic' },
];
const DURATIONS = [10, 30, 60, 300, 600, 1800].map((s) => ({
  value: String(s),
  label: s < 60 ? `${s} seconds` : `${s / 60} minute${s === 60 ? '' : 's'}`,
}));
const SEV_TONE: Record<Severity, 'stalled' | 'warn' | 'info'> = {
  crit: 'stalled',
  warn: 'warn',
  info: 'info',
};

const GONE = 'It may have just resolved; the list refreshes.';
export function AlertsView() {
  const url = useUrl();
  const { client, clusterId } = useKafka();
  const qc = useQueryClient();
  const toast = useToast();
  const attempt = useAttempt();
  const firingLive = useStream<AlertEvent[]>('alerts');
  const all = useKafkaQuery(
    ['alerts', 'all'],
    (c) => c.listAlerts({ state: 'all', limit: 200 }),
    3000,
  );
  const rules = useKafkaQuery(['alert-rules'], (c) => c.listAlertRules(), 3000);
  const now = Date.now();
  const firing = (firingLive ?? all.data?.filter((a) => a.state === 'firing') ?? []).filter(
    (a) => !a.acknowledged,
  );
  const history = (all.data ?? []).filter((a) => a.state === 'resolved' || a.acknowledged);
  const ruleOf = (id: string) => rules.data?.find((r) => r.id === id);
  const refresh = () => qc.invalidateQueries({ queryKey: [clusterId, 'alerts'] });
  const editing = url.get('rule');
  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle={`${firing.filter((a) => !a.mutedUntil || Date.parse(a.mutedUntil) <= now).length} firing · ${rules.data?.length ?? 0} rules · notifications to this browser`} // muted ones stay listed but aren't counted, as in the bell
        actions={
          <Button variant="primary" onClick={() => url.set({ rule: 'new' })}>
            New rule
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.9fr_1fr]">
        <div className="flex min-w-0 flex-col gap-3">
          <h2 className="section-title m-0">Firing</h2>
          {firing.length === 0 && (
            <Card>
              <EmptyState title="Nothing is firing">
                Rules are checked every second against live metrics.
              </EmptyState>
            </Card>
          )}
          {firing.map((a) => {
            const r = ruleOf(a.ruleId);
            const muted = a.mutedUntil && Date.parse(a.mutedUntil) > now;
            return (
              <article
                key={a.id}
                className={`ki-insert rounded-lg border bg-surface p-4 ${a.severity === 'crit' ? 'border-crit' : a.severity === 'warn' ? 'border-warn' : 'border-line'}`}
              >
                <div className="flex items-start gap-3">
                  <span
                    role="img"
                    aria-label={
                      a.severity === 'crit'
                        ? 'Critical'
                        : a.severity === 'warn'
                          ? 'Warning'
                          : 'Info'
                    }
                    className={`mt-[6px] size-2 shrink-0 rounded-full ${a.severity === 'crit' ? 'bg-crit' : a.severity === 'warn' ? 'bg-warn' : 'bg-copper'}`}
                  />
                  <div className="min-w-0 grow">
                    <h3 className="m-0 text-[13px] font-semibold">{a.title}</h3>
                    <p className="m-0 mt-1 text-[12px] text-ink-muted">
                      Rule “{r?.name ?? a.ruleId}” · firing for{' '}
                      {formatDuration(now - Date.parse(a.firedAt))} · {a.evidence}
                      {muted && ` · muted until ${formatClock(a.mutedUntil!)}`}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        href={a.href}
                        className="inline-flex h-control-sm items-center rounded-md bg-copper px-3 text-[12px] font-semibold text-copper-on no-underline hover:bg-copper-strong"
                      >
                        Open{' '}
                        {a.href.includes('/groups/')
                          ? 'group'
                          : a.href.includes('/topics')
                            ? 'topic'
                            : 'page'}
                      </Link>
                      <Button
                        size="sm"
                        disabled={!!muted}
                        onClick={async () => {
                          if (
                            await attempt(
                              'mute the alert',
                              client.muteAlert(a.id, new Date(now + 3600e3).toISOString()),
                              GONE,
                            )
                          )
                            toast({ tone: 'info', title: 'Muted for 1 hour', body: a.title });
                          refresh();
                        }}
                      >
                        Mute 1 h
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          await attempt(
                            'acknowledge the alert',
                            client.acknowledgeAlert(a.id),
                            GONE,
                          );
                          refresh();
                        }}
                      >
                        Acknowledge
                      </Button>
                    </div>
                  </div>
                  <span className="font-mono text-[10px] text-ink-muted">
                    {formatClock(a.firedAt)}
                  </span>
                </div>
              </article>
            );
          })}
          <h2 className="section-title m-0 mt-3">History</h2>
          <DataTable
            caption="Alert history"
            rows={history.slice(0, 50)}
            rowKey={(a) => a.id}
            empty={<EmptyState title="No alerts in the last 24 hours" />}
            columns={[
              {
                key: 'w',
                header: 'When',
                kind: 'id',
                cell: (a) =>
                  now - Date.parse(a.firedAt) > 86400e3 ? 'Yesterday' : formatClock(a.firedAt),
              },
              {
                key: 'a',
                header: 'Alert',
                cell: (a) => (
                  <Link href={a.href} className="text-ink no-underline hover:text-copper">
                    {a.title}
                  </Link>
                ),
              },
              {
                key: 'd',
                header: 'Duration',
                kind: 'id',
                cell: (a) =>
                  formatDuration(
                    (a.resolvedAt ? Date.parse(a.resolvedAt) : now) - Date.parse(a.firedAt),
                  ),
              },
              {
                key: 's',
                header: 'State',
                cell: (a) =>
                  a.state === 'resolved' ? (
                    <StatusBadge status="healthy">Resolved</StatusBadge>
                  ) : (
                    <StatusBadge status="neutral">Acknowledged</StatusBadge>
                  ),
              },
            ]}
          />
        </div>
        <Card
          title="Rules"
          actions={
            <Button size="sm" variant="ghost" onClick={() => url.set({ rule: 'new' })}>
              Add alert rule
            </Button>
          }
          className="self-start"
        >
          <ul className="m-0 flex list-none flex-col p-0">
            {(rules.data ?? []).map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-2 border-b border-line-subtle py-2 last:border-b-0"
              >
                <button
                  type="button"
                  onClick={() => url.set({ rule: r.id })}
                  className="min-w-0 grow cursor-pointer border-none bg-transparent p-0 text-left text-[13px] text-ink hover:text-copper"
                >
                  {r.name}
                  {r.threshold !== undefined && r.metric === 'lag' && (
                    <span className="ml-1 font-mono text-[10px] text-ink-muted">
                      &gt; {formatInt(r.threshold)} ·{' '}
                      {r.durationSec >= 60 ? `${r.durationSec / 60}m` : `${r.durationSec}s`}
                    </span>
                  )}
                </button>
                {!r.enabled ? (
                  <StatusBadge status="neutral" dot={false}>
                    Off
                  </StatusBadge>
                ) : r.muted ? (
                  <StatusBadge status="neutral" dot={false}>
                    Muted
                  </StatusBadge>
                ) : r.state === 'firing' ? (
                  <StatusBadge status={SEV_TONE[r.severity]} dot={false}>
                    Firing
                  </StatusBadge>
                ) : r.state === 'pending' ? (
                  <StatusBadge status="neutral" dot={false}>
                    Pending
                  </StatusBadge>
                ) : (
                  <StatusBadge status="healthy" dot={false}>
                    OK
                  </StatusBadge>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <RuleDialog
        open={!!editing}
        rule={editing && editing !== 'new' ? ruleOf(editing) : undefined}
        onClose={() => url.set({ rule: undefined })}
      />
    </>
  );
}

function RuleDialog({
  open,
  rule,
  onClose,
}: {
  open: boolean;
  rule?: AlertRule;
  onClose: () => void;
}) {
  const { client, clusterId, info } = useKafka();
  const qc = useQueryClient();
  const toast = useToast();
  const groups = useKafkaQuery(['groups'], (c, id) => c.listGroups(id), false);
  const brokers = useKafkaQuery(['brokers'], (c, id) => c.listBrokers(id), false);
  const topics = useKafkaQuery(
    ['topics', 'names'],
    (c, id) => c.listTopics(id, { size: 500 }),
    false,
  );
  const blank: AlertRuleInput = {
    name: 'Lag too high',
    metric: 'lag',
    scope: { kind: 'any' },
    threshold: 5000,
    durationSec: 300,
    severity: 'warn',
    channels: ['in-app'],
    enabled: true,
  };
  const [r, setR] = useState<AlertRuleInput & { id?: string }>(blank);
  const [error, setError] = useState<string>();
  // the threshold as typed: invalid text is shown as an error, never silently saved as 0
  const [thresholdText, setThresholdText] = useState('5000');
  useEffect(() => {
    if (open) {
      setR(rule ? { ...rule } : blank);
      setThresholdText(String((rule ?? blank).threshold ?? 0));
      setError(undefined);
    }
  }, [open, rule?.id]);
  const meta = METRICS.find((m) => m.value === r.metric)!;
  const thresholdValue = Number(thresholdText.replace(/,/g, ''));
  const thresholdError =
    meta.unit && (!thresholdText.trim() || !Number.isFinite(thresholdValue) || thresholdValue < 0)
      ? 'Enter a number of 0 or more.'
      : undefined;
  // a metric without a threshold field (e.g. DLQ receiving) carries none, not a hidden leftover 5000
  // saved as shown: the threshold field's value for a metric that has one, none for a metric that doesn't
  const input: typeof r = meta.unit
    ? { ...r, threshold: thresholdError ? r.threshold : thresholdValue }
    : { ...r, threshold: undefined };
  const preview = useKafkaQuery(
    ['rule-preview', input.metric, JSON.stringify(input.scope), input.threshold, input.durationSec],
    (c) => c.previewAlertRule?.(input) ?? Promise.resolve({ firings: 0 }),
    false,
  );
  const target = r.scope.kind === 'specific' ? r.scope.target : undefined;
  const series = useKafkaQuery(
    ['rule-series', r.metric, target],
    async (c, id) => {
      if (r.metric !== 'lag') return [];
      const ids = target
        ? [target]
        : (await c.listGroups(id))
            .filter((g: GroupSummary) => g.type !== 'share' && g.members > 0)
            .map((g) => g.groupId);
      const all = await Promise.all(
        ids.map((g) => c.getHistory(id, { metric: 'lag', scope: 'group', key: g, range: '24h' })),
      );
      // worst group at each time
      const byT = new Map<number, number>();
      for (const s of all)
        for (const [t, v] of s[0]?.points ?? []) byT.set(t, Math.max(byT.get(t) ?? 0, v));
      return [...byT.entries()].sort((a, b) => a[0] - b[0]);
    },
    false,
  );
  const scopeOptions = useMemo(() => {
    if (meta.scope === 'group')
      return [
        { value: '', label: 'any group' },
        ...(groups.data ?? []).map((g) => ({ value: g.groupId, label: g.groupId })),
      ];
    if (meta.scope === 'topic')
      return [
        { value: '', label: 'any topic' },
        ...(topics.data?.items ?? []).map((t) => ({ value: t.name, label: t.name })),
      ];
    if (meta.scope === 'broker')
      return [
        { value: '', label: 'any broker' },
        ...(brokers.data ?? []).map((b) => ({ value: `broker-${b.id}`, label: `broker ${b.id}` })),
      ];
    return [{ value: '', label: 'the cluster' }];
  }, [meta.scope, groups.data, topics.data, brokers.data]);

  const save = async () => {
    try {
      await client.saveAlertRule(input);
      await qc.invalidateQueries({ queryKey: [clusterId, 'alert-rules'] });
      toast({ tone: 'ok', title: rule ? `Saved “${r.name}”` : `Created “${r.name}”` });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async () => {
    if (!rule) return;
    try {
      await client.deleteAlertRule(rule.id);
      toast({ tone: 'info', title: `Deleted “${rule.name}”` });
      onClose();
    } catch (e) {
      setError(`Couldn't delete the rule: ${(e as Error).message}`);
    }
    await qc.invalidateQueries({ queryKey: [clusterId, 'alert-rules'] });
  };
  const browser = r.channels.includes('browser');
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={rule ? 'Edit alert rule' : 'New alert rule'}
      description={
        info.mode === 'demo'
          ? 'Checked every second against live metrics.'
          : 'Checked on every metrics sample (every few seconds).'
      }
      className="w-[620px]"
      footer={
        <>
          {rule && (
            <Button variant="danger" onClick={remove} className="mr-auto">
              Delete rule
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={!!thresholdError}>
            {rule ? 'Save rule' : 'Create rule'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField
          label="Name"
          value={r.name}
          onChange={(e) => setR({ ...r, name: e.target.value })}
          data-autofocus
          error={error}
        />
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-1 p-0 text-[12px] font-medium text-ink-muted">When</legend>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <div className="w-[200px]">
              <Select
                label="Metric"
                hideLabel
                value={r.metric}
                onChange={(e) =>
                  setR({ ...r, metric: e.target.value as AlertMetric, scope: { kind: 'any' } })
                }
                options={METRICS.map((m) => ({ value: m.value, label: m.label }))}
              />
            </div>
            {meta.scope !== 'cluster' && (
              <>
                <span className="text-ink-muted">of</span>
                <div className="w-[160px]">
                  <Select
                    label="Scope"
                    hideLabel
                    value={target ?? ''}
                    onChange={(e) =>
                      setR({
                        ...r,
                        scope: e.target.value
                          ? { kind: 'specific', target: e.target.value }
                          : { kind: 'any' },
                      })
                    }
                    options={scopeOptions}
                    className="font-mono"
                  />
                </div>
              </>
            )}
            {meta.unit && (
              <>
                <span className="text-ink-muted">{meta.unit}</span>
                <input
                  aria-label="Threshold"
                  inputMode="numeric"
                  value={thresholdText}
                  aria-invalid={!!thresholdError}
                  aria-describedby={thresholdError ? 'ki-threshold-err' : undefined}
                  onChange={(e) => {
                    setThresholdText(e.target.value);
                    const n = Number(e.target.value.replace(/,/g, ''));
                    if (Number.isFinite(n) && n >= 0) setR({ ...r, threshold: n });
                  }}
                  className="h-control-md w-[100px] rounded-md border border-line bg-surface px-3 font-mono text-[12px] text-ink focus:border-copper aria-[invalid=true]:border-crit"
                />
                {thresholdError && (
                  <span id="ki-threshold-err" role="alert" className="text-[12px] text-crit-text">
                    {thresholdError}
                  </span>
                )}
              </>
            )}
            {r.metric === 'group-status' && (
              <span className="text-ink-muted">is Stalled or Stopped</span>
            )}
            <span className="text-ink-muted">for</span>
            <div className="w-[130px]">
              <Select
                label="Duration"
                hideLabel
                value={String(r.durationSec)}
                onChange={(e) => setR({ ...r, durationSec: Number(e.target.value) })}
                options={DURATIONS}
              />
            </div>
          </div>
        </fieldset>
        <div className="flex items-center gap-3">
          <span className="text-[12px] font-medium text-ink-muted">Severity</span>
          <SegmentedControl
            label="Severity"
            value={r.severity}
            onChange={(v) => setR({ ...r, severity: v as Severity })}
            options={[
              { value: 'info', label: 'Info' },
              { value: 'warn', label: 'Warning' },
              { value: 'crit', label: 'Critical' },
            ]}
          />
        </div>
        <div className="rounded-md bg-surface-sunken p-3">
          <div className="mb-2 flex text-[12px]">
            <span className="font-semibold">Preview · last 24 h</span>
            <span className="ml-auto text-ink-muted" role="status">
              {preview.data
                ? `Would have fired ${preview.data.firings} time${preview.data.firings === 1 ? '' : 's'}`
                : '…'}
            </span>
          </div>
          {r.metric === 'lag' && (series.data?.length ?? 0) > 1 ? (
            <TimeSeriesChart
              label="Lag over the last 24 hours with the threshold"
              height={90}
              xFormat={axisTime('24h')}
              yFormat={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)))}
              series={[
                { key: 'lag', label: 'worst group lag', points: series.data!, color: 'chart-1' },
                {
                  key: 'threshold',
                  label: 'threshold',
                  points: [
                    [series.data![0]![0], r.threshold ?? 0],
                    [series.data!.at(-1)![0], r.threshold ?? 0],
                  ],
                  color: 'warn',
                  dashed: true,
                },
              ]}
            />
          ) : (
            <p className="m-0 text-[12px] text-ink-muted">
              Replayed against the simulator&apos;s recorded history.
            </p>
          )}
        </div>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 p-0 text-[12px] font-medium text-ink-muted">Notify</legend>
          <Checkbox
            label="In the app (bell and toast)"
            checked={r.channels.includes('in-app')}
            onChange={(e) =>
              setR({
                ...r,
                channels: e.target.checked
                  ? [...r.channels, 'in-app']
                  : r.channels.filter((c) => c !== 'in-app'),
              })
            }
          />
          <Checkbox
            label="Browser notification"
            checked={browser}
            onChange={async (e) => {
              const on = e.target.checked;
              // permission is asked only on this explicit user action
              if (
                on &&
                typeof Notification !== 'undefined' &&
                Notification.permission === 'default'
              )
                await Notification.requestPermission().catch(() => 'denied');
              // functional update: edits made while the permission prompt was open are kept
              setR((cur) => ({
                ...cur,
                channels: on
                  ? [...cur.channels.filter((c) => c !== 'browser'), 'browser']
                  : cur.channels.filter((c) => c !== 'browser'),
              }));
            }}
          />
          {browser &&
            typeof Notification !== 'undefined' &&
            Notification.permission === 'denied' && (
              <p className="m-0 pl-6 text-[12px] text-warn-text">
                This browser blocks notifications for the site. Allow them in site settings.
              </p>
            )}
          <Checkbox
            label="Slack or webhook · arrives in v2 with the agent"
            disabled
            checked={false}
            onChange={() => {}}
          />
          <Checkbox
            label="Rule enabled"
            checked={r.enabled}
            onChange={(e) => setR({ ...r, enabled: e.target.checked })}
          />
          <Checkbox
            label="Muted (keeps evaluating, doesn't notify)"
            checked={!!r.muted}
            onChange={(e) => setR({ ...r, muted: e.target.checked })}
          />
        </fieldset>
      </form>
    </Dialog>
  );
}
