import { afterEach, expect, test, vi } from 'vitest';
import { keepFocus } from './focus';

afterEach(() => vi.unstubAllGlobals());

test('focus left inside a closed dialog counts as lost (the message drawer stays in the DOM after closing)', () => {
  const focus = vi.fn();
  const fallback = { focus } as unknown as HTMLElement;
  const closeButton = {
    isConnected: true,
    disabled: false,
    closest: (sel: string) => (sel === 'dialog:not([open])' ? {} : null),
  };
  vi.stubGlobal('document', { activeElement: closeButton, body: {} });
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => cb());
  keepFocus(fallback);
  expect(focus).toHaveBeenCalled();
});

test('focus on a live control is left alone', () => {
  const focus = vi.fn();
  vi.stubGlobal('document', {
    activeElement: { isConnected: true, disabled: false, closest: () => null },
    body: {},
  });
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => cb());
  keepFocus({ focus } as unknown as HTMLElement);
  expect(focus).not.toHaveBeenCalled();
});

test('with a watch window, focus lost a few frames later is still caught', () => {
  const focus = vi.fn();
  const row = { isConnected: true, disabled: false, closest: () => null };
  const doc = { activeElement: row as unknown, body: {}, getElementById: () => ({ focus }) };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('performance', { now: () => 0 });
  const frames: Array<() => void> = [];
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
  keepFocus(undefined, 2000);
  frames.shift()!(); // frame 1: still on the row
  frames.shift()!(); // frame 2: still on the row
  row.isConnected = false; // the refresh removes the row
  frames.shift()!();
  expect(focus).toHaveBeenCalledTimes(1);
});
