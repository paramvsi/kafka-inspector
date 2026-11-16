# Features

Every feature has an ID, a release (**MVP** or **v2**), and acceptance criteria (AC). "Demo" = simulated mode; "Self" = self-hosted agent mode. Unless stated, a feature works in both. In Self mode v1, write actions are disabled (F-90).


## Build status (2026-11-16)

✅ done and tested · ⚠️ done with a noted gap (see DECISIONS) · ⏳ not done

| Area | Features | Status |
| --- | --- | --- |
| App shell | F-01, F-02, F-03, F-05, F-06, F-07, F-08 | ✅ (motion via native dialog/popover + CSS, not the `motion` library) |
| Deep links, saved filters | F-04 | ✅ saved filters in the agent DB (Self) and localStorage (Demo) |
| Overview | F-10 … F-15 | ✅ (F-10 health tiles in a second row) |
| Brokers | F-20, F-21, F-22 | ✅ (config edit is v2) |
| Topics | F-30, F-31, F-32, F-33, F-34, F-35, F-37, F-38, F-39 | ✅ F-30 paginates (25/page) instead of virtualising |
| Topic config | F-36 | ✅ edit and reset-to-default in the demo (logged in Recent events, persisted); read-only on real clusters |
| Message browser | F-40 … F-49 | ✅ |
| Produce | F-50, F-51 | ✅ (demo) |
| Consumer groups | F-60 … F-64 | ✅ (reset/delete in demo) |
| Lag health | F-70, F-71 | ✅ shared vectors pass in TS and Java |
| History | F-72 | ✅ agent: retention + downsampling job; demo keeps 24 h (7d shows what exists) |
| Alerts | F-80 … F-83 | ✅ (rule preview is demo-only; Slack/webhook v2) |
| Topology | F-85 | ✅ agent shows topics → groups only (producers aren't visible to the Admin API) |
| Schemas | F-87, F-88, F-89 | ✅ |
| Read-only, sign-in | F-90, F-91 | ✅ |
| Clusters, self-hosting | F-95, F-96 | ✅ |
| Docker image | F-97 | ⚠️ built and tested; not published (Q-01) |
| Simulator, chaos, tour | F-100, F-101, F-102 | ✅ |
| Landing page | F-110 | ✅ product shot is a Playwright screenshot (`pnpm shots`); not deployed yet |

---

## App shell and navigation

**F-01 App shell — MVP.** Sidebar (232 px) + top bar (56 px) + content, per `designs/screens/Sidebar.dc.html` and `Topbar.dc.html`.
- AC: Sidebar sections Monitor (Overview, Brokers, Topics, Consumer groups), Data (Schemas, Topology), Operate (Alerts, Chaos panel*, Clusters, Run on your Kafka*). *Demo only.
- AC: Active item has `aria-current="page"` and the copper marker. Counts in mono; firing-alert count uses the crit chip.
- AC: Top bar shows breadcrumb (`cluster / section / item`), global search with ⌘K hint, time-range control (15m, 1h, 24h, 7d), Live indicator (pausable: paused freezes every polled and streamed value and the topology flow; alert toasts, notifications and the bell keep arriving).
- AC: Demo sidebar footer: "Simulated cluster" note. Self footer: version, Read-only badge, "Signed in as admin · Sign out".

**F-02 Cluster switcher — MVP.** Button in the sidebar listing configured clusters with status dot (Connected / Degraded / Disconnected). Switching keeps the current route where it makes sense.

**F-03 Command palette — MVP.** ⌘K / Ctrl+K opens a palette searching topics, groups, schemas and actions; `>` prefix = actions only; ↑↓ ↵ navigation; Esc closes. Per `CommandPalette.dc.html`.

**F-04 Deep links and saved filters — MVP.** Every view, tab, filter, time range, partition and offset is in the URL. Users can save a message-browser filter by name (local storage in Demo, agent DB in Self).

**F-05 Themes — MVP.** Dark default, light via `data-theme="light"`; toggle in settings menu; respects `prefers-color-scheme` on first visit; persisted.

**F-06 Keyboard shortcuts — MVP.** `/` focuses the page filter, `g o` Overview, `g t` Topics, `g g` Groups, `?` shows the shortcut sheet.

**F-07 Accessibility — MVP.** WCAG 2.1 AA: contrast per tokens, focus ring on all interactive elements, labelled inputs, tables with `scope` headers and captions, status never shown by colour alone.

**F-08 Motion — MVP.** Every animation per `docs/MOTION.md`: motion tokens, CSS/native overlay enter/exit (no motion library), live-data signals (flash, pulse, Live dot), chart first-draw only, topology flow, tour spotlight, landing reveals; reduced-motion setting + OS preference; no jank during live updates.

## Overview dashboard

**F-10 KPI row — MVP.** Messages in/s, bytes in/s, total consumer lag (with trend word), under-replicated partitions; plus brokers online, offline partitions, under min ISR, active controller, active alerts available as tiles. Thresholds per ROADMAP/ARCHITECTURE.
- AC: Values update every second without layout shift (tabular numbers).

**F-11 Throughput chart — MVP.** In/out series (`chart-1`, `chart-2`) over the selected range with gridlines and peak annotation.

**F-12 Needs attention — MVP.** Ranked list of problems: stalled/stopped/warn groups, under-replicated/offline partitions, skewed topics, health-check failures; each links to the fix screen.

**F-13 Consumer group summary table — MVP.** Problem groups first: name, type, members, lag, 1 h sparkline (coloured by status), catch-up forecast, status badge.

**F-14 Recent events feed — MVP.** Rebalances, broker up/down, ISR shrink/expand, alerts fired/resolved, config changes, a real group going stalled or stopped (`group-stalled`, Self) (Demo: simulator events).

**F-15 Loading and disconnected states — MVP.** Skeletons while connecting (with progress text); disconnect banner with reconnect countdown, attempt count, Retry and Edit connection; stale values dimmed and labelled "stale". Per `OverviewLoading` and `OverviewDisconnected`.

## Brokers

**F-20 Broker list — MVP.** id (controller badge), host, rack, partitions, leaders, in/s, disk used, status.
**F-21 Leader balance — MVP.** Bar per broker; flag a broker leading > 40 % of partitions (checked only with 3 or more online brokers; with fewer, someone always leads more).
**F-22 Broker config — MVP (read).** Key settings + "All settings" list with search; edit is v2.

## Topics

**F-30 Topic list — MVP.** Filter by name/regex, hide internal topics, view switch (All / Needs attention / Starred), sort (issues first default), columns: partitions, RF, size, in/s, 1 h trend, groups, last message (freshness), health badge. Paginated, 25 per page (a stale page is clamped to the last one); issues-first ties break by name so rows don't move on refresh; the header shows the server's total and notes when the other totals cover only the first 500 topics.
**F-31 No-results state — MVP.** Explains, offers clear filter / include internal / create topic.
**F-32 Create topic — MVP (Demo only).** Dialog: name (validation; "." and ".." refused), partitions, RF (validated against broker count; a min.insync.replicas above RF is refused), retention, cleanup policy, advanced overrides, equivalent CLI preview.
**F-33 Topic overview tab — MVP.** KPI row, partitions table (leader, ISR, low/high watermark, share of traffic), health checks, consumers with lag badges.
**F-34 Partitions tab — MVP.** Full partition table with skew bars.
**F-35 Consumers tab — MVP.** Groups reading this topic with lag and status.
**F-36 Config tab — MVP (read).** All configs, overrides highlighted vs defaults. Edit in Demo; v2 in Self.
**F-37 Schema tab — MVP.** Linked subject(s), latest version, link to diff.
**F-38 Topic health checks — MVP.** RF 1, min.insync.replicas too low, no consumers, infinite retention, partition skew %, disk-fill forecast; each with a fix hint.
**F-39 Freshness — MVP.** Time since last message per topic/partition; time since last commit per group.

## Message browser

**F-40 Browse — MVP.** Start from oldest / newest / offset / timestamp / group position; partition picker; decode-as picker (per key and value); table: offset, partition, time, key, value preview.
**F-41 Live tail — MVP.** Streams new messages with a max display rate (default 50/s), shows actual rate, pause/resume.
**F-42 Filters — MVP.** JavaScript expression over `{key, value, headers, partition, offset, timestamp}`, run in a sandboxed Web Worker with a time budget; shows "N of M scanned match". Plus key/header/text quick filters.
**F-43 Multi-topic search and sample mode — MVP.** Search a regex of topics at once; "sample" spreads reads across partitions.
**F-44 Message drawer — MVP.** Key, partition/offset, timestamp, schema (subject, version, id), headers, size, pretty JSON tree, masked-field note; actions: Copy JSON, Reprocess to topic (Demo), Trace key (v2).
**F-45 Decoding — MVP.** Auto-detect order: Schema Registry header (when the registry knows the id) → JSON → UTF-8 text → hex. Formats: JSON, text, hex, Base64, Avro (registry), JSON Schema (registry), number keys (int/long/double big-endian), UUID. v2: Protobuf, MessagePack, CBOR, XML. See ARCHITECTURE "Serdes".
**F-46 Decode errors — MVP.** Never hide a message: show error reason, annotated hex dump (magic byte, schema id), and "try another way" actions. Per `TopicMessagesError`.
**F-47 Data masking — MVP.** Rules per topic pattern: remove / replace / mask a field path; applied after decoding to every view of a value (tree, text, hex/base64 — JSON is masked, then re-encoded); a non-JSON body on a masked topic shows "Raw bytes hidden: masking rule … applies to this topic"; drawer shows which rule masked what. Not masked: keys, headers, and the raw hex of a body that fails to decode (see DECISIONS).
**F-48 Export — MVP.** Download current result set as JSON or CSV.
**F-49 Column picker — MVP.** Choose JSON fields to show as columns.

## Produce (Demo in v1)

**F-50 Produce drawer — MVP.** Partition (auto by key), key, value editor, schema badge, "Generate from schema" (random valid data), validation against schema, headers, send N messages. Per `ProduceMessage`.
**F-51 Reprocess — MVP.** Send a message (edited or not) to another topic; DLQ shortcut.

## Consumer groups

**F-60 Group list — MVP.** KPI row (healthy / warn / stalled-or-stopped / rebalances), filter, type filter (consumer, classic, share, streams), columns: name, type, state, topics, members, lag, 1 h sparkline, last commit, health.
**F-61 Group detail — MVP.** Header with status and type/state, KPIs (lag, consume rate, produce rate, forecast), lag + forecast chart (dashed forecast line to zero), per-partition table (committed, end offset, lag, member/host, status), members tab.
**F-62 Reset offsets — MVP (Demo only in v1).** Requires empty group (simulator pauses members); scope topic + partitions; earliest / latest / time / offset / shift-by; dry-run table (current → new, skipped, lag after); DLQ tip. Per `ResetOffsets`.
**F-63 Delete inactive group — MVP (Demo).**
**F-64 Share groups — MVP.** Show share groups (KIP-932) with their own detail fields; at least one in the simulator.

## Lag health and forecast

**F-70 Lag status — MVP.** Healthy / Warn / Stalled / Stopped (+ Rebalancing/Empty/Unknown as neutral) per partition and rolled up per group, using the rules in ARCHITECTURE "Lag evaluation". Shared pure function with test vectors.
**F-71 Catch-up forecast — MVP.** `t = lag / (consumeRate − produceRate)` when positive, else "won't catch up at current rates"; shown as "~14 min" everywhere.
**F-72 Metric history — MVP.** Time series for 15m/1h/24h/7d — cluster msgs/s in/out, bytes/s in, lag, under-replicated; topic msgs/s; partition end offset; group lag; Demo pre-generates 24 h on load; Self stores samples in the agent DB (retention configurable, default 7 d).

## Alerts

**F-80 Alerts page — MVP.** Firing list (severity, title, evidence, actions: open, mute 1 h, acknowledge), history table, rules list with state.
**F-81 Rule builder — MVP.** Metric (lag, group status, topic silent, under-replicated, broker offline, DLQ receiving), scope (any / specific), threshold, duration, severity, channels; 24 h preview "would have fired N times" (demo only; self-hosted says "Preview isn't available on this cluster"). Per `AlertRule`.
**F-82 Delivery — MVP.** In-app bell + toast, browser notification. v2: Slack/webhook (Self).
**F-83 Ready-made rules — MVP.** Seeded: group stalled/stopped, lag > 5,000 for 5 min, under-replicated > 0, broker offline, topic silent 10 min, DLQ receiving (muted).

Alert rules are app data, not Kafka writes, so they are allowed in read-only Self mode.

## Topology

**F-85 Topology map — MVP.** Producers (client ids) → topics → consumer groups (custom SVG). Edge width = msgs/s; node colour = health; dashed edge for producers writing to DLQ; highlight search; click node to open; fit to screen. In Self mode the map shows topics → groups only: the Admin API doesn't expose producers.

## Schemas

**F-87 Subjects — MVP.** List with latest version, type, compatibility.
**F-88 Version diff — MVP.** Pick two versions; side-by-side field diff (added/removed/changed), compatibility verdict (backward/forward/full) with per-field explanation; Protobuf pairs show "Not checked" (v2); a JSON Schema verdict covers top-level properties, types and required only. Per `Schemas`.
**F-89 Compatibility check — MVP.** Paste a candidate schema and check against the registry (read-only call; allowed in Self).

## Read-only mode and sign-in (Self)

**F-90 Read-only — MVP.** When `info.readOnly`: banner on affected pages, write buttons disabled with tooltip "Read-only in this version…", write routes absent from the agent. Per `TopicsReadOnly`.
**F-91 Sign in — MVP.** Username `admin` + `KI_ADMIN_PASSWORD`; session cookie (HttpOnly, SameSite=Strict); rate-limited login; sign out. Per `SignIn`.

## Clusters and self-hosting

**F-95 Clusters page — MVP.** Demo: list of saved connections (simulated + user-added), Add cluster dialog with Test connection steps (reachable → brokers → auth → metadata → permissions) and actionable errors. Self: read-only list from server config with "edit the config to change" note. Per `Clusters`, `AddCluster`.
**F-96 Run on your own Kafka — MVP (Demo).** Form (name, bootstrap, security, SASL mechanism, Schema Registry, port; access fixed to read-only) → generates `docker-compose.yml`, `.env` (variable names only), and `docker run` line; Copy and Download (zip). Nothing leaves the browser. Per `RunOnKafka`.
**F-97 Docker image — MVP.** `ghcr.io/<owner>/kafka-inspector:<version>`; one container serves web + API on 8080; config via env or YAML; healthcheck endpoint; non-root user.

## Simulator and chaos (Demo)

**F-100 Simulator — MVP.** See ARCHITECTURE "Simulator". Deterministic, seeded, 1 s ticks, 24 h back-filled history, real Avro bytes on Avro topics, IndexedDB persistence of user changes, Reset demo.
**F-101 Chaos panel — MVP.** Actions: crash consumer, slow consumer, traffic spike ×10, broker down, rebalance, hot partition, poison message; running-incident banner with Stop; simulator settings (base traffic, daily wave, seed, reset); event log. Per `Chaos`. Stopping an incident, or its expiry, logs an end event; a rebalance on a group with no members is refused.
**F-102 Guided tour — MVP.** 5 steps walking one incident end to end (trigger poison message → see Stalled → open group → reset offsets shift +1 → recovery).

## Website

**F-110 Landing page — MVP.** Per `Landing.dc.html`: hero with two CTAs, embedded product shot, three questions, comparison table, two ways to use, feature grid, about the author, footer with trademark notice. Lives at `/` of the marketing site; the app lives at `/app` (see DECISIONS).

## v2 backlog (do not build in MVP)

Write actions on real clusters; Protobuf/MessagePack/CBOR/XML; message diff; partition reassignment and preferred leader election; client quotas; transactional producers and KRaft quorum view; bulk actions; topic catalogue; import messages; local audit log; Kafka Connect; ACLs; config diff; message tracing; incident timeline; Slack/webhook alerts; REST-proxy connection mode; OIDC sign-in; Helm chart.
