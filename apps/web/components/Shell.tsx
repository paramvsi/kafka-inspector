'use client';
import type { ConnectionState, Overview } from '@ki/core';
import { Sidebar, Skeleton, ToastProvider, Topbar } from '@ki/ui';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { AlertWatcher, Bell } from './AlertWatcher';
import { GuidedTour } from './Tour';
import { CommandPalette } from './CommandPalette';
import { ShortcutSheet, useShortcuts } from './Shortcuts';
import { useSavedClusters } from '../lib/clusters';
import { AppStateProvider, useApp } from '../lib/app';
import { KafkaProvider, useBoot, useKafkaMaybe, useStream, type Boot } from '../lib/kafka';
import { locate, navFor, type Mode } from '../lib/nav';
import { DisconnectedBanner } from './Disconnected';
import { SettingsMenu } from './SettingsMenu';

export function Shell({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <AppStateProvider>
        <ToastProvider>
          <Booted>{children}</Booted>
        </ToastProvider>
      </AppStateProvider>
    </Suspense>
  );
}

// One tree before and after boot: Frame (sidebar, top bar, settings menu) keeps its identity, so a menu
// opened while the cluster starts stays open when the live data arrives.
function Booted({ children }: { children: ReactNode }) {
  const boot = useBoot();
  return (
    <KafkaProvider ctx={boot.state === 'ready' ? boot.ctx : null}>
      <Chrome boot={boot}>{children}</Chrome>
    </KafkaProvider>
  );
}

export function BootStatus({ text, failed }: { text: string; failed?: boolean }) {
  return (
    <div role="status" className="flex items-center gap-3 text-[13px] text-ink-muted">
      {!failed && (
        <span
          aria-hidden="true"
          className="ki-spinner size-4 rounded-full border-2 border-line border-t-copper"
        />
      )}
      {text}
    </div>
  );
}

/** Skeleton shaped like the Overview (01b). */
export function PageSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      <div className="grid grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-line bg-surface p-4">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-4 h-6 w-36" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[2fr_1fr] gap-4">
        <div className="rounded-lg border border-line bg-surface p-4">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-4 h-[170px] w-full" />
        </div>
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      </div>
      <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4">
        {[90, 70, 76, 62].map((w) => (
          <Skeleton key={w} className="h-3" />
        ))}
      </div>
    </div>
  );
}

const ConnectionCtx = createContext<ConnectionState>({ state: 'connected' });
/** Live-data connection (agent WebSocket). `?preview=disconnected` simulates a lost connection on the demo. */
export function useConnection(): ConnectionState {
  const real = useContext(ConnectionCtx);
  const { preview } = useApp();
  return preview === 'disconnected'
    ? {
        state: 'reconnecting',
        since: Date.now() - 23_000,
        attempt: 3,
        maxAttempts: 10,
        nextAt: Date.now() + 5000,
      }
    : real;
}

function Chrome({ children, boot }: { children: ReactNode; boot: Boot }) {
  const client = useKafkaMaybe()?.client;
  const [real, setReal] = useState<ConnectionState>({ state: 'connected' });
  useEffect(() => client?.onConnection?.(setReal), [client]);
  return (
    <ConnectionCtx.Provider value={real}>
      <ChromeInner boot={boot}>{children}</ChromeInner>
    </ConnectionCtx.Provider>
  );
}

function ChromeInner({ children, boot }: { children: ReactNode; boot: Boot }) {
  const k = useKafkaMaybe();
  const { preview } = useApp();
  const connection = useConnection();
  const lost = connection.state === 'reconnecting';
  const overview = useStream<Overview>('metrics');
  const [palette, setPalette] = useState<{ open: boolean; initial?: string }>({ open: false });
  const openPalette = useCallback((initial?: string) => setPalette({ open: true, initial }), []);
  const { sheet, closeSheet } = useShortcuts(openPalette);
  const [saved] = useSavedClusters();
  if (!k || boot.state !== 'ready') {
    return (
      // the cluster isn't known yet (demo or agent): no name, no "connected" claim
      <Frame mode="demo" cluster={{ name: 'Connecting…', status: 'degraded' }}>
        <BootStatus
          text={
            boot.state === 'failed'
              ? `Couldn't start: ${boot.error}. Reload the page to try again.`
              : boot.state === 'connecting'
                ? `${boot.step}…`
                : 'Starting…'
          }
          failed={boot.state === 'failed'}
        />
        <PageSkeleton />
      </Frame>
    );
  }
  const { info, client } = k;
  // ?preview=readonly shows the self-hosted chrome (Read-only badge, no demo-only pages)
  const mode: Mode = info.mode === 'demo' && preview !== 'readonly' ? 'demo' : 'self';
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
    <Frame
      mode={mode}
      cluster={lost ? { ...cluster, status: 'disconnected' } : cluster}
      onSignOut={
        client.signOut
          ? () => client.signOut!().finally(() => location.assign('/app/sign-in/'))
          : undefined
      }
      counts={counts}
      version={info.version}
      onSearchOpen={openPalette}
      bell={<Bell />}
      clusterMenu={
        <ClusterMenu clusters={info.clusters} saved={info.mode === 'demo' ? saved : []} />
      }
    >
      {lost && <DisconnectedBanner cluster={cluster.name} connection={connection} />}
      {children}
      <AlertWatcher />
      {info.mode === 'demo' && <GuidedTour />}
      <CommandPalette
        open={palette.open}
        initial={palette.initial}
        onClose={() => setPalette({ open: false })}
      />
      <ShortcutSheet open={sheet} onClose={closeSheet} />
    </Frame>
  );
}

function Frame({
  mode,
  cluster,
  counts,
  version,
  children,
  onSearchOpen,
  clusterMenu,
  bell,
  onSignOut,
}: {
  bell?: ReactNode;
  onSignOut?: () => void;
  mode: Mode;
  cluster: { name: string; status: 'connected' | 'degraded' | 'disconnected' };
  counts?: { brokers: number; topics: number; groups: number; alerts: number };
  version?: string;
  children: ReactNode;
  onSearchOpen?: (initial?: string) => void;
  clusterMenu?: ReactNode;
}) {
  const loc = locate(usePathname());
  const params = useSearchParams();
  // Detail pages show the item itself as the last crumb: Topics / orders
  const item = params.get('name') ?? params.get('id') ?? params.get('subject');
  const crumb = loc.parent && item ? item : loc.crumb;
  const { range, setRange, live, setLive, preview } = useApp();
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
        clusterMenu={clusterMenu}
        onSignOut={onSignOut}
      />
      <div className="flex min-w-0 grow flex-col">
        <Topbar
          cluster={cluster.name}
          parent={loc.parent}
          crumb={crumb}
          range={range}
          onRange={setRange}
          live={live && preview !== 'disconnected' && cluster.status !== 'disconnected'}
          onLiveToggle={() => setLive(!live)}
          actions={
            <>
              {bell}
              <SettingsMenu />
            </>
          }
          onSearchOpen={onSearchOpen}
        />
        <main id="main" className="flex min-w-0 flex-col gap-4 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

function ClusterMenu({
  clusters,
  saved,
}: {
  clusters: Array<{ id: string; name: string; status: 'connected' | 'degraded' | 'disconnected' }>;
  saved: Array<{ id: string; name: string; url?: string }>;
}) {
  const DOT = { connected: 'bg-ok', degraded: 'bg-warn', disconnected: 'bg-crit' };
  // switching keeps the section, not the detail page: a topic or group may not exist on the other cluster
  const section = (usePathname() ?? '/app/').replace(/^(\/app\/[^/]+\/).*$/, '$1');
  const WORD = { connected: 'Connected', degraded: 'Degraded', disconnected: 'Disconnected' };
  return (
    <div className="flex flex-col">
      <div className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-muted">
        Clusters
      </div>
      {clusters.map((c) => (
        <a
          key={c.id}
          href={`${section}?c=${encodeURIComponent(c.id)}`}
          className="flex items-center gap-2 rounded-md px-2 py-2 font-mono text-[12px] text-ink no-underline hover:bg-surface-hover"
        >
          <span aria-hidden="true" className={`size-[7px] rounded-full ${DOT[c.status]}`} />
          {c.name}
          <span className="ml-auto font-sans text-[11px] text-ink-muted">{WORD[c.status]}</span>
        </a>
      ))}
      {saved.map((c) => (
        <a
          key={c.id}
          href={c.url ? `${c.url.replace(/\/$/, '')}/app/` : '/app/clusters/'}
          target={c.url ? '_blank' : undefined}
          rel="noopener"
          className="flex items-center gap-2 rounded-md px-2 py-2 font-mono text-[12px] text-ink no-underline hover:bg-surface-hover"
        >
          <span aria-hidden="true" className="size-[7px] rounded-full bg-line-strong" />
          {c.name}
          <span className="ml-auto font-sans text-[11px] text-ink-muted">Saved</span>
        </a>
      ))}
      <Link
        href="/app/clusters/"
        className="mt-1 border-t border-line-subtle px-2 pt-2 text-[12px] text-copper no-underline hover:underline"
      >
        Manage clusters
      </Link>
    </div>
  );
}
