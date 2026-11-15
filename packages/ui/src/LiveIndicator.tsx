import { cx } from './cx';

export interface LiveIndicatorProps {
  live: boolean;
  onToggle: () => void;
}

/** Live dot pulses (MOTION.md "Live data"); static when paused or under reduced motion. */
export function LiveIndicator({ live, onToggle }: LiveIndicatorProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={live ? 'Pause live updates' : 'Resume live updates'}
      className={cx(
        'flex cursor-pointer items-center gap-[6px] rounded-md border-none bg-transparent px-1 text-[12px] font-medium',
        live ? 'text-ok-text' : 'text-ink-muted',
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          'size-[7px] rounded-full',
          live ? 'animate-live-pulse bg-ok motion-off:animate-none' : 'bg-ink-muted',
        )}
      />
      {live ? 'Live' : 'Paused'}
    </button>
  );
}
