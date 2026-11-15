// Web Worker entry: runs the simulator off the main thread and exposes it with Comlink.
import * as Comlink from 'comlink';
import { DexieStore } from './dexie-store';
import { Simulator } from './sim';

let sim: Simulator | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
const handles = new Map<number, () => void>();
let seq = 0;

async function boot(seed?: string): Promise<void> {
  if (timer) clearInterval(timer);
  sim = new Simulator({ seed, store: new DexieStore() });
  await sim.init();
  timer = setInterval(() => sim!.tick(Date.now()), 1000);
}

const ready = (async () => {
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
        await ready;
        if (prop === '__reboot') return boot(args[0] as string | undefined);
        // Functions can't cross the worker boundary: keep unsubscribe handles here, return ids.
        if (prop === 'subscribeAll') {
          const id = ++seq;
          handles.set(id, sim!.onEvent(args[0] as Parameters<Simulator['onEvent']>[0]));
          return id;
        }
        if (prop === 'tailStart') {
          const id = ++seq;
          handles.set(
            id,
            sim!.tail(
              args[0] as Parameters<Simulator['tail']>[0],
              args[1] as Parameters<Simulator['tail']>[1],
            ),
          );
          return id;
        }
        if (prop === 'release') {
          handles.get(args[0] as number)?.();
          handles.delete(args[0] as number);
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
