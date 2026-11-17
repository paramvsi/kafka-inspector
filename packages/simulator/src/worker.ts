// Web Worker entry: runs the simulator off the main thread and exposes it with Comlink.
import * as Comlink from 'comlink';
import { DexieStore } from './dexie-store';
import { Simulator } from './sim';

let sim: Simulator | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let seq = 0;

// Live subscriptions outlive a reboot (Reset demo, new seed): each is re-attached to the new simulator.
type Sub =
  | { kind: 'events'; cb: Parameters<Simulator['onEvent']>[0]; off?: () => void }
  | {
      kind: 'tail';
      req: Parameters<Simulator['tail']>[0];
      cb: Parameters<Simulator['tail']>[1];
      onError?: (message: string) => void;
      off?: () => void;
    };
const subs = new Map<number, Sub>();
const attach = (s: Sub) => {
  if (s.kind === 'events') {
    s.off = sim!.onEvent(s.cb);
    return;
  }
  try {
    s.off = sim!.tail(s.req, s.cb, s.onError);
  } catch (e) {
    // the topic doesn't exist (or no longer, after a reboot): say so instead of an unhandled rejection
    s.onError?.((e as Error).message);
  }
};

async function boot(seed?: string): Promise<void> {
  // build and back-fill first; in-flight calls keep using the old simulator until the swap
  const next = new Simulator({ seed, store: new DexieStore() });
  await next.init();
  if (timer) clearInterval(timer);
  subs.forEach((s) => s.off?.());
  sim = next;
  // tick first: a subscription that can't be re-attached must not stop the cluster
  timer = setInterval(() => {
    // one bad tick must not reach the page as a worker error (which marks the cluster stopped for good)
    try {
      sim!.tick(Date.now());
    } catch (e) {
      console.error('Simulator tick failed; the next tick retries.', e);
    }
  }, 1000);
  for (const [id, s] of subs) {
    try {
      attach(s);
    } catch {
      subs.delete(id); // e.g. a tail on a topic the reset removed
    }
  }
}

let ready = (async () => {
  let seed: string | undefined;
  try {
    seed = (await new DexieStore().load()).settings?.seed;
  } catch {
    /* no storage */
  }
  await boot(seed);
})();

/** Every call waits for the back-fill, then forwards to the simulator. */
const api = new Proxy(
  {},
  {
    get(_t, prop: string) {
      if (prop === 'then') return undefined;
      return async (...args: unknown[]) => {
        // a reboot (Reset demo, new seed) joins the chain: calls made after it wait for the new simulator, so a
        // write in the back-fill window isn't applied to the old one and then discarded; overlapping reboots run in
        // the order they were asked for, so the last seed requested wins
        if (prop === '__reboot') {
          ready = ready.then(() => boot(args[0] as string | undefined));
          return ready;
        }
        await ready;
        // Functions can't cross the worker boundary: keep unsubscribe handles here, return ids.
        if (prop === 'subscribeAll') {
          const id = ++seq;
          const s: Sub = { kind: 'events', cb: args[0] as Parameters<Simulator['onEvent']>[0] };
          attach(s);
          subs.set(id, s);
          return id;
        }
        if (prop === 'tailStart') {
          const id = ++seq;
          const s: Sub = {
            kind: 'tail',
            req: args[0] as Parameters<Simulator['tail']>[0],
            cb: args[1] as Parameters<Simulator['tail']>[1],
            onError: args[2] as ((message: string) => void) | undefined,
          };
          attach(s);
          subs.set(id, s);
          return id;
        }
        if (prop === 'release') {
          subs.get(args[0] as number)?.off?.();
          subs.delete(args[0] as number);
          return;
        }
        const fn = (sim as unknown as Record<string, (...a: unknown[]) => unknown>)[prop];
        if (typeof fn !== 'function') throw new Error(`Unknown simulator method ${prop}`);
        return fn.apply(sim, args);
      };
    },
  },
);

Comlink.expose(api);
