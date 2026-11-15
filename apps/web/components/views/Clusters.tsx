'use client';
import {
  Button,
  Checkbox,
  DataTable,
  Dialog,
  SegmentedControl,
  StatusBadge,
  TextField,
  useToast,
} from '@ki/ui';
import { useState } from 'react';
import { useKafka } from '../../lib/kafka';
import { useSavedClusters, type SavedCluster } from '../../lib/clusters';
import { useUrl } from '../../lib/url';
import { PageHeader } from '../Page';

type Row = {
  id: string;
  name: string;
  color: string;
  mode: string;
  target: string;
  status: 'connected' | 'degraded' | 'disconnected' | 'saved';
  readOnly: boolean;
  saved?: SavedCluster;
};
const STATUS = {
  connected: 'healthy',
  degraded: 'warn',
  disconnected: 'stopped',
  saved: 'neutral',
} as const;
const WORD = {
  connected: 'Connected',
  degraded: 'Degraded',
  disconnected: 'Disconnected',
  saved: 'Saved',
};

export function ClustersView() {
  const url = useUrl();
  const { info } = useKafka();
  const [saved, setSaved] = useSavedClusters();
  const demo = info.mode === 'demo';
  const rows: Row[] = [
    ...info.clusters.map((c) => ({
      id: c.id,
      name: c.name,
      color: 'chart-1',
      mode: c.simulated ? 'Simulated (in this browser)' : 'Agent',
      target: c.simulated ? 'Web Worker' : `${c.brokers} brokers · Kafka ${c.kafkaVersion}`,
      status: c.status,
      readOnly: info.readOnly,
    })),
    ...(demo
      ? saved.map((s) => ({
          id: s.id,
          name: s.name,
          color: s.color,
          mode: s.mode === 'local-agent' ? 'Local agent' : 'Simulated',
          target: s.url ?? `seed ${s.seed}`,
          status: 'saved' as const,
          readOnly: s.readOnly,
          saved: s,
        }))
      : []),
  ];
  return (
    <>
      <PageHeader
        title="Clusters"
        subtitle={
          demo
            ? 'Saved connections live in this browser. Passwords are never stored.'
            : 'Clusters come from the agent configuration. Edit KI_CLUSTERS_* (or kafka-inspector.yml) and restart the agent to change them.'
        }
        actions={
          demo && (
            <Button variant="primary" onClick={() => url.set({ add: 1 })}>
              Add cluster
            </Button>
          )
        }
      />
      <DataTable
        caption="Clusters"
        rows={rows}
        rowKey={(r) => r.id}
        columns={[
          {
            key: 'n',
            header: 'Name',
            cell: (r) => (
              <span className="flex items-center gap-2 font-mono text-[12px]">
                <span
                  aria-hidden="true"
                  className="size-[10px] rounded-sm"
                  style={{ background: `var(--${r.color})` }}
                />
                {r.name}
              </span>
            ),
          },
          { key: 'm', header: 'Connect with', kind: 'dim', cell: (r) => r.mode },
          { key: 't', header: 'Target', kind: 'id', cell: (r) => r.target },
          {
            key: 'a',
            header: 'Access',
            cell: (r) => (
              <StatusBadge status="neutral" dot={false}>
                {r.readOnly ? 'Read-only' : 'Read and write (demo)'}
              </StatusBadge>
            ),
          },
          {
            key: 's',
            header: 'Status',
            cell: (r) => <StatusBadge status={STATUS[r.status]}>{WORD[r.status]}</StatusBadge>,
          },
          {
            key: 'x',
            header: <span className="sr-only">Actions</span>,
            cell: (r) =>
              r.saved ? (
                <span className="flex justify-end gap-2">
                  {r.saved.url && (
                    <Button
                      size="sm"
                      onClick={() =>
                        window.open(
                          `${r.saved!.url!.replace(/\/$/, '')}/app/`,
                          '_blank',
                          'noopener',
                        )
                      }
                    >
                      Open
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSaved(saved.filter((x) => x.id !== r.id))}
                  >
                    Remove
                  </Button>
                </span>
              ) : null,
          },
        ]}
      />
      {demo && (
        <AddClusterDialog
          open={url.get('add') === '1'}
          onClose={() => url.set({ add: undefined })}
          onSave={(c) => setSaved([...saved, c])}
        />
      )}
    </>
  );
}

type Step = {
  label: string;
  state: 'Pass' | 'Fail' | 'Skipped' | 'Running';
  detail?: React.ReactNode;
};

function AddClusterDialog({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (c: SavedCluster) => void;
}) {
  const toast = useToast();
  const { client } = useKafka();
  const [name, setName] = useState('');
  const [color, setColor] = useState<SavedCluster['color']>('chart-2');
  const [mode, setMode] = useState<'local-agent' | 'simulated' | 'rest-proxy'>('local-agent');
  const [agent, setAgent] = useState('http://localhost:8080');
  const [seed, setSeed] = useState('kafka-43');
  const [steps, setSteps] = useState<Step[]>([]);

  const test = async (): Promise<boolean> => {
    if (mode === 'simulated') {
      setSteps([
        { label: 'Simulator available', state: 'Pass', detail: 'Runs in a Web Worker in this tab' },
        { label: 'Brokers reachable', state: 'Pass', detail: '3 of 3 (simulated)' },
        { label: 'Authentication', state: 'Pass', detail: 'Not required' },
        { label: 'Read cluster metadata', state: 'Pass' },
        { label: 'Check permissions (describe, read)', state: 'Pass' },
      ]);
      return true;
    }
    setSteps([{ label: 'Agent reachable', state: 'Running' }]);
    const t0 = performance.now();
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 3000);
      await fetch(`${agent.replace(/\/$/, '')}/api/health`, {
        mode: 'no-cors',
        signal: ctl.signal,
      });
      clearTimeout(timer);
      const ms = Math.round(performance.now() - t0);
      setSteps([
        { label: 'Agent reachable', state: 'Pass', detail: `${agent} · ${ms} ms` },
        ...[
          'Brokers reachable',
          'Authentication',
          'Read cluster metadata',
          'Check permissions (describe, read)',
        ].map((label) => ({
          label,
          state: 'Skipped' as const,
          detail: 'The agent checks these with its own credentials. Open it to see the result.',
        })),
      ]);
      return true;
    } catch {
      setSteps([
        {
          label: 'Agent reachable',
          state: 'Fail',
          detail: (
            <>
              Couldn&apos;t reach <code className="font-mono">{agent}</code>. Is the agent running?
              Start it with the command from{' '}
              <a className="text-copper underline" href="/app/self-host/">
                Run on your Kafka
              </a>
              , then test again.
            </>
          ),
        },
        ...[
          'Brokers reachable',
          'Authentication',
          'Read cluster metadata',
          'Check permissions (describe, read)',
        ].map((label) => ({ label, state: 'Skipped' as const })),
      ]);
      return false;
    }
  };

  const save = async (connect: boolean) => {
    const c: SavedCluster = {
      id: `c_${Date.now()}`,
      name: name || (mode === 'simulated' ? `sim-${seed}` : 'local-agent'),
      color,
      mode: mode === 'simulated' ? 'simulated' : 'local-agent',
      url: mode === 'local-agent' ? agent : undefined,
      seed: mode === 'simulated' ? seed : undefined,
      readOnly: mode !== 'simulated',
    };
    if (connect && !(await test())) return;
    onSave(c);
    onClose();
    if (connect && mode === 'local-agent')
      window.open(`${agent.replace(/\/$/, '')}/app/`, '_blank', 'noopener');
    if (connect && mode === 'simulated') {
      await client.chaos?.settings({ seed });
      toast({ tone: 'info', title: `Simulated cluster reseeded with ${seed}` });
    } else toast({ tone: 'ok', title: `Saved ${c.name}` });
  };

  const BADGE = {
    Pass: 'healthy',
    Fail: 'stalled',
    Skipped: 'neutral',
    Running: 'neutral',
  } as const;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add cluster"
      className="w-[840px]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save(false)} disabled={mode === 'rest-proxy'}>
            Save without connecting
          </Button>
          <Button variant="primary" onClick={() => save(true)} disabled={mode === 'rest-proxy'}>
            Save and connect
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[1fr_300px] gap-6">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[1fr_auto] items-end gap-4">
            <TextField
              label="Name"
              mono
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="prod-us-2"
              data-autofocus
            />
            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-1 p-0 text-[12px] font-medium text-ink-muted">Colour</legend>
              <div className="flex h-control-md items-center gap-2">
                {(['chart-1', 'chart-2', 'chart-3'] as const).map((c) => (
                  <label key={c} className="cursor-pointer">
                    <input
                      type="radio"
                      name="colour"
                      className="sr-only"
                      checked={color === c}
                      onChange={() => setColor(c)}
                      aria-label={
                        c === 'chart-1' ? 'Copper' : c === 'chart-2' ? 'Verdigris' : 'Grey'
                      }
                    />
                    <span
                      aria-hidden="true"
                      className={`block size-5 rounded-sm ${color === c ? 'outline outline-2 outline-offset-2 outline-focus' : ''}`}
                      style={{ background: `var(--${c})` }}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <div>
            <div className="mb-1 text-[12px] font-medium text-ink-muted">Connect with</div>
            <SegmentedControl
              label="Connect with"
              value={mode}
              onChange={(v) => {
                setMode(v as typeof mode);
                setSteps([]);
              }}
              options={[
                { value: 'simulated', label: 'Simulated' },
                { value: 'rest-proxy', label: 'REST proxy' },
                { value: 'local-agent', label: 'Local agent' },
              ]}
            />
          </div>
          {mode === 'local-agent' && (
            <>
              <TextField
                label="Agent URL"
                mono
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                hint="The self-hosted agent serves this UI and talks to your Kafka. Bootstrap servers, SASL and TLS are set in its environment, never in the browser."
              />
              <Checkbox label="Read-only (always, in this version)" checked readOnly disabled />
            </>
          )}
          {mode === 'simulated' && (
            <TextField
              label="Seed"
              mono
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              hint="Reseeds the simulated cluster in this browser: same shape, different data."
            />
          )}
          {mode === 'rest-proxy' && (
            <p className="m-0 rounded-md bg-surface-sunken p-3 text-[13px] text-ink-muted">
              Connecting through Confluent REST Proxy or Redpanda HTTP Proxy arrives in v2. Use a
              local agent for real clusters today.
            </p>
          )}
        </div>
        <section
          className="flex flex-col gap-3 border-l border-line-subtle pl-6"
          aria-live="polite"
        >
          <h3 className="m-0 text-[13px] font-semibold">Test connection</h3>
          {steps.length === 0 && (
            <p className="m-0 text-[12px] text-ink-muted">
              Checks run in order: reachable → brokers → authentication → metadata → permissions.
            </p>
          )}
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {steps.map((s) => (
              <li key={s.label} className="flex gap-3 text-[13px]">
                <StatusBadge status={BADGE[s.state]} dot={false} className="shrink-0">
                  {s.state}
                </StatusBadge>
                <div>
                  <div
                    className={
                      s.state === 'Fail'
                        ? 'font-semibold text-crit-text'
                        : s.state === 'Skipped'
                          ? 'text-ink-muted'
                          : ''
                    }
                  >
                    {s.label}
                  </div>
                  {s.detail && <div className="text-[12px] text-ink-muted">{s.detail}</div>}
                </div>
              </li>
            ))}
          </ol>
          <div className="grow" />
          <Button onClick={test} disabled={mode === 'rest-proxy'}>
            {steps.length ? 'Test again' : 'Test connection'}
          </Button>
        </section>
      </div>
    </Dialog>
  );
}
