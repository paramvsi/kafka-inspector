// Domain types and the KafkaClient boundary (docs/ARCHITECTURE.md). The UI talks only to KafkaClient (rule 1).

export type Mode = 'demo' | 'agent' | 'rest-proxy';

export interface Capabilities {
  writes: boolean;
  chaos: boolean;
  history: boolean;
  auth: boolean;
  schemaRegistry: boolean;
}

export type ClusterStatus = 'connected' | 'degraded' | 'disconnected';

export interface ClusterSummary {
  id: string;
  name: string;
  color?: string;
  status: ClusterStatus;
  brokers: number;
  kafkaVersion: string;
  schemaRegistry: boolean;
  simulated?: boolean;
}

export interface AppInfo {
  mode: Mode;
  version: string;
  readOnly: boolean;
  capabilities: Capabilities;
  clusters: ClusterSummary[];
  user?: { name: string };
}

export type GroupType = 'classic' | 'consumer' | 'share' | 'streams' | 'unknown';
export type GroupState =
  | 'Stable'
  | 'PreparingRebalance'
  | 'CompletingRebalance'
  | 'Empty'
  | 'Dead'
  | 'Assigning'
  | 'Reconciling'
  | 'Unknown';
export type LagStatus = 'healthy' | 'warn' | 'stalled' | 'stopped' | 'unknown';

export interface Forecast {
  kind: 'caught-up' | 'eta' | 'never' | 'unknown';
  seconds?: number;
  consumeRate?: number;
  produceRate?: number;
}

export interface HealthFinding {
  id: 'rf1' | 'low-min-isr' | 'no-consumers' | 'infinite-retention' | 'skew' | 'disk-fill';
  severity: 'warn' | 'crit' | 'info';
  message: string;
  fix: string;
}

export interface Broker {
  id: number;
  host: string;
  port: number;
  rack?: string;
  isController: boolean;
  online: boolean;
  partitions: number;
  leaders: number;
  bytesInPerSec?: number;
  diskUsedBytes?: number;
  diskTotalBytes?: number;
}

export interface ConfigEntry {
  name: string;
  value: string | null;
  source: 'default' | 'dynamic-topic' | 'dynamic-broker' | 'static-broker' | 'unknown';
  isDefault: boolean;
  isSensitive: boolean;
  readOnly: boolean;
}

export interface TopicQuery {
  query?: string;
  regex?: boolean;
  internal?: boolean;
  view?: 'all' | 'attention' | 'starred';
  starred?: string[];
  sort?: 'issues' | 'name' | 'size' | 'rate';
  page?: number;
  size?: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

export interface TopicSummary {
  name: string;
  internal: boolean;
  partitions: number;
  replicationFactor: number;
  sizeBytes?: number;
  messagesInPerSec: number;
  consumerGroups: number;
  lastMessageAt?: string;
  underReplicated: number;
  health: HealthFinding[];
  trend?: number[];
}

export interface PartitionInfo {
  partition: number;
  leader: number | null;
  replicas: number[];
  isr: number[];
  lowWatermark: number;
  highWatermark: number;
  sharePct?: number;
  lastMessageAt?: string;
}

export interface TopicConsumer {
  groupId: string;
  type: GroupType;
  lag: number;
  status: LagStatus;
  state: GroupState;
}

export interface TopicDetail {
  summary: TopicSummary;
  partitions: PartitionInfo[];
  consumers: TopicConsumer[];
  schema?: { keySubject?: string; valueSubject?: string };
}

export type BrowseFrom = 'newest' | 'oldest' | 'offset' | 'timestamp' | 'group';

export interface BrowseRequest {
  topic: string;
  partition: number | 'all';
  from: BrowseFrom;
  offset?: number;
  timestamp?: string;
  group?: string;
  limit?: number;
  cursor?: string;
}

export interface TailRequest {
  topic: string;
  partition: number | 'all';
  maxRate?: number;
}

export interface SearchRequest {
  topicRegex: string;
  from: 'newest' | 'oldest';
  limit?: number;
  sample?: boolean;
}

export interface RawMessage {
  topic: string;
  partition: number;
  offset: number;
  timestamp: string;
  key: Uint8Array | null;
  value: Uint8Array | null;
  headers: Array<{ key: string; value: Uint8Array }>;
  sizeBytes: number;
}

export interface RawMessagePage {
  messages: RawMessage[];
  nextCursor?: string;
  scanned: number;
}

export interface GroupQuery {
  type?: GroupType;
  query?: string;
}

export interface GroupSummary {
  groupId: string;
  type: GroupType;
  state: GroupState;
  members: number;
  topics: string[];
  totalLag: number;
  lastCommitAt?: string;
  status: LagStatus;
  forecast: Forecast;
  trend?: number[];
}

export interface GroupPartitionLag {
  topic: string;
  partition: number;
  committedOffset: number | null;
  endOffset: number;
  lag: number;
  memberId?: string;
  clientId?: string;
  host?: string;
  status: LagStatus;
}

export interface GroupMember {
  memberId: string;
  clientId: string;
  host: string;
  assignments: Array<{ topic: string; partition: number }>;
}

export interface GroupDetail {
  summary: GroupSummary;
  partitions: GroupPartitionLag[];
  members: GroupMember[];
  /** Share groups (KIP-932) only. */
  share?: { deliveryCount: number; inFlight: number; acquisitionLockMs: number };
}

export type MetricName =
  'messagesIn' | 'bytesIn' | 'bytesOut' | 'messagesOut' | 'lag' | 'endOffset' | 'committedOffset';
export type TimeRange = '15m' | '1h' | '24h' | '7d';

export interface HistoryQuery {
  metric: MetricName;
  scope: 'cluster' | 'topic' | 'partition' | 'group';
  key?: string;
  range: TimeRange;
}

export interface Series {
  key: string;
  points: Array<[number, number]>;
}

export type StreamChannel = 'metrics' | 'lag' | 'events' | 'alerts';
export interface ConnectionState {
  state: 'connected' | 'reconnecting';
  /** epoch ms when the connection was lost */
  since?: number;
  attempt?: number;
  maxAttempts?: number;
  /** epoch ms of the next attempt */
  nextAt?: number;
}
export type Unsubscribe = () => void;

export interface ClusterEvent {
  id: string;
  ts: string;
  kind:
    | 'rebalance'
    | 'broker-down'
    | 'broker-up'
    | 'isr-shrink'
    | 'isr-expand'
    | 'alert-fired'
    | 'alert-resolved'
    | 'config'
    | 'chaos'
    | 'offsets-reset'
    | 'topic-created'
    | 'topic-deleted';
  severity: 'info' | 'warn' | 'crit';
  title: string;
  detail?: string;
}

export interface Kpis {
  messagesInPerSec: number;
  messagesOutPerSec: number;
  bytesInPerSec: number;
  totalLag: number;
  lagTrend: 'rising' | 'falling' | 'steady';
  underReplicated: number;
  totalPartitions: number;
  brokersOnline: number;
  brokersTotal: number;
  offlinePartitions: number;
  underMinIsr: number;
  activeController: number | null;
  activeAlerts: number;
  topics: number;
  groups: number;
}

export interface AttentionItem {
  id: string;
  severity: 'crit' | 'warn' | 'info';
  title: string;
  detail: string;
  since: string;
  href: string;
  action?: string;
}

export interface Overview {
  cluster: ClusterSummary;
  kpis: Kpis;
  attention: AttentionItem[];
  groups: GroupSummary[];
  events: ClusterEvent[];
}

export type StreamEvent =
  | { channel: 'metrics'; ts: string; data: Overview }
  | { channel: 'lag'; ts: string; data: GroupSummary[] }
  | { channel: 'events'; ts: string; data: ClusterEvent[] }
  | { channel: 'alerts'; ts: string; data: AlertEvent[] };

export interface SubjectSummary {
  subject: string;
  latestVersion: number;
  type: 'AVRO' | 'JSON' | 'PROTOBUF';
  compatibility:
    | 'BACKWARD'
    | 'BACKWARD_TRANSITIVE'
    | 'FORWARD'
    | 'FORWARD_TRANSITIVE'
    | 'FULL'
    | 'FULL_TRANSITIVE'
    | 'NONE';
  versions: number[];
}

export interface SchemaVersion {
  subject: string;
  version: number;
  id: number;
  type: 'AVRO' | 'JSON' | 'PROTOBUF';
  schema: string;
  references?: Array<{ name: string; subject: string; version: number }>;
  registeredAt?: string;
}

export interface CompatibilityResult {
  compatible: boolean;
  messages: string[];
}

export interface TopologyNode {
  id: string;
  kind: 'producer' | 'topic' | 'group';
  label: string;
  status: LagStatus | 'neutral';
  rate: number;
  /** short finding shown on the node, e.g. "skew 41%", "RF 1", "9.3k behind" */
  note?: string;
}
export interface TopologyEdge {
  from: string;
  to: string;
  rate: number;
  kind: 'produce' | 'consume' | 'dlq';
}
export interface Topology {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

export type AlertMetric =
  'lag' | 'group-status' | 'topic-silent' | 'under-replicated' | 'broker-offline' | 'dlq-receiving';
export type Severity = 'crit' | 'warn' | 'info';

export interface AlertRuleInput {
  name: string;
  metric: AlertMetric;
  scope: { kind: 'any' } | { kind: 'specific'; target: string };
  threshold?: number;
  durationSec: number;
  severity: Severity;
  channels: Array<'in-app' | 'browser'>;
  enabled: boolean;
  muted?: boolean;
}
export interface AlertRule extends AlertRuleInput {
  id: string;
  state?: 'ok' | 'pending' | 'firing';
}
export interface AlertEvent {
  id: string;
  ruleId: string;
  severity: Severity;
  title: string;
  evidence: string;
  target: string;
  href: string;
  state: 'firing' | 'resolved';
  firedAt: string;
  resolvedAt?: string;
  mutedUntil?: string;
  acknowledged?: boolean;
}
export interface AlertQuery {
  state?: 'firing' | 'resolved' | 'all';
  limit?: number;
}

export interface SavedFilter {
  name: string;
  expr: string;
}

export interface NewTopic {
  name: string;
  partitions: number;
  replicationFactor: number;
  retentionMs?: number;
  cleanupPolicy?: 'delete' | 'compact' | 'compact,delete';
  configs?: Record<string, string>;
}
export interface ProduceRequest {
  topic: string;
  partition?: number;
  key?: string | null;
  value: string;
  headers?: Array<{ key: string; value: string }>;
  count?: number;
  valueFormat?: 'json' | 'text' | 'avro';
}
export interface ProduceResult {
  partition: number;
  offset: number;
  count: number;
}
export type ResetStrategy =
  | { kind: 'earliest' }
  | { kind: 'latest' }
  | { kind: 'timestamp'; timestamp: string }
  | { kind: 'offset'; offset: number }
  | { kind: 'shift'; by: number };
export interface ResetOffsetsRequest {
  groupId: string;
  topic: string;
  partitions: number[] | 'all';
  strategy: ResetStrategy;
}
export interface ResetPreviewRow {
  partition: number;
  current: number | null;
  next: number;
  lagAfter: number;
  skipped: boolean;
  reason?: string;
}
export interface ResetPreview {
  rows: ResetPreviewRow[];
  applied: boolean;
}

export type ChaosActionKind =
  | 'crash-consumer'
  | 'slow-consumer'
  | 'traffic-spike'
  | 'broker-down'
  | 'rebalance'
  | 'hot-partition'
  | 'poison-message';
export interface ChaosAction {
  kind: ChaosActionKind;
  target?: string;
}
export interface Incident {
  id: string;
  kind: ChaosActionKind;
  target: string;
  startedAt: string;
  endsAt?: string;
}
export interface SimSettings {
  baseTraffic?: number;
  dailyWave?: boolean;
  seed?: string;
}

export interface KafkaClient {
  info(): Promise<AppInfo>;

  getOverview(clusterId: string): Promise<Overview>;
  listBrokers(clusterId: string): Promise<Broker[]>;
  getBrokerConfig(clusterId: string, brokerId: number): Promise<ConfigEntry[]>;

  listTopics(clusterId: string, q?: TopicQuery): Promise<Page<TopicSummary>>;
  getTopic(clusterId: string, name: string): Promise<TopicDetail>;
  getTopicConfig(clusterId: string, name: string): Promise<ConfigEntry[]>;

  browse(clusterId: string, req: BrowseRequest): Promise<RawMessagePage>;
  tail(clusterId: string, req: TailRequest, onBatch: (batch: RawMessage[]) => void): Unsubscribe;
  search(clusterId: string, req: SearchRequest): Promise<RawMessagePage>;

  listGroups(clusterId: string, q?: GroupQuery): Promise<GroupSummary[]>;
  getGroup(clusterId: string, groupId: string): Promise<GroupDetail>;

  getHistory(clusterId: string, q: HistoryQuery): Promise<Series[]>;
  subscribe(
    clusterId: string,
    channel: StreamChannel,
    onEvent: (e: StreamEvent) => void,
  ): Unsubscribe;

  listSubjects(clusterId: string): Promise<SubjectSummary[]>;
  getSchema(clusterId: string, subject: string, version: number | 'latest'): Promise<SchemaVersion>;
  getSchemaById(clusterId: string, id: number): Promise<SchemaVersion>;
  checkCompatibility(
    clusterId: string,
    subject: string,
    schema: string,
  ): Promise<CompatibilityResult>;

  getTopology(clusterId: string): Promise<Topology>;

  listAlertRules(): Promise<AlertRule[]>;
  saveAlertRule(rule: AlertRuleInput & { id?: string }): Promise<AlertRule>;
  deleteAlertRule(id: string): Promise<void>;
  listAlerts(q?: AlertQuery): Promise<AlertEvent[]>;
  muteAlert(id: string, until: string): Promise<void>;
  acknowledgeAlert(id: string): Promise<void>;
  previewAlertRule?(rule: AlertRuleInput): Promise<{ firings: number }>;

  /** Present only when capabilities.writes (demo in v1). */
  writes?: {
    createTopic(clusterId: string, spec: NewTopic): Promise<void>;
    deleteTopic(clusterId: string, name: string): Promise<void>;
    /** Set overrides; a null value removes the override (back to the default). */
    updateTopicConfig(
      clusterId: string,
      name: string,
      changes: Record<string, string | null>,
    ): Promise<void>;
    produce(clusterId: string, req: ProduceRequest): Promise<ProduceResult>;
    resetOffsets(
      clusterId: string,
      req: ResetOffsetsRequest,
      dryRun: boolean,
    ): Promise<ResetPreview>;
    deleteGroup(clusterId: string, groupId: string): Promise<void>;
  };

  /** Saved message-browser filters in the agent DB (F-04). Absent → the app keeps them in localStorage. */
  savedFilters?: {
    list(): Promise<SavedFilter[]>;
    save(f: SavedFilter): Promise<void>;
  };

  /** Connection state for live data (agent mode: WebSocket with reconnect back-off). */
  onConnection?(cb: (c: ConnectionState) => void): Unsubscribe;
  /** Ends the session (agent mode). */
  signOut?(): Promise<void>;

  /** Demo only. */
  chaos?: {
    run(action: ChaosAction): Promise<Incident>;
    stop(id: string): Promise<void>;
    reset(): Promise<void>;
    settings(s: SimSettings): Promise<void>;
    incidents(): Promise<Incident[]>;
  };
}
