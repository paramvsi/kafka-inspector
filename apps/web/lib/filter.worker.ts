// JavaScript message filters (F-42, ARCHITECTURE "JavaScript filters"): compiled once per expression,
// evaluated per message with a 50 ms budget per batch, in a worker with no DOM. Shadowing network globals is a
// convenience, not a sandbox (Function-constructed code can reach the global): the boundary is the worker's own
// CSP, `connect-src 'none'` (agent SecurityConfig and netlify.toml), so expressions — including deep-linked or
// saved ones — can't reach the network or the session.
type Msg = {
  key: unknown;
  value: unknown;
  headers: Record<string, string>;
  partition: number;
  offset: number;
  timestamp: string;
};
type Req = { id: number; expr: string; messages: Msg[] };

const BUDGET_MS = 50;
let compiled: { expr: string; fn: (m: Msg) => unknown } | null = null;

function compile(expr: string): (m: Msg) => unknown {
  if (compiled?.expr === expr) return compiled.fn;
  const body = `"use strict"; const fetch = undefined, XMLHttpRequest = undefined, WebSocket = undefined, importScripts = undefined, postMessage = undefined, self = undefined, globalThis = undefined, indexedDB = undefined, caches = undefined, EventSource = undefined; const { key, value, headers, partition, offset, timestamp } = m; return (${expr});`;
  const fn = new Function('m', body) as (m: Msg) => unknown;
  compiled = { expr, fn };
  return fn;
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, expr, messages } = e.data;
  let fn: (m: Msg) => unknown;
  try {
    fn = compile(expr);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id,
      error: `Syntax error: ${(err as Error).message}`,
    });
    return;
  }
  const start = performance.now();
  const matches: number[] = [];
  let scanned = 0;
  let error: string | undefined;
  for (let i = 0; i < messages.length; i++) {
    if (performance.now() - start > BUDGET_MS) break;
    scanned++;
    try {
      if (fn(messages[i]!)) matches.push(i);
    } catch (err) {
      error ??= `Offset ${messages[i]!.offset}: ${(err as Error).message}`;
    }
  }
  (self as unknown as Worker).postMessage({
    id,
    matches,
    scanned,
    timedOut: scanned < messages.length,
    error,
  });
};
