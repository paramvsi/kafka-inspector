import { afterEach, expect, test, vi } from 'vitest';
import { focusAfterClose, keepFocus } from './focus';

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

test('focusAfterClose waits for the dialog to close, then moves focus even though nothing is lost yet', () => {
  const focus = vi.fn();
  let open = true;
  vi.stubGlobal('document', {
    activeElement: { isConnected: true, disabled: false, closest: () => null }, // the row, still there
    querySelector: (sel: string) => (sel === 'dialog[open]' && open ? {} : null),
    getElementById: () => ({ focus }),
  });
  vi.stubGlobal('performance', { now: () => 0 });
  const frames: Array<() => void> = [];
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
  focusAfterClose();
  frames.shift()!(); // dialog still closing
  expect(focus).not.toHaveBeenCalled();
  open = false;
  frames.shift()!();
  expect(focus).toHaveBeenCalledTimes(1);
});
