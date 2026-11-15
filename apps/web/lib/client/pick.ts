// Picks the client at startup (ARCHITECTURE "Picking the client").
import type { KafkaClient } from '@ki/core';

export type Picked = { kind: 'client'; client: KafkaClient } | { kind: 'sign-in' };

export async function pickClient(): Promise<Picked> {
  const forced = process.env.NEXT_PUBLIC_KI_MODE;
  if (forced === 'demo')
    return { kind: 'client', client: (await import('./simulated')).createSimulatedClient() };
  if (forced === 'agent')
    return { kind: 'client', client: (await import('./agent')).createAgentClient() };
  const probe = await probeAgent();
  if (probe === 'agent')
    return { kind: 'client', client: (await import('./agent')).createAgentClient() };
  if (probe === 'sign-in') return { kind: 'sign-in' };
  return { kind: 'client', client: (await import('./simulated')).createSimulatedClient() };
}

/** 200 JSON from /api/info → agent (or sign-in when signedIn is false, AGENT_API "Meta"); 401 → sign-in; else demo. */
export async function probeAgent(): Promise<'agent' | 'sign-in' | 'none'> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 2000);
  try {
    const res = await fetch('/api/info', {
      signal: ctl.signal,
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (res.status === 401) return 'sign-in';
    // a static host answers unknown paths with HTML: only JSON counts as the agent
    if (res.status !== 200 || !res.headers.get('content-type')?.includes('application/json'))
      return 'none';
    const body = (await res.json()) as { mode?: string; signedIn?: boolean };
    if (body.mode !== 'agent') return 'none';
    return body.signedIn === false ? 'sign-in' : 'agent';
  } catch {
    return 'none';
  } finally {
    clearTimeout(timer);
  }
}
