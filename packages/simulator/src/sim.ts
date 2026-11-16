// The simulated cluster (docs/ARCHITECTURE.md "Simulator"). Pure TypeScript: no DOM, no worker APIs —
// worker.ts exposes it over Comlink, tests drive it directly with an injected clock.
import {
  combineForecasts,
  evaluateLag,
  forecast as forecastOf,
  formatDuration,
  formatEta,
  formatCount,
  formatInt,
  isNeutralState,
  rollupStatus,
  type AlertEvent,
  type AlertQuery,
  type AlertRule,
  type AlertRuleInput,
  type AppInfo,
  type AttentionItem,
  type Broker,
  type BrowseRequest,
  type ChaosAction,
  type ClusterEvent,
  type ClusterSummary,
  type CompatibilityResult,
  type ConfigEntry,
  type Forecast,
  type GroupDetail,
  type GroupPartitionLag,
  type GroupQuery,
  type GroupState,
  type GroupSummary,
  type HealthFinding,
  type HistoryQuery,
  type Incident,
  type LagSample,
  type LagStatus,
  type NewTopic,
  type Overview,
  type Page,
  type PartitionInfo,
  type ProduceRequest,
  type ProduceResult,
  type RawMessage,
  type RawMessagePage,
  type ResetOffsetsRequest,
  type ResetPreview,
  type SchemaVersion,
  type SearchRequest,
  type Series,
  type SimSettings,
  type SubjectSummary,
  type TailRequest,
  type TopicDetail,
  type TopicQuery,
  type TopicSummary,
  type Topology,
  TOPIC_NAME,
  ALERT_METRICS,
  becameStuck,
  plural,
  safeRegex,
} from '@ki/core';
import { checkCompatibility } from '@ki/core/schema-compat';
import { History } from './history';
import { AvroType, fromDisplay } from '@ki/core/avro';
import { frame, generateMessage, isMalformed } from './messages';
import {
  BROKERS,
  CLUSTER,
  DEFAULT_SEED,
  MALFORMED,
  POISON,
  SEED_GROUPS,
  SEED_TOPICS,
  SINK_CYCLE,
  type GroupDef,
  type TopicDef,
} from './model';
import { hash, hex, rng } from './prng';
import * as registry from './registry';
import { MemoryStore, type Action, type Store } from './store';

const DAY = 24 * 3600 * 1000;
// Lag window in demo mode: 10 samples at 1 s, so a stall shows within 10 s (phase 3 gate). Configurable per
// ARCHITECTURE; the agent uses 30 samples at 10 s.
const WINDOW = 10;
const WINDOW_MS = 10_000;
const FINE_MS = 15 * 60 * 1000;
const VERSION = '0.1.0';

interface PState {
  def: TopicDef;
  p: number;
  end: number;
  retained: number;
  leader: number | null;
  replicas: number[];
  isr: number[];
  rate: number;
  lastMsgAt: number;
}

interface GPart {
  topic: string;
  p: number;
  committed: number;
  lastCommitAt: number;
  ring: LagSample[];
  status: LagStatus;
  frozenSince: number;
  consumeRate: number;
}

interface GState {
  def: GroupDef;
  state: GroupState;
  members: number;
  parts: GPart[];
  slow: boolean;
  crashed: boolean;
  rebalanceUntil: number;
  pausedUntil: number;
  /** the rebalance running is the rejoin after an offset reset */
  resetRejoin?: boolean;
  deleted: boolean;
  status: LagStatus;
  forecast: Forecast;
  lastCommitAt: number;
}

interface Poison {
  topic: string;
  p: number;
  offset: number;
  group: string;
  since: number;
  incident?: string;
}

interface IncidentState extends Incident {
  until?: number;
  undo: () => void;
}

type Listener = (channel: 'metrics' | 'lag' | 'events' | 'alerts', data: unknown) => void;

export interface SimOptions {
  seed?: string;
  now?: () => number;
  store?: Store;
}

export const SEEDED_RULES: AlertRule[] = [
  {
    id: 'r-group-stalled',
    name: 'Consumer group stalled or stopped',
    metric: 'group-status',
    scope: { kind: 'any' },
    durationSec: 30,
    severity: 'crit',
    channels: ['in-app', 'browser'],
    enabled: true,
  },
  {
    id: 'r-lag-5k',
    name: 'Lag above 5,000 for 5 min',
    metric: 'lag',
    scope: { kind: 'any' },
    threshold: 5000,
    durationSec: 300,
    severity: 'warn',
    channels: ['in-app'],
    enabled: true,
  },
  {
    id: 'r-urp',
    name: 'Under-replicated partitions',
    metric: 'under-replicated',
    scope: { kind: 'any' },
    threshold: 0,
    durationSec: 30,
    severity: 'crit',
    channels: ['in-app', 'browser'],
    enabled: true,
  },
  {
    id: 'r-broker-offline',
    name: 'Broker offline',
    metric: 'broker-offline',
    scope: { kind: 'any' },
    durationSec: 10,
    severity: 'crit',
    channels: ['in-app', 'browser'],
    enabled: true,
  },
  {
    id: 'r-topic-silent',
    name: 'Topic silent for 10 min',
    metric: 'topic-silent',
    scope: { kind: 'any' },
    durationSec: 600,
    severity: 'warn',
    channels: ['in-app'],
    enabled: true,
  },
  {
    id: 'r-dlq',
    name: 'DLQ receiving messages',
    metric: 'dlq-receiving',
    scope: { kind: 'any' },
    threshold: 0,
    durationSec: 60,
    severity: 'info',
    channels: ['in-app'],
    enabled: true,
    muted: true,
  },
];

const offlineLabel = (n: number) => `${plural(n, 'partition')} offline`;

export class Simulator {
  readonly seed: string;
  private now: () => number;
  private store: Store;
  private settings: Required<SimSettings>;

  private topics = new Map<string, TopicDef>();
  private parts = new Map<string, PState[]>();
  private groups = new Map<string, GState>();
  private brokersOnline = new Map<number, boolean>(BROKERS.map((b) => [b.id, true]));
  private history = new History();
  private events: ClusterEvent[] = [];
  private incidents = new Map<string, IncidentState>();
  private poisonFixed = false;
  /** When the opening poison starts in this back-fill: 6m 12s before load, or when it started before a recorded fix. */
  private poisonStartAt = 0;
  private poisonStarted = false;
  private poison: Poison | null = null;
  private poisoned = new Set<string>();
  private produced = new Map<string, RawMessage>();
  private spike = new Map<string, number>(); // topic or '*' → multiplier
  private hot = new Map<string, number>(); // topic → hot partition
  private dlqExtra = 0;

  private rules: AlertRule[] = SEEDED_RULES.map((r) => ({ ...r }));
  private alertEvents: AlertEvent[] = [];
  private pending = new Map<string, number>();
  private firing = new Map<string, AlertEvent>();

  private listeners = new Set<Listener>();
  private tails = new Map<
    number,
    {
      req: TailRequest;
      next: Map<number, number>;
      cb: (b: RawMessage[]) => void;
      onError?: (message: string) => void;
    }
  >();
  private tailSeq = 0;
  private lastTick = 0;
  private loadedAt = 0;
  private tickCount = 0;
  private replaying = false;
  private lastMetrics = { messagesIn: 0, messagesOut: 0, bytesIn: 0, bytesOut: 0 };

  constructor(opts: SimOptions = {}) {
    this.seed = opts.seed ?? DEFAULT_SEED;
    this.now = opts.now ?? (() => Date.now());
    this.store = opts.store ?? new MemoryStore();
    this.settings = { baseTraffic: 1, dailyWave: true, seed: this.seed };
  }

  // ───────────────────────────── setup and back-fill ─────────────────────────────

  async init(): Promise<void> {
    const saved = await this.store.load();
    if (saved.settings) this.settings = { ...this.settings, ...saved.settings };
    if (saved.rules) this.rules = saved.rules;
    this.backfill(this.now(), saved.actions);
  }

  /** Builds the seeded cluster and simulates the last 24 h (60 s steps, then 1 s for the last 15 min). */
  backfill(now: number, actions: Action[] = []): void {
    this.loadedAt = now;
    const start = now - DAY;
    SEED_TOPICS.forEach((def, ti) => this.addTopic(def, ti, start));
    for (const def of SEED_GROUPS) this.addGroup(def, start);
    this.seedHistoricEvents(now);

    const pending = [...actions].sort((a, b) => a.t - b.t);
    // the user already moved fraud-scorer past the poison message: don't stall it again on reload
    // recorded only when a live reset actually moved fraud-scorer past the poison message
    // A fix that recorded when its poison started replays that poison from then, so the saved reset
    // lands on the same stalled offsets; an older fix without it just leaves the poison out.
    const fix = actions.find((a) => a.kind === 'poison-fixed');
    const since = (fix?.payload as { since?: number } | null)?.since;
    this.poisonFixed = !!fix && since === undefined;
    this.poisonStartAt = since ?? now - POISON.activeForMsAtLoad;
    this.poisonStarted = false;
    const applyDue = (t: number) => {
      while (pending.length && pending[0]!.t <= t) this.replay(pending.shift()!);
    };

    this.replaying = true;
    this.lastTick = start;
    this.record(start);
    for (let t = start + 60_000; t <= now - FINE_MS; t += 60_000) {
      applyDue(t);
      this.step(t);
    }
    for (let t = this.lastTick + 1000; t <= now; t += 1000) {
      applyDue(t);
      this.step(t);
    }
    while (pending.length) this.replay(pending.shift()!);
    this.replaying = false;
  }

  private addTopic(def: TopicDef, ti: number, start: number): void {
    this.topics.set(def.name, def);
    const r = rng(hash(this.seed, 'topic', def.name));
    const ps: PState[] = [];
    for (let p = 0; p < def.partitions; p++) {
      // exactly RF replicas, spread round-robin
      const replicas = Array.from(
        { length: Math.min(def.rf, BROKERS.length) },
        (_, k) => BROKERS[(ti + p + k) % BROKERS.length]!.id,
      );
      // a broker that is down (chaos) is not in sync and can't lead
      const isr = replicas.filter((b) => this.brokersOnline.get(b) !== false);
      const end = Math.floor(def.endAtLoad * (1 + (r() - 0.5) * 0.002));
      const retained = def.sizeBytes
        ? Math.min(end, Math.floor(def.sizeBytes / def.avgBytes / def.partitions))
        : Number.MAX_SAFE_INTEGER;
      ps.push({
        def,
        p,
        end,
        retained,
        leader: isr[0] ?? null,
        replicas,
        isr,
        rate: 0,
        lastMsgAt: def.silentForMs ? this.loadedAt - def.silentForMs : start,
      });
    }
    this.parts.set(def.name, ps);
  }

  private addGroup(def: GroupDef, start: number): void {
    const parts: GPart[] = [];
    for (const topic of def.topics) {
      for (const ps of this.parts.get(topic) ?? []) {
        parts.push({
          topic,
          p: ps.p,
          committed: ps.end,
          lastCommitAt: start,
          ring: [],
          status: 'healthy',
          frozenSince: start,
          consumeRate: 0,
        });
      }
    }
    this.groups.set(def.groupId, {
      def,
      state: def.initialState ?? 'Stable',
      members: def.members,
      parts,
      slow: false,
      crashed: false,
      rebalanceUntil: 0,
      pausedUntil: 0,
      deleted: false,
      status: 'healthy',
      forecast: { kind: 'caught-up' },
      lastCommitAt: start,
    });
  }

  private seedHistoricEvents(now: number): void {
    const ev = (ago: number, e: Omit<ClusterEvent, 'id' | 'ts'>) =>
      this.pushEvent({ ...e, ts: new Date(now - ago).toISOString() });
    ev(7 * 3600e3, {
      kind: 'isr-shrink',
      severity: 'warn',
      title: 'ISR shrank on orders-11',
      detail: 'Broker 3 fell out of sync for 14s',
    });
    ev(7 * 3600e3 - 14e3, {
      kind: 'isr-expand',
      severity: 'info',
      title: 'ISR expanded on orders-11',
      detail: 'Broker 3 back in sync',
    });
    ev(5 * 3600e3, {
      kind: 'config',
      severity: 'info',
      title: 'Config changed on clickstream',
      detail: 'retention.ms 604800000 → 259200000',
    });
    ev(3 * 3600e3, {
      kind: 'rebalance',
      severity: 'info',
      title: 'analytics-etl rebalanced',
      detail: '4 members · 93 partitions reassigned',
    });
  }

  // ───────────────────────────── the tick ─────────────────────────────

  /** Advance to `now` and notify subscribers. Called every second by the worker. */
  tick(now = this.now()): void {
    const gap = now - this.lastTick;
    if (gap <= 0) return;
    // A sleeping tab can come back minutes later: catch up in 1 s steps (cap 120), then one big step.
    if (gap > 2000) {
      const steps = Math.min(120, Math.floor(gap / 1000) - 1);
      for (let i = 1; i <= steps; i++) this.step(this.lastTick + 1000);
    }
    this.step(now);
    this.tickCount++;
    if (this.tickCount % 60 === 0) this.history.compact(now);
    this.emitTails();
    this.emit();
  }

  private rateOf(def: TopicDef, t: number): number {
    if (def.silentForMs || def.rate === 0) return def.name === 'payments.dlq' ? this.dlqExtra : 0;
    const wave = this.settings.dailyWave
      ? 1 + 0.12 * Math.sin((2 * Math.PI * (t % DAY)) / DAY - 2.2)
      : 1;
    const noise =
      1 + 0.08 * ((hash(this.seed, def.name, Math.floor(t / 1000)) % 1000) / 1000 - 0.5);
    const spike = this.spike.get(def.name) ?? this.spike.get('*') ?? 1;
    const base = def.name === 'payments.dlq' ? 0.03 + this.dlqExtra : def.rate;
    return base * this.settings.baseTraffic * wave * noise * spike;
  }

  private shares(def: TopicDef): number[] {
    const n = def.partitions;
    const hot = this.hot.get(def.name);
    const fixed: Record<number, number> = {
      ...(def.skew ?? {}),
      ...(hot !== undefined ? { [hot]: 0.4 } : {}),
    };
    const fixedSum = Object.values(fixed).reduce((a, b) => a + b, 0);
    const rest = n - Object.keys(fixed).length;
    return Array.from({ length: n }, (_, p) => fixed[p] ?? (rest ? (1 - fixedSum) / rest : 0));
  }

  private step(t: number): void {
    const dt = (t - this.lastTick) / 1000;
    this.lastTick = t;
    if (dt <= 0) return;

    // Production
    let msgsIn = 0,
      bytesIn = 0;
    for (const [, ps] of this.parts) {
      const def = ps[0]!.def;
      const rate = this.rateOf(def, t);
      const shares = this.shares(def);
      let produced = 0; // what the partitions actually take: a leaderless one takes nothing (as the topic rows show)
      for (const s of ps) {
        s.rate = s.leader === null ? 0 : rate * shares[s.p]!;
        produced += s.rate;
        const before = Math.floor(s.end);
        s.end += s.rate * dt;
        if (Math.floor(s.end) > before) s.lastMsgAt = t;
      }
      if (!def.internal) {
        msgsIn += produced;
        bytesIn += produced * def.avgBytes;
      }
    }

    // Consumption
    let msgsOut = 0,
      bytesOut = 0;
    for (const g of this.groups.values()) {
      if (g.deleted) continue;
      if (g.rebalanceUntil && t >= g.rebalanceUntil) {
        g.rebalanceUntil = 0;
        g.resetRejoin = false;
        g.state = g.crashed || g.members === 0 ? 'Empty' : 'Stable';
      } else if (g.rebalanceUntil && t >= g.rebalanceUntil - 2000 && !g.crashed && g.members > 0) {
        g.state = 'CompletingRebalance';
      }
      if (g.pausedUntil && t >= g.pausedUntil) {
        g.pausedUntil = 0;
        if (!g.crashed && g.def.members > 0) {
          this.rebalance(g, t, 'members rejoined after offset reset', 3000);
          g.resetRejoin = true;
        }
      }
      const beforeStop = !!g.def.stoppedForMs && t < this.loadedAt - g.def.stoppedForMs;
      const active =
        beforeStop ||
        (!g.crashed && g.members > 0 && !g.rebalanceUntil && !g.pausedUntil && g.state !== 'Empty');
      const cycle =
        (t - this.loadedAt + SINK_CYCLE.phaseAtLoadMs + 100 * SINK_CYCLE.periodMs) %
        SINK_CYCLE.periodMs;
      const inDip = cycle < SINK_CYCLE.dipMs;

      for (const gp of g.parts) {
        const ps = this.parts.get(gp.topic)?.[gp.p];
        if (!ps) continue;
        const before = gp.committed;
        if (active) {
          const isPoisoned =
            this.poison &&
            this.poison.group === g.def.groupId &&
            this.poison.topic === gp.topic &&
            this.poison.p === gp.p &&
            gp.committed >= this.poison.offset;
          if (isPoisoned) {
            gp.committed = this.poison!.offset;
            gp.lastCommitAt = t; // keeps committing the same offset
          } else {
            let cap: number;
            if (g.def.type === 'share') {
              const inFlight = ps.rate * 0.14 * (1 + 0.3 * Math.sin(t / 7000 + gp.p));
              gp.committed = Math.max(gp.committed, ps.end - inFlight);
              cap = 0;
            } else if (g.def.groupId === 'payments-sink') {
              const w = sinkWeight(gp.topic, gp.p);
              cap = ps.rate + w * (inDip ? -SINK_CYCLE.dipDeficit : SINK_CYCLE.drainSurplus);
            } else {
              cap = ps.rate * g.def.capacity * (g.slow ? 0.6 : 1) + 2;
            }
            if (g.slow && g.def.groupId === 'payments-sink') cap *= 0.6;
            gp.committed = Math.min(ps.end, gp.committed + Math.max(0, cap) * dt);
            gp.lastCommitAt = t;
          }
        }
        gp.consumeRate = (gp.committed - before) / dt;
        if (Math.floor(gp.committed) !== Math.floor(before)) gp.frozenSince = t;
        msgsOut += gp.consumeRate;
        bytesOut += gp.consumeRate * ps.def.avgBytes;
        // after a reset, members are away (pause + rejoin): a frozen position then isn't a stall
        if (!g.pausedUntil && !(g.rebalanceUntil && g.resetRejoin))
          gp.ring.push({ t, committed: Math.floor(gp.committed), end: Math.floor(ps.end) });
        if (gp.ring.length > WINDOW) gp.ring.shift();
      }
      if (active) g.lastCommitAt = t;
      this.evaluateGroup(g, t);
    }

    this.dlqExtra = this.poison ? 1 : 0;
    this.lastMetrics = { messagesIn: msgsIn, messagesOut: msgsOut, bytesIn, bytesOut };
    this.record(t);
    this.evaluateAlerts(t);
    this.expireIncidents(t);
  }

  private evaluateGroup(g: GState, t: number): void {
    const statuses: LagStatus[] = [];
    const fparts: Array<{ lag: number; forecast: Forecast }> = [];
    const window = this.replaying && t < this.loadedAt - FINE_MS ? 3 : WINDOW;
    for (const gp of g.parts) {
      const ring = gp.ring.slice(-window);
      gp.status = evaluateLag({
        samples: ring,
        lastCommitAt: gp.lastCommitAt,
        now: t,
        windowMs: this.replaying && t < this.loadedAt - FINE_MS ? 180_000 : WINDOW_MS,
      });
      statuses.push(gp.status);
      const last = ring.at(-1);
      const ps = this.parts.get(gp.topic)?.[gp.p];
      fparts.push({
        // no samples yet (e.g. right after a reset): the real distance, not 0 — 0 would read as caught up
        lag: last
          ? Math.max(0, last.end - (last.committed ?? last.end))
          : ps
            ? Math.max(0, Math.floor(ps.end) - Math.floor(gp.committed))
            : 0,
        forecast: forecastOf(ring),
      });
    }
    const prev = g.status;
    // Share groups (KIP-932) have in-flight records, not a committed position: lag rules don't apply while members run.
    g.status = g.def.type === 'share' && g.members > 0 ? 'healthy' : rollupStatus(statuses);
    // Share groups (KIP-932) have in-flight records, not a committed position to catch up: no forecast.
    g.forecast = g.def.type === 'share' ? { kind: 'unknown' } : combineForecasts(fparts);
    if (!this.replaying || t > this.loadedAt - FINE_MS) {
      if (becameStuck(prev, g.status)) {
        this.pushEvent({
          ts: new Date(t).toISOString(),
          kind: 'chaos',
          severity: 'crit',
          title: `${g.def.groupId} ${g.status}`,
          detail: this.groupDetailLine(g, t),
        });
      }
    }
  }

  private record(t: number): void {
    const v = new Map<string, number>();
    v.set('cluster:messagesIn', this.lastMetrics.messagesIn);
    v.set('cluster:messagesOut', this.lastMetrics.messagesOut);
    v.set('cluster:bytesIn', this.lastMetrics.bytesIn);
    v.set('cluster:bytesOut', this.lastMetrics.bytesOut);
    let urp = 0;
    for (const [name, ps] of this.parts) {
      let r = 0;
      for (const s of ps) {
        r += s.rate;
        v.set(`end:${name}:${s.p}`, s.end);
        if (s.isr.length < s.replicas.length) urp++;
      }
      v.set(`topic:${name}:messagesIn`, r);
      v.set(`topic:${name}:bytesIn`, r * ps[0]!.def.avgBytes);
    }
    v.set('cluster:underReplicated', urp);
    for (const [id, on] of this.brokersOnline) v.set(`broker:${id}:online`, on ? 1 : 0); // for alert previews
    let total = 0;
    for (const g of this.groups.values()) {
      if (g.deleted) continue;
      const lag = this.groupLag(g);
      v.set(`group:${g.def.groupId}:lag`, lag);
      v.set(`group:${g.def.groupId}:alertLag`, g.members > 0 ? lag : 0); // what the live lag rule sees
      v.set(`group:${g.def.groupId}:status`, STATUS_CODE[g.status]);
      if (g.def.type !== 'share' && g.members > 0) total += lag;
    }
    v.set('cluster:lag', total);
    this.history.push(t, v);
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private groupLag(g: GState): number {
    let lag = 0;
    for (const gp of g.parts) {
      const ps = this.parts.get(gp.topic)?.[gp.p];
      if (ps) lag += Math.max(0, Math.floor(ps.end) - Math.floor(gp.committed));
    }
    return lag;
  }

  /** Low watermark: retention keeps a constant number of messages per partition. */
  private low(s: PState): number {
    return Math.max(0, Math.floor(s.end) - s.retained);
  }

  private pushEvent(e: Omit<ClusterEvent, 'id'>): void {
    this.events.push({ ...e, id: `ev_${hash(e.ts, e.title).toString(36)}` });
    this.events.sort((a, b) => a.ts.localeCompare(b.ts));
    if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
  }

  private groupDetailLine(g: GState, t: number): string {
    if (g.status === 'stalled') {
      const stuck = g.parts.filter((p) => p.status === 'stalled');
      const first = stuck[0];
      if (!first) return '';
      const where = stuck.length === 1 ? `Partition ${first.p}` : `${stuck.length} partitions`;
      return `${where} · same offset for ${formatDuration(t - first.frozenSince)}`;
    }
    if (g.status === 'stopped')
      return `No commits for ${formatDuration(t - g.lastCommitAt)} · ${formatInt(this.groupLag(g))} behind`;
    if (g.status === 'warn') {
      const f = g.forecast;
      return `${formatInt(this.groupLag(g))} behind · ${f.kind === 'eta' ? `catch-up in ${formatEta(f.seconds!)}` : 'won’t catch up at current rates'}`;
    }
    return '';
  }

  private timestampOf(s: PState, offset: number): number {
    const t = this.history.timeOf(`end:${s.def.name}:${s.p}`, offset + 1);
    if (t !== undefined) return Math.min(t, this.lastTick);
    // before history: extrapolate with the topic's mean rate
    const first = this.history.first ?? this.lastTick;
    const firstEnd = this.history.at(`end:${s.def.name}:${s.p}`, first) ?? s.end;
    const rate = (s.def.rate || 0.01) / s.def.partitions;
    return Math.floor(first - ((firstEnd - offset) / rate) * 1000);
  }

  private message(s: PState, offset: number, ts?: number): RawMessage {
    const key = `${s.def.name}:${s.p}:${offset}`;
    return generateMessage(this.seed, s.def, s.p, offset, ts ?? this.timestampOf(s, offset), {
      malformed: (topic, p, o) =>
        MALFORMED.some((m) => m.topic === topic && m.partition === p && m.offset === o) ||
        isMalformed(this.seed, topic, p, o),
      poisoned: (topic, p, o) => this.poisoned.has(`${topic}:${p}:${o}`),
      produced: this.produced.get(key),
    });
  }

  private group(id: string): GState {
    const g = this.groups.get(id);
    if (!g || g.deleted) throw new Error(`Consumer group ${id} not found.`);
    return g;
  }

  private topicParts(name: string): PState[] {
    const ps = this.parts.get(name);
    if (!ps) throw new Error(`Topic ${name} not found.`);
    return ps;
  }

  private rebalance(g: GState, t: number, why: string, ms = 8000): void {
    g.state = 'PreparingRebalance';
    g.rebalanceUntil = t + ms;
    this.pushEvent({
      ts: new Date(t).toISOString(),
      kind: 'rebalance',
      severity: 'info',
      title: `${g.def.groupId} rebalanced`,
      detail: why,
    });
  }

  // ───────────────────────────── subscriptions ─────────────────────────────

  onEvent(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    if (this.listeners.size === 0) return;
    const overview = this.getOverview();
    const groups = overview.groups;
    // newest first, as listAlerts and the agent stream order them (the list mustn't reorder when the stream takes over)
    const firing = this.alertEvents
      .filter((a) => a.state === 'firing')
      .sort((a, b) => b.firedAt.localeCompare(a.firedAt));
    for (const l of this.listeners) {
      l('metrics', overview);
      l('lag', groups);
      l('events', overview.events);
      l('alerts', firing);
    }
  }

  tail(
    req: TailRequest,
    cb: (batch: RawMessage[]) => void,
    onError?: (message: string) => void,
  ): () => void {
    const id = ++this.tailSeq;
    const next = new Map<number, number>();
    for (const s of this.topicParts(req.topic))
      if (req.partition === 'all' || req.partition === s.p) next.set(s.p, Math.floor(s.end));
    this.tails.set(id, { req, next, cb, onError });
    return () => this.tails.delete(id);
  }

  private emitTails(): void {
    for (const [id, t] of this.tails) {
      const ps = this.parts.get(t.req.topic);
      // deleted (or re-created with other partitions): end the tail with the agent's message, don't idle on old offsets
      if (!ps || [...t.next.keys()].some((p) => !ps[p] || ps[p].end < t.next.get(p)!)) {
        this.tails.delete(id);
        t.onError?.(`Topic ${t.req.topic} was deleted. The live tail stopped.`);
        continue;
      }
      const maxRate = t.req.maxRate ?? 50;
      const fresh: Array<{ s: PState; offsets: number[] }> = [];
      let total = 0;
      for (const [p, from] of t.next) {
        const s = ps[p]!;
        const to = Math.floor(s.end);
        if (to > from) {
          const offsets: number[] = [];
          for (let o = from; o < to; o++) offsets.push(o);
          fresh.push({ s, offsets });
          total += to - from;
          t.next.set(p, to);
        }
      }
      if (!total) continue;
      // Sample evenly down to maxRate per second; the UI shows the actual rate from metrics.
      const keep = Math.min(1, maxRate / total);
      const batch: RawMessage[] = [];
      for (const { s, offsets } of fresh) {
        const n = Math.max(
          offsets.length && keep * offsets.length >= 0.5 ? 1 : 0,
          Math.round(offsets.length * keep),
        );
        const stride = offsets.length / Math.max(1, n);
        const picked = new Set<number>();
        for (let i = 0; i < n; i++) picked.add(offsets[Math.floor(i * stride + stride - 1)]!);
        // a message the user just produced always shows, however busy the topic (sampling would hide it)
        for (const o of offsets) if (this.produced.has(`${t.req.topic}:${s.p}:${o}`)) picked.add(o);
        for (const o of picked) batch.push(this.message(s, o));
      }
      batch.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const mine = batch.filter((m) => this.produced.has(`${m.topic}:${m.partition}:${m.offset}`));
      const room = Math.max(0, maxRate - mine.length); // slice(-0) would keep everything
      const rest = batch.filter((m) => !mine.includes(m));
      t.cb(
        [...(room ? rest.slice(-room) : []), ...mine].sort((a, b) =>
          a.timestamp.localeCompare(b.timestamp),
        ),
      );
    }
  }

  // ───────────────────────────── KafkaClient: meta ─────────────────────────────

  info(): AppInfo {
    return {
      mode: 'demo',
      version: VERSION,
      readOnly: false,
      capabilities: { writes: true, chaos: true, history: true, auth: false, schemaRegistry: true },
      clusters: [this.clusterSummary()],
    };
  }

  private clusterSummary(): ClusterSummary {
    const offline = [...this.brokersOnline.values()].some((v) => !v);
    return {
      id: CLUSTER.id,
      name: CLUSTER.name,
      status: offline ? 'degraded' : 'connected',
      brokers: BROKERS.length,
      kafkaVersion: CLUSTER.kafkaVersion,
      schemaRegistry: true,
      simulated: true,
    };
  }

  getOverview(): Overview {
    const t = this.lastTick;
    let urp = 0,
      offline = 0,
      total = 0,
      underMinIsr = 0;
    for (const ps of this.parts.values()) {
      // effective min.insync.replicas (config edits included), read once per topic
      const minIsr = Number(this.effectiveConfig(ps[0]!.def.name)['min.insync.replicas'] ?? 2);
      for (const s of ps) {
        total++;
        if (s.isr.length < s.replicas.length) urp++;
        if (s.leader === null) offline++;
        if (s.replicas.length > 1 && s.isr.length < minIsr) underMinIsr++;
      }
    }
    const lagNow = this.history.at('cluster:lag', t) ?? 0;
    const lagAgo = this.history.at('cluster:lag', t - 60_000) ?? lagNow;
    const groups = this.listGroups();
    return {
      cluster: this.clusterSummary(),
      kpis: {
        messagesInPerSec: this.lastMetrics.messagesIn,
        messagesOutPerSec: this.lastMetrics.messagesOut,
        bytesInPerSec: this.lastMetrics.bytesIn,
        totalLag: lagNow,
        lagTrend:
          lagNow > lagAgo * 1.02 + 10
            ? 'rising'
            : lagNow < lagAgo * 0.98 - 10
              ? 'falling'
              : 'steady',
        underReplicated: urp,
        totalPartitions: total,
        brokersOnline: [...this.brokersOnline.values()].filter(Boolean).length,
        brokersTotal: BROKERS.length,
        offlinePartitions: offline,
        underMinIsr,
        activeController: this.controllerId(),
        activeAlerts: this.alertEvents.filter(
          // as the agent counts them: acknowledged alerts aren't active
          (a) =>
            a.state === 'firing' &&
            !a.acknowledged &&
            !(a.mutedUntil && Date.parse(a.mutedUntil) > t),
        ).length,
        topics: this.topics.size,
        groups: groups.length,
      },
      attention: this.attention(groups, urp, offline),
      groups,
      events: this.events.slice(-30).reverse(),
    };
  }

  private attention(groups: GroupSummary[], urp: number, offline: number): AttentionItem[] {
    const t = this.lastTick;
    const items: AttentionItem[] = [];
    const sev: Record<string, number> = { crit: 0, warn: 1, info: 2 };
    for (const b of BROKERS) {
      if (!this.brokersOnline.get(b.id))
        items.push({
          id: `broker-${b.id}`,
          severity: 'crit',
          title: `Broker ${b.id} is offline`,
          detail: `${b.host}:${b.port} · leaders moved to other brokers`,
          since: new Date(t).toISOString(),
          href: '/app/brokers/',
          action: `Investigate broker ${b.id}`,
        });
    }
    if (offline)
      items.push({
        id: 'offline',
        severity: 'crit',
        title: offlineLabel(offline),
        detail:
          offline === 1 ? 'No in-sync replica can lead it' : 'No in-sync replica can lead them',
        since: new Date(t).toISOString(),
        href: '/app/topics/?view=attention',
      });
    if (urp)
      items.push({
        id: 'urp',
        severity: 'warn',
        title: `${plural(urp, 'partition')} under-replicated`,
        detail: 'ISR is smaller than the replica set',
        since: new Date(t).toISOString(),
        href: '/app/topics/?view=attention',
      });
    for (const g of groups) {
      const gs = this.groups.get(g.groupId)!;
      if (g.status === 'stalled' || g.status === 'stopped' || g.status === 'warn') {
        const since =
          g.status === 'stalled'
            ? // its stalled partition may be gone (topic deleted before the next step re-rates the group)
              Math.min(
                t,
                ...gs.parts.filter((p) => p.status === 'stalled').map((p) => p.frozenSince),
              )
            : g.status === 'stopped'
              ? gs.lastCommitAt
              : t;
        items.push({
          id: `group-${g.groupId}`,
          severity: g.status === 'warn' ? 'warn' : 'crit',
          title: `${g.groupId} ${g.status === 'warn' ? 'lag rising' : g.status}`,
          detail: this.groupDetailLine(gs, t),
          since: new Date(since).toISOString(),
          href: `/app/groups/view/?id=${encodeURIComponent(g.groupId)}`,
          action: `Investigate ${g.groupId}`,
        });
      }
    }
    for (const [name, ps] of this.parts) {
      const def = ps[0]!.def;
      if (def.internal) continue;
      const { max, p, flagged } = skewOf(this.shares(def));
      if (flagged) {
        items.push({
          id: `skew-${name}`,
          severity: 'info',
          title: `${name} partition ${p} is hot`,
          detail: `${Math.round(max * 100)}% of topic traffic on 1 of ${def.partitions} partitions`,
          since: new Date(t - 3600e3).toISOString(),
          href: `/app/topics/view/?name=${encodeURIComponent(name)}&tab=partitions`,
          action: `Open ${name}`,
        });
      }
    }
    return items.sort(
      (a, b) => sev[a.severity]! - sev[b.severity]! || b.since.localeCompare(a.since),
    );
  }

  // ───────────────────────────── brokers ─────────────────────────────

  listBrokers(): Broker[] {
    const totalSize = [...this.topics.values()].reduce((a, d) => a + this.sizeOf(d), 0);
    return BROKERS.map((b, i) => {
      let partitions = 0,
        leaders = 0,
        bytesIn = 0;
      for (const ps of this.parts.values()) {
        for (const s of ps) {
          if (s.replicas.includes(b.id)) partitions++;
          if (s.leader === b.id) {
            leaders++;
            bytesIn += s.rate * s.def.avgBytes;
          }
        }
      }
      const online = this.brokersOnline.get(b.id)!;
      return {
        id: b.id,
        host: b.host,
        port: b.port,
        rack: b.rack,
        isController: b.id === this.controllerId(),
        online,
        partitions,
        leaders,
        bytesInPerSec: online ? bytesIn : 0,
        diskUsedBytes: Math.round((totalSize / 3) * [0.99, 0.957, 1.05][i]!),
        diskTotalBytes: b.diskTotalBytes,
      };
    });
  }

  getBrokerConfig(id: number): ConfigEntry[] {
    if (!BROKERS.some((b) => b.id === id)) throw new Error(`Broker ${id} not found.`);
    const key: Array<[string, string, boolean?]> = [
      ['num.partitions', '12'],
      ['default.replication.factor', '3'],
      ['min.insync.replicas', '2'],
      ['log.retention.hours', '168', true],
      ['auto.create.topics.enable', 'true', true],
      ['broker.id', String(id)],
      ['node.id', String(id)],
      ['process.roles', 'broker,controller'],
      ['controller.quorum.voters', '1@kafka-1:9093,2@kafka-2:9093,3@kafka-3:9093'],
      ['listeners', 'PLAINTEXT://:9092,CONTROLLER://:9093'],
      ['advertised.listeners', `PLAINTEXT://kafka-${id}.prod.internal:9092`],
      ['log.dirs', '/var/lib/kafka/data'],
      ['group.coordinator.rebalance.protocols', 'classic,consumer,share'],
      ['share.coordinator.state.topic.replication.factor', '3'],
      ['ssl.keystore.password', null as unknown as string],
    ];
    const generic = BROKER_CONFIG_NAMES.map((n, i): [string, string] => [
      n,
      BROKER_DEFAULTS[i % BROKER_DEFAULTS.length]!,
    ]);
    return [...key, ...generic].map(([name, value, overridden]) => ({
      name,
      value: name.includes('password') ? '******' : value,
      source: overridden
        ? 'static-broker'
        : name.includes('id') ||
            name.includes('listeners') ||
            name === 'log.dirs' ||
            name.startsWith('controller') ||
            name === 'process.roles'
          ? 'static-broker'
          : 'default',
      isDefault: !overridden && !name.includes('id') && !name.includes('listeners'),
      isSensitive: name.includes('password'),
      readOnly: true,
    }));
  }

  // ───────────────────────────── topics ─────────────────────────────

  private sizeOf(def: TopicDef): number {
    const growth = def.name === 'orders' ? 0.05 : 0;
    return Math.round(def.sizeBytes * (1 + (growth * (this.lastTick - this.loadedAt)) / DAY));
  }

  /** KRaft: the lowest online broker leads; none when all are down. */
  private controllerId(): number | null {
    return BROKERS.map((b) => b.id).find((id) => this.brokersOnline.get(id) !== false) ?? null;
  }

  private consumersOf(topic: string): GState[] {
    // by assignment, not the seed definition: a deleted and re-created topic has no consumers until one joins
    return [...this.groups.values()].filter(
      (g) => !g.deleted && g.parts.some((p) => p.topic === topic),
    );
  }

  private health(def: TopicDef, ps: PState[]): HealthFinding[] {
    const out: HealthFinding[] = [];
    const offline = ps.filter((s) => s.leader === null).length;
    if (offline)
      out.push({
        id: 'offline',
        severity: 'crit',
        message: offlineLabel(offline),
        fix: 'Bring the brokers holding its replicas back; until then nothing can be produced to or read from those partitions.',
      });
    if (def.internal) return out;
    // the effective config, so F-36 edits (retention.ms, min.insync.replicas) change the checks
    const cfg = this.effectiveConfig(def.name);
    const retentionMs = Number(cfg['retention.ms']);
    const minIsr = Number(cfg['min.insync.replicas']);
    if (def.rf === 1)
      out.push({
        id: 'rf1',
        severity: 'warn',
        message: 'RF 1',
        fix: 'Increase the replication factor to 3 so a single broker failure does not lose data.',
      });
    if (def.rf >= 3 && minIsr < 2)
      out.push({
        id: 'low-min-isr',
        severity: 'warn',
        message: `min.insync.replicas ${minIsr}`,
        fix: 'Set min.insync.replicas to 2 with acks=all.',
      });
    if (this.consumersOf(def.name).length === 0 && !def.name.endsWith('.dlq'))
      out.push({
        id: 'no-consumers',
        severity: 'info',
        message: 'No consumers',
        fix: 'Nothing reads this topic. Delete it or lower its retention to save disk.',
      });
    if (retentionMs === -1)
      out.push({
        id: 'infinite-retention',
        severity: 'info',
        message: 'Infinite retention',
        fix: 'Set retention.ms or use compaction so the topic stops growing.',
      });
    const sk = skewOf(this.shares(def));
    if (sk.flagged)
      out.push({
        id: 'skew',
        severity: 'warn',
        message: `Skew ${Math.round(sk.max * 100)}%`,
        fix: `Partition ${sk.p} takes ${Math.round(sk.max * 100)}% of the traffic. Use a key with more distinct values.`,
      });
    if (def.name === 'orders') {
      const broker = this.listBrokers()[0]!;
      const free = (broker.diskTotalBytes ?? 0) - (broker.diskUsedBytes ?? 0);
      const growthPerDay = def.sizeBytes * 0.05;
      out.push({
        id: 'disk-fill',
        severity: 'info',
        message: `Disk fills in ~${Math.round(free / growthPerDay)} days`,
        fix: `Retention ${retentionMs > 0 ? `${Math.round(retentionMs / 86_400_000)} days` : 'unlimited'}. Lower retention.ms or add disk before then.`,
      });
    }
    return out;
  }

  private summary(name: string): TopicSummary {
    const ps = this.topicParts(name);
    const def = ps[0]!.def;
    const rate = ps.reduce((a, s) => a + s.rate, 0);
    const last = Math.max(...ps.map((s) => s.lastMsgAt));
    const trend = this.history
      .series(`topic:${name}:messagesIn`, this.lastTick - 3600e3, 24)
      .map(([, v]) => v);
    return {
      name,
      internal: !!def.internal,
      partitions: def.partitions,
      replicationFactor: def.rf,
      sizeBytes: this.sizeOf(def),
      messagesInPerSec: rate,
      consumerGroups: this.consumersOf(name).length,
      // nothing produced yet → no "last message" (lastMsgAt starts at creation for the silence alert)
      lastMessageAt: ps.some((s) => s.end >= 1) ? new Date(last).toISOString() : undefined,
      underReplicated: ps.filter((s) => s.isr.length < s.replicas.length).length,
      health: this.health(def, ps),
      trend,
    };
  }

  listTopics(q: TopicQuery = {}): Page<TopicSummary> {
    let names = [...this.topics.keys()];
    if (!q.internal) names = names.filter((n) => !this.topics.get(n)!.internal);
    if (q.query) {
      let re: RegExp | null = null;
      if (q.regex) {
        re = safeRegex(q.query, 'i'); // the worker can't interrupt a runaway match
      }
      names = names.filter((n) =>
        re ? re.test(n) : n.toLowerCase().includes(q.query!.toLowerCase()),
      );
    }
    let items = names.map((n) => this.summary(n));
    if (q.view === 'attention') items = items.filter(needsAttention);
    if (q.view === 'starred') items = items.filter((t) => q.starred?.includes(t.name));
    const sort = q.sort ?? 'issues';
    const score = (t: TopicSummary) =>
      t.health.some((h) => h.severity === 'crit')
        ? 3
        : t.health.some((h) => h.severity === 'warn')
          ? 2
          : needsAttention(t)
            ? 1
            : 0;
    items.sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : sort === 'size'
          ? (b.sizeBytes ?? -1) - (a.sizeBytes ?? -1) || a.name.localeCompare(b.name) // unknown last
          : sort === 'rate'
            ? b.messagesInPerSec - a.messagesInPerSec || a.name.localeCompare(b.name)
            : // ties by name, not the live rate, so rows don't swap places on every refresh
              score(b) - score(a) || a.name.localeCompare(b.name),
    );
    const size = Math.min(q.size ?? 50, 500);
    const page = Math.max(1, q.page ?? 1);
    return { items: items.slice((page - 1) * size, page * size), total: items.length, page, size };
  }

  getTopic(name: string): TopicDetail {
    const ps = this.topicParts(name);
    const def = ps[0]!.def;
    const shares = this.shares(def);
    const partitions: PartitionInfo[] = ps.map((s) => ({
      partition: s.p,
      leader: s.leader,
      replicas: s.replicas,
      isr: s.isr,
      lowWatermark: this.low(s),
      highWatermark: Math.floor(s.end),
      sharePct: shares[s.p]! * 100,
      lastMessageAt: s.end >= 1 ? new Date(s.lastMsgAt).toISOString() : undefined,
    }));
    const consumers = this.consumersOf(name).map((g) => ({
      groupId: g.def.groupId,
      type: g.def.type,
      lag: g.parts
        .filter((p) => p.topic === name)
        .reduce(
          (a, gp) => a + Math.max(0, Math.floor(ps[gp.p]!.end) - Math.floor(gp.committed)),
          0,
        ),
      status: rollupStatus(g.parts.filter((p) => p.topic === name).map((p) => p.status)),
      state: g.state,
    }));
    return {
      summary: this.summary(name),
      partitions,
      consumers,
      schema: def.subject
        ? {
            valueSubject: def.subject,
            keySubject: registry.SUBJECTS.some((s) => s.subject === `${name}-key`)
              ? `${name}-key`
              : undefined,
          }
        : undefined,
    };
  }

  // effective config per topic, cached: health checks and the min-ISR count read it every tick
  private configCache = new Map<string, Record<string, string | null>>();
  private effectiveConfig(name: string): Record<string, string | null> {
    let c = this.configCache.get(name);
    if (!c) {
      c = Object.fromEntries(this.getTopicConfig(name).map((e) => [e.name, e.value]));
      this.configCache.set(name, c);
    }
    return c;
  }

  getTopicConfig(name: string): ConfigEntry[] {
    const def = this.topicParts(name)[0]!.def;
    const merged: Record<string, string | null> = {
      ...(def.retentionMs !== undefined ? { 'retention.ms': String(def.retentionMs) } : {}),
      ...(def.cleanup === 'compact' ? { 'cleanup.policy': 'compact' } : {}),
      ...(def.name === 'clickstream'
        ? { 'retention.ms': '259200000', 'compression.type': 'zstd' }
        : {}),
      ...(def.name === 'orders' ? { 'max.message.bytes': '2097152' } : {}),
      ...(def.name === 'audit-log' ? { 'min.insync.replicas': '1' } : {}),
      ...def.configs,
    };
    // null marks an override the user reset to the default
    const overrides = Object.fromEntries(
      Object.entries(merged).filter((e): e is [string, string] => e[1] !== null),
    );
    return TOPIC_DEFAULTS.map(([n, v]) => ({
      name: n,
      value: overrides[n] ?? v,
      source: n in overrides ? 'dynamic-topic' : 'default',
      isDefault: !(n in overrides),
      isSensitive: false,
      readOnly: false,
    }));
  }

  // ───────────────────────────── messages ─────────────────────────────

  browse(req: BrowseRequest): RawMessagePage {
    const ps = this.topicParts(req.topic).filter(
      (s) => req.partition === 'all' || s.p === req.partition,
    );
    const limit = Math.min(Math.max(1, req.limit ?? 100), 500);
    const cursor: Record<number, number> = req.cursor ? JSON.parse(req.cursor) : {};
    const descending = req.from === 'newest';
    const candidates: Array<{ s: PState; o: number; t: number }> = [];
    const next: Record<number, number> = {};
    let scanned = 0;
    for (const s of ps) {
      const hw = Math.floor(s.end);
      const lo = this.low(s);
      let startAt: number;
      if (req.cursor && cursor[s.p] !== undefined) startAt = cursor[s.p]!;
      else if (req.from === 'newest') startAt = hw - 1;
      else if (req.from === 'oldest') startAt = lo;
      else if (req.from === 'offset') startAt = Math.max(lo, Math.min(hw, req.offset ?? lo));
      else if (req.from === 'timestamp')
        startAt = this.offsetAt(s, Date.parse(req.timestamp ?? '') || this.lastTick);
      else {
        const g = req.group ? this.groups.get(req.group) : undefined;
        const gp = g?.parts.find((x) => x.topic === s.def.name && x.p === s.p);
        startAt = gp ? Math.floor(gp.committed) : hw;
      }
      const per = req.partition === 'all' ? limit : limit;
      const offsets: number[] = [];
      if (descending) for (let o = startAt; o >= lo && offsets.length < per; o--) offsets.push(o);
      else for (let o = startAt; o < hw && offsets.length < per; o++) offsets.push(o);
      scanned += offsets.length;
      for (const o of offsets) candidates.push({ s, o, t: this.timestampOf(s, o) });
    }
    candidates.sort((a, b) => (descending ? b.t - a.t || b.o - a.o : a.t - b.t || a.o - b.o));
    const picked = candidates.slice(0, limit);
    for (const s of ps) {
      const mine = picked.filter((c) => c.s === s).map((c) => c.o);
      if (mine.length) next[s.p] = descending ? Math.min(...mine) - 1 : Math.max(...mine) + 1;
      else if (cursor[s.p] !== undefined) next[s.p] = cursor[s.p]!;
    }
    return {
      messages: picked.map((c) => this.message(c.s, c.o, c.t)),
      nextCursor: picked.length === limit ? JSON.stringify(next) : undefined,
      scanned,
    };
  }

  private offsetAt(s: PState, ts: number): number {
    const v = this.history.at(`end:${s.def.name}:${s.p}`, ts);
    return Math.max(this.low(s), Math.floor(v ?? this.low(s)));
  }

  search(req: SearchRequest): RawMessagePage {
    const re = safeRegex(req.topicRegex);
    // same as the agent (AGENT_API): at most 20 matching topics, results newest first whichever end is read
    const topics = [...this.topics.keys()]
      .filter((n) => re.test(n) && !this.topics.get(n)!.internal)
      .slice(0, 20);
    const limit = Math.min(req.limit ?? 100, 500);
    const out: RawMessage[] = [];
    let scanned = 0;
    for (const name of topics) {
      const ps = this.parts.get(name)!;
      const per = Math.max(1, Math.ceil(limit / topics.length / (req.sample ? ps.length : 1)));
      for (const s of req.sample ? ps : [ps.reduce((a, b) => (b.rate > a.rate ? b : a))]) {
        const hw = Math.floor(s.end),
          lo = this.low(s);
        for (let i = 0; i < per; i++) {
          const o = req.from === 'newest' ? hw - 1 - i : lo + i;
          if (o < lo || o >= hw) break;
          out.push(this.message(s, o));
          scanned++;
        }
      }
    }
    out.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return { messages: out.slice(0, limit), scanned };
  }

  // ───────────────────────────── groups ─────────────────────────────

  private groupSummary(g: GState): GroupSummary {
    const topics = [...new Set(g.parts.map((p) => p.topic))];
    return {
      groupId: g.def.groupId,
      type: g.def.type,
      state: g.state,
      members: g.members,
      topics,
      totalLag: this.groupLag(g),
      lastCommitAt: new Date(g.lastCommitAt).toISOString(),
      status: g.status,
      forecast: g.forecast,
      trend: this.history
        .series(`group:${g.def.groupId}:lag`, this.lastTick - 3600e3, 24)
        .map(([, v]) => v),
    };
  }

  listGroups(q: GroupQuery = {}): GroupSummary[] {
    const rank: Record<LagStatus, number> = {
      stalled: 0,
      stopped: 1,
      warn: 2,
      unknown: 3,
      healthy: 4,
    };
    return [...this.groups.values()]
      .filter((g) => !g.deleted)
      .filter((g) => !q.type || g.def.type === q.type)
      .filter((g) => !q.query || g.def.groupId.includes(q.query))
      .map((g) => this.groupSummary(g))
      .sort((a, b) => rank[a.status] - rank[b.status] || b.totalLag - a.totalLag);
  }

  getGroup(id: string): GroupDetail {
    const g = this.group(id);
    const members = Array.from({ length: g.members }, (_, i) => ({
      memberId: `${id}-${i + 1}-${hex(rng(hash(this.seed, id, i)), 8)}`,
      clientId: `${id}-${i + 1}`,
      host: `${g.def.hostBase}${12 + i * 4 + (i % 2)}`,
      assignments:
        g.def.type === 'share'
          ? g.parts.map((p) => ({ topic: p.topic, partition: p.p }))
          : g.parts
              .filter((_, k) => k % g.members === i)
              .map((p) => ({ topic: p.topic, partition: p.p })),
    }));
    const partitions: GroupPartitionLag[] = g.parts.map((gp, k) => {
      const ps = this.parts.get(gp.topic)![gp.p]!;
      const owner = members.length
        ? members[g.def.type === 'share' ? 0 : k % members.length]
        : undefined;
      return {
        topic: gp.topic,
        partition: gp.p,
        committedOffset: Math.floor(gp.committed),
        endOffset: Math.floor(ps.end),
        lag: Math.max(0, Math.floor(ps.end) - Math.floor(gp.committed)),
        memberId: owner?.memberId,
        clientId: owner?.clientId,
        host: owner?.host,
        status: gp.status,
      };
    });
    partitions.sort((a, b) => b.lag - a.lag);
    return {
      summary: this.groupSummary(g),
      partitions,
      members,
      share:
        g.def.type === 'share'
          ? undefined // as the agent: delivery counts and lock times aren't reported (rule 7: no invented numbers)
          : undefined,
    };
  }

  // ───────────────────────────── history ─────────────────────────────

  getHistory(q: HistoryQuery): Series[] {
    const span: Record<HistoryQuery['range'], number> = {
      '15m': 15 * 60e3,
      '1h': 3600e3,
      '24h': DAY,
      '7d': 7 * DAY,
    };
    const from = this.lastTick - span[q.range];
    const key = (k: string) => [{ key: q.key ?? q.scope, points: this.history.series(k, from) }];
    switch (q.scope) {
      case 'cluster':
        return key(`cluster:${q.metric === 'lag' ? 'lag' : q.metric}`);
      case 'topic':
        if (q.metric === 'endOffset')
          return (this.parts.get(q.key!) ?? []).map((s) => ({
            key: `${q.key}-${s.p}`,
            points: this.history.series(`end:${q.key}:${s.p}`, from),
          }));
        return key(`topic:${q.key}:${q.metric}`);
      case 'group':
        return key(`group:${q.key}:lag`);
      case 'partition': {
        const [topic, p] = splitPartitionKey(q.key ?? '');
        return key(`end:${topic}:${p}`);
      }
    }
  }

  // ───────────────────────────── schemas ─────────────────────────────

  listSubjects(): SubjectSummary[] {
    return registry.listSubjects();
  }
  getSchema(subject: string, version: number | 'latest'): SchemaVersion {
    const s = registry.getSchema(subject, version);
    if (!s) throw new Error(`Subject ${subject} version ${version} not found.`);
    return s;
  }
  getSchemaById(id: number): SchemaVersion {
    const s = registry.getSchemaById(id);
    if (!s) throw new Error(`Schema ${id} not found.`);
    return s;
  }
  checkCompatibility(subject: string, schema: string): CompatibilityResult {
    const latest = this.getSchema(subject, 'latest');
    const sub = registry.listSubjects().find((s) => s.subject === subject)!;
    if (!sub.compatibility.endsWith('_TRANSITIVE'))
      return checkCompatibility(latest.type, latest.schema, schema, sub.compatibility);
    // *_TRANSITIVE: the candidate must be compatible with every registered version
    const messages: string[] = [];
    for (const v of sub.versions) {
      const old = this.getSchema(subject, v);
      const r = checkCompatibility(old.type, old.schema, schema, sub.compatibility);
      if (!r.compatible) messages.push(...r.messages.map((m) => `v${v}: ${m}`));
    }
    return { compatible: messages.length === 0, messages };
  }

  // ───────────────────────────── topology ─────────────────────────────

  getTopology(): Topology {
    const core = [...this.topics.values()].filter(
      (d) => !d.internal && d.producer && d.producer !== 'platform-services',
    );
    const nodes: Topology['nodes'] = [];
    const edges: Topology['edges'] = [];
    const producers = new Set<string>();
    for (const def of core) {
      const rate = this.parts.get(def.name)!.reduce((a, s) => a + s.rate, 0);
      const health = this.summary(def.name).health;
      const finding = health.find((h) => h.severity === 'warn' || h.severity === 'crit');
      nodes.push({
        id: `topic:${def.name}`,
        kind: 'topic',
        label: def.name,
        note: finding?.message.replace(/^Skew/, 'skew'),
        status: health.some((h) => h.severity === 'warn' || h.severity === 'crit')
          ? 'warn'
          : 'healthy',
        rate,
      });
      const isDlq = def.name.endsWith('.dlq');
      if (isDlq) {
        edges.push({ from: `group:${def.producer}`, to: `topic:${def.name}`, rate, kind: 'dlq' });
      } else {
        producers.add(def.producer!);
        edges.push({
          from: `producer:${def.producer}`,
          to: `topic:${def.name}`,
          rate,
          kind: 'produce',
        });
      }
    }
    for (const p of producers) {
      const rate = edges.filter((e) => e.from === `producer:${p}`).reduce((a, e) => a + e.rate, 0);
      nodes.unshift({ id: `producer:${p}`, kind: 'producer', label: p, status: 'neutral', rate });
    }
    for (const g of this.groups.values()) {
      if (g.deleted) continue;
      const rate = g.parts.reduce((a, p) => a + p.consumeRate, 0);
      const neutral = isNeutralState(g.state) && g.status === 'healthy';
      nodes.push({
        id: `group:${g.def.groupId}`,
        kind: 'group',
        label: g.def.groupId,
        note:
          g.status === 'stalled' || g.status === 'stopped'
            ? g.status
            : g.def.type === 'share'
              ? 'share'
              : g.status === 'warn'
                ? `${formatCount(this.groupLag(g))} behind`
                : undefined,
        status: neutral ? 'neutral' : g.status,
        rate,
      });
      for (const topic of new Set(g.parts.map((p) => p.topic))) {
        if (!core.some((d) => d.name === topic)) continue;
        const r = g.parts.filter((p) => p.topic === topic).reduce((a, p) => a + p.consumeRate, 0);
        edges.push({
          from: `topic:${topic}`,
          to: `group:${g.def.groupId}`,
          rate: r,
          kind: 'consume',
        });
      }
    }
    return { nodes, edges };
  }

  // ───────────────────────────── alerts ─────────────────────────────

  private conditions(
    rule: AlertRule,
    t: number,
  ): Array<{ target: string; title: string; evidence: string; href: string }> {
    const out: Array<{ target: string; title: string; evidence: string; href: string }> = [];
    const inScope = (target: string) => rule.scope.kind === 'any' || rule.scope.target === target;
    switch (rule.metric) {
      case 'lag':
        for (const g of this.groups.values()) {
          if (g.deleted || g.def.type === 'share' || !inScope(g.def.groupId)) continue;
          const lag = this.groupLag(g);
          if (g.members > 0 && lag > (rule.threshold ?? 0))
            out.push({
              target: g.def.groupId,
              title: `${g.def.groupId} lag above ${formatInt(rule.threshold ?? 0)}`,
              evidence: `${formatInt(lag)} behind`,
              href: `/app/groups/view/?id=${g.def.groupId}`,
            });
        }
        break;
      case 'group-status':
        for (const g of this.groups.values()) {
          if (g.deleted || !inScope(g.def.groupId)) continue;
          if (g.status === 'stalled' || g.status === 'stopped')
            out.push({
              target: g.def.groupId,
              title: `${g.def.groupId} ${g.status}`,
              evidence: this.groupDetailLine(g, t),
              href: `/app/groups/view/?id=${g.def.groupId}`,
            });
        }
        break;
      case 'under-replicated': {
        let urp = 0;
        for (const ps of this.parts.values())
          for (const s of ps) if (s.isr.length < s.replicas.length) urp++;
        if (urp > (rule.threshold ?? 0))
          out.push({
            target: 'cluster',
            title: `${plural(urp, 'partition')} under-replicated`,
            evidence: 'ISR smaller than the replica set',
            href: '/app/topics/?view=attention',
          });
        break;
      }
      case 'broker-offline':
        for (const [id, on] of this.brokersOnline)
          if (!on && inScope(`broker-${id}`))
            // the rule dialog (and the agent) name brokers broker-<id>
            out.push({
              target: `broker-${id}`,
              title: `Broker ${id} offline`,
              evidence: 'Not reachable by the controller',
              href: '/app/brokers/',
            });
        break;
      case 'topic-silent':
        for (const [name, ps] of this.parts) {
          const def = ps[0]!.def;
          if (def.internal || !inScope(name) || this.consumersOf(name).length === 0) continue;
          const last = Math.max(...ps.map((s) => s.lastMsgAt));
          if (t - last > rule.durationSec * 1000)
            out.push({
              target: name,
              title: `${name} is silent`,
              evidence: `No messages for ${formatDuration(t - last)}`,
              href: `/app/topics/view/?name=${name}`,
            });
        }
        break;
      case 'dlq-receiving':
        for (const [name, ps] of this.parts) {
          if (!name.endsWith('.dlq') || !inScope(name)) continue;
          const rate = ps.reduce((a, s) => a + s.rate, 0);
          if (rate > (rule.threshold ?? 0) + 0.5)
            out.push({
              target: name,
              title: `${name} is receiving messages`,
              evidence: `${rate.toFixed(1)}/s`,
              href: `/app/topics/view/?name=${name}&tab=messages`,
            });
        }
        break;
    }
    return out;
  }

  private evaluateAlerts(t: number): void {
    for (const rule of this.rules) {
      // a disabled rule has no hits, so its firing alerts resolve below
      const hits = rule.enabled ? this.conditions(rule, t) : [];
      const active = new Set(hits.map((h) => `${rule.id}|${h.target}`));
      for (const h of hits) {
        const k = `${rule.id}|${h.target}`;
        if (!this.pending.has(k)) this.pending.set(k, t);
        const fire =
          rule.metric === 'topic-silent' || t - this.pending.get(k)! >= rule.durationSec * 1000;
        const ev = this.firing.get(k);
        if (ev) {
          ev.title = h.title;
          ev.evidence = h.evidence;
        } else if (fire && !rule.muted) {
          const firedAt =
            rule.metric === 'topic-silent' ? t : this.pending.get(k)! + rule.durationSec * 1000;
          const e: AlertEvent = {
            id: `al_${hash(k, firedAt).toString(36)}`,
            ruleId: rule.id,
            severity: rule.severity,
            title: h.title,
            evidence: h.evidence,
            target: h.target,
            href: h.href,
            state: 'firing',
            firedAt: new Date(firedAt).toISOString(),
          };
          this.firing.set(k, e);
          this.alertEvents.push(e);
          this.pushEvent({
            ts: e.firedAt,
            kind: 'alert-fired',
            severity: rule.severity === 'info' ? 'info' : rule.severity,
            title: `Alert: ${h.title}`,
            detail: h.evidence,
          });
        }
      }
      for (const [k, e] of this.firing) {
        if (!k.startsWith(`${rule.id}|`) || active.has(k)) continue;
        e.state = 'resolved';
        e.resolvedAt = new Date(t).toISOString();
        this.firing.delete(k);
        this.pushEvent({
          ts: e.resolvedAt,
          kind: 'alert-resolved',
          severity: 'info',
          title: `Resolved: ${e.title}`,
        });
      }
      for (const k of [...this.pending.keys()])
        if (k.startsWith(`${rule.id}|`) && !active.has(k)) this.pending.delete(k);
    }
    if (this.alertEvents.length > 500) this.alertEvents.splice(0, this.alertEvents.length - 500);
  }

  listAlertRules(): AlertRule[] {
    return this.rules.map((r) => ({
      ...r,
      state: [...this.firing.keys()].some((k) => k.startsWith(`${r.id}|`))
        ? 'firing'
        : [...this.pending.keys()].some((k) => k.startsWith(`${r.id}|`))
          ? 'pending'
          : 'ok',
    }));
  }

  async saveAlertRule(input: AlertRuleInput & { id?: string }): Promise<AlertRule> {
    // the agent's checks and messages (AlertService.validate), so the demo refuses the same rules
    if (!input.name.trim()) throw new Error('Give the rule a name.');
    if (!input.metric) throw new Error('Choose a metric.');
    if (!input.severity) throw new Error('Choose a severity: info, warn or crit.');
    if (!(ALERT_METRICS as readonly string[]).includes(input.metric))
      throw new Error(`Unknown metric ${input.metric}. Use one of [${ALERT_METRICS.join(', ')}].`);
    if (!(input.durationSec >= 0)) throw new Error("Duration can't be negative.");
    if (input.name.length > 200) throw new Error('Rule names are limited to 200 characters.');
    if (!['info', 'warn', 'crit'].includes(input.severity))
      throw new Error('Severity must be info, warn or crit.');
    if (input.scope && !['any', 'specific'].includes(input.scope.kind))
      throw new Error('Scope kind must be any or specific.');
    if (input.id && !this.rules.some((r) => r.id === input.id))
      throw new Error(`Alert rule ${input.id} doesn't exist.`); // an edit of a deleted rule must not recreate it
    if (
      input.threshold !== undefined &&
      !(Number.isFinite(input.threshold) && input.threshold >= 0)
    )
      throw new Error('The threshold must be a number of 0 or more.');
    const rule: AlertRule = {
      ...input,
      id: input.id ?? `r_${crypto.randomUUID()}`, // two same-named rules in one tick must not collide
    };
    const i = this.rules.findIndex((r) => r.id === rule.id);
    if (i >= 0) this.rules[i] = rule;
    else this.rules.push(rule);
    await this.store.saveRules(this.rules);
    return rule;
  }

  async deleteAlertRule(id: string): Promise<void> {
    this.rules = this.rules.filter((r) => r.id !== id);
    for (const k of [...this.pending.keys()]) if (k.startsWith(`${id}|`)) this.pending.delete(k);
    for (const [k, e] of [...this.firing]) {
      if (!k.startsWith(`${id}|`)) continue;
      e.state = 'resolved';
      e.resolvedAt = new Date(this.lastTick).toISOString();
      this.firing.delete(k);
    }
    await this.store.saveRules(this.rules);
  }

  listAlerts(q: AlertQuery = {}): AlertEvent[] {
    const state = q.state ?? 'all';
    return (
      this.alertEvents
        .filter((a) => state === 'all' || a.state === state)
        // firing first (as the agent lists them): a long-running alert mustn't drop off behind newer resolved ones
        .sort(
          (a, b) =>
            Number(b.state === 'firing') - Number(a.state === 'firing') ||
            b.firedAt.localeCompare(a.firedAt),
        )
        .slice(0, q.limit ?? 200)
    );
  }

  muteAlert(id: string, until: string): void {
    const a = this.alertEvents.find((x) => x.id === id);
    if (!a) throw new Error(`No alert event ${id}. It may have been pruned; the list refreshes.`);
    const t = Date.parse(until);
    if (Number.isNaN(t)) throw new Error('Give "until" as an ISO 8601 time.');
    if (t <= this.lastTick) throw new Error('"until" must be in the future.');
    if (t > this.lastTick + 365 * DAY) throw new Error('Mute for a year at most.');
    a.mutedUntil = until;
  }

  acknowledgeAlert(id: string): void {
    const a = this.alertEvents.find((x) => x.id === id);
    if (!a) throw new Error(`No alert event ${id}. It may have been pruned; the list refreshes.`);
    a.acknowledged = true;
  }

  /** "Would have fired N times in the last 24 h" — replays the rule over recorded history. */
  previewAlertRule(rule: AlertRuleInput): { firings: number } {
    const from = this.lastTick - DAY;
    let firings = 0;
    const scan = (points: Array<[number, number]>, hit: (v: number) => boolean) => {
      let since: number | null = null;
      let fired = false;
      for (const [t, v] of points) {
        if (hit(v)) {
          since ??= t;
          if (!fired && t - since >= rule.durationSec * 1000) {
            firings++;
            fired = true;
          }
        } else {
          since = null;
          fired = false;
        }
      }
    };
    // full resolution: bucket averages turn a 0/1 signal into 0.5 and hide short outages
    // (history keeps 1 sample/min beyond 15 min, so shorter episodes there are gone either way)
    const N = DAY / 1000;
    const groups = [...this.groups.values()].filter(
      (g) => !g.deleted && (rule.scope.kind === 'any' || rule.scope.target === g.def.groupId),
    );
    if (rule.metric === 'lag')
      for (const g of groups)
        if (g.def.type !== 'share')
          // alertLag is 0 while the group has no members, as the live rule skips them
          scan(
            this.history.series(`group:${g.def.groupId}:alertLag`, from, N),
            (v) => v > (rule.threshold ?? 0),
          );
    if (rule.metric === 'group-status')
      for (const g of groups)
        scan(
          this.history.series(`group:${g.def.groupId}:status`, from, N),
          (v) => v >= STATUS_CODE.stalled,
        );
    if (rule.metric === 'under-replicated')
      scan(
        this.history.series('cluster:underReplicated', from, N),
        (v) => v > (rule.threshold ?? 0),
      );
    // the same conditions the live evaluation uses, replayed over recorded history
    const inScope = (target: string) => rule.scope.kind === 'any' || rule.scope.target === target;
    if (rule.metric === 'broker-offline')
      for (const id of this.brokersOnline.keys())
        if (inScope(`broker-${id}`))
          scan(this.history.series(`broker:${id}:online`, from, N), (v) => v === 0);
    if (rule.metric === 'topic-silent')
      for (const [name, ps] of this.parts)
        if (!ps[0]!.def.internal && inScope(name) && this.consumersOf(name).length > 0)
          scan(this.history.series(`topic:${name}:messagesIn`, from, N), (v) => v === 0);
    if (rule.metric === 'dlq-receiving')
      for (const name of this.parts.keys())
        if (name.endsWith('.dlq') && inScope(name))
          scan(
            this.history.series(`topic:${name}:messagesIn`, from, N),
            (v) => v > (rule.threshold ?? 0) + 0.5,
          );
    return { firings };
  }

  // ───────────────────────────── writes (demo) ─────────────────────────────

  /** A saved action that no longer applies (e.g. a reset on a deleted topic) is skipped, not fatal. */
  private replay(a: Action): void {
    try {
      this.applyAction(a, true);
    } catch (e) {
      console.warn(`Skipped a saved demo change (${a.kind}): ${(e as Error).message}`);
    }
  }

  private applyAction(a: Action, replay = false): void {
    // any write can change a topic's config (create with configs, edit, delete + re-create)
    this.configCache.clear();
    switch (a.kind) {
      case 'create-topic': {
        const spec = a.payload as NewTopic;
        const def: TopicDef = {
          name: spec.name,
          partitions: spec.partitions,
          rf: spec.replicationFactor,
          rate: 0,
          avgBytes: 300,
          sizeBytes: 0,
          format: 'json',
          endAtLoad: 0,
          retentionMs: spec.retentionMs,
          cleanup: spec.cleanupPolicy === 'compact' ? 'compact' : 'delete',
          configs: {
            ...spec.configs,
            ...(spec.cleanupPolicy && spec.cleanupPolicy !== 'delete'
              ? { 'cleanup.policy': spec.cleanupPolicy }
              : {}),
          },
        };
        this.addTopic(def, this.topics.size, a.t);
        this.pushEvent({
          ts: new Date(a.t).toISOString(),
          kind: 'topic-created',
          severity: 'info',
          title: `Topic ${spec.name} created`,
          detail: `${spec.partitions} partitions · RF ${spec.replicationFactor}`,
        });
        break;
      }
      case 'delete-topic': {
        const name = a.payload as string;
        this.topics.delete(name);
        this.parts.delete(name);
        // groups stop reading it; its produced messages and poison markers go with it
        for (const g of this.groups.values()) g.parts = g.parts.filter((gp) => gp.topic !== name);
        for (const k of this.produced.keys()) if (k.startsWith(`${name}:`)) this.produced.delete(k);
        for (const k of this.poisoned) if (k.startsWith(`${name}:`)) this.poisoned.delete(k);
        if (this.poison?.topic === name) this.endPoison(); // no topic, no poison message, no DLQ trickle
        // a re-created topic of the same name starts a fresh history (timeOf assumes a rising series)
        this.history.drop((k) => k.startsWith(`end:${name}:`) || k.startsWith(`topic:${name}:`));
        this.pushEvent({
          ts: new Date(a.t).toISOString(),
          kind: 'topic-deleted',
          severity: 'warn',
          title: `Topic ${name} deleted`,
        });
        break;
      }
      case 'update-config': {
        const { name, changes } = a.payload as {
          name: string;
          changes: Record<string, string | null>;
        };
        const def = this.topics.get(name);
        if (!def) break;
        // null is kept as a marker so built-in overrides reset too
        def.configs = { ...def.configs, ...changes };
        this.pushEvent({
          ts: new Date(a.t).toISOString(),
          kind: 'config',
          severity: 'info',
          title: `Config changed on ${name}`,
          detail: Object.entries(changes)
            .map(([k, v]) => `${k} = ${v ?? 'default'}`)
            .join(' · '),
        });
        break;
      }
      case 'produce':
        this.doProduce(a.payload as ProduceRequest, a.t);
        break;
      case 'reset-offsets':
        this.doReset(a.payload as ResetOffsetsRequest, false, a.t);
        break;
      case 'delete-group': {
        const g = this.groups.get(a.payload as string);
        if (g) g.deleted = true;
        if (this.poison?.group === a.payload) this.endPoison();
        break;
      }
    }
    void replay;
  }

  private async log(kind: Action['kind'], payload: unknown): Promise<void> {
    const a: Action = { t: this.lastTick, kind, payload };
    this.applyAction(a);
    await this.store.append(a);
  }

  async createTopic(spec: NewTopic): Promise<void> {
    if (!TOPIC_NAME.test(spec.name))
      throw new Error(
        'Topic names use letters, digits, ".", "_" and "-" (max 249 characters), and can\'t be "." or "..".',
      );
    if (this.topics.has(spec.name)) throw new Error(`Topic ${spec.name} already exists.`);
    if (!Number.isInteger(spec.partitions) || spec.partitions < 1 || spec.partitions > 1000)
      throw new Error('Partitions must be between 1 and 1,000.');
    const online = [...this.brokersOnline.values()].filter(Boolean).length;
    if (
      !Number.isInteger(spec.replicationFactor) ||
      spec.replicationFactor < 1 ||
      spec.replicationFactor > online
    )
      throw new Error(`Replication factor must be between 1 and ${online} (brokers online).`);
    // only an override the user chose is checked: like Kafka, a topic may be created under the cluster default
    const minIsr = Number(spec.configs?.['min.insync.replicas'] ?? 0);
    if (minIsr > spec.replicationFactor)
      throw new Error(
        `min.insync.replicas (${minIsr}) can't exceed the replication factor (${spec.replicationFactor}): every acks=all write would fail.`,
      );
    await this.log('create-topic', spec);
  }

  async updateTopicConfig(name: string, changes: Record<string, string | null>): Promise<void> {
    const def = this.topics.get(name);
    if (!def) throw new Error(`Topic ${name} not found.`);
    if (def.internal) throw new Error('Internal topic configs cannot be changed here.');
    const known = new Map(TOPIC_DEFAULTS);
    for (const [k, v] of Object.entries(changes)) {
      if (!known.has(k)) throw new Error(`Unknown topic config ${k}.`);
      if (v === null) continue;
      const def0 = known.get(k)!;
      if (/^-?\d+$/.test(def0) && !/^-?\d+$/.test(v))
        throw new Error(`${k} must be a whole number.`);
      if (/^-?\d+$/.test(def0)) {
        // Kafka's own lower bounds: -1 means "unlimited" for retention, -2 "use the broker's" for local retention
        const min = MIN_CONFIG[k] ?? 0;
        if (Number(v) < min)
          throw new Error(`${k} must be ${min < 0 ? `${min} or more` : `at least ${min}`}.`);
        if (k === 'min.insync.replicas' && Number(v) > def.rf)
          throw new Error(
            `min.insync.replicas can't exceed the replication factor (${def.rf}): every acks=all write would fail.`,
          );
      }
      if ((def0 === 'true' || def0 === 'false') && v !== 'true' && v !== 'false')
        throw new Error(`${k} must be true or false.`);
    }
    if (Object.keys(changes).length) await this.log('update-config', { name, changes });
  }

  async deleteTopic(name: string): Promise<void> {
    const def = this.topics.get(name);
    if (!def) throw new Error(`Topic ${name} not found.`);
    if (def.internal) throw new Error('Internal topics cannot be deleted.');
    await this.log('delete-topic', name);
  }

  private doProduce(req: ProduceRequest, t: number): ProduceResult {
    const ps = this.topicParts(req.topic);
    const enc = new TextEncoder();
    const count = Math.max(1, Math.min(req.count ?? 1, 1000));
    const partition =
      req.partition ??
      (req.key ? hash(req.key) % ps.length : Math.floor(rng(hash(t))() * ps.length));
    const s = ps[partition];
    if (!s) throw new Error(`Partition ${partition} does not exist on ${req.topic}.`);
    if (s.leader === null)
      throw new Error(
        `Partition ${partition} of ${req.topic} has no leader (its brokers are down). Pick another partition or bring the broker back.`,
      );
    // the same limits a real cluster applies (producers default to acks=all since Kafka 3.0)
    const cfg = this.effectiveConfig(req.topic);
    const minIsr = Number(cfg['min.insync.replicas']);
    if (s.isr.length < minIsr)
      throw new Error(
        `Not enough in-sync replicas for partition ${partition} of ${req.topic}: ${s.isr.length} of the ${minIsr} min.insync.replicas requires. Bring the broker back, or produce to another partition.`,
      );
    const maxBytes = Number(cfg['max.message.bytes']);
    const first = Math.floor(s.end);
    for (let i = 0; i < count; i++) {
      const offset = first + i;
      const text = count > 1 ? req.value.replaceAll('{{i}}', String(i + 1)) : req.value;
      let value: Uint8Array = enc.encode(text);
      // Avro topics get real Confluent-framed Avro so produced messages decode like the rest.
      if (req.valueFormat === 'avro' && s.def.subject) {
        const schema = registry.getSchema(s.def.subject, 'latest')!;
        const type = AvroType.parse(schema.schema);
        value = frame(schema.id, type.encode(fromDisplay(type.schema, JSON.parse(text))));
      }
      const key = req.key ? enc.encode(req.key) : null;
      const headers = (req.headers ?? []).map((h) => ({ key: h.key, value: enc.encode(h.value) }));
      const size = value.length + (key?.length ?? 0);
      if (maxBytes > 0 && size > maxBytes)
        throw new Error(
          `The message is ${formatInt(size)} bytes; ${req.topic} accepts at most ${formatInt(maxBytes)} (max.message.bytes). Make it smaller or raise the topic's limit.`,
        );
      this.produced.set(`${req.topic}:${partition}:${offset}`, {
        topic: req.topic,
        partition,
        offset,
        timestamp: new Date(t).toISOString(),
        key,
        value,
        headers,
        sizeBytes: (key?.length ?? 0) + value.length,
      });
    }
    s.end = first + count + (s.end - first);
    s.lastMsgAt = t;
    return { partition, offset: first, count };
  }

  async produce(req: ProduceRequest): Promise<ProduceResult> {
    if (!this.topics.has(req.topic)) throw new Error(`Topic ${req.topic} not found.`);
    const res = this.doProduce(req, this.lastTick);
    await this.store.append({ t: this.lastTick, kind: 'produce', payload: req });
    return res;
  }

  private doReset(req: ResetOffsetsRequest, dryRun: boolean, t: number): ResetPreview {
    const g = this.group(req.groupId);
    const ps = this.topicParts(req.topic);
    const rows = g.parts
      .filter((gp) => gp.topic === req.topic)
      .map((gp) => {
        const s = ps[gp.p]!;
        const lo = this.low(s),
          hw = Math.floor(s.end);
        const current = Math.floor(gp.committed);
        if (req.partitions !== 'all' && !req.partitions.includes(gp.p))
          return {
            partition: gp.p,
            current,
            next: current,
            lagAfter: hw - current,
            skipped: true,
            reason: 'Not selected',
          };
        const st = req.strategy;
        let next =
          st.kind === 'earliest'
            ? lo
            : st.kind === 'latest'
              ? hw
              : st.kind === 'offset'
                ? st.offset
                : st.kind === 'shift'
                  ? current + st.by
                  : this.offsetAt(s, Date.parse(st.timestamp));
        next = Math.max(lo, Math.min(hw, next));
        return {
          partition: gp.p,
          current,
          next,
          lagAfter: hw - next,
          skipped: next === current,
          reason: next === current ? 'Already at that offset' : undefined,
        };
      })
      .sort((a, b) => a.partition - b.partition);
    if (!dryRun) {
      for (const row of rows) {
        if (row.skipped) continue;
        const gp = g.parts.find((x) => x.topic === req.topic && x.p === row.partition)!;
        gp.committed = row.next;
        gp.frozenSince = t;
        gp.lastCommitAt = t;
        gp.ring = [];
        if (
          this.poison &&
          this.poison.group === g.def.groupId &&
          this.poison.topic === req.topic &&
          this.poison.p === row.partition &&
          row.next > this.poison.offset
        ) {
          if (this.poison.incident) this.incidents.delete(this.poison.incident);
          // the opening scenario must not re-stall it on reload (a chaos-made poison isn't replayed)
          if (!this.replaying && !this.poison.incident)
            void this.store.append({
              t,
              kind: 'poison-fixed',
              payload: { since: this.poison.since },
            });
          this.poison = null;
        }
      }
      // The simulator pauses members for the reset (a real reset needs an empty group), then they rejoin.
      if (g.members > 0 && !g.crashed) {
        g.state = 'Empty';
        g.pausedUntil = t + 2000;
        g.rebalanceUntil = 0; // the reset's own pause and rejoin replace a running rebalance
        g.resetRejoin = false;
      }
      this.pushEvent({
        ts: new Date(t).toISOString(),
        kind: 'offsets-reset',
        severity: 'info',
        title: `Offsets reset for ${g.def.groupId}`,
        detail: `${req.topic} · ${plural(rows.filter((r) => !r.skipped).length, 'partition')} · ${describeStrategy(req)}`,
      });
    }
    return { rows, applied: !dryRun };
  }

  async resetOffsets(req: ResetOffsetsRequest, dryRun: boolean): Promise<ResetPreview> {
    const st = req.strategy;
    if (st.kind === 'offset' && !(Number.isInteger(st.offset) && st.offset >= 0))
      throw new Error('The offset must be a whole number of 0 or more.');
    if (st.kind === 'shift' && !Number.isInteger(st.by))
      throw new Error('Shift by a whole number of messages.');
    if (st.kind === 'timestamp' && Number.isNaN(Date.parse(st.timestamp)))
      throw new Error('Pick a valid date and time.');
    if (dryRun) return this.doReset(req, true, this.lastTick);
    const res = this.doReset(req, false, this.lastTick);
    await this.store.append({ t: this.lastTick, kind: 'reset-offsets', payload: req });
    return res;
  }

  async deleteGroup(id: string): Promise<void> {
    const g = this.group(id);
    if (g.members > 0)
      throw new Error(
        `${id} has ${g.members} active members. Stop them before deleting the group.`,
      );
    await this.log('delete-group', id);
  }

  // ───────────────────────────── chaos ─────────────────────────────

  runChaos(action: ChaosAction): Incident {
    const t = this.lastTick;
    const id = `inc_${hash(action.kind, action.target ?? '', t).toString(36)}`;
    const iso = new Date(t).toISOString();
    let target = (action.target ?? '').trim();
    // "02" and "2" are the same broker: compare one spelling
    if (action.kind === 'broker-down' && /^\d+$/.test(target)) target = String(Number(target));
    // one run per action and target: overlapping runs share a single flag, so the first to end would cancel both
    const effective =
      target ||
      (
        {
          'crash-consumer': 'order-service',
          'slow-consumer': 'payments-sink',
          'traffic-spike': '*',
          'broker-down': '2',
          rebalance: 'analytics-etl',
          'hot-partition': 'orders',
          'poison-message': `${POISON.topic}-${POISON.partition}`,
        } as Partial<Record<ChaosAction['kind'], string>>
      )[action.kind];
    for (const inc of this.incidents.values())
      if (inc.kind === action.kind && inc.target === effective)
        throw new Error(`${action.kind} is already running on ${effective}. Stop it first.`);
    let until: number | undefined;
    let undo: () => void = () => {};
    const ev = (title: string, detail?: string) =>
      this.pushEvent({ ts: iso, kind: 'chaos', severity: 'warn', title, detail });
    // the end of an incident is an event too (stopped by hand or expired), timed when it ends
    const ended = (title: string) =>
      this.pushEvent({
        ts: new Date(this.lastTick).toISOString(),
        kind: 'chaos',
        severity: 'info',
        title,
      });

    switch (action.kind) {
      case 'crash-consumer': {
        target ||= 'order-service';
        const g = this.group(target);
        g.crashed = true;
        g.state = 'Empty';
        g.members = 0;
        g.rebalanceUntil = 0; // a group with no members isn't rebalancing or waiting out a reset pause
        g.pausedUntil = 0;
        g.resetRejoin = false;
        ev(`Chaos: ${target} crashed`, 'All members left the group; commits stopped');
        undo = () => {
          g.crashed = false;
          if (g.deleted) return; // deleted while crashed: nothing to rejoin
          g.members = g.def.members;
          this.rebalance(g, this.lastTick, 'members rejoined');
        };
        break;
      }
      case 'slow-consumer': {
        target ||= 'payments-sink';
        const g = this.group(target);
        g.slow = true;
        ev(`Chaos: ${target} slowed to 60%`);
        undo = () => {
          g.slow = false;
          ended(`Chaos ended: ${target} back to full speed`);
        };
        break;
      }
      case 'traffic-spike': {
        target ||= '*';
        this.spike.set(target, 10);
        until = t + 2 * 60_000;
        ev(
          `Chaos: traffic spike ×10 on ${target === '*' ? 'all topics' : target}`,
          'For 2 minutes',
        );
        undo = () => {
          this.spike.delete(target);
          ended(`Chaos ended: traffic spike on ${target === '*' ? 'all topics' : target}`);
        };
        break;
      }
      case 'broker-down': {
        const id2 = Number(action.target || 2);
        if (!this.brokersOnline.has(id2))
          throw new Error(`Broker ${action.target} does not exist.`);
        target = String(id2);
        this.brokersOnline.set(id2, false);
        for (const ps of this.parts.values()) {
          for (const s of ps) {
            s.isr = s.isr.filter((b) => b !== id2);
            if (s.leader === id2) s.leader = s.isr[0] ?? null;
          }
        }
        this.pushEvent({
          ts: iso,
          kind: 'broker-down',
          severity: 'crit',
          title: `Broker ${id2} is down`,
          detail: 'Leaders moved; ISR shrank on its partitions',
        });
        undo = () => {
          this.brokersOnline.set(id2, true);
          for (const ps of this.parts.values()) {
            for (const s of ps) {
              // other brokers may still be down: only online replicas rejoin, preferred leader if online
              s.isr = s.replicas.filter((b) => this.brokersOnline.get(b) !== false);
              s.leader = s.isr.includes(s.replicas[0]!) ? s.replicas[0]! : (s.isr[0] ?? null);
            }
          }
          this.pushEvent({
            ts: new Date(this.lastTick).toISOString(),
            kind: 'broker-up',
            severity: 'info',
            title: `Broker ${id2} is back`,
            detail: 'ISR expanded; preferred leaders restored',
          });
        };
        break;
      }
      case 'rebalance': {
        target ||= 'analytics-etl';
        const rg = this.group(target);
        if (rg.crashed || rg.members === 0)
          throw new Error(`${target} has no members to rebalance. Stop the crash first.`);
        this.rebalance(rg, t, 'chaos panel');
        until = t + 8000;
        // stopped early: the group settles now, as the other kinds restore their state on stop
        undo = () => {
          if (rg.deleted || rg.crashed || !rg.rebalanceUntil) return;
          rg.rebalanceUntil = 0;
          rg.resetRejoin = false;
          rg.state = rg.members > 0 ? 'Stable' : 'Empty';
        };
        break;
      }
      case 'hot-partition': {
        target ||= 'orders';
        const def = this.topics.get(target);
        if (!def) throw new Error(`Topic ${target} not found.`);
        // 40% only reads as skew past 2/n (skewOf), so n ≥ 6; on 1 partition it would just cut the topic's traffic
        if (def.partitions < 6)
          throw new Error(
            `${target} has ${def.partitions} partition${def.partitions === 1 ? '' : 's'}. Pick a topic with 6 or more partitions.`,
          );
        const p = 5;
        this.hot.set(target, p);
        ev(`Chaos: ${target} partition ${p} is hot`, '40% of topic traffic');
        undo = () => {
          this.hot.delete(target);
          ended(`Chaos ended: ${target} traffic evenly spread again`);
        };
        break;
      }
      case 'poison-message': {
        // one poison at a time: a second would overwrite the first, and stopping it would end both
        if (this.poison)
          throw new Error(
            'A poison message is already stalling fraud-scorer. Fix it first: reset its offset on payments partition 7 (shift +1).',
          );
        target = `${POISON.topic}-${POISON.partition}`;
        this.startPoison(t, id);
        undo = () => {
          if (this.poison?.incident === id) this.poison = null;
        };
        break;
      }
    }
    const inc: IncidentState = {
      id,
      kind: action.kind,
      target,
      startedAt: iso,
      endsAt: until ? new Date(until).toISOString() : undefined,
      until,
      undo,
    };
    this.incidents.set(id, inc);
    return strip(inc);
  }

  private endPoison(): void {
    if (this.poison?.incident) this.incidents.delete(this.poison.incident);
    this.poison = null;
  }

  private startPoison(t: number, incident?: string): void {
    const g = this.group(POISON.group);
    const gp = g.parts.find((p) => p.topic === POISON.topic && p.p === POISON.partition);
    if (!gp) return; // payments was deleted: no partition to poison
    const offset = Math.floor(gp.committed);
    this.poison = {
      topic: POISON.topic,
      p: POISON.partition,
      offset,
      group: POISON.group,
      since: t,
      incident,
    };
    this.poisoned.add(`${POISON.topic}:${POISON.partition}:${offset}`);
    this.pushEvent({
      ts: new Date(t).toISOString(),
      kind: 'chaos',
      severity: 'warn',
      title: `Poison message on ${POISON.topic}-${POISON.partition}`,
      detail: `Offset ${formatInt(offset)} fails to deserialize; failures go to payments.dlq`,
    });
  }

  stopChaos(id: string): void {
    const inc = this.incidents.get(id);
    if (!inc) return;
    inc.undo();
    this.incidents.delete(id);
  }

  listIncidents(): Incident[] {
    return [...this.incidents.values()].map(strip);
  }

  private expireIncidents(t: number): void {
    for (const inc of this.incidents.values()) {
      if (inc.until && t >= inc.until) this.stopChaos(inc.id);
    }
    // the opening poison scenario starts 6m 12s before load
    if (!this.poisonStarted && !this.poisonFixed && this.replaying && t >= this.poisonStartAt) {
      this.poisonStarted = true;
      if (!this.poison) this.startPoison(t);
    }
  }

  async reset(): Promise<void> {
    await this.store.clear();
    for (const inc of [...this.incidents.keys()]) this.stopChaos(inc);
  }

  async updateSettings(s: SimSettings): Promise<void> {
    this.settings = { ...this.settings, ...s };
    await this.store.saveSettings(this.settings);
  }

  getSettings(): Required<SimSettings> {
    return { ...this.settings };
  }

  /** Test hook: number of history samples. */
  get historySize(): number {
    return this.history.times.length;
  }
}

// ───────────────────────────── module helpers ─────────────────────────────

/** Skew: the hottest partition carries more than twice its fair share. */
function skewOf(shares: number[]): { max: number; p: number; flagged: boolean } {
  const max = Math.max(...shares);
  return { max, p: shares.indexOf(max), flagged: shares.length > 2 && max > 2 / shares.length };
}

const STATUS_CODE: Record<LagStatus, number> = {
  healthy: 0,
  unknown: 0,
  warn: 1,
  stalled: 2,
  stopped: 3,
};

// Lag builds on three partitions (as in the reference); the rest stay caught up.
const SINK_WEIGHTS: Record<string, number> = {
  'orders:7': 0.5,
  'orders:3': 0.3,
  'payments:4': 0.2,
};
function sinkWeight(topic: string, p: number): number {
  return SINK_WEIGHTS[`${topic}:${p}`] ?? 0;
}

function needsAttention(t: TopicSummary): boolean {
  return (
    t.underReplicated > 0 || t.health.some((h) => h.severity !== 'info' || h.id === 'no-consumers')
  );
}

function splitPartitionKey(k: string): [string, number] {
  const i = k.lastIndexOf('-');
  return [k.slice(0, i), Number(k.slice(i + 1))];
}

function describeStrategy(req: ResetOffsetsRequest): string {
  const s = req.strategy;
  return s.kind === 'shift'
    ? `shift by ${s.by > 0 ? '+' : ''}${s.by}`
    : s.kind === 'offset'
      ? `to offset ${formatInt(s.offset)}`
      : s.kind === 'timestamp'
        ? `to ${s.timestamp}`
        : `to ${s.kind}`;
}

function strip(i: IncidentState): Incident {
  return { id: i.id, kind: i.kind, target: i.target, startedAt: i.startedAt, endsAt: i.endsAt };
}

const MIN_CONFIG: Record<string, number> = {
  'retention.ms': -1,
  'retention.bytes': -1,
  'local.retention.ms': -2,
  'local.retention.bytes': -2,
  'segment.bytes': 14,
  'segment.index.bytes': 4,
  'min.insync.replicas': 1,
  'max.message.bytes': 0,
};

const TOPIC_DEFAULTS: Array<[string, string]> = [
  ['cleanup.policy', 'delete'],
  ['compression.type', 'producer'],
  ['delete.retention.ms', '86400000'],
  ['file.delete.delay.ms', '60000'],
  ['flush.messages', '9223372036854775807'],
  ['flush.ms', '9223372036854775807'],
  ['index.interval.bytes', '4096'],
  ['max.compaction.lag.ms', '9223372036854775807'],
  ['max.message.bytes', '1048588'],
  ['message.timestamp.type', 'CreateTime'],
  ['min.cleanable.dirty.ratio', '0.5'],
  ['min.compaction.lag.ms', '0'],
  ['min.insync.replicas', '2'],
  ['preallocate', 'false'],
  ['retention.bytes', '-1'],
  ['retention.ms', '604800000'],
  ['segment.bytes', '1073741824'],
  ['segment.index.bytes', '10485760'],
  ['segment.jitter.ms', '0'],
  ['segment.ms', '604800000'],
  ['unclean.leader.election.enable', 'false'],
  ['message.downconversion.enable', 'true'],
  ['remote.storage.enable', 'false'],
  ['local.retention.ms', '-2'],
  ['local.retention.bytes', '-2'],
];

const BROKER_CONFIG_NAMES = [
  'background.threads',
  'compression.type',
  'connections.max.idle.ms',
  'delete.topic.enable',
  'fetch.max.bytes',
  'group.initial.rebalance.delay.ms',
  'group.max.session.timeout.ms',
  'group.min.session.timeout.ms',
  'leader.imbalance.check.interval.seconds',
  'leader.imbalance.per.broker.percentage',
  'log.cleaner.enable',
  'log.cleaner.threads',
  'log.flush.interval.messages',
  'log.retention.bytes',
  'log.retention.check.interval.ms',
  'log.roll.hours',
  'log.segment.bytes',
  'message.max.bytes',
  'num.io.threads',
  'num.network.threads',
  'num.recovery.threads.per.data.dir',
  'num.replica.fetchers',
  'offsets.retention.minutes',
  'offsets.topic.num.partitions',
  'offsets.topic.replication.factor',
  'queued.max.requests',
  'replica.fetch.max.bytes',
  'replica.lag.time.max.ms',
  'replica.socket.timeout.ms',
  'request.timeout.ms',
  'socket.receive.buffer.bytes',
  'socket.request.max.bytes',
  'socket.send.buffer.bytes',
  'transaction.state.log.min.isr',
  'transaction.state.log.replication.factor',
  'unclean.leader.election.enable',
  'zookeeper.metadata.migration.enable',
  'metadata.log.dir',
  'metadata.max.retention.ms',
  'share.group.enable',
  'share.group.delivery.count.limit',
  'share.group.record.lock.duration.ms',
  'group.consumer.heartbeat.interval.ms',
  'group.consumer.session.timeout.ms',
];
const BROKER_DEFAULTS = [
  '10',
  'producer',
  '600000',
  'true',
  '57671680',
  '3000',
  '1800000',
  '6000',
  '300',
  '10',
  'true',
  '1',
  '9223372036854775807',
  '-1',
  '300000',
  '168',
  '1073741824',
  '1048588',
  '8',
  '3',
  '1',
  '1',
  '10080',
  '50',
  '3',
  '500',
];
