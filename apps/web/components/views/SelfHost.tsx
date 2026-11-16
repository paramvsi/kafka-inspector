'use client';
import { Button, CopyButton, Select, TextField } from '@ki/ui';
import { strToU8, zipSync } from 'fflate';
import { useMemo, useState } from 'react';
import { useKafka } from '../../lib/kafka';
import {
  compose,
  dockerRun,
  dotenv,
  PRESETS,
  warnings,
  type SelfHostForm,
} from '../../lib/selfhost';
import { PageHeader } from '../Page';

const TABS = ['docker-compose.yml', '.env', 'docker run'] as const;

/** Run on your own Kafka (19, F-96): demo only; everything is generated in this browser. */
export function SelfHostView() {
  const { info } = useKafka();
  const [f, setF] = useState<SelfHostForm>({
    name: 'prod-us-2',
    bootstrap: 'b-1.prod-us-2:9096,b-2.prod-us-2:9096',
    security: 'SASL_SSL',
    mechanism: 'SCRAM-SHA-512',
    schemaRegistry: '',
    registryAuth: false,
    port: 8080,
  });
  const [tab, setTab] = useState<(typeof TABS)[number]>('docker-compose.yml');
  const [note, setNote] = useState<string>();
  const files = useMemo(
    () => ({ 'docker-compose.yml': compose(f), '.env': dotenv(f), 'docker run': dockerRun(f) }),
    [f],
  );
  const warn = warnings(f);
  const set = <K extends keyof SelfHostForm>(k: K, v: SelfHostForm[K]) => setF({ ...f, [k]: v });
  // the port as typed; the files use the last valid one (1–65535)
  const [portText, setPortText] = useState(String(f.port));
  const portOk = /^\d+$/.test(portText) && Number(portText) >= 1 && Number(portText) <= 65535;
  if (info.mode !== 'demo')
    return (
      <PageHeader
        title="Run on your own Kafka"
        subtitle="You're already running it. This page is part of the hosted demo."
      />
    );
  const download = () => {
    const zip = zipSync({
      'kafka-inspector/docker-compose.yml': strToU8(files['docker-compose.yml']),
      'kafka-inspector/.env': strToU8(files['.env']),
      'kafka-inspector/README.txt': strToU8(
        `Fill in .env, then run:\n\n  docker compose up -d\n\nOpen http://localhost:${f.port} and sign in as admin with KI_ADMIN_PASSWORD.\n`,
      ),
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
    a.download = 'kafka-inspector.zip';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const steps = [
    'Describe your cluster',
    'Download and fill in secrets',
    <>
      Run <code className="font-mono text-[12px]">docker compose up</code>
    </>,
  ];
  return (
    <>
      <PageHeader
        title="Run Kafka Inspector on your own Kafka"
        subtitle="Same app, on your server, reading your real cluster. Nothing you type here leaves your browser."
      />
      <ol className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-3">
        {steps.map((s, i) => (
          <li
            key={i}
            className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-[13px] ${i === 0 ? 'border-copper-soft bg-copper-soft' : 'border-line bg-surface'}`}
          >
            <span
              className={`flex size-6 items-center justify-center rounded-full font-mono text-[11px] ${i === 0 ? 'bg-copper text-copper-on' : 'border border-line-strong'}`}
            >
              {i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.15fr]">
        <form
          className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4"
          onSubmit={(e) => e.preventDefault()}
        >
          <TextField
            label="Cluster name"
            mono
            value={f.name}
            onChange={(e) => set('name', e.target.value)}
          />
          <TextField
            label="Bootstrap servers"
            mono
            value={f.bootstrap}
            onChange={(e) => set('bootstrap', e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Security"
              value={f.security}
              onChange={(e) => set('security', e.target.value as SelfHostForm['security'])}
              options={['PLAINTEXT', 'SSL', 'SASL_PLAINTEXT', 'SASL_SSL'].map((v) => ({
                value: v,
                label: v,
              }))}
            />
            <Select
              label="Mechanism"
              disabled={!f.security.startsWith('SASL')}
              value={f.mechanism}
              onChange={(e) => set('mechanism', e.target.value as SelfHostForm['mechanism'])}
              options={['PLAIN', 'SCRAM-SHA-256', 'SCRAM-SHA-512'].map((v) => ({
                value: v,
                label: v,
              }))}
            />
          </div>
          <TextField
            label={
              <>
                Schema Registry <span className="font-normal">optional</span>
              </>
            }
            mono
            value={f.schemaRegistry}
            onChange={(e) => set('schemaRegistry', e.target.value)}
            placeholder="https://schema-registry.internal"
          />
          {f.schemaRegistry && (
            <label className="inline-flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                className="size-4 accent-copper"
                checked={f.registryAuth}
                onChange={(e) => set('registryAuth', e.target.checked)}
              />
              Registry needs a username and password
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Port"
              mono
              inputMode="numeric"
              value={portText}
              error={portOk ? undefined : 'Enter a port from 1 to 65535.'}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '');
                setPortText(v);
                if (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 65535) set('port', Number(v));
              }}
            />
            <div className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-ink-muted">Access</span>
              <span className="inline-flex h-control-md items-center self-start rounded-md bg-surface-hover px-3 text-[13px] text-ink-muted">
                Read-only (v1)
              </span>
            </div>
          </div>
          <details className="text-[13px]">
            <summary className="cursor-pointer text-copper underline">
              Using Amazon MSK, Confluent Cloud or Aiven? See provider settings
            </summary>
            <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
              {Object.entries(PRESETS).map(([name, p]) => (
                <li key={name} className="flex items-start gap-3">
                  <Button
                    size="sm"
                    onClick={() => {
                      setF({ ...f, ...p });
                      setNote(p.note);
                    }}
                  >
                    {name}
                  </Button>
                  <span className="text-[12px] text-ink-muted">{p.note}</span>
                </li>
              ))}
            </ul>
          </details>
          {note && (
            <p className="m-0 text-[12px] text-ink-muted" role="status">
              {note}
            </p>
          )}
          {warn.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12px] text-warn-text">
              {warn.map((w) => (
                <li key={w}>! {w}</li>
              ))}
            </ul>
          )}
        </form>
        <section
          className="flex min-w-0 flex-col rounded-lg border border-line bg-surface"
          aria-label="Generated files"
        >
          <div
            role="tablist"
            aria-label="Files"
            className="flex gap-5 border-b border-line px-4 pt-3"
          >
            {TABS.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`-mb-px cursor-pointer border-x-0 border-t-0 border-b-2 bg-transparent pb-2 font-mono text-[12px] ${tab === t ? 'border-copper text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}
              >
                {t}
              </button>
            ))}
          </div>
          <pre
            role="tabpanel"
            tabIndex={0}
            aria-label={tab}
            className="m-0 min-h-[320px] grow overflow-auto p-4 font-mono text-[12px] leading-[19px]"
          >
            {files[tab]}
          </pre>
          <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
            <p className="m-0 grow text-[12px] text-ink-muted">
              Passwords go in <code className="font-mono">.env</code> on your server; these files
              never contain them.
            </p>
            <CopyButton text={() => files[tab]} label="Copy" />
            <Button variant="primary" onClick={download}>
              Download files
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
