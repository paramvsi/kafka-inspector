import { afterEach, expect, test, vi } from 'vitest';
import { ApiError, createAgentClient } from './agent';

class FakeSocket {
  static all: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (e: { data: string }) => void;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(m: string) {
    this.sent.push(m);
  }
  up() {
    this.readyState = 1;
    this.onopen?.();
  }
  down() {
    this.readyState = 3;
    this.onclose?.();
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

test('a non-JSON error page becomes an ApiError with the status', async () => {
  vi.stubGlobal('location', { protocol: 'http:', host: 'agent:8080', pathname: '/', search: '' });
  vi.stubGlobal('fetch', async () => new Response('<html>502 Bad Gateway</html>', { status: 502 }));
  const err = await createAgentClient()
    .listBrokers('local')
    .catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err.message).toBe('The agent answered 502.');
});
