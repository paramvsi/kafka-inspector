# Product

## One line

A real-time UI for Apache Kafka that shows what happened, what is about to happen, and tells you — try it in the browser on a simulated cluster, or run it on your own Kafka with one command.

## Why it exists

Free Kafka UIs (AKHQ, Kafbat UI, Kafdrop, Redpanda Console) are good at browsing and admin, but show **current state only**: lag is computed on request, nothing keeps history, nothing alerts. Teams bolt on Burrow or Prometheus for that. Kafka Inspector builds history, lag health, forecasts and alerts into the UI itself.

It is also a portfolio project for Paramveer Singh, proving the positioning "senior full-stack engineer who builds real-time data platforms: React/Next.js on the front, Java/Spring Boot and Kafka behind it". It must be built entirely from scratch on demo data — nothing from any employer.

## Users

- **Recruiters and hiring managers** — open the live demo, click around, trigger an incident from the chaos panel, understand it in two minutes.
- **Engineers on call** — answer "is anything falling behind?", "what's in this topic?", "how does data flow?" quickly.
- **Platform teams** — self-host the read-only image against a real cluster.

## Two ways to run

| | Hosted demo (Netlify) | Self-hosted (Docker) |
| --- | --- | --- |
| Data | Simulated in the browser (Web Worker) | The user's own Kafka |
| Backend | None | Spring Boot agent in the same container |
| Sign in | None | One admin password (`KI_ADMIN_PASSWORD`) |
| Browse topics, groups, lag, messages, schemas | Yes | Yes |
| History and alerts | Yes (IndexedDB) | Yes (embedded database) |
| Create/delete topics, reset offsets, produce | Yes (fake cluster) | **v2** — disabled with hint in v1 |
| Chaos panel, "Run on your own Kafka" page | Yes | Hidden |

A third connection mode, **REST proxy** (browser → Confluent REST Proxy / Redpanda HTTP Proxy), is designed into the `KafkaClient` abstraction but is **not required for the MVP** (see DECISIONS).

## Scope lock (15 Nov 2026)

**MVP** — everything in `FEATURES.md` not marked v2, including:

- Core parity: brokers, topics, partitions, message browser (live tail, JS filter, multi-topic search, decode JSON/Avro/JSON Schema/text/hex), produce (demo), consumer groups, offset reset with dry run (demo), schema registry with version diff.
- Differentiators: metric history, lag health status + catch-up forecast, alerts, topology map, freshness, topic health checks.
- Kafka 4 awareness: KRaft, group types including share groups (KIP-932).
- Simulator + chaos panel + guided tour.
- Self-hosting: read-only agent image, sign-in, "Run on your own Kafka" generator page.
- UX: command palette (⌘K), deep links for every view/filter, saved filters, dark + light themes, WCAG 2.1 AA.
- Marketing landing page.

**v2** — write actions on real clusters, Protobuf/MessagePack/CBOR/XML decoding, message diff, partition reassignment, quotas, transactions view, KRaft quorum view, bulk actions, topic catalogue, import messages, audit log, Kafka Connect, ACLs, config diff, message tracing, incident timeline, Slack/webhook alert channels, REST-proxy mode.

**Not planned** — SQL over topics, AI natural-language filters, ksqlDB, Kafka Streams agent, replication management, multi-user RBAC/SSO, approval workflows, Terraform.

## Success criteria for the MVP

- Live demo on Netlify; every chaos action visibly changes the dashboard.
- `docker run` of the published image connects read-only to a real cluster; the generator page produces a compose file that works.
- Lighthouse 90+ on the dashboard; no dropped frames during 1 s live updates.
- Unit + e2e + agent integration tests green in CI.
- README with architecture diagram, GIFs and a "how the simulator works" section; pinned on GitHub; case study on the portfolio.

## Brand

Design system **Copper Oxide** (copper accent over patina green-black; Sora + Martian Mono). Logo: copper lens over three verdigris partition bars, one short with a copper "lag" dot. See `docs/DESIGN_SYSTEM.md` and `assets/brand/`.

"Kafka" is a trademark of the Apache Software Foundation. Describe the product as a UI "for Apache Kafka" and show the trademark notice in the footer and README. The final product name is an open question (DECISIONS).
