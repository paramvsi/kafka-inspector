---
description: Build one roadmap phase (0–5) using its prompt in prompts/
argument-hint: <phase 0-5 or prompt number 01-08>
---
Build the phase given in `$ARGUMENTS`.

Map: phase 0 → `prompts/01-scaffold.md`; 1 → `02-core-and-simulator.md`; 2 → `03-core-views.md` then `04-messages-and-serdes.md`; 3 → `05-differentiators.md`; 4 → `06-agent.md` then `07-self-host-ui.md`; 5 → `08-launch.md`. If the argument is a two-digit prompt number, use that file.

1. Re-read `CLAUDE.md` and the prompt file(s), plus every doc and design reference listed under "Context".
2. Check the previous phase's gate in `docs/ROADMAP.md` passed; if not, stop and say what's missing.
3. Post a commit-by-commit plan and wait for approval.
4. Build in small green commits. Tick features in `docs/FEATURES.md` as ACs pass. Log decisions in `docs/DECISIONS.md`.
5. Run the phase's acceptance/gate, then stop and report as the prompt asks.
