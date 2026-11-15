# Decisions

## Made (don't change without asking)

| # | Decision | Why |
| --- | --- | --- |
| D-01 | One codebase, two modes: browser simulator (demo) and Spring Boot agent (self-hosted) behind one `KafkaClient` interface | Netlify can't host a backend; browsers can't speak Kafka's TCP protocol |
| D-02 | Real clusters are **read-only in v1**; the agent has no write endpoints | Safety and scope; writes need audit, confirmations and permissions |
| D-03 | Decoding (serdes) runs in the browser in both modes; the agent returns raw bytes | One decoder implementation, exercised by the simulator's real Avro bytes |
| D-04 | Lag status and forecast are pure functions with shared test vectors (TS + Java) | Same verdicts in demo and self-hosted |
| D-05 | Next.js App Router with `output: 'export'`; detail pages use query params (`/app/topics/view?name=`) | Static export can't pre-render unknown names; the same files are served by Netlify and the agent |
| D-06 | The web app lives under `/app`; the landing page at `/`. In self-hosted mode `/` redirects to `/app/` | One build for both; marketing page not needed on a self-hosted instance |
| D-07 | Design system Copper Oxide, dark default + light theme via `data-theme` | Chosen 15 Nov 2026 |
| D-08 | Fonts Sora (UI) + Martian Mono (data) | Part of Copper Oxide |
| D-09 | pnpm workspace for TS; Gradle (Kotlin DSL) for the agent; Java 21 | Common, well-supported defaults |
| D-10 | Agent storage: embedded H2 file DB by default, PostgreSQL optional | `docker run` with no extra services |
| D-11 | Self-hosted auth v1: single admin password via `KI_ADMIN_PASSWORD`, session cookie | Minimum safe gate; OIDC is v2 |
| D-12 | REST-proxy connection mode is designed into the interface but not built in v1 | Agent mode covers real clusters; keeps MVP to ~9 weeks |
| D-13 | Licence Apache-2.0 | Same as AKHQ/Kafbat; friendly to companies |
| D-14 | Nothing from any employer is reused; all sample data is generated | Portfolio honesty and NDA safety |
| D-15 | Motion spec (`docs/MOTION.md`, rule 11, F-08) applied **before** phase 0, so motion is built in from the start; `prompts/10-motion-retrofit.md` is not needed. `motion` library for presence, CSS for the rest | Add-on arrived before any code existed |

## Open questions (ask the user before the step that needs them)

| # | Question | Needed by |
| --- | --- | --- |
| Q-01 | Final product name ("Kafka Inspector" is a working name; Apache trademark concern when distributing) | Before the first image is published (phase 4) and before buying a domain |
| Q-02 | ~~GitHub owner/org~~ **Answered 2026-11-15: `paramvsi`** (`github.com/paramvsi/kafka-inspector`, `ghcr.io/paramvsi/kafka-inspector`) | Phase 0 (repo creation) |
| Q-03 | Domain for the demo/landing (e.g. Netlify subdomain vs custom) | Phase 5 |
| Q-04 | Portfolio and GitHub URLs for the landing page "Built by" section | Phase 5 |

## Decisions made during build

Add rows here as you go: date, decision, reason.

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-11-15 | Repo root is `kafka-inspect/`; the handover pack and motion add-on were copied up from `context/`, which is kept unchanged and git-ignored. Pack README is `docs/HANDOVER.md` | User: keep the repo outside `context/` |
| 2026-11-15 | Theme toggle lives in a settings menu at the right end of the top bar (F-05). "Simulated cluster" note only in the sidebar footer, as in the designs; no top-bar chip | Designs have no toggle; prompt 01 conflicted with `Topbar.dc.html` |
| 2026-11-15 | Tailwind v4: tokens mapped with CSS `@theme inline` using the same names as the v3 excerpt in DESIGN_SYSTEM.md (no `tailwind.config.ts`) | Current stable; v4 config is CSS-first |
| 2026-11-15 | TypeScript 6.0.x, not 7.x | `typescript-eslint` peer range is `>=4.8.4 <6.1.0` |

| 2026-11-15 | `packages/ui/tokens/tokens.json` = `design-system/tokens.json` + `motion.reduced.overrides` (the reduced-motion values that previously existed only in `tokens.css`). Generated CSS is byte-identical to `design-system/tokens.css` (tested) | Generate the CSS from JSON without hard-coding values in the script |
| 2026-11-15 | Don't use the token type class `.overline` in markup: Tailwind v4 has an `overline` utility (text-decoration) with the same name. Section labels use explicit utilities with the same values (11/16, 500, 0.06em, uppercase) | Name collision drew a line over sidebar section labels |
| 2026-11-15 | Sidebar stays 232px (`--sidebar-width`, F-01). The reference PNGs show ~228px because the sidebar is a shrinkable flex child there | Spec over rendering artifact |
| 2026-11-15 | `netlify.toml` at the repo root, not `deploy/` (ARCHITECTURE layout) | Netlify reads it from the base directory |
| 2026-11-15 | Q-02 answered: repo `github.com/paramvsi/kafka-inspector`, public | User |
| 2026-11-15 | When a phase prompt disagrees with the spec docs (ARCHITECTURE, FEATURES), the spec wins. Prompts corrected: forecast type and test-vector path (02, 06), back-fill resolution (02), decode-error shape, tail buffer 2,000, export JSON/CSV (04), Recharts and ranges 15m/1h/24h/7d (05), F-refs (03, 04) | User ruling: ARCHITECTURE wins |
| 2026-11-15 | Full suite (`pnpm lint && pnpm typecheck && pnpm test`, `pnpm e2e` for UI) runs before every commit in this repo | User ruling: repo rule over the global push-only rule |
| 2026-11-15 | Spring Boot 4.1 for the agent, not 3.x | ARCHITECTURE "use current stable"; spec wins over prompt 06 |
| 2026-11-15 | Own Avro binary codec in `packages/core/src/serdes/avro.ts` instead of `avsc` at runtime. `avsc` stays a dev dependency: tests check our encoder is byte-identical to it | `avsc` needs Node `buffer`/`util`/`crypto`/`fs`, which Turbopack does not polyfill in the worker |
| 2026-11-15 | `KafkaClient` additions: `chaos.run` returns the `Incident`, `chaos.incidents()`, optional `previewAlertRule()` (F-81 "would have fired N times") | Rule 1: add to the interface instead of reaching past it |
| 2026-11-15 | Sample-data numbers that the shared lag rules can't produce are not forced. A group catching up has shrinking lag → Healthy (rule 4), so "Warn + catch-up ~14 min" can't coexist. `payments-sink` runs a 16-min saw-tooth instead: ~60 s of Warn while lag builds to ~9.3k, then Healthy draining in ~14 min | Rule 9 (same lag logic everywhere) outranks screen copy |
| 2026-11-15 | Message offsets/rates follow the reference *rates*; reference offsets (e.g. 88,410 on payments-7, 7,511,202 on payments-4) aren't reachable with those rates and are not forced. The poison offset is whatever `fraud-scorer` had committed when it stalled | The reference numbers are mutually inconsistent |
| 2026-11-15 | "Total consumer lag" KPI = lag of active (members > 0) classic/consumer groups; share groups (in-flight records) and Empty groups are excluded. Share groups get no catch-up forecast | Matches the reference total (3,168 + 9,312); share lag isn't a backlog |
| 2026-11-15 | Hosted demo build sets `NEXT_PUBLIC_KI_MODE=demo` (netlify.toml) | Skip the `/api/info` probe and its console 404 on a static host |
