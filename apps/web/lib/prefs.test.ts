import { describe, expect, test } from 'vitest';
import { applyPrefs, prefsScript } from './prefs';

const store = (data: Record<string, string>) => (k: string) => data[k] ?? null;

describe('applyPrefs', () => {
  test('first visit follows the OS colour scheme', () => {
    const root = { dataset: {} as DOMStringMap };
    applyPrefs(root, store({}), true);
    expect(root.dataset).toEqual({ theme: 'light' });
    applyPrefs(root, store({}), false);
    expect(root.dataset.theme).toBe('dark');
  });

  test('a saved choice wins over the OS', () => {
    const root = { dataset: {} as DOMStringMap };
    applyPrefs(root, store({ 'ki-theme': 'dark', 'ki-motion': 'reduced' }), true);
    expect(root.dataset).toEqual({ theme: 'dark', motion: 'reduced' });
  });

  test('garbage in storage is ignored; motion stays unset (follow OS)', () => {
    const root = { dataset: {} as DOMStringMap };
    applyPrefs(root, store({ 'ki-theme': 'purple', 'ki-motion': 'fast' }), false);
    expect(root.dataset).toEqual({ theme: 'dark' });
  });

  test('blocked storage does not throw', () => {
    const root = { dataset: {} as DOMStringMap };
    const blocked = () => {
      throw new Error('SecurityError');
    };
    expect(() => applyPrefs(root, blocked, true)).not.toThrow();
    expect(root.dataset.theme).toBe('light');
  });
});

test('the inline <head> script is self-contained and applies the saved theme', () => {
  const documentElement = { dataset: {} as DOMStringMap };
  const run = new Function('document', 'localStorage', 'matchMedia', prefsScript);
  run({ documentElement }, { getItem: store({ 'ki-theme': 'light' }) }, () => ({ matches: false }));
  expect(documentElement.dataset.theme).toBe('light');
});
