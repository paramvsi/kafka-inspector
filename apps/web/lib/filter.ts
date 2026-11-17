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
  /** messages the expression threw on (skipped, not matched), and the first one's reason */
  skipped?: number;
  skipError?: string;
}

const WATCHDOG_MS = 1000;
let worker: Worker | null = null;
let seq = 0;

const spawn = () =>
  new Worker(new URL('./filter.worker.ts', import.meta.url), {
    type: 'module',
    name: 'message-filter',
  });

// ponytail: a fresh worker gets a longer first budget (its module load counts against the timer);
// switch to a 'ready' handshake if first-run timings ever matter
const FIRST_RUN_MS = 5000;
let warm = false;

export function runFilter(expr: string, messages: FilterInput[]): Promise<FilterResult> {
  if (!worker) {
    worker = spawn();
    warm = false;
  }
  const budget = warm ? WATCHDOG_MS : FIRST_RUN_MS;
  const id = ++seq;
  const w = worker;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      w.terminate();
      if (worker === w) worker = null;
      warm = false;
      resolve({
        matches: [],
        scanned: 0,
        timedOut: true,
        error: `The filter took longer than ${budget / 1000} s and was stopped. Check for loops.`,
      });
    }, budget);
    const onMsg = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      clearTimeout(timer);
      warm = true;
      w.removeEventListener('message', onMsg);
      resolve(
        e.data.error && !e.data.matches ? { matches: [], scanned: 0, error: e.data.error } : e.data,
      );
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ id, expr, messages });
  });
}
