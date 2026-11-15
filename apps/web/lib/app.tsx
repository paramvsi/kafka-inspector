'use client';
// App-wide view state: live/paused, time range, preview states, connection.
import type { TimeRange } from '@ki/core';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { useUrl } from './url';

export type Preview = 'loading' | 'disconnected' | 'readonly' | undefined;

interface AppState {
  live: boolean;
  setLive: (v: boolean) => void;
  range: TimeRange;
  setRange: (r: TimeRange) => void;
  /** ?preview= shows designed states on the demo (documented in README) */
  preview: Preview;
}

const Ctx = createContext<AppState>({
  live: true,
  setLive: () => {},
  range: '1h',
  setRange: () => {},
  preview: undefined,
});
export const useApp = () => useContext(Ctx);

const RANGES: TimeRange[] = ['15m', '1h', '24h', '7d'];

export function AppStateProvider({ children }: { children: ReactNode }) {
  const url = useUrl();
  const [live, setLive] = useState(true);
  const r = url.get('range') as TimeRange | undefined;
  const range = r && RANGES.includes(r) ? r : '1h';
  const p = url.get('preview');
  const preview = p === 'loading' || p === 'disconnected' || p === 'readonly' ? p : undefined;
  return (
    <Ctx.Provider
      value={{
        live,
        setLive,
        range,
        setRange: (x) => url.set({ range: x === '1h' ? undefined : x }),
        preview,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
