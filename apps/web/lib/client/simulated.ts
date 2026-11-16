// SimulatedClient: KafkaClient backed by the in-browser simulator worker (demo mode).
import type {
  AlertRuleInput,
  KafkaClient,
  RawMessage,
  StreamChannel,
  StreamEvent,
  TailRequest,
} from '@ki/core';
import * as Comlink from 'comlink';

type Remote = Record<string, (...args: unknown[]) => Promise<unknown>>;

export function createSimulatedClient(): KafkaClient {
  const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), {
    type: 'module',
    name: 'kafka-simulator',
  });
  const sim = Comlink.wrap<Remote>(worker) as unknown as Remote;
  // a worker that fails to load or crashes would leave every call pending forever (spinners, no error):
  // fail the calls in flight and every later one, so screens show their error state
  let dead: Error | null = null;
  const inFlight = new Set<(e: Error) => void>();
  worker.addEventListener('error', (e) => {
    dead = new Error(
      `The simulated cluster stopped${e.message ? ` (${e.message})` : ''}. Reload the page to start it again.`,
    );
    inFlight.forEach((reject) => reject(dead!));
    inFlight.clear();
  });
  const call = <T>(name: string, ...args: unknown[]): Promise<T> => {
    if (dead) return Promise.reject(dead);
    return new Promise<T>((resolve, reject) => {
      inFlight.add(reject);
      (sim[name]!(...args) as Promise<T>)
        .then(resolve, reject)
        .finally(() => inFlight.delete(reject));
    });
  };

  // One worker subscription fans out to every local listener.
  const listeners = new Map<StreamChannel, Set<(e: StreamEvent) => void>>();
  let subscribed: Promise<number> | null = null;
  const ensure = () => {
    subscribed ??= call<number>(
      'subscribeAll',
      Comlink.proxy((channel: StreamChannel, data: unknown) => {
        const ev = { channel, ts: new Date().toISOString(), data } as StreamEvent;
        listeners.get(channel)?.forEach((l) => l(ev));
      }),
    );
  };

  return {
    info: () => call('info'),
    getOverview: () => call('getOverview'),
    listBrokers: () => call('listBrokers'),
    getBrokerConfig: (_c, id) => call('getBrokerConfig', id),
    listTopics: (_c, q) => call('listTopics', q),
    getTopic: (_c, name) => call('getTopic', name),
    getTopicConfig: (_c, name) => call('getTopicConfig', name),
    browse: (_c, req) => call('browse', req),
    search: (_c, req) => call('search', req),
    tail: (
      _c,
      req: TailRequest,
      onBatch: (b: RawMessage[]) => void,
      onError?: (m: string) => void,
    ) => {
      const id = call<number>(
        'tailStart',
        req,
        Comlink.proxy(onBatch),
        onError ? Comlink.proxy(onError) : undefined,
      );
      // after the worker died both reject: nothing to release, and no unhandled rejection
      return () => void id.then((i) => call('release', i)).catch(() => undefined);
    },
    listGroups: (_c, q) => call('listGroups', q),
    getGroup: (_c, id) => call('getGroup', id),
    getHistory: (_c, q) => call('getHistory', q),
    subscribe: (_c, channel, onEvent) => {
      ensure();
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(onEvent);
      return () => listeners.get(channel)?.delete(onEvent);
    },
    listSubjects: () => call('listSubjects'),
    getSchema: (_c, subject, version) => call('getSchema', subject, version),
    getSchemaById: (_c, id) => call('getSchemaById', id),
    checkCompatibility: (_c, subject, schema) => call('checkCompatibility', subject, schema),
    getTopology: () => call('getTopology'),
    listAlertRules: () => call('listAlertRules'),
    saveAlertRule: (rule) => call('saveAlertRule', rule),
    deleteAlertRule: (id) => call('deleteAlertRule', id),
    listAlerts: (q) => call('listAlerts', q),
    muteAlert: (id, until) => call('muteAlert', id, until),
    acknowledgeAlert: (id) => call('acknowledgeAlert', id),
    previewAlertRule: (rule: AlertRuleInput) => call('previewAlertRule', rule),
    writes: {
      createTopic: (_c, spec) => call('createTopic', spec),
      deleteTopic: (_c, name) => call('deleteTopic', name),
      updateTopicConfig: (_c, name, changes) => call('updateTopicConfig', name, changes),
      produce: (_c, req) => call('produce', req),
      resetOffsets: (_c, req, dryRun) => call('resetOffsets', req, dryRun),
      deleteGroup: (_c, id) => call('deleteGroup', id),
    },
    chaos: {
      run: (action) => call('runChaos', action),
      stop: (id) => call('stopChaos', id),
      reset: async () => {
        await call('reset');
        await call('__reboot');
      },
      settings: async (s) => {
        await call('updateSettings', s);
        if (s.seed) await call('__reboot', s.seed);
      },
      incidents: () => call('listIncidents'),
      getSettings: () => call('getSettings'),
    },
  };
}
