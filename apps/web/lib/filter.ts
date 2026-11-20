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

/** The filter shares the worker's global, so an expression can post a look-alike reply for a request id: the page
 * accepts only the shape the worker builds (integer indexes, a count, string errors), never arbitrary objects. */
function reply(d: unknown): FilterResult {
  const r = (d ?? {}) as Record<string, unknown>;
  if (r.error && !r.matches) return { matches: [], scanned: 0, error: String(r.error) };
  if (
    !Array.isArray(r.matches) ||
    !r.matches.every((i) => Number.isInteger(i) && i >= 0) ||
    typeof r.scanned !== 'number' ||
    (r.error !== undefined && typeof r.error !== 'string') ||
    (r.skipError !== undefined && typeof r.skipError !== 'string') ||
    (r.skipped !== undefined && !Number.isInteger(r.skipped)) ||
    (r.timedOut !== undefined && typeof r.timedOut !== 'boolean')
  )
    return {
      matches: [],
      scanned: 0,
      error: 'The filter returned something that is not a result. Check the expression.',
    };
  return r as unknown as FilterResult; // checked above: every field is the type the worker sends
}

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
      resolve(reply(e.data));
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ id, expr, messages });
  });
}
