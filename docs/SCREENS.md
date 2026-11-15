# Screens

Reference designs: a PNG of every screen in `designs/png/` (look at these first) and the source HTML in `designs/screens/*.dc.html` (serve the repo root over HTTP to view them live — see `designs/README.md`). The live, commentable canvas is https://claude.ai/artifact/D1ghbfZLA5RXauXSoRs9Gm. Build each screen to **match its reference visually** using `packages/ui` components and tokens; copy text from the reference unless the feature spec says otherwise.

All app screens share **Sidebar** + **Topbar** (`Sidebar.dc.html`, `Topbar.dc.html`). Frame: 1280 × 800 desktop reference; layouts must also work down to 1024 px wide (sidebar collapses to icons below 1100 px) and degrade gracefully on tablets.

## Routes

Static export cannot pre-render unknown topic/group names, so detail pages use query parameters. Every app route accepts `c=<clusterId>` (defaults to the first cluster).

| # | Screen | Route | Reference | Features |
| --- | --- | --- | --- | --- |
| 01 | Overview | `/app` | `Main.dc.html` | F-10–F-14 |
| 01b | Overview — loading | `/app` (state) | `OverviewLoading.dc.html` | F-15 |
| 01c | Overview — disconnected | `/app` (state) | `OverviewDisconnected.dc.html` | F-15 |
| 02 | Brokers | `/app/brokers` | `Brokers.dc.html` | F-20–F-22 |
| 03 | Topics | `/app/topics?q=&view=&internal=` | `Topics.dc.html` | F-30, F-38, F-39 |
| 03b | Topics — no results | `/app/topics?q=shipment` | `TopicsEmpty.dc.html` | F-31 |
| 04 | Create topic (dialog) | `/app/topics?create=1` | `CreateTopic.dc.html` | F-32 |
| 05 | Topic · Overview | `/app/topics/view?name=orders&tab=overview` | `TopicOverview.dc.html` | F-33, F-38 |
| 06 | Topic · Messages + drawer | `/app/topics/view?name=orders&tab=messages&from=newest&live=1&filter=…&msg=1:21861950` | `TopicMessages.dc.html` | F-40–F-49 |
| 06b | Messages — decode error | same, `msg=4:7511202` | `TopicMessagesError.dc.html` | F-46 |
| 07 | Produce message (drawer) | `/app/topics/view?name=orders&produce=1` | `ProduceMessage.dc.html` | F-50 |
| 08 | Consumer groups | `/app/groups?type=` | `Groups.dc.html` | F-60, F-70 |
| 09 | Group detail | `/app/groups/view?id=payments-sink` | `GroupDetail.dc.html` | F-61, F-71, F-72 |
| 10 | Reset offsets (dialog) | `/app/groups/view?id=fraud-scorer&reset=1` | `ResetOffsets.dc.html` | F-62 |
| 11 | Schema registry · diff | `/app/schemas?subject=orders-value&from=3&to=4` | `Schemas.dc.html` | F-87–F-89 |
| 12 | Topology | `/app/topology?highlight=` | `Topology.dc.html` | F-85 |
| 13 | Alerts | `/app/alerts` | `Alerts.dc.html` | F-80, F-82, F-83 |
| 13b | Alert rule builder (dialog) | `/app/alerts?rule=new` | `AlertRule.dc.html` | F-81 |
| 14 | Clusters | `/app/clusters` | `Clusters.dc.html` | F-95 |
| 14b | Add cluster — test failed | `/app/clusters?add=1` | `AddCluster.dc.html` | F-95 |
| 15 | Chaos panel | `/app/chaos` (demo only) | `Chaos.dc.html` | F-101, F-102 |
| 16 | Command palette | overlay, any route | `CommandPalette.dc.html` | F-03 |
| 17 | Overview — light | `/app` with light theme | `OverviewLight.dc.html` | F-05 |
| 18 | Sign in | `/app/sign-in` (agent only) | `SignIn.dc.html` | F-91 |
| 19 | Run on your own Kafka | `/app/self-host` (demo only) | `RunOnKafka.dc.html` | F-96 |
| 20 | Topics — read-only | `/app/topics` with `readOnly` | `TopicsReadOnly.dc.html` | F-90 |
| 21 | Website landing page | `/` | `Landing.dc.html` | F-110 |

## States every data screen must handle

| State | Pattern |
| --- | --- |
| Loading (first load) | Skeleton blocks shaped like the content (`surface-hover` fills), status line with what's happening |
| Refreshing | Keep data; subtle Live dot pulse; never blank the table |
| Empty (no data exists) | Explain why + primary action (e.g. "No consumer groups yet") |
| No results (filtered) | Echo the query, offer clear filter + alternatives (03b) |
| Error (request failed) | Inline alert in the card: what failed, Retry; keep other cards working |
| Disconnected (cluster) | Global banner (01c), dim stale values, pause actions |
| Read-only | Banner + disabled write actions with tooltip (20) |
| Decode failure | Per-message error with raw bytes (06b) |

## Sample data story (keep consistent across screens and the simulator)

Cluster `prod-eu-1`, 3 brokers, Kafka 4.1 (KRaft). 42 topics, 186 partitions. Throughput ~48,213 msg/s (peak 52,904 at 13:58). `payments-sink` (classic, 3 members) lag 9,312, Warn, catch-up ~14 min (consume 8,180/s vs produce 7,511/s). `fraud-scorer` stalled on `payments` partition 7 at offset 88,410 for 6 min (poison message → `payments.dlq`); fix = Reset offsets → Shift by +1. `clickstream` partition 3 hot (41 %). `audit-log` RF 1. `legacy-events` no consumers. `search-indexer` stopped (Empty). `notify-workers` is a share group.

## Notes for building

- Tables in the references are plain HTML using `co-table` classes; build them with `packages/ui` `DataTable` (TanStack-backed) keeping the same look.
- Dialogs and drawers: shadcn Dialog/Sheet restyled with tokens; overlay `rgba(5,9,7,.62)`; focus trapped; Esc closes; URL param reflects open state.
- Charts in the references are static SVG; build with Recharts using the same tokens (gridlines `line-subtle`, baseline `line-strong`, area fill 12–14 %).
- The landing page embeds the real Overview as its hero image: render a screenshot (generated in CI by Playwright) rather than a live iframe.
