import type { ReactNode } from 'react';
import { ChevronDownIcon } from './icons';
import { NavItem, type LinkLike } from './NavItem';

export interface NavEntry {
  key: string;
  label: string;
  href: string;
  count?: ReactNode;
  countTone?: 'default' | 'crit';
}
export interface NavSection {
  title: string;
  items: NavEntry[];
}

export interface SidebarProps {
  sections: NavSection[];
  activeKey?: string;
  mode: 'demo' | 'self';
  cluster: { name: string; status: 'connected' | 'degraded' | 'disconnected' };
  version?: string;
  onSignOut?: () => void;
  linkAs?: LinkLike;
}

const statusDot = { connected: 'bg-ok', degraded: 'bg-warn', disconnected: 'bg-crit' };
const statusWord = { connected: 'Connected', degraded: 'Degraded', disconnected: 'Disconnected' };

export function Sidebar({
  sections,
  activeKey,
  mode,
  cluster,
  version,
  onSignOut,
  linkAs,
}: SidebarProps) {
  return (
    <nav
      aria-label="Main"
      className="sticky top-0 flex h-screen w-sidebar shrink-0 flex-col gap-[2px] overflow-y-auto border-r border-line bg-bg-sidebar px-3 py-4 text-ink"
    >
      <div className="flex items-center gap-[10px] px-2 pb-[14px] pt-[2px]">
        {/* Two-colour mark: pick the file for the ground, never recolour (DESIGN_SYSTEM.md). */}
        <img
          src="/brand/kafka-inspector-icon-dark.png"
          alt=""
          width={24}
          height={24}
          className="light:hidden"
        />
        <img
          src="/brand/kafka-inspector-icon-light.png"
          alt=""
          width={24}
          height={24}
          className="hidden light:block"
        />
        <div className="text-[14px] font-semibold">Kafka Inspector</div>
      </div>

      {/* ponytail: F-02 placeholder — opens the cluster list once clusters exist (phase 2). */}
      <button
        type="button"
        className="mb-[14px] flex h-control-md cursor-pointer items-center gap-2 rounded-md border border-line bg-surface px-[10px] font-mono text-[11px] text-ink"
      >
        <span
          aria-hidden="true"
          className={`size-[7px] rounded-full ${statusDot[cluster.status]}`}
        />
        {cluster.name}
        <span className="sr-only">, {statusWord[cluster.status]}</span>
        <span className="grow" />
        <span className="text-ink-muted">
          <ChevronDownIcon />
        </span>
      </button>

      {sections.map((s, i) => (
        <div key={s.title} className="flex flex-col gap-[2px]">
          <div
            className={`px-[10px] py-[6px] text-[11px] font-medium uppercase leading-4 tracking-[0.06em] text-ink-subtle ${i ? 'mt-[10px]' : ''}`}
          >
            {s.title}
          </div>
          {s.items.map((it) => (
            <NavItem
              key={it.key}
              label={it.label}
              href={it.href}
              count={it.count}
              countTone={it.countTone}
              active={it.key === activeKey}
              as={linkAs}
            />
          ))}
        </div>
      ))}

      <div className="grow" />

      {mode === 'demo' ? (
        <div className="rounded-md border border-dashed border-line-strong px-3 py-[10px] text-[12px] leading-4 text-ink-muted">
          <div className="mb-[2px] font-semibold text-ink">Simulated cluster</div>
          Data is generated in your browser. Run it on your own Kafka from the link above.
        </div>
      ) : (
        <div className="flex flex-col gap-[6px] border-t border-line px-2 pt-3 text-[12px] text-ink-muted">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-[22px] items-center rounded-sm bg-surface-hover px-2 text-[12px] font-medium text-ink-muted">
              Read-only
            </span>
            {version && <span className="font-mono text-[10px]">v{version}</span>}
          </div>
          <div className="flex items-center">
            <span>
              Signed in as <span className="text-ink">admin</span>
            </span>
            <span className="grow" />
            <button
              type="button"
              onClick={onSignOut}
              className="cursor-pointer border-none bg-transparent p-0 text-[12px] text-copper hover:text-copper-strong"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
