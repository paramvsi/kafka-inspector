# 01 — Phase 0: Scaffold (day 1–2)

Context: `CLAUDE.md`, `docs/ARCHITECTURE.md` (Repo layout, Stack), `docs/DESIGN_SYSTEM.md`, `designs/screens/Sidebar.dc.html`, `designs/screens/Topbar.dc.html`, `designs/screens/Main.dc.html`.

## Tasks
1. pnpm workspace with `apps/web`, `packages/core`, `packages/simulator`, `packages/ui`; root scripts `dev`, `build`, `test`, `e2e`, `lint`, `typecheck`, `tokens`. TypeScript strict, ESLint, Prettier, Vitest, Playwright installed.
2. `apps/web`: Next.js (App Router, TS) with `output: 'export'`, `trailingSlash: true`, app under `/app`, placeholder landing at `/`. Tailwind configured per DESIGN_SYSTEM. Fonts via `next/font/google` (Sora, Martian Mono).
3. Tokens: copy `design-system/tokens.json` to `packages/ui/tokens/`; write `packages/ui/scripts/build-tokens.ts` that emits `tokens.css` identical in shape to `design-system/tokens.css`; import it in `globals.css`. Add a test that the script's output matches the committed CSS.
4. Theme: dark default; toggle sets `data-theme` on `<html>`, persisted (try/catch around storage), respects `prefers-color-scheme` on first visit, no flash (inline script in `<head>`).
5. App shell (F-01, F-02, F-05): `Sidebar` and `Topbar` in `packages/ui` matching the references (nav groups, active state, cluster switcher placeholder, search field with ⌘K chip, Live indicator, theme toggle, "Simulated cluster" chip). Stub pages for every route in `docs/SCREENS.md` showing the page title only. Query-param detail routes (`/app/topics/view?name=`).
6. Brand: copy `assets/brand/favicons/*` and icons into `apps/web/public/brand/`; set favicon + app icons + `<title>` pattern "Page · Kafka Inspector".
7. `netlify.toml` (build `pnpm --filter web build`, publish `apps/web/out`, SPA-style fallbacks for `/app/*` to the right exported HTML).
8. `.github/workflows/ci.yml`: install, lint, typecheck, unit tests, build. (Agent job comes in phase 4.)
9. Root `README.md` stub (keep this pack's README as `docs/HANDOVER.md`), `LICENSE` (Apache-2.0), `.editorconfig`, `.nvmrc` (Node 22).

## Acceptance
- `pnpm dev` → `/app` shows the shell; every sidebar item navigates to its stub; theme toggle works with no flash on reload.
- Shell visually matches `Main.dc.html` chrome (sidebar width, topbar height, colours, fonts) in dark and `OverviewLight.dc.html` in light.
- `pnpm build` produces `apps/web/out` with `/app/index.html` and `/app/topics/view/index.html`.
- CI green. No hex colours outside `packages/ui/tokens`.

## Stop and report
Screenshots of `/app` dark + light next to the references; list of deviations.
