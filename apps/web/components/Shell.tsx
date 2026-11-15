'use client';
import type { Overview } from '@ki/core';
import { Sidebar, Topbar, type TimeRange } from '@ki/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { KafkaProvider, useBoot, useKafka, useStream } from '../lib/kafka';
import { locate, navFor, type Mode } from '../lib/nav';
import { SettingsMenu } from './SettingsMenu';

export function Shell({ children }: { children: ReactNode }) {
  const boot = useBoot();
  if (boot.state === 'ready') {
    return (
      <KafkaProvider ctx={boot.ctx}>
        <Chrome>{children}</Chrome>
      </KafkaProvider>
    );
  }
  return (
    <Frame mode="demo" cluster={{ name: '…', status: 'connected' }}>
      <div role="status" className="text-ink-muted">
        {boot.state === 'failed'
          ? `Couldn't start: ${boot.error}. Reload the page to try again.`
          : `${boot.step}…`}
      </div>
    </Frame>
  );
}

function Chrome({ children }: { children: ReactNode }) {
  const { info } = useKafka();
  const overview = useStream<Overview>('metrics');
  const mode: Mode = info.mode === 'demo' ? 'demo' : 'self';
  const cluster = overview?.cluster ?? info.clusters[0]!;
  const counts = overview
    ? {
        brokers: overview.kpis.brokersTotal,
        topics: overview.kpis.topics,
        groups: overview.kpis.groups,
        alerts: overview.kpis.activeAlerts,
      }
    : undefined;
  return (
    <Frame mode={mode} cluster={cluster} counts={counts} version={info.version}>
      {children}
    </Frame>
  );
}

function Frame({
  mode,
  cluster,
  counts,
  version,
  children,
}: {
  mode: Mode;
  cluster: { name: string; status: 'connected' | 'degraded' | 'disconnected' };
  counts?: { brokers: number; topics: number; groups: number; alerts: number };
  version?: string;
  children: ReactNode;
}) {
  const loc = locate(usePathname());
  // ponytail: local state for now; moves to the URL (F-04) in phase 3.
  const [range, setRange] = useState<TimeRange>('1h');
  const [live, setLive] = useState(true);
  return (
    <div className="flex min-h-screen bg-bg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-10 focus:rounded-md focus:bg-surface focus:p-2"
      >
        Skip to content
      </a>
      <Sidebar
        sections={navFor(mode, counts)}
        activeKey={loc.active}
        mode={mode}
        cluster={cluster}
        version={version}
        linkAs={Link}
      />
      <div className="flex min-w-0 grow flex-col">
        <Topbar
          cluster={cluster.name}
          parent={loc.parent}
          crumb={loc.crumb}
          range={range}
          onRange={setRange}
          live={live}
          onLiveToggle={() => setLive((l) => !l)}
          actions={<SettingsMenu />}
        />
        <main id="main" className="flex flex-col gap-4 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
