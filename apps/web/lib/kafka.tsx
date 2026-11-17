'use client';
import { sameEntity } from './keep';
import { nextPoll } from './poll';
// React access to the KafkaClient (rule 1: components never construct clients or import the simulator).
import type { AppInfo, KafkaClient, StreamChannel, StreamEvent } from '@ki/core';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useApp } from './app';
import { pickClient } from './client/pick';

interface Ctx {
  client: KafkaClient;
  info: AppInfo;
  clusterId: string;
}

const KafkaContext = createContext<Ctx | null>(null);

export type Boot =
  | { state: 'connecting'; step: string }
  | { state: 'ready'; ctx: Ctx }
  | { state: 'failed'; error: string };

export function useBoot(): Boot {
  const [boot, setBoot] = useState<Boot>({
    state: 'connecting',
    step: 'Checking for a Kafka Inspector agent',
  });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const picked = await pickClient();
        if (picked.kind === 'sign-in') {
          const next = encodeURIComponent(location.pathname + location.search);
          location.assign(`/app/sign-in/?next=${next}`);
          return;
        }
        if (alive) setBoot({ state: 'connecting', step: 'Connecting to the cluster' });
        const info = await picked.client.info();
        // ?c= picks a cluster; in-app links don't carry it, so this tab remembers the pick until it closes
        const known = (id: string | null) => info.clusters.find((c) => c.id === id)?.id;
        const fromUrl = known(new URLSearchParams(location.search).get('c'));
        let remembered: string | undefined;
        try {
          // remember only a cluster that exists: a stale ?c=gone link must not replace this tab's pick
          if (fromUrl) sessionStorage.setItem('ki-cluster', fromUrl);
          else remembered = known(sessionStorage.getItem('ki-cluster'));
        } catch {
          /* storage blocked: ?c= still works for this page */
        }
        const clusterId = fromUrl ?? remembered ?? info.clusters[0]?.id ?? 'default';
        if (alive) setBoot({ state: 'ready', ctx: { client: picked.client, info, clusterId } });
      } catch (e) {
        if (alive) setBoot({ state: 'failed', error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return boot;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
      // a 4xx won't change on a retry (not found, refused, bad input): show it now; network and 5xx get one more try
      // (checked by shape: the agent client is lazy-loaded, the demo bundle shouldn't pull it in for ApiError)
      retry: (n, e) => {
        const st = (e as { status?: unknown } | null)?.status;
        return n < 1 && !(typeof st === 'number' && st >= 400 && st < 500);
      },
    },
  },
});

/** `ctx` is null while booting, so the shell can render one stable tree before and after boot. */
export function KafkaProvider({ ctx, children }: { ctx: Ctx | null; children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <KafkaContext.Provider value={ctx}>{children}</KafkaContext.Provider>
    </QueryClientProvider>
  );
}

/** Null while booting (shell only); views use useKafka(). */
export function useKafkaMaybe(): Ctx | null {
  return useContext(KafkaContext);
}

export function useKafka(): Ctx {
  const ctx = useContext(KafkaContext);
  if (!ctx) throw new Error('useKafka() used outside <KafkaProvider>.');
  return ctx;
}

/** Request/response data, refreshed every `refreshMs` while mounted (live views pass 1000–5000). */
export function useKafkaQuery<T>(
  key: QueryKey,
  fn: (c: KafkaClient, clusterId: string) => Promise<T>,
  refreshMs: number | false = false,
  enabled = true,
) {
  const { client, clusterId } = useKafka();
  const { live } = useApp();
  return useQuery({
    enabled,
    queryKey: [clusterId, ...key],
    queryFn: () => fn(client, clusterId),
    // Paused (Live off) freezes polled data too; writes still refresh through invalidation
    refetchInterval: (q) => (live ? nextPoll(q.state, refreshMs) : false),
    // the last result stays while a filter or range changes; another entity's data never shows under a new name
    placeholderData: (prev, prevQuery) =>
      sameEntity(prevQuery?.queryKey, [clusterId, ...key]) ? prev : undefined,
  });
}

/**
 * Live stream channel → latest payload (batched to 1/s by the client). Paused Live freezes it, except
 * `always` subscribers (alert delivery must not wait for the user to resume).
 */
export function useStream<T>(
  channel: StreamChannel,
  opts: { always?: boolean } = {},
): T | undefined {
  const k = useKafkaMaybe();
  const client = k?.client;
  const clusterId = k?.clusterId ?? '';
  const { live } = useApp();
  const qc = useQueryClient();
  const [data, setData] = useState<T | undefined>(() =>
    qc.getQueryData<T>([clusterId, 'stream', channel]),
  );
  useEffect(() => {
    // Paused (Live indicator off): keep showing the last values.
    if ((!live && !opts.always) || !client) return;
    return client.subscribe(clusterId, channel, (e: StreamEvent) => {
      qc.setQueryData([clusterId, 'stream', channel], e.data);
      setData(e.data as T);
    });
  }, [client, clusterId, channel, qc, live, opts.always]);
  return data;
}
