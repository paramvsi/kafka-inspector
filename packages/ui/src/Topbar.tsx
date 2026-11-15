import type { ReactNode } from 'react';
import { LiveIndicator } from './LiveIndicator';
import { SearchInput } from './SearchInput';
import { SegmentedControl } from './SegmentedControl';

export const TIME_RANGES = ['15m', '1h', '24h', '7d'] as const;
export type TimeRange = (typeof TIME_RANGES)[number];

export interface TopbarProps {
  cluster: string;
  parent?: string;
  crumb: string;
  range: TimeRange;
  onRange: (r: TimeRange) => void;
  live: boolean;
  onLiveToggle: () => void;
  /** Right-most slot, e.g. the settings menu. */
  actions?: ReactNode;
  /** Opens the command palette; the search field becomes its trigger. */
  onSearchOpen?: (initial?: string) => void;
}

export function Topbar({
  cluster,
  parent,
  crumb,
  range,
  onRange,
  live,
  onLiveToggle,
  actions,
  onSearchOpen,
}: TopbarProps) {
  return (
    <header className="flex h-topbar items-center gap-[14px] border-b border-line bg-surface px-6 text-[13px] text-ink">
      <nav aria-label="Breadcrumb" className="min-w-0 truncate">
        <ol className="m-0 flex list-none gap-1 p-0 text-ink-muted">
          {[cluster, parent].filter(Boolean).map((c) => (
            <li key={c} className="after:ml-1 after:text-line-strong after:content-['/']">
              {c}
            </li>
          ))}
          <li aria-current="page" className="font-semibold text-ink">
            {crumb}
          </li>
        </ol>
      </nav>
      <div className="grow" />
      <SearchInput
        readOnly={!!onSearchOpen}
        aria-haspopup={onSearchOpen ? 'dialog' : undefined}
        onClick={() => onSearchOpen?.()}
        onKeyDown={(e) => {
          if (!onSearchOpen) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSearchOpen();
          } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            onSearchOpen(e.key);
          }
        }}
      />
      <SegmentedControl
        label="Time range"
        options={[...TIME_RANGES]}
        value={range}
        onChange={(v) => onRange(v as TimeRange)}
      />
      <LiveIndicator live={live} onToggle={onLiveToggle} />
      {actions}
    </header>
  );
}
