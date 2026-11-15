// @vitest-environment happy-dom
import { act, render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Dialog } from './Dialog';

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
