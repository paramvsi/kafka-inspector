# 10 — Motion retrofit (paste once, mid-build)

We forgot to specify motion before the build started. It's now specified in `docs/MOTION.md`. Add it to what's already built, without breaking anything, and make sure every later phase includes it.

## First, read
`CLAUDE.md` (new rule 11), `docs/MOTION.md` (all), `docs/DESIGN_SYSTEM.md` (Motion section), `docs/FEATURES.md` F-08, and the "Motion" sections now added to the remaining phase prompts in `prompts/`.

## Then reply with a plan, before changing code
1. Which phase we're in and which screens/components already exist.
2. For each existing component/screen: which MOTION.md catalogue entries apply (a table: component · motion · status *todo*).
3. Anything in MOTION.md that conflicts with what's built or with performance budgets.
Wait for my approval.

## Tasks (after approval), in small green commits
1. **Tokens** — merge the new `motion` block of `design-system/tokens.json` into `packages/ui/tokens/tokens.json`; extend the token build script to emit the motion CSS vars, `[data-motion="reduced"]` overrides and the `prefers-reduced-motion` block exactly as in `design-system/tokens.css`; update the token snapshot test. Map durations/easings in Tailwind (see DESIGN_SYSTEM.md).
2. **Motion setting** — `data-motion` on `<html>`: `auto` (follow OS) by default, user toggle "Reduce motion" in Settings/user menu, persisted like the theme (try/catch), applied before first paint.
3. **Primitives** — add `motion` (motion.dev) and build `packages/ui/motion`: `useReducedMotion()`, `<Presence>`, `<Fade>`, `<Pop>`, `<SlideIn side>`, `<Reveal once>`, `useValueFlash(value, threshold)`, `<PulseRing trigger>`, `<FlowEdge rate>`. All read tokens; none hard-code durations. Unit-test reduced-motion behaviour.
4. **Retrofit built components** — Dialog, Drawer, Tooltip, Toast, Popover/Select, Banner, CommandPalette, Tabs/SegmentedControl indicator, Button press, StatusBadge pulse, KpiCard flash, Live dot, Skeleton shimmer, disconnected stale fade, charts first-draw. Only what exists today; the rest is in the later phase prompts.
5. **Guardrails** — lint/CI check that fails on literal durations (`\d+ms`) or `cubic-bezier(` outside the tokens/motion package; Playwright project with `reducedMotion: 'reduce'` running the smoke suite; a perf check during live updates (no long tasks > 50 ms).
6. **Docs** — tick F-08 items done so far; note in `docs/DECISIONS.md`: "D-15 Motion spec added mid-build; `motion` library for presence, CSS for the rest".

## Acceptance
- Every built overlay animates in/out per MOTION.md and can be dismissed mid-animation.
- Live numbers never tween; KPI flash ≤ 1 per card per 5 s.
- Reduced motion (OS emulation and the in-app toggle): nothing moves, no pulses/shimmer, fades ≤ 120 ms.
- No regressions: all existing unit + e2e tests green; screens still match `designs/png/`.

## Stop and report
The table from the plan with statuses, a short screen recording of overlays + live signals (normal and reduced), and what remains for later phases.
