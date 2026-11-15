# Roadmap — MVP in five phases (~9 weeks part-time)

Each phase ends with a **gate**: a demo check. If it fails, the next phase waits. Each phase has a prompt in `prompts/`.

| Phase | Weeks | Prompt | Build | Gate |
| --- | --- | --- | --- | --- |
| 0. Scaffold | day 1–2 | `01-scaffold.md` | Monorepo, tooling, CI skeleton, tokens, fonts, app shell with Sidebar/Topbar, routes stubbed | `pnpm dev` shows the shell in dark and light; CI green |
| 1. Foundation | 1 | `02-core-and-simulator.md` | `packages/core` types + `KafkaClient` + lag/forecast + formatters; `packages/simulator` seed cluster, ticks, history back-fill, deterministic messages, Worker + Comlink; `SimulatedClient`; client picker | Lag numbers move in the UI; lag test vectors pass |
| 2. Core views | 2–3 | `03-core-views.md`, `04-messages-and-serdes.md` | Overview (all states), Brokers, Topics (+ empty), Topic detail tabs, Message browser (tail, JS filter, drawer, decode, errors, masking, export), Produce, Groups, Group detail, Create topic, Reset offsets, Schemas + diff, health checks, freshness | All 01–11 screens match references on demo data |
| 3. Differentiators | 4–5 | `05-differentiators.md` | History charts + range picker, lag status everywhere, forecast chart, alerts (rules, evaluator, firing, history, bell/toast/browser), topology, chaos panel + guided tour, command palette, deep links, saved filters, keyboard shortcuts | One incident visible end to end (poison message → stalled → alert → reset → recovered) |
| 4. Self-host agent | 6–8 | `06-agent.md`, `07-self-host-ui.md` | Spring Boot agent per AGENT_API (read-only), sampler + history DB, alert evaluator, sign-in, static hosting, Dockerfile, dev compose with Kafka + Schema Registry, Testcontainers tests, `AgentClient`, read-only UI states, Sign in, Run-on-your-Kafka generator, Clusters (agent mode) | Agent reads a real cluster; generated compose works end to end |
| 5. Launch | 9 | `08-launch.md` | Landing page, guided tour polish, a11y audit, performance pass, Playwright suite, README with GIFs, release workflow → GHCR, Netlify deploy | Definition of done met |

`prompts/09-review.md` is a reusable review pass to run at the end of each phase.

## Definition of done (MVP)

- [ ] Live demo on Netlify with the "Simulated cluster" note — **not deployed**: `netlify.toml` ready (demo mode), needs a Netlify site linked to the repo
- [x] Every chaos action produces a visible change on the dashboard (simulator tests + e2e)
- [x] Lighthouse 90+ on `/app` with the desktop preset (99/100/100); mobile-throttled preset scores 87 on performance (LCP waits for the simulator back-fill). No long tasks during live updates (e2e)
- [x] Unit tests for lag status, forecast and serdes; Playwright tests for the main flows; agent integration tests with Testcontainers; CI green
- [ ] Docker image on GHCR — **not published** (Q-01). `docker run` with `KAFKA_BOOTSTRAP` + `KI_ADMIN_PASSWORD` works against a real cluster read-only ✓ (dev stack + e2e)
- [x] The "Run on your own Kafka" page downloads a compose file that connects read-only (`scripts/selfhost-gate.sh`)
- [x] README: what it is, screenshots, architecture diagram, how the simulator works, self-hosting guide, trademark, licence — **gaps:** live demo link (not deployed), GIFs (needs ffmpeg), provider settings unverified
- [ ] Pinned on GitHub; case study on the portfolio — owner's step

## After the MVP (v2 order suggestion)

1. Write actions behind `KI_READ_ONLY=false` (create/delete topic, produce, reset offsets) with typed confirmations + audit log
2. Protobuf decoding, message diff (reuse the Spec Diff engine), config diff
3. Slack/webhook alerts, OIDC sign-in
4. Kafka Connect, ACLs, quotas
5. Helm chart
