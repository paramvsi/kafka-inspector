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
      // the visible word changes with the state, so no aria-pressed ("Paused, not pressed" read as nonsense):
      // the name is the state, then what a click does
      aria-label={live ? 'Live. Pause live updates' : 'Paused. Resume live updates'}
      title={live ? 'Pause live updates' : 'Resume live updates'}
      className={cx(
        'flex h-control-sm cursor-pointer items-center gap-[6px] rounded-md border-none bg-transparent px-2 text-[12px] font-medium hover:bg-surface-hover',
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
