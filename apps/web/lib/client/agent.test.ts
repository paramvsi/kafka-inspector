import { afterEach, expect, test, vi } from 'vitest';
import { ApiError, createAgentClient } from './agent';

class FakeSocket {
  static all: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen?: () => void;
  onclose?: (e: { code: number }) => void;
  onmessage?: (e: { data: string }) => void;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  closed = false;
  send(m: string) {
    this.sent.push(m);
  }
  close() {
    this.closed = true;
  }
  up() {
    this.readyState = 1;
    this.onopen?.();
  }
  down() {
    this.readyState = 3;
    this.onclose?.({ code: 1006 }); // abnormal close, as a dropped network gives
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeSocket.all = [];
});

test('a subscribe during reconnect back-off opens one socket, not two', () => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('location', { protocol: 'http:', host: 'agent:8080' });
  const client = createAgentClient();
  client.subscribe('local', 'metrics', () => {});
  FakeSocket.all[0]!.up();
  FakeSocket.all[0]!.down(); // agent restarts → back-off timer pending
  client.subscribe('local', 'alerts', () => {}); // user navigates meanwhile
  vi.advanceTimersByTime(60_000);
  expect(FakeSocket.all).toHaveLength(2);
});

test('the last unsubscribe during back-off cancels the pending reconnect', () => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('location', { protocol: 'http:', host: 'agent:8080' });
  const client = createAgentClient();
  const off = client.subscribe('local', 'metrics', () => {});
  FakeSocket.all[0]!.up();
  FakeSocket.all[0]!.down();
  off();
  vi.advanceTimersByTime(60_000);
  expect(FakeSocket.all).toHaveLength(1);
});

test('a tail error frame reaches onError, never onBatch', () => {
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('location', { protocol: 'http:', host: 'agent:8080' });
  const onBatch = vi.fn();
  const onError = vi.fn();
  createAgentClient().tail('local', { topic: 'nope', partition: 'all' }, onBatch, onError);
  const sock = FakeSocket.all[0]!;
  sock.up();
  const id = JSON.parse(sock.sent[0]!).id;
  sock.onmessage?.({
    data: JSON.stringify({ id, channel: 'tail', error: "Topic nope doesn't exist." }),
  });
  expect(onError).toHaveBeenCalledWith("Topic nope doesn't exist.");
  expect(onBatch).not.toHaveBeenCalled();
});

test('a non-JSON error page becomes an ApiError with the status', async () => {
  vi.stubGlobal('location', { protocol: 'http:', host: 'agent:8080', pathname: '/', search: '' });
  vi.stubGlobal('fetch', async () => new Response('<html>502 Bad Gateway</html>', { status: 502 }));
  const err = await createAgentClient()
    .listBrokers('local')
    .catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err.message).toBe('The agent answered 502.');
});

test('a tail the agent ended is not restarted by a reconnect', () => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('location', { protocol: 'http:', host: 'agent:8080' });
  const client = createAgentClient();
  client.subscribe('local', 'metrics', () => {}); // keeps the connection wanted
  client.tail(
    'local',
    { topic: 'gone', partition: 'all' },
    () => {},
    () => {},
  );
  const sock = FakeSocket.all[0]!;
  sock.up();
  const tailId = sock.sent.map((m) => JSON.parse(m)).find((m) => m.op === 'tail').id;
  sock.onmessage?.({
    data: JSON.stringify({ id: tailId, channel: 'tail', error: 'Topic gone was deleted.' }),
  });
  sock.down();
  vi.advanceTimersByTime(60_000);
  const next = FakeSocket.all[1]!;
  next.up();
  expect(next.sent.map((m) => JSON.parse(m).op)).not.toContain('tail');
});

test('the last unsubscribe closes the idle socket', () => {
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('location', { protocol: 'http:', host: 'agent:8080' });
  const off = createAgentClient().subscribe('local', 'metrics', () => {});
  FakeSocket.all[0]!.up();
  off();
  expect(FakeSocket.all[0]!.closed).toBe(true);
});

test('a deliberate sign-out is not reported as an expired session', async () => {
  const assign = vi.fn();
  vi.stubGlobal('location', {
    assign,
    pathname: '/app/topics/',
    search: '',
    host: 'x',
    origin: 'http://x',
  });
  vi.stubGlobal('document', { cookie: '' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url).includes('/api/auth/logout')
        ? new Response(null, { status: 204 })
        : new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } }),
    ),
  );
  const client = createAgentClient();
  await client.signOut!();
  // a poll that was already in flight comes back 401 after the logout
  await client.listTopics('c', {}).catch(() => undefined);
  expect(assign.mock.calls.some(([u]) => String(u).includes('reason=expired'))).toBe(false);
});

test('a silent connection (no frame, not even the 20 s ping, for 45 s) is dropped and reopened', () => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('location', { protocol: 'http:', host: 'agent:8080' });
  const client = createAgentClient();
  client.subscribe('local', 'metrics', () => {});
  const first = FakeSocket.all[0]!;
  first.up();
  // pings keep it alive
  for (let i = 0; i < 3; i++) {
    vi.advanceTimersByTime(20_000);
    first.onmessage?.({ data: JSON.stringify({ op: 'ping' }) });
  }
  expect(FakeSocket.all).toHaveLength(1);
  // then nothing: a NAT or proxy dropped it without a close
  vi.advanceTimersByTime(46_000 + 60_000);
  expect(first.closed).toBe(true);
  expect(FakeSocket.all).toHaveLength(2);
});
