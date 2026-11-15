'use client';
import { SegmentedControl, SettingsIcon } from '@ki/ui';
import { useEffect, useState } from 'react';
import { isReducedMotion, setReducedMotion, setTheme, type Theme } from '../lib/prefs';

/** Settings popover: theme (F-05) and reduce motion (F-08). Native [popover] gives Esc, light dismiss and focus return. */
export function SettingsMenu() {
  const [theme, setThemeState] = useState<Theme>('dark');
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    // Read what the <head> script applied; done after mount to keep server and client HTML identical.
    setThemeState(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
    setReduced(isReducedMotion());
  }, []);

  return (
    <>
      <button
        type="button"
        popoverTarget="ki-settings"
        aria-label="Settings"
        className="flex size-control-md cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-ink-muted transition-colors duration-instant ease-standard hover:bg-surface-hover hover:text-ink"
      >
        <SettingsIcon />
      </button>
      <div
        id="ki-settings"
        popover="auto"
        role="dialog"
        aria-label="Settings"
        className="ki-popover w-[240px] rounded-lg border border-line bg-surface p-4 text-[13px] text-ink [box-shadow:var(--shadow-popover)]"
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span id="ki-theme-label">Theme</span>
            <SegmentedControl
              label="Theme"
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
              ]}
              value={theme}
              onChange={(v) => {
                setTheme(v as Theme);
                setThemeState(v as Theme);
              }}
            />
          </div>
          <label className="flex cursor-pointer items-center justify-between gap-3">
            Reduce motion
            <input
              type="checkbox"
              checked={reduced}
              onChange={(e) => {
                setReducedMotion(e.target.checked);
                setReduced(e.target.checked);
              }}
              className="size-4 cursor-pointer accent-copper"
            />
          </label>
        </div>
      </div>
    </>
  );
}
