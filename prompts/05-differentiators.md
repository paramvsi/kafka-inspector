# 05 — Phase 3: Differentiators (weeks 4–5)

Context: `docs/FEATURES.md` Lag health and forecast, Alerts, Topology, Simulator and chaos, App shell (deep links, saved views); `docs/ARCHITECTURE.md` Lag rules, Storage; references `GroupDetail`, `Alerts`, `AlertRule`, `Topology`, `Chaos`, `Main`.

## Tasks
1. `TimeSeriesChart` (uPlot or Recharts — pick one, record in DECISIONS) using `chart-1..3` tokens; range picker 15m/1h/6h/24h/custom; crosshair with mono values; annotations for events (rebalances, chaos).
2. History everywhere it's designed: Overview throughput, Topic overview, Group detail lag chart with forecast line + "clears in" label.
3. Alerts: rule model (metric, scope, condition, duration, severity), evaluator in the simulator worker (agent evaluates server-side in phase 4), firing → resolved lifecycle, history list, bell badge + toast + optional browser notification (permission asked on user action only). Rule builder dialog per `AlertRule`.
4. Topology per F-85 (React Flow): layout, edge widths, health colours, DLQ dashed edges, search highlight, fit, click-through.
5. Chaos panel per `Chaos` + F-101: each action produces a visible change within 5 s; running-incident banner with Stop; event log; simulator settings and Reset demo.
6. Guided tour F-102: 5 steps, skippable, resumable, keyboard accessible; ends with recovered state.
7. Deep links & saved views: every filter/tab/selection in the URL; "Copy link" on detail pages.

## Motion (docs/MOTION.md)
Chart first-draw reveal and range cross-fade (no per-tick animation); alert list insert/remove; topology edge flow scaled by rate, stalled node pulse, highlight fade, pause when hidden; chaos trigger progress + reaction flash; reset-offsets recovery pulse; tour spotlight move. Add the incident flow under reduced motion to `e2e/incident.spec.ts`.

## Gate (must pass)
Poison message on `payments` partition 7 → `fraud-scorer` shows **Stalled** on Overview, Groups and Topology within 10 s → alert fires (bell + toast) → Reset offsets shift +1 on partition 7 → lag drains, status returns to Healthy, alert resolves. Automate this as a Playwright test (`e2e/incident.spec.ts`).

## Stop and report
GIF of the incident flow; chart library decision.
