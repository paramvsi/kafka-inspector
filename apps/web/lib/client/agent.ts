// AgentClient: KafkaClient over the self-hosted agent's REST + WebSocket API (docs/AGENT_API.md).
import type {
  AlertRule,
  ConnectionState,
  KafkaClient,
  RawMessage,
  StreamChannel,
  StreamEvent,
} from '@ki/core';
import { fromBase64 } from '@ki/core';

type Dto = {
  topic: string;
  partition: number;
  offset: number;
  timestamp: string;
  key?: string | null;
  value?: string | null;
  headers: Array<{ key: string; value: string }>;
  sizeBytes: number;
};

const BACKOFF = [1, 2, 5, 10, 30];
const MAX_ATTEMPTS = 10;

function csrf(): string | undefined {
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith('KI_CSRF='))
    ?.slice('KI_CSRF='.length);
}

/** Set by a deliberate sign-out: the 401s and the socket's 1008 that follow it aren't an expired session. */
let signingOut = false;

/** The session ended (expiry, sign-out elsewhere, agent restart): go to sign-in, say why, come back afterwards. */
const toSignIn = () =>
  signingOut ||
  location.assign(
    `/app/sign-in/?next=${encodeURIComponent(location.pathname + location.search)}&reason=expired`,
  );

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') {
    const token = csrf();
    if (token) headers['X-KI-CSRF'] = decodeURIComponent(token);
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(
      0,
      'UNREACHABLE',
      "Couldn't reach the Kafka Inspector agent. Check that the container is running.",
    );
  }
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    toSignIn();
    throw new ApiError(401, 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: { error?: { code?: string; message?: string } } | undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    // e.g. a reverse proxy's HTML 502 page
    if (res.ok)
      throw new ApiError(res.status, 'BAD_RESPONSE', 'The agent sent a response that is not JSON.');
  }
  if (!res.ok)
    throw new ApiError(
      res.status,
      json?.error?.code ?? 'ERROR',
      json?.error?.message ?? `The agent answered ${res.status}.`,
    );
  return json as T;
}

/** Sign in from the Sign in page (before a client exists). Fetches /api/info first so the CSRF cookie is set. */
export async function signIn(username: string, password: string): Promise<void> {
  await fetch('/api/info', { credentials: 'same-origin' }).catch(() => undefined);
  await api('POST', '/api/auth/login', { username, password });
}

/** Reachability of another agent (Clusters → Add cluster). Opaque no-cors request; resolves with the round trip in ms. */
export async function pingAgent(url: string, timeoutMs = 3000): Promise<number> {
  const t0 = performance.now();
  await fetch(`${url.replace(/\/$/, '')}/api/health`, {
    mode: 'no-cors',
    signal: AbortSignal.timeout(timeoutMs),
  });
  return Math.round(performance.now() - t0);
}

/** This page's own agent is up: a same-origin check that reads the status (a proxy's 502 isn't "up"; a
 * no-cors ping like pingAgent can't tell). 401 counts as up — the agent answered, the session just ended. */
export async function agentHealthy(timeoutMs = 3000): Promise<boolean> {
  try {
    const r = await fetch('/api/health', {
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    return r.ok || r.status === 401;
  } catch {
    return false;
  }
}

export async function agentInfo(): Promise<{ version: string; clusters?: number }> {
  const i = await api<{ version: string; clusters?: unknown[] }>('GET', '/api/info');
  return { version: i.version, clusters: i.clusters?.length };
}

const toRaw = (m: Dto): RawMessage => ({
  ...m,
  // the agent omits null fields: absent and null both mean "no bytes"
  key: m.key == null ? null : fromBase64(m.key),
  value: m.value == null ? null : fromBase64(m.value),
  headers: m.headers.map((h) => ({ key: h.key, value: fromBase64(h.value) })),
});

const q = (o: Record<string, unknown>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

export function createAgentClient(): KafkaClient {
  // ── one WebSocket, many subscriptions, resubscribed after reconnect ──
  type Sub = {
    msg: Record<string, unknown>;
    onData: (data: unknown, ts: string) => void;
    onError?: (message: string) => void;
  };
  const subs = new Map<string, Sub>();
  const conn = new Set<(c: ConnectionState) => void>();
  let ws: WebSocket | null = null;
  let attempt = 0;
  let since: number | undefined;
  let seq = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const emit = (c: ConnectionState) => conn.forEach((l) => l(c));
  const open = () => {
    // one socket at a time: a subscribe during back-off opens now and cancels the pending retry
    clearTimeout(retry);
    retry = undefined;
    if (ws) return;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/stream`;
    const sock = new WebSocket(url);
    ws = sock;
    sock.onopen = () => {
      attempt = 0;
      since = undefined;
      emit({ state: 'connected' });
      subs.forEach((s) => sock.send(JSON.stringify(s.msg)));
    };
    sock.onmessage = (e) => {
      const m = JSON.parse(e.data as string);
      if (m.op === 'ping') return;
      const sub = subs.get(m.id);
      if (typeof m.error === 'string') {
        sub?.onError?.(m.error);
        if (m.channel === 'tail') subs.delete(m.id); // the agent ended it: a reconnect must not restart it
      } else sub?.onData(m.data, m.ts);
    };
    sock.onclose = (e) => {
      if (ws !== sock) return;
      ws = null;
      // 1008 "Signed out": the agent ended this session; retrying would only be refused
      if (e.code === 1008) return toSignIn();
      if (subs.size === 0) return;
      since ??= Date.now();
      const wait = BACKOFF[Math.min(attempt, BACKOFF.length - 1)]!;
      attempt++;
      emit({
        state: 'reconnecting',
        since,
        attempt: Math.min(attempt, MAX_ATTEMPTS),
        maxAttempts: MAX_ATTEMPTS,
        nextAt: Date.now() + wait * 1000,
      });
      retry = setTimeout(open, wait * 1000);
    };
  };
  const add = (msg: Record<string, unknown>, onData: Sub['onData'], onError?: Sub['onError']) => {
    const id = `s${++seq}`;
    const full = { ...msg, id };
    subs.set(id, { msg: full, onData, onError });
    if (!ws) open();
    else if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(full));
    return () => {
      subs.delete(id);
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'unsub', id }));
      // nothing left to stream: a pending reconnect would only open an idle socket
      if (subs.size === 0) {
        clearTimeout(retry);
        retry = undefined;
        const idle = ws;
        ws = null; // onclose sees a socket that isn't current and stays quiet
        idle?.close();
      }
    };
  };

  const c = (id: string) => `/api/clusters/${encodeURIComponent(id)}`;
  return {
    info: () => api('GET', '/api/info'),
    getOverview: (id) => api('GET', `${c(id)}/overview`),
    listBrokers: (id) => api('GET', `${c(id)}/brokers`),
    getBrokerConfig: (id, b) => api('GET', `${c(id)}/brokers/${b}/config`),
    listTopics: (id, t = {}) =>
      // starred only matters for the Starred view; sending it always could overflow the URL
      api(
        'GET',
        `${c(id)}/topics?${q({ ...t, starred: t.view === 'starred' ? t.starred?.join(',') : undefined })}`,
      ),
    getTopic: (id, name) => api('GET', `${c(id)}/topics/${encodeURIComponent(name)}`),
    getTopicConfig: (id, name) => api('GET', `${c(id)}/topics/${encodeURIComponent(name)}/config`),
    browse: async (id, r) => {
      const page = await api<{ messages: Dto[]; nextCursor?: string; scanned: number }>(
        'GET',
        `${c(id)}/topics/${encodeURIComponent(r.topic)}/messages?${q({ partition: r.partition, from: r.from, offset: r.offset, timestamp: r.timestamp, group: r.group, limit: r.limit, cursor: r.cursor })}`,
      );
      return { ...page, messages: page.messages.map(toRaw) };
    },
    search: async (id, r) => {
      const page = await api<{ messages: Dto[]; scanned: number }>(
        'POST',
        `${c(id)}/messages/search`,
        r,
      );
      return { ...page, messages: page.messages.map(toRaw) };
    },
    tail: (id, r, onBatch, onError) =>
      add(
        {
          op: 'tail',
          cluster: id,
          topic: r.topic,
          partition: String(r.partition),
          maxRate: r.maxRate ?? 50,
        },
        (data) => onBatch((data as Dto[]).map(toRaw)),
        onError,
      ),
    listGroups: (id, g = {}) => api('GET', `${c(id)}/groups?${q(g as Record<string, unknown>)}`),
    getGroup: (id, g) => api('GET', `${c(id)}/groups/${encodeURIComponent(g)}`),
    getHistory: (id, h) =>
      api('GET', `${c(id)}/history?${q(h as unknown as Record<string, unknown>)}`),
    subscribe: (id, channel: StreamChannel, onEvent: (e: StreamEvent) => void) =>
      add({ op: 'sub', cluster: id, channel }, (data, ts) =>
        onEvent({ channel, ts, data } as StreamEvent),
      ),
    listSubjects: (id) => api('GET', `${c(id)}/schemas/subjects`),
    getSchema: (id, s, v) =>
      api('GET', `${c(id)}/schemas/subjects/${encodeURIComponent(s)}/versions/${v}`),
    getSchemaById: (id, n) => api('GET', `${c(id)}/schemas/ids/${n}`),
    checkCompatibility: (id, s, schema) =>
      api('POST', `${c(id)}/schemas/subjects/${encodeURIComponent(s)}/compatibility`, { schema }),
    getTopology: (id) => api('GET', `${c(id)}/topology`),
    listAlertRules: () => api('GET', '/api/alerts/rules'),
    saveAlertRule: (r) =>
      r.id
        ? api<AlertRule>('PUT', `/api/alerts/rules/${encodeURIComponent(r.id)}`, r)
        : api<AlertRule>('POST', '/api/alerts/rules', r),
    deleteAlertRule: (id) => api('DELETE', `/api/alerts/rules/${encodeURIComponent(id)}`),
    listAlerts: (a = {}) => api('GET', `/api/alerts/events?${q(a as Record<string, unknown>)}`),
    muteAlert: (id, until) =>
      api('POST', `/api/alerts/events/${encodeURIComponent(id)}/mute`, { until }),
    acknowledgeAlert: (id) => api('POST', `/api/alerts/events/${encodeURIComponent(id)}/ack`),
    onConnection: (cb) => {
      conn.add(cb);
      return () => conn.delete(cb);
    },
    signOut: () => {
      signingOut = true; // Shell sends the user to sign-in itself, with no "session ended" note
      return api('POST', '/api/auth/logout');
    },
    savedFilters: {
      list: () => api('GET', '/api/filters'),
      save: (f) => api('PUT', `/api/filters/${encodeURIComponent(f.name)}`, { expr: f.expr }),
    },
  };
}
