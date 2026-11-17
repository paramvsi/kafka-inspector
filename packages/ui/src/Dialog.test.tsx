// @vitest-environment happy-dom
import { act, render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Dialog, Drawer } from './Dialog';

afterEach(() => vi.useRealTimers());

test('content stays during the exit transition, then unmounts', () => {
  vi.useFakeTimers();
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  const view = (open: boolean) => (
    <Dialog open={open} onClose={() => {}} title="T">
      <p>body text</p>
    </Dialog>
  );
  const { rerender, queryByText } = render(view(true));
  expect(queryByText('body text')).not.toBeNull();
  rerender(view(false));
  expect(queryByText('body text')).not.toBeNull(); // still there while it fades
  act(() => vi.advanceTimersByTime(450));
  expect(queryByText('body text')).toBeNull();
});

test('a dialog and a drawer announce their description on open (aria-describedby)', () => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  for (const C of [Dialog, Drawer]) {
    const { container, unmount } = render(
      <C
        open
        onClose={() => {}}
        title="Broker 1 · all settings"
        description="Read-only. Editing arrives in v2."
      >
        <p>body</p>
      </C>,
    );
    const d = container.querySelector('dialog')!;
    const ref = d.getAttribute('aria-describedby');
    expect(ref).toBeTruthy();
    expect(container.ownerDocument.getElementById(ref!)?.textContent).toBe(
      'Read-only. Editing arrives in v2.',
    );
    unmount();
  }
});
