# Architecture

## Big picture

```
                ┌──────────────────────── apps/web (Next.js, static export) ───────────────────────┐
                │  pages / components (packages/ui, Copper Oxide)                                    │
                │                     │                                                              │
                │              KafkaClient (packages/core)                                           │
                │        ┌────────────┴─────────────┐                                                │
                │  SimulatedClient            AgentClient                 (RestProxyClient: v2)      │
                │  (Web Worker,               (fetch /api/*, WebSocket                               │
                │   packages/simulator)        /api/stream)                                          │
                └─────────────────────────────────┬──────────────────────────────────────────────────┘
                                                  │ same origin (served by the agent)
                                ┌─────────────────┴─────────────────┐
                                │ apps/agent (Spring Boot, Java 21) │── Kafka AdminClient / Consumer ──▶ user's Kafka
                                │ REST + WebSocket, read-only (v1)  │── HTTP ──────────────────────────▶ Schema Registry
                                │ sampler, alerts, embedded DB      │
                                └───────────────────────────────────┘
```

Hosted demo = `apps/web` static files on Netlify → no `/api/info` → `SimulatedClient`.
Self-hosted = Docker image where the agent serves the same static files at `/app` and the API at `/api` → `AgentClient`.

## Repository layout (pnpm workspace + Gradle)

```
kafka-inspector/
├─ CLAUDE.md
├─ apps/
│  ├─ web/                 Next.js App Router, TypeScript, Tailwind, output: 'export'
│  │  ├─ app/              routes (see SCREENS.md)
│  │  ├─ lib/client/       pick.ts picks SimulatedClient or AgentClient at startup
│  │  └─ public/brand/     logos, favicons
│  ├─ site/                (optional) landing page; or a route group in apps/web — see DECISIONS
│  └─ agent/               Spring Boot (Gradle), serves /app + /api
├─ packages/
│  ├─ core/                types, KafkaClient interface, lag rules, forecast, serdes, formatters (no React)
│  ├─ simulator/           cluster model + Web Worker entry + chaos actions (depends on core)
│  └─ ui/                  React components implementing Copper Oxide (Button, StatusBadge, KpiCard, …)
├─ design-system/          tokens.json, tokens.css, reference components (do not edit by hand; see DESIGN_SYSTEM.md)
├─ designs/screens/        reference HTML per screen
├─ deploy/
│  ├─ Dockerfile           multi-stage: build web → build agent → slim JRE runtime
│  └─ docker-compose.dev.yml   agent + Kafka (KRaft) + Schema Registry + a traffic generator
├─ netlify.toml            demo hosting (static export, headers incl. the worker CSP)
└─ .github/workflows/      ci.yml (lint, test, e2e, agent tests, image smoke), release.yml (image to GHCR on tag, after CI), nightly.yml (three browsers)
```

## Stack

| Layer | Choice |
| --- | --- |
| Web framework | Next.js (App Router) with `output: 'export'`, React, TypeScript strict |
| Styling | Tailwind CSS v4 mapped to Copper Oxide CSS variables; native `<dialog>` / `[popover]` primitives in `packages/ui` (no shadcn) |
| Server state | TanStack Query (requests) + a `useStream` hook over `KafkaClient.subscribe` (live data) |
| Client state | the URL (F-04) + React context; per-viewer conveniences in localStorage (no Zustand) |
| Charts | Recharts for time series; small custom SVG for sparklines |
| Topology | custom SVG + HTML (no React Flow) |
| Tables | `packages/ui` `DataTable` + TanStack Virtual (message list) |
| Worker RPC | Comlink |
| Storage (demo) | IndexedDB via Dexie |
| Serdes | own Avro codec in `packages/core` (cross-checked against `avsc` in tests); JSON Schema compatibility subset in `schema-compat.ts` |
| Tests (TS) | Vitest, Testing Library, Playwright, axe-core |
| Agent | Java 21, Spring Boot (web, websocket, security, validation, actuator), Kafka `kafka-clients`, Flyway, H2 (default) / PostgreSQL (optional), Testcontainers |

Use current stable versions; verify APIs against the installed versions rather than memory.

## The `KafkaClient` boundary (packages/core)

```ts
export type Mode = 'demo' | 'agent' | 'rest-proxy';

export interface Capabilities {
  writes: boolean;      // create/delete topic, produce, reset offsets, delete group
  chaos: boolean;       // chaos panel, guided tour (demo only)
  history: boolean;     // metric history available
  auth: boolean;        // sign-in required (agent)
  schemaRegistry: boolean;
}

export interface AppInfo {
  mode: Mode;
  version: string;
  readOnly: boolean;
  capabilities: Capabilities;
  clusters: ClusterSummary[];
  user?: { name: string };
}

export interface KafkaClient {
  info(): Promise<AppInfo>;

  // cluster-level
  getOverview(clusterId: string): Promise<Overview>;
  listBrokers(clusterId: string): Promise<Broker[]>;
  getBrokerConfig(clusterId: string, brokerId: number): Promise<ConfigEntry[]>;

  // topics
  listTopics(clusterId: string, q?: TopicQuery): Promise<Page<TopicSummary>>;
  getTopic(clusterId: string, name: string): Promise<TopicDetail>;
  getTopicConfig(clusterId: string, name: string): Promise<ConfigEntry[]>;

  // messages (raw bytes; decoding happens in the browser via core/serdes)
  browse(clusterId: string, req: BrowseRequest): Promise<RawMessagePage>;
  tail(clusterId: string, req: TailRequest, onBatch: (batch: RawMessage[]) => void, onError?: (message: string) => void): Unsubscribe;
  search(clusterId: string, req: SearchRequest): Promise<RawMessagePage>;   // multi-topic

  // consumer groups
  listGroups(clusterId: string, q?: GroupQuery): Promise<GroupSummary[]>;
  getGroup(clusterId: string, groupId: string): Promise<GroupDetail>;

  // history and live streams
  getHistory(clusterId: string, q: HistoryQuery): Promise<Series[]>;
  subscribe(clusterId: string, channel: StreamChannel, onEvent: (e: StreamEvent) => void): Unsubscribe;

  // schemas
  listSubjects(clusterId: string): Promise<SubjectSummary[]>;
  getSchema(clusterId: string, subject: string, version: number | 'latest'): Promise<SchemaVersion>;
  getSchemaById(clusterId: string, id: number): Promise<SchemaVersion>;     // used by serdes, cached
  checkCompatibility(clusterId: string, subject: string, schema: string): Promise<CompatibilityResult>;

  // topology
  getTopology(clusterId: string): Promise<Topology>;

  // alerts (app data — allowed in read-only mode)
  listAlertRules(): Promise<AlertRule[]>;
  saveAlertRule(rule: AlertRuleInput): Promise<AlertRule>;
  deleteAlertRule(id: string): Promise<void>;
  listAlerts(q?: AlertQuery): Promise<AlertEvent[]>;
  muteAlert(id: string, until: string): Promise<void>;
  acknowledgeAlert(id: string): Promise<void>;

  // writes — present only when capabilities.writes (demo in v1)
  writes?: {
    createTopic(clusterId: string, spec: NewTopic): Promise<void>;
    deleteTopic(clusterId: string, name: string): Promise<void>;
    updateTopicConfig(clusterId: string, name: string, changes: Record<string, string | null>): Promise<void>; // null = reset to default
    produce(clusterId: string, req: ProduceRequest): Promise<ProduceResult>;
    resetOffsets(clusterId: string, req: ResetOffsetsRequest, dryRun: boolean): Promise<ResetPreview>;
    deleteGroup(clusterId: string, groupId: string): Promise<void>;
  };

  // demo only
  chaos?: { run(action: ChaosAction): Promise<Incident>; stop(id: string): Promise<void>; reset(): Promise<void>; settings(s: SimSettings): Promise<void>; getSettings(): Promise<Required<SimSettings>>; incidents(): Promise<Incident[]> };
  savedFilters?: { list(): Promise<SavedFilter[]>; save(f: SavedFilter): Promise<void> }; // agent DB (F-04)
  previewAlertRule?(rule: AlertRuleInput): Promise<{ firings: number }>;
  onConnection?(cb: (c: ConnectionState) => void): Unsubscribe; // agent WebSocket state
  signOut?(): Promise<void>;
}

export type StreamChannel = 'metrics' | 'lag' | 'events' | 'alerts';
export type Unsubscribe = () => void;
```

### Core domain types (abridged — complete them in `packages/core/src/types.ts`)

```ts
export type GroupType = 'classic' | 'consumer' | 'share' | 'streams' | 'unknown';
export type GroupState = 'Stable' | 'PreparingRebalance' | 'CompletingRebalance' | 'Empty' | 'Dead' | 'Assigning' | 'Reconciling' | 'Unknown';
export type LagStatus = 'healthy' | 'warn' | 'stalled' | 'stopped' | 'unknown';

export interface Broker { id: number; host: string; port: number; rack?: string; isController: boolean; online: boolean; partitions: number; leaders: number; bytesInPerSec?: number; diskUsedBytes?: number; diskTotalBytes?: number }
export interface TopicSummary { name: string; internal: boolean; partitions: number; replicationFactor: number; sizeBytes?: number; messagesInPerSec: number; consumerGroups: number; lastMessageAt?: string; underReplicated: number; health: HealthFinding[] }
export interface PartitionInfo { partition: number; leader: number | null; replicas: number[]; isr: number[]; lowWatermark: number; highWatermark: number; sharePct?: number }
export interface GroupPartitionLag { topic: string; partition: number; committedOffset: number | null; endOffset: number; lag: number; memberId?: string; clientId?: string; host?: string; status: LagStatus }
export interface GroupSummary { groupId: string; type: GroupType; state: GroupState; members: number; topics: string[]; totalLag: number; lastCommitAt?: string; status: LagStatus; forecast: Forecast }
export interface Forecast { kind: 'caught-up' | 'eta' | 'never' | 'unknown'; seconds?: number; consumeRate?: number; produceRate?: number }
export interface RawMessage { topic: string; partition: number; offset: number; timestamp: string; key: Uint8Array | null; value: Uint8Array | null; headers: Array<{ key: string; value: Uint8Array }>; sizeBytes: number }
export interface HealthFinding { id: 'offline' | 'rf1' | 'low-min-isr' | 'no-consumers' | 'infinite-retention' | 'skew' | 'disk-fill'; severity: 'warn' | 'crit' | 'info'; message: string; fix: string }
```

### Picking the client (apps/web/lib/client/pick.ts)

1. `NEXT_PUBLIC_KI_MODE` set → force that mode (dev).
2. Else `GET /api/info` (same origin, 2 s timeout). 200 → `AgentClient`; 401 → go to `/app/sign-in`; anything else → `SimulatedClient`.
3. Expose via React context `useKafka()`; components never construct clients.

## Lag evaluation (packages/core/lag.ts) — shared by simulator, web and agent

Inputs per partition: an ordered window of samples `{t, committed, end}` (committed may be null) plus `lastCommitAt`.

Window: demo 10 samples at 1 s; agent 30 samples at 10 s (5 min). Configurable.

Rules, evaluated in order (Burrow-style):

1. No samples or committed always null → `unknown`.
2. `now − lastCommitAt > windowDuration` and last lag > 0 → `stopped`.
3. Committed offset identical across the whole window, last lag > 0, and commits still arriving (`lastCommitAt` within window) → `stalled`.
4. Any sample with lag = 0, or last lag < first lag → `healthy`.
5. Committed offset advanced and lag strictly increased across the window (or net increase with a positive least-squares slope) → `warn`.
6. Otherwise → `healthy`.

Group roll-up: any `stopped` → `stopped`; else any `stalled` → `stalled`; else any `warn` → `warn`; else every partition `unknown` → `unknown`; else `healthy`. Neutral states (Empty, rebalancing) come from `GroupState` and are shown with the neutral badge. A group event is raised only when a group becomes stalled or stopped from another state (`becameStuck`), not on stopped → stalled while it recovers.

**Forecast** over the same window: `consumeRate = Σ Δcommitted / Δt`, `produceRate = Σ Δend / Δt`.
- lag = 0 → `caught-up` (still with consumeRate/produceRate when the window has length; a group's rates sum every partition, caught-up ones included)
- consumeRate > produceRate → `eta`, seconds = lag / (consumeRate − produceRate)
- else → `never` ("won't catch up at current rates")
- **Group** (`combineForecasts`): ETA = the slowest partition's (a group is caught up when its last partition is); any partition that is `never` with lag > 0 makes the group `never`; rates are summed for display

Format: < 60 s "under a minute"; < 120 min "~N min"; else "~N h".

Ship **test vectors** (`packages/core/test/lag-vectors.json` — status, forecast and consume/produce rates; `lag-group-vectors.json` — `rollupStatus` and `combineForecasts`) and run both files in the Java agent tests.

## Simulator (packages/simulator)

- Runs in a Web Worker; exposed with Comlink as `SimulatedClient`'s backend. Ticks every 1 s.
- **Seed cluster** (seed `kafka-42`): brokers 1–3 (KRaft, controller 1, racks eu-west-1a/b/c); topics `orders` (24p), `payments` (12p), `clickstream` (12p), `inventory` (12p), `notifications` (6p), `payments.dlq` (3p), `audit-log` (3p, RF 1), `legacy-events` (6p, no consumers), 31 smaller filler topics, plus internal `__consumer_offsets`, `_schemas`, `__share_group_state` (42 topics, 186 partitions in all); groups `order-service`, `payments-sink` (classic), `fraud-scorer`, `analytics-etl`, `search-indexer` (empty), `notify-workers` (share group).
- Producer rate per topic = base × daily wave (sin, period 24 h) × noise (seeded) × chaos multipliers. Spread across partitions with optional hot-key skew.
- Each partition's end offset grows by its rate; each group's committed offset grows by its consume rate, capped at end offset.
- 24 h of history is back-filled on first load (sampled every 60 s for older data, 1 s for the last 15 min).
- **Messages are a pure function of `(topic, partition, offset)`** via a seeded PRNG — nothing stored. Avro topics produce real Confluent wire-format bytes (magic 0, schema id, avro payload) using the simulator's own schema registry, so the real decoder path is exercised. When the "poison message" scenario is active, the payments message at fraud-scorer's committed offset on partition 7 is malformed (the offset follows the run, it isn't fixed).
- Writes (create topic, delete topic, config edits, produce, reset offsets, delete group) and saved state go to IndexedDB as an action log replayed during back-fill; "Reset demo" clears it. A live reset that moves fraud-scorer past the opening poison message also records `poison-fixed { since }` (when that poison started); back-fill replays the stall from `since` and the saved reset clears it at its original time, so a reload shows the same recovery (a reset that doesn't skip it isn't a fix; an older `poison-fixed` without `since` leaves the poison out).
- **Chaos actions** (each returns an incident id and can be stopped): crash consumer (group → Empty, commits stop), slow consumer (consume rate × 0.6), traffic spike (× 10 for 2 min), broker down (broker offline, ISR shrinks, leaders move), rebalance (group → rebalancing 8 s; stopping it settles the group at once), hot partition (one partition gets 40 % of a topic), poison message (fraud-scorer stalls on payments-7 at its committed offset; failures written to payments.dlq).
- The opening state reproduces the designs: `payments-sink` builds lag and drains it on a 16-minute saw-tooth, `fraud-scorer` stalled, `clickstream` skewed.

## Serdes (packages/core/serdes)

- Decoding runs in the browser in **both** modes. The agent returns raw bytes (base64) + metadata; schemas are fetched by id through `KafkaClient.getSchemaById` and cached.
- Detection order: magic byte 0 and length ≥ 5 with registry → registry format (by schema type; if the registry doesn't know the id, auto falls through, since a leading 0x00 is often just data such as an int64 key — choosing Avro explicitly reports the unknown id) → JSON parse → printable UTF-8 → hex.
- Wire format: byte 0 = 0x00, bytes 1–4 = schema id (big-endian int32), then payload. Protobuf (v2) adds message-index varints.
- Per-topic overrides for key and value; number keys decode int32/int64/double big-endian; UUID from 16 bytes or 36-char string.
- Decode errors return `{ ok: false, reason, hex, annotations }` — never throw into the UI.
- Masking runs after decoding on JSON paths (`$.email`, `$.card.number`) with remove/replace/mask actions — also on text and hex/base64 views of a JSON body; other bodies on a masked topic hide their raw bytes. It is a display feature, not a security control; say so in the docs.

## JavaScript filters

Run user expressions in a dedicated Worker with no DOM, compiled once per expression, evaluated per message with a per-batch time budget (50 ms); the worker is terminated and restarted on timeout. Expression receives `{ key, value, headers, partition, offset, timestamp }` with decoded values.

## Storage

- Demo: IndexedDB (Dexie) — saved clusters, filters, alert rules, alert history, user-created topics/messages, simulator overrides.
- Agent: embedded H2 file DB in `/data` by default (Flyway migrations), PostgreSQL via `KI_DB_URL`. Tables: `metric_sample` (cluster, scope, key, metric, ts, value; also indexed on ts for the prune job) with downsampling job, `alert_rule`, `alert_event`, `saved_filter`.

## Performance budgets

- Live updates batched to 1 per second per channel; charts update without re-mounting.
- Message pages ≤ 500 rows; live tail ring buffer 2,000 rows; tables virtualised beyond 200 rows.
- Worker tick ≤ 10 ms for the seed cluster on a mid-range laptop.
- Initial JS for the dashboard route ≤ 250 kB gzip (Recharts loads lazily).

## Testing strategy

- `packages/core`: unit tests for lag rules (vectors), forecast, formatters, serdes (golden byte fixtures incl. corrupt ones).
- `packages/simulator`: determinism (same seed → same snapshot), chaos actions change state as specified.
- `packages/ui`: component tests + axe.
- `apps/web`: Playwright e2e for: overview loads, chaos → stalled → reset offsets → recovered, message browser filter + drawer, create topic, command palette, theme toggle, read-only mode (mock `/api/info`).
- `apps/agent`: Testcontainers Kafka (+ Schema Registry) integration tests for every endpoint; lag vectors shared with TS; security tests (unauthenticated → 401, no write routes exist).
