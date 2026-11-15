# 03 — Phase 2a: Core views (weeks 2–3, part 1)

Context: `docs/SCREENS.md` rows 01–05, 08–11, 14, 16, 17, 20 and "Required states"; `docs/FEATURES.md` sections App shell, Overview, Brokers, Topics, Consumer groups, Schemas, Clusters (demo half); references in `designs/screens/`.

Build each screen against its reference, all states included. For each: route + URL state, data via `useKafka()` hooks only, loading/empty/error states, keyboard access, then a Playwright test that loads it on the seeded demo.

## Order
1. `packages/ui` primitives needed now: `DataTable` (sort, sticky header, virtualised rows ≥ 200, column resize optional), `KpiCard`, `Sparkline`, `StatusBadge`, `SegmentedControl`, `SearchInput`, `Dialog`, `Drawer`, `Tabs`, `Tooltip`, `Toast`, `Banner`, `Skeleton`, `EmptyState`, `Select`, `TextField`, `Switch`, `Kbd`, `CodeBlock`.
2. Overview (01, 01b, 01c, 17) — F-10…F-15.
3. Brokers (02) — F-20…F-22, incl. config drawer.
4. Topics (03, 03b) — F-30, F-31, F-38, F-39; Create topic (04) — F-32 (demo writes; disabled in read-only).
5. Topic detail · Overview tab (05) — F-33, F-38; Partitions and Config tabs per F-34…F-37.
6. Consumer groups (08), Group detail (09) — F-60, F-61, F-70…F-72 (lag status + forecast text; charts arrive in phase 3).
7. Reset offsets (10) — F-62: strategies, dry-run preview table, typed confirmation.
8. Schemas list + version diff + compatibility check (11) — F-87…F-89.
9. Clusters (14, 14b) — F-95 demo half (saved connections; Test connection steps; errors explain the fix).
10. Command palette (16) — F-03; global shortcuts (F-06).
11. Read-only states (20) — F-90 UI side, toggled by `info().readOnly` (add a demo dev flag to preview it).

## Motion (docs/MOTION.md)
Use `packages/ui/motion` for Dialog, Drawer, Tooltip, Toast, Select, Banner, CommandPalette presence; tab/segmented indicator slide; KPI value flash; status badge pulse on entering Warn/Stalled/Stopped; Live dot pulse; skeleton shimmer; disconnected fade. Charts: first-draw only.

## Acceptance
- Each screen matches its reference on the seeded demo, dark and light (attach side-by-side screenshots).
- Numbers are mono, tabular; status colours only on status; every status has its word.
- No layout shift on live updates; tables keep scroll position and selection.
- axe: zero serious/critical violations on each route.
- Playwright: one test per screen + the "no results" and "read-only" states.

## Stop and report
Screenshot grid vs references; deviations list; anything in a reference that seemed wrong.
