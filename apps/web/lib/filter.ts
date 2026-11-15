'use client';
// Main-thread side of the filter worker. A watchdog terminates and restarts the worker if an expression
// never returns (e.g. an infinite loop), and reports it as a timeout.
export interface FilterInput {
  key: unknown;
  value: unknown;
  headers: Record<string, string>;
  partition: number;
  offset: number;
  timestamp: string;
}
export interface FilterResult {
  matches: number[];
  scanned: number;
  timedOut?: boolean;
  error?: string;
}

const WATCHDOG_MS = 1000;
let worker: Worker | null = null;
let seq = 0;

const spawn = () =>
  new Worker(new URL('./filter.worker.ts', import.meta.url), {
    type: 'module',
    name: 'message-filter',
  });

export function runFilter(expr: string, messages: FilterInput[]): Promise<FilterResult> {
  worker ??= spawn();
  const id = ++seq;
  const w = worker;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      w.terminate();
      if (worker === w) worker = null;
      resolve({
        matches: [],
        scanned: 0,
        timedOut: true,
        error: 'The filter took longer than 1 s and was stopped. Check for loops.',
      });
    }, WATCHDOG_MS);
    const onMsg = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      clearTimeout(timer);
      w.removeEventListener('message', onMsg);
      resolve(
        e.data.error && !e.data.matches ? { matches: [], scanned: 0, error: e.data.error } : e.data,
      );
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ id, expr, messages });
  });
}
