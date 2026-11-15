# 02 — Phase 1: Core + simulator (week 1)

Context: `docs/ARCHITECTURE.md` (KafkaClient, Core types, Client picking, Lag rules, Forecast, Simulator, Serdes, Storage, Testing), `docs/SCREENS.md` (Sample data story), F-04, F-06, F-07, F-100.

## Tasks
1. `packages/core`
   - Types and the `KafkaClient` interface exactly as in ARCHITECTURE (export from `index.ts`).
   - `evaluateLag(window)` → `healthy | warn | stalled | stopped | unknown` (Burrow-style rules in ARCHITECTURE) and `forecast(lag, consumeRate, produceRate)` → `{ kind: 'clearsIn', seconds } | { kind: 'growing', ratePerSec } | { kind: 'steady' }` + `formatForecast()`.
   - Formatters: counts (`1.2M`), bytes, rates (`/s`), durations (`~14 min`), relative time, offsets with thin-space grouping. All mono-friendly.
   - `test-vectors/lag.json` (≥ 20 cases incl. edges: empty window, offsets reset, committed > end, single sample) consumed by Vitest now and by JUnit in phase 4.
2. `packages/simulator`
   - Seeded PRNG; seed cluster `prod-eu-1` (3 brokers, topics, groups, producers, schemas) matching the sample-data story in SCREENS so the screens' numbers are reachable.
   - Tick loop (1 s): produce rates with daily wave + noise, consumer rates, commits, partition skew. Back-fill 24 h of history at 1-minute resolution on start.
   - Messages as a pure function of `(topic, partition, offset, seed)`: keys, headers, JSON bodies, **real Avro binary with Confluent wire format** for Avro topics, a few deliberately malformed payloads (for 06b).
   - Chaos hooks (implemented in phase 3 UI, but the engine supports them now): crash/slow consumer, spike, broker down, rebalance, hot partition, poison message.
   - User changes (created topics, produced messages, offset resets) persisted to IndexedDB via Dexie; `reset()`.
   - Runs in a Web Worker; expose via Comlink.
3. `apps/web/lib/client`: `SimulatedClient` (wraps the worker), `AgentClient` stub that throws "not yet", `pickClient()` per mode detection (`/api/info` 200 → agent, 401 → sign-in, else demo; `NEXT_PUBLIC_KI_MODE` override). React context `useKafka()` + TanStack Query hooks; `subscribe()` drives live updates.
4. Temporary debug page `/app/_debug` listing groups with lag + status updating every second (delete in phase 2).

## Acceptance
- Lag numbers on `/app/_debug` move; `payments-sink` sits around 9.3k lag and "clears in ~14 min"; `fraud-scorer` reads **Stalled** after a poison message is injected from the console.
- Same seed → identical first 1,000 messages of `orders` across reloads (test).
- Avro messages round-trip through `avsc` with the registry schema (test).
- Simulator tick + history back-fill < 50 ms main-thread time (it's in the worker; verify no long tasks).
- Coverage ≥ 90 % for `packages/core`.

## Stop and report
Short screen recording or GIF of the debug page; test summary.
