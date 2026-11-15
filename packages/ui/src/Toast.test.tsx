// @vitest-environment happy-dom
import { act, fireEvent, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { ToastProvider, useToast } from './Feedback';

afterEach(() => vi.useRealTimers());

function Pusher({ at }: { at: Array<[number, string]> }) {
  const toast = useToast();
  useEffect(() => {
    const ts = at.map(([ms, title]) => setTimeout(() => toast({ tone: 'info', title }), ms));
    return () => ts.forEach(clearTimeout);
  }, [at, toast]);
  return null;
}

test('a new toast does not restart the timers of the ones already shown', () => {
  vi.useFakeTimers();
  const { queryByText } = render(
    <ToastProvider>
      <Pusher
        at={[
          [0, 'first'],
          [4000, 'second'],
        ]}
      />
    </ToastProvider>,
  );
  // step so React runs effects between pushes (one long act would defer them to its end)
  act(() => vi.advanceTimersByTime(10));
  act(() => vi.advanceTimersByTime(3990));
  act(() => vi.advanceTimersByTime(10));
  act(() => vi.advanceTimersByTime(2400)); // 6.41 s: first is gone (6 s from 0, not from 4 s)
  expect(queryByText('first')).toBeNull();
  expect(queryByText('second')).not.toBeNull();
});

test('hover holds a toast open; leaving restarts its 6 s', () => {
  vi.useFakeTimers();
  const { getByText, queryByText } = render(
    <ToastProvider>
      <Pusher at={[[0, 'held']]} />
    </ToastProvider>,
  );
  act(() => vi.advanceTimersByTime(10));
  fireEvent.mouseEnter(getByText('held').closest('.ki-toast')!);
  act(() => vi.advanceTimersByTime(20_000));
  expect(queryByText('held')).not.toBeNull();
  fireEvent.mouseLeave(getByText('held').closest('.ki-toast')!);
  act(() => vi.advanceTimersByTime(6500));
  expect(queryByText('held')).toBeNull();
});
