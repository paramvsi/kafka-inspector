# Kafka Inspector — project guide for Claude Code

Kafka Inspector is a real-time web UI for Apache Kafka. It ships two ways from one codebase:

1. **Hosted demo** — a static web app on Netlify that runs against a **simulated Kafka cluster inside the browser** (Web Worker). No backend.
2. **Self-hosted** — one Docker image: a Spring Boot **agent** serves the same web app plus a **read-only** REST + WebSocket API that talks to the user's real Kafka.

Its edge over AKHQ / Kafbat UI / Kafdrop: **metric history, lag health status, catch-up forecasts, built-in alerts, a topology map, and a simulated demo cluster with a chaos panel.**

## Read before you write code

| File | What it holds |
| --- | --- |
| `docs/PRODUCT.md` | What we're building, for whom, scope lock (MVP / v2 / not planned) |
| `docs/FEATURES.md` | Every feature with an ID (F-xx) and acceptance criteria |
| `docs/ARCHITECTURE.md` | Repo layout, stack, `KafkaClient` interface, domain types, simulator model, lag rules, serdes |
| `docs/AGENT_API.md` | The REST/WebSocket contract between web app and agent, config, security |
| `docs/SCREENS.md` | Every screen and state: route, components, data, reference design file |
| `docs/DESIGN_SYSTEM.md` | Copper Oxide rules: tokens, type, components, voice |
| `docs/MOTION.md` | Motion principles, tokens and the catalogue of every animation |
| `docs/ROADMAP.md` | Phases, gates, definition of done, test strategy |
| `docs/DECISIONS.md` | Decisions already made and open questions — don't relitigate silently |
| `design-system/` | Source of truth for tokens (`tokens.json`, `tokens.css`) and reference components |
| `designs/png/*.png` | Rendered image of every screen (1280×800; landing 1440 wide). Match these visually. |
| `designs/screens/*.dc.html` | Source HTML for the screens — exact copy, spacing and values. |

## Non-negotiable rules

1. **UI talks only to `KafkaClient`.** No component imports the simulator, `fetch`, or WebSocket directly. Add a method to the interface instead.
2. **Use design tokens, never hex.** Colours, spacing, radii and fonts come from `design-system/tokens.css` CSS variables (mapped in Tailwind). Dark is the default theme; light is `data-theme="light"` on `<html>`.
3. **Numbers and Kafka names are mono.** Offsets, lag, counts, topic/group names use `font-mono` with `tabular-nums`.
4. **Status colours mean status only.** `ok`/`warn`/`crit` are for health. Chart series use `chart-1`, `chart-2`, `chart-3`.
5. **Real clusters are read-only in v1.** The agent exposes no write endpoints; the UI hides or disables write actions when `info.readOnly` is true, with the hint "Read-only in this version".
6. **Never log or persist secrets.** Credentials live in agent env/config only. Generated compose/.env files contain variable names, never values.
7. **The demo is honest.** Simulated mode always shows the "Simulated cluster" note. Never present generated data as real.
8. **Accessibility is a requirement**: WCAG 2.1 AA, real buttons/links/labels, visible focus ring (`focus-ring` token), 44px touch targets on touch layouts.
9. **Same lag logic everywhere.** Lag status and forecast are pure functions in `packages/core` used by the simulator, the web app and (ported) the agent, with shared test vectors.
10. **Small, reviewed steps.** Work one prompt/phase at a time from `prompts/`. Finish with tests green and a short summary of what changed and what's next.
11. **Motion follows `docs/MOTION.md`.** Durations/easings from motion tokens only, via `packages/ui/motion`; animate only `transform`/`opacity`; live numbers never tween; everything respects reduced motion.

## Commands (once scaffolded)

```bash
pnpm install
pnpm dev              # web app at http://localhost:3000 (simulated mode)
pnpm test             # unit tests (Vitest) for all TS packages
pnpm e2e              # Playwright against the built web app
pnpm build            # static export to apps/web/out
cd apps/agent && ./gradlew test bootRun   # agent on http://localhost:8080
docker compose -f deploy/docker-compose.dev.yml up   # agent + Kafka + Schema Registry for local dev
```

## Copy and voice

Sentence case. Verb-first buttons that name the object ("Reset offsets", "Create topic"). Kafka names exactly as they are, in mono. Units in labels, not values ("Messages in / s" → `48,213`). No exclamation marks, no emoji. Errors say what failed and what to do.

## When unsure

Check `docs/DECISIONS.md`. If the answer isn't there, pick the option that keeps the `KafkaClient` boundary clean and the demo honest, note it under "Decisions made during build" in that file, and tell the user in your summary.
