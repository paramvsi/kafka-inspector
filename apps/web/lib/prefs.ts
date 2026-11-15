// Theme (F-05) and motion (F-08, docs/MOTION.md) preferences, applied before first paint.
export type Theme = 'dark' | 'light';
export type MotionPref = 'reduced' | 'full'; // absent = follow the OS

const THEME_KEY = 'ki-theme';
const MOTION_KEY = 'ki-motion';

/** Runs inline in <head> (via prefsScript) — must stay self-contained: no imports, no outer references. */
export function applyPrefs(
  root: { dataset: DOMStringMap },
  read: (key: string) => string | null,
  prefersLight: boolean,
): void {
  let theme: string | null = null;
  let motion: string | null = null;
  try {
    theme = read('ki-theme');
    motion = read('ki-motion');
  } catch {
    // storage blocked (private mode, disabled cookies): fall back to the OS
  }
  root.dataset.theme =
    theme === 'light' || theme === 'dark' ? theme : prefersLight ? 'light' : 'dark';
  if (motion === 'reduced' || motion === 'full') root.dataset.motion = motion;
}

export const prefsScript = `(${applyPrefs.toString()})(document.documentElement,function(k){return localStorage.getItem(k)},matchMedia('(prefers-color-scheme: light)').matches)`;

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not persisted; the choice still applies for this page view
  }
}

/** Token duration in ms, e.g. --dur-fast → 150. */
function tokenMs(name: string): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
}

export function setTheme(theme: Theme): void {
  const root = document.documentElement;
  // Cross-fade colours on user toggle only, never on load (MOTION.md "Theme toggle").
  root.classList.add('theme-switching');
  root.dataset.theme = theme;
  save(THEME_KEY, theme);
  window.setTimeout(() => root.classList.remove('theme-switching'), tokenMs('--dur-fast'));
}

export function setReducedMotion(reduced: boolean): void {
  const value: MotionPref = reduced ? 'reduced' : 'full';
  document.documentElement.dataset.motion = value;
  save(MOTION_KEY, value);
}

export function isReducedMotion(): boolean {
  const m = document.documentElement.dataset.motion;
  return m ? m === 'reduced' : matchMedia('(prefers-reduced-motion: reduce)').matches;
}
