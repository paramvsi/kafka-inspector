'use client';
import { Sidebar, Topbar, type TimeRange } from '@ki/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { locate, navFor, type Mode } from '../lib/nav';
import { SettingsMenu } from './SettingsMenu';

// ponytail: phase 0 constants — mode comes from the client picker and the cluster from KafkaClient in phase 1.
const MODE: Mode = 'demo';
const CLUSTER = { name: 'prod-eu-1', status: 'connected' as const };

export function Shell({ children }: { children: ReactNode }) {
  const loc = locate(usePathname());
  // ponytail: local state for now; moves to the URL (F-04) and Zustand in phase 3.
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
        sections={navFor(MODE)}
        activeKey={loc.active}
        mode={MODE}
        cluster={CLUSTER}
        linkAs={Link}
      />
      <div className="flex min-w-0 grow flex-col">
        <Topbar
          cluster={CLUSTER.name}
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
