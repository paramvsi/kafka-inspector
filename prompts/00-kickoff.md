# 00 — Kick-off (paste first, once)

You are building **Kafka Inspector**: a Kafka dashboard that runs as a no-backend demo on Netlify (in-browser simulated cluster) and as a self-hosted read-only Docker image (Spring Boot agent) against real Kafka.

Before writing any code:

1. Read, in order: `CLAUDE.md`, `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/FEATURES.md`, `docs/SCREENS.md`, `docs/DESIGN_SYSTEM.md`, `docs/AGENT_API.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md`. Skim `design-system/README.md` and open two or three files in `designs/screens/` to get the visual language.
2. Reply with:
   - a 10-line summary of what you understood (two modes, the `KafkaClient` boundary, read-only v1, the five phases);
   - anything in the docs that contradicts something else, or that you'd need to guess — list it, don't resolve it silently;
   - the open questions in `docs/DECISIONS.md` that block phase 0 (at minimum Q-02, the GitHub owner).
3. Then propose the plan for phase 0 (`prompts/01-scaffold.md`) as a checklist of commits. **Wait for my approval before you start.**

Working agreement for the whole build:
- One phase at a time. Small commits, each green (`pnpm lint && pnpm typecheck && pnpm test`; `./gradlew check` once the agent exists).
- Follow the 11 rules in `CLAUDE.md`. If a rule blocks you, stop and ask; don't work around it.
- When a screen is involved, open its reference in `designs/screens/` and match it (layout, copy, states). Copy is part of the design — use the words in the reference.
- Record any decision you make in `docs/DECISIONS.md` ("Decisions made during build").
- At the end of each phase: run the gate, then stop and report (what's done, what's not, screenshots of the screens touched, anything you'd change).
