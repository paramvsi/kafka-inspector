# Agent API (self-hosted, v1 read-only)

The agent is a Spring Boot app that serves the web app at `/app/**` (static files from the Next.js export; unknown paths fall back to the route's `index.html`) and this API at `/api/**`. Same origin, so no CORS. `/` redirects to `/app/`.

All responses are JSON. Errors use `{ "error": { "code": "STRING_CODE", "message": "Human sentence.", "details": {} } }` with the matching HTTP status. Times are ISO-8601 UTC. Offsets and counts are numbers (use `long` in Java; JS numbers are safe to 2^53).

## Auth

- `POST /api/auth/login` `{ "username": "admin", "password": "…" }` → 204 + session cookie (`KI_SESSION`, HttpOnly, Secure when behind TLS, SameSite=Strict). Rate-limit 5 attempts/min per IP.
- `POST /api/auth/logout` → 204.
- Every other `/api/**` route except `GET /api/info` and `GET /api/health` requires a session → else 401 `UNAUTHENTICATED`.
- CSRF: double-submit cookie (`KI_CSRF` cookie + `X-KI-CSRF` header) on non-GET requests.

## Meta

- `GET /api/health` → `{ "status": "UP" }` (Docker healthcheck; no auth).
- `GET /api/info` → `AppInfo` (see ARCHITECTURE). Unauthenticated callers get `{ mode, version, auth: true, signedIn: false }` only.

## Clusters

- `GET /api/clusters` → `ClusterSummary[]` `{ id, name, color, status: "connected"|"degraded"|"disconnected", brokers, kafkaVersion, schemaRegistry: boolean }`
- `GET /api/clusters/{c}/overview` → `Overview` (KPIs, needs-attention list, recent events)
- `GET /api/clusters/{c}/brokers` → `Broker[]`
- `GET /api/clusters/{c}/brokers/{id}/config` → `ConfigEntry[]` `{ name, value, source, isDefault, isSensitive, readOnly }` (sensitive values masked as `"******"`)

## Topics

- `GET /api/clusters/{c}/topics?query=&regex=false&internal=false&view=all|attention|starred&sort=issues|name|size|rate&page=1&size=50` → `Page<TopicSummary>`
- `GET /api/clusters/{c}/topics/{name}` → `TopicDetail` (summary + partitions + consumers + health findings)
- `GET /api/clusters/{c}/topics/{name}/config` → `ConfigEntry[]`

## Messages (raw bytes; browser decodes)

- `GET /api/clusters/{c}/topics/{name}/messages?partition=all|N&from=newest|oldest|offset|timestamp|group&offset=&timestamp=&group=&limit=100` → `RawMessagePage` `{ messages: RawMessageDto[], nextCursor, scanned }`
  - `RawMessageDto`: `{ topic, partition, offset, timestamp, key: base64|null, value: base64|null, headers: [{key, value: base64}], sizeBytes }`
  - Max `limit` 500. The agent uses a dedicated consumer per request with `enable.auto.commit=false`, no `group.id` (assign + seek); it **never commits offsets**.
- `POST /api/clusters/{c}/messages/search` `{ topicRegex, from, limit, sample: boolean }` → `RawMessagePage` (multi-topic)

## Consumer groups

- `GET /api/clusters/{c}/groups?type=&query=` → `GroupSummary[]` (types: classic, consumer, share, streams where the broker reports them)
- `GET /api/clusters/{c}/groups/{id}` → `GroupDetail` `{ summary, partitions: GroupPartitionLag[], members: [{ memberId, clientId, host, assignments }] }`

## History

- `GET /api/clusters/{c}/history?metric=messagesIn|bytesIn|bytesOut|lag|endOffset|committedOffset&scope=cluster|topic|partition|group&key=&range=15m|1h|24h|7d` → `Series[]` `{ key, points: [[epochMillis, value], …] }`
- Sampler runs every 10 s (configurable), downsamples to 1 min after 1 h and 10 min after 24 h; retention `KI_HISTORY_RETENTION` (default 7d).

## Live stream

- `GET /api/stream` upgrades to WebSocket. Client sends `{ "op": "sub", "cluster": "prod", "channel": "metrics"|"lag"|"events"|"alerts" }` or `{ "op": "tail", "cluster": "prod", "topic": "orders", "partition": "all", "maxRate": 50 }` and `{ "op": "unsub", "id": "…" }`.
- Server sends `{ "id": "…", "channel": "…", "ts": "…", "data": … }` batched at most once per second per subscription (tail: batches of `RawMessageDto`).
- Heartbeat `{ "op": "ping" }` every 20 s; client reconnects with exponential back-off (1, 2, 5, 10, 30 s) and resubscribes.

## Schemas (proxied to Schema Registry with server-side credentials)

- `GET /api/clusters/{c}/schemas/subjects` → `SubjectSummary[]` `{ subject, latestVersion, type: AVRO|JSON|PROTOBUF, compatibility }`
- `GET /api/clusters/{c}/schemas/subjects/{s}/versions/{v|latest}` → `SchemaVersion` `{ subject, version, id, type, schema, references }`
- `GET /api/clusters/{c}/schemas/ids/{id}` → `SchemaVersion`
- `POST /api/clusters/{c}/schemas/subjects/{s}/compatibility` `{ schema, version: "latest" }` → `{ compatible: boolean, messages: string[] }` (read-only check; allowed in v1)

## Topology

- `GET /api/clusters/{c}/topology` → `{ nodes: [{ id, kind: producer|topic|group, label, status, rate }], edges: [{ from, to, rate, kind: produce|consume|dlq }] }`. Producers are inferred from client ids seen in broker metrics where available; document that producer detection is best-effort in self-hosted mode.

## Alerts (app data — allowed in read-only mode)

- `GET /api/alerts/rules`, `POST /api/alerts/rules`, `PUT /api/alerts/rules/{id}`, `DELETE /api/alerts/rules/{id}`
- `GET /api/filters` → `[{ name, expr }]`; `PUT /api/filters/{name}` with `{ expr }` → 204 (saved message-browser filters, F-04; app data like alert rules)
- `GET /api/alerts/events?state=firing|resolved|all&limit=` ; `POST /api/alerts/events/{id}/mute` `{ until }` ; `POST /api/alerts/events/{id}/ack`
- Evaluator runs after each sampler pass using the shared lag rules.

## Not present in v1

No endpoint creates/deletes topics, produces, resets or deletes offsets/groups, or edits configs. The UI gets `capabilities.writes = false`. Adding them is v2 and must come with an explicit `KI_READ_ONLY=false`.

## Configuration

Environment variables (or `/config/kafka-inspector.yml` with the same keys in YAML; indexed lists for multiple clusters):

| Variable | Default | Meaning |
| --- | --- | --- |
| `KI_ADMIN_PASSWORD` | required | Admin password; the agent refuses to start without it |
| `KI_READ_ONLY` | `true` | Must stay true in v1 |
| `KI_PORT` | `8080` | HTTP port |
| `KI_DB_URL` | `jdbc:h2:file:/data/ki` | History/alerts DB (PostgreSQL URL allowed) |
| `KI_HISTORY_RETENTION` | `7d` | Metric history retention |
| `KI_SAMPLE_INTERVAL` | `10s` | Sampler interval |
| `KI_CLUSTERS_0_NAME` | — | Cluster display name |
| `KI_CLUSTERS_0_BOOTSTRAP` | — | Bootstrap servers |
| `KI_CLUSTERS_0_SECURITY` | `PLAINTEXT` | PLAINTEXT, SSL, SASL_PLAINTEXT, SASL_SSL |
| `KI_CLUSTERS_0_SASL_MECHANISM` | — | PLAIN, SCRAM-SHA-256, SCRAM-SHA-512, OAUTHBEARER |
| `KI_CLUSTERS_0_SASL_USERNAME` / `_PASSWORD` | — | Credentials (env only; never logged) |
| `KI_CLUSTERS_0_SSL_TRUSTSTORE_LOCATION` / `_PASSWORD` | — | Optional custom CA |
| `KI_CLUSTERS_0_SCHEMA_REGISTRY` | — | Registry URL |
| `KI_CLUSTERS_0_SCHEMA_REGISTRY_USERNAME` / `_PASSWORD` | — | Registry basic auth |
| `KAFKA_BOOTSTRAP` | — | Shortcut for a single cluster named `default` |

## Security checklist

- Run as non-root; read-only root filesystem except `/data`.
- Never log config values containing `PASSWORD`, `SECRET`, `TOKEN`, `KEY`; mask in `/api/.../config` responses.
- Session timeout 12 h; login rate limiting (5 failed attempts / min per address, 30 / min in total; the attempt is reserved before the password check); `/api/stream` accepts same-origin handshakes only and closes when the session ends; secure headers (CSP limited to self + Google Fonts, `X-Frame-Options: DENY`). Worker scripts (`/_next/static/chunks/turbopack-worker-*`) get their own CSP — `script-src 'self' 'unsafe-eval'; connect-src 'none'` — so the message filter can compile expressions but has no network; pages never allow eval.
- Startup log line lists clusters and security protocol only.

## Notes from the build (phase 4)

- **Errors.** Every error uses `{ "error": { "code", "message", "details" } }`: 400 `BAD_REQUEST` / `INVALID_DATA`, 404 `NOT_FOUND` / `TOPIC_NOT_FOUND` / `BROKER_NOT_FOUND` / `RULE_NOT_FOUND` / `ALERT_NOT_FOUND`, 405 `METHOD_NOT_ALLOWED`, 429 `RATE_LIMITED`, 502 `KAFKA_UNAVAILABLE`, 503 `UNAVAILABLE`, 500 `INTERNAL` (no internals; see the agent log).
- **History** accepts only what the sampler records: cluster `messagesIn`, `messagesOut`, `bytesIn`, `lag`, `underReplicated`; topic `messagesIn`; partition `endOffset`; group `lag`. Ranges `15m`, `1h`, `24h`, `7d`; anything else is 400.
- **Browse never creates topics**: the consumer sets `allow.auto.create.topics=false`.

These refine the contract above; the agent and `AgentClient` implement them.

- **Info.** Anonymous callers get `200 { mode: "agent", version, auth: true, signedIn: false }`. The web app treats `signedIn: false` (and any 401) as "go to sign-in".
- **CSRF.** Every response sets the `KI_CSRF` cookie (readable by the page); every non-GET request, including `POST /api/auth/login`, must echo it in `X-KI-CSRF`. Missing or wrong → `403 FORBIDDEN`.
- **Sign-in errors.** `401 BAD_CREDENTIALS`; `429 RATE_LIMITED` after 5 *failed* attempts per IP per minute (a successful sign-in clears the count).
- **Live stream ids.** The client chooses the subscription `id` in `sub` / `tail` and the server echoes it on every message; tail batches arrive on channel `"tail"`. The agent pushes `metrics`, `lag`, `events` and `alerts` after every sampler pass (`KI_SAMPLE_INTERVAL`, default 10 s). Slow clients: the send buffer is bounded and the oldest data is dropped.
- **Commit times.** Kafka's Admin API exposes committed offsets, not commit timestamps. The agent treats an unchanged offset in a group *with members* as "still committing" (→ Stalled when behind) and in an *empty* group as "no commits since it last moved" (→ Stopped when behind). The lag window is 30 samples (`ki.lag-window`).
- **Groups.** Classic groups whose protocol type isn't `consumer` (Schema Registry `sr`, Kafka Connect `connect`) are not listed. Share groups (KIP-932) are listed with members; their lag and forecast are `unknown`.
- **Topology.** Producers are not visible to the Admin API: the agent returns topics → consumer groups only.
- **Schemas.** Without a configured registry every schema route answers `404 NO_SCHEMA_REGISTRY` with the variable to set.
- **Alert rules.** `DELETE /api/alerts/rules/{id}` is a soft delete (the rule disappears; its firing alerts resolve).
- **History retention** (`KI_HISTORY_RETENTION`, default 7 d) runs every 10 min: samples older than 1 h are thinned to 1 per minute, older than 24 h to 1 per 10 min; resolved alert events are removed after 7 days. Queries bucket-average, so a thinned range reads the same.
- **Errors.** `404 *_NOT_FOUND`, `400 BAD_REQUEST`, `502 KAFKA_UNAVAILABLE` (brokers unreachable), `503 UNAVAILABLE` (still connecting on first start).
