import type { KafkaClient, Unsubscribe } from '@ki/core';

/** Calls `cb` each time a dropped live connection comes back (not on the first connect): what changed
 * during the gap needs fetching again. A client without a live connection (the demo) never calls it. */
export function onReconnect(client: KafkaClient, cb: () => void): Unsubscribe {
  let dropped = false;
  return (
    client.onConnection?.((c) => {
      if (c.state !== 'connected') dropped = true;
      else if (dropped) {
        dropped = false;
        cb();
      }
    }) ?? (() => {})
  );
}
