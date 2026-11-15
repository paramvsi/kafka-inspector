import { afterEach, expect, test, vi } from 'vitest';
import { probeAgent } from './pick';

const reply = (status: number, body: unknown, type = 'application/json') =>
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status,
          headers: { 'content-type': type },
        }),
    ),
  );
afterEach(() => vi.unstubAllGlobals());

test('agent signed in → agent; signed out → sign-in; 401 → sign-in', async () => {
  reply(200, { mode: 'agent', version: '1', readOnly: true, clusters: [] });
  expect(await probeAgent()).toBe('agent');
  reply(200, { mode: 'agent', version: '1', auth: true, signedIn: false });
  expect(await probeAgent()).toBe('sign-in');
  reply(401, { error: { code: 'UNAUTHENTICATED' } });
  expect(await probeAgent()).toBe('sign-in');
});

test('static hosts (HTML 404/200) and network errors → demo', async () => {
  reply(404, '<html>not found</html>', 'text/html');
  expect(await probeAgent()).toBe('none');
  reply(200, '<html>index</html>', 'text/html');
  expect(await probeAgent()).toBe('none');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('offline');
    }),
  );
  expect(await probeAgent()).toBe('none');
});
