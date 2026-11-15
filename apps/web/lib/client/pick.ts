// Picks the client at startup (ARCHITECTURE "Picking the client").
import type { KafkaClient } from '@ki/core';

export type Picked = { kind: 'client'; client: KafkaClient } | { kind: 'sign-in' };

export async function pickClient(): Promise<Picked> {
  const forced = process.env.NEXT_PUBLIC_KI_MODE;
  if (forced === 'demo')
    return { kind: 'client', client: (await import('./simulated')).createSimulatedClient() };
  if (forced === 'agent')
    return { kind: 'client', client: (await import('./agent')).createAgentClient() };
  const status = await probe();
  if (status === 200)
    return { kind: 'client', client: (await import('./agent')).createAgentClient() };
  if (status === 401) return { kind: 'sign-in' };
  return { kind: 'client', client: (await import('./simulated')).createSimulatedClient() };
}

async function probe(): Promise<number> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 2000);
  try {
    const res = await fetch('/api/info', {
      signal: ctl.signal,
      headers: { accept: 'application/json' },
    });
    // A static host answers unknown paths with an HTML 404/200 page — only JSON counts as the agent.
    if (res.status === 200 && !res.headers.get('content-type')?.includes('application/json'))
      return 404;
    return res.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}
