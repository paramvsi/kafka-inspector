# Kafka Inspector — Claude Code handover pack

Everything needed to build Kafka Inspector end to end with Claude Code: product spec, features with acceptance criteria, architecture, agent API, design system, screen designs, brand assets and phase-by-phase prompts.

## How to use

1. Create an empty repo (e.g. `kafka-inspector`) and copy **all of this folder's contents** into its root. `CLAUDE.md` must sit at the root so Claude Code loads it automatically.
2. Open the repo in Claude Code.
3. Paste `prompts/00-kickoff.md`. Claude reads the docs, asks the open questions in `docs/DECISIONS.md`, and proposes a plan for phase 0. Approve it.
4. Run one phase at a time: `/build-phase 1` (or paste `prompts/01-scaffold.md`, then `02…08`). Each prompt ends with a gate and a stop-and-report; review, then continue.
5. At the end of each phase run `/review` (or `prompts/09-review.md`).
6. Commit after each green step. Tick features off in `docs/FEATURES.md` as their ACs pass.

## What's in here

| Path | Contents |
| --- | --- |
| `CLAUDE.md` | Project guide and non-negotiable rules — Claude Code reads this every session |
| `docs/PRODUCT.md` | What it is, who it's for, the two ways to run it, scope lock |
| `docs/FEATURES.md` | F-01…F-110 with acceptance criteria, plus the v2 backlog |
| `docs/ARCHITECTURE.md` | Repo layout, stack, `KafkaClient` interface, types, lag/forecast rules, simulator, serdes, perf budgets, testing |
| `docs/AGENT_API.md` | The self-hosted agent's REST + WebSocket API, config and security checklist |
| `docs/SCREENS.md` | Every route ↔ design file, required states, sample-data story |
| `docs/DESIGN_SYSTEM.md` | How to implement Copper Oxide (tokens → CSS vars → Tailwind → `packages/ui`) |
| `docs/ROADMAP.md` | Five phases, gates, definition of done |
| `docs/DECISIONS.md` | Decisions made, open questions, build log |
| `docs/MOTION.md` | Motion principles, tokens and the animation catalogue |
| `design-system/` | Copper Oxide tokens (JSON + compiled CSS), brand book, reference components (JS/CSS/types + per-component guidelines) |
| `designs/` | PNG of every screen (`png/`) + the HTML sources (`screens/`) and how to view them |
| `assets/brand/` | Logo icons, marks, lockups, favicons |
| `prompts/` | Kick-off, one prompt per phase, review prompt, `10-motion-retrofit.md` for adding motion mid-build |
| `.claude/commands/` | `/build-phase N`, `/review`, `/check-screen <name>` slash commands |

## Live references

- Design system: https://claude.ai/artifact/2jqJdzZqjvwLTA2ffAGR5w (search "Copper Oxide" in your artifacts if the link differs)
- Screens canvas: "Kafka Inspector — Screens" in your artifacts
- Feature spec doc: "Kafka Inspector — Feature Spec" in your docs

The files in this pack are the build source; the live versions are for browsing.
