import { afterEach, expect, test, vi } from 'vitest';
import { createAgentClient } from './client/agent';
import { onReconnect } from './reconnect';

class FakeSocket {
  static all: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  onopen?: () => void;
  onclose?: (e: { code: number }) => void;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send() {}
  close() {}
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeSocket.all = [];
});

test('onReconnect fires once when a dropped live connection comes back, not on the first connect', () => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('location', { protocol: 'http:', host: 'agent:8080' });
  const client = createAgentClient();
  const back = vi.fn();
  onReconnect(client, back);
  client.subscribe('local', 'metrics', () => {});
  FakeSocket.all[0]!.onopen?.();
  expect(back).not.toHaveBeenCalled();
  FakeSocket.all[0]!.onclose?.({ code: 1006 });
  vi.advanceTimersByTime(60_000);
  FakeSocket.all[1]!.onopen?.();
  expect(back).toHaveBeenCalledTimes(1);
});
