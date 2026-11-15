# 09 — Review pass (run at the end of every phase)

Review the work of the phase just finished. Don't add features. Report findings first; fix only after I agree.

Check:
1. **Rules** — each of the 11 rules in `CLAUDE.md`. Grep for hex colours outside tokens, direct Kafka/HTTP calls from components, `console.log` of config, write paths reachable in read-only.
2. **Features** — for each feature in this phase, every acceptance criterion in `docs/FEATURES.md`: pass / fail / partial, with evidence (test name or screenshot).
3. **Screens** — open each touched route next to its reference in `designs/screens/`, dark and light. List differences in layout, copy, spacing, states.
4. **States** — loading, empty, no results, error, disconnected, read-only where they apply.
5. **Quality** — tests meaningful (not snapshot-only), types strict (no `any` without comment), no unused exports, error messages say what to do.
6. **Motion** — every animation in this phase matches `docs/MOTION.md`; no literal `ms`/`cubic-bezier` outside tokens (`grep -rnE "[0-9]+ms|cubic-bezier" apps packages --include=*.tsx --include=*.ts --include=*.css` minus tokens); reduced-motion run passes.
7. **Performance & a11y** — long tasks during live updates; axe results; keyboard path.
8. **Docs** — ARCHITECTURE / AGENT_API / DECISIONS updated for anything that changed.

Output a table: area · finding · severity (blocker / should / nit) · proposed fix.
