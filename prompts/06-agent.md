# 06 — Phase 4a: Self-hosted agent (weeks 6–7)

Context: `docs/AGENT_API.md` (all of it), `docs/ARCHITECTURE.md` (Lag rules, Testing), `docs/DECISIONS.md` D-02, D-03, D-10, D-11; F-90, F-91, F-97.

## Tasks
1. `apps/agent`: Spring Boot 3.x, Java 21, Gradle Kotlin DSL. Packages: `config`, `security`, `kafka` (AdminClient + browse consumer), `history`, `alerts`, `schemas`, `api`, `ws`, `web` (static files).
2. Config from env/YAML exactly as in AGENT_API's table; fail fast with a clear message if `KI_ADMIN_PASSWORD` is missing. Support PLAINTEXT, SSL, SASL_SSL with PLAIN / SCRAM-SHA-256/512; MSK IAM optional behind a flag (record in DECISIONS if skipped).
3. Security: session cookie, CSRF double-submit, login rate limit, security headers, secrets never logged (add a log-scrubbing test), non-root container.
4. Read endpoints per AGENT_API. Browse consumer uses `assign` + `seek`, `enable.auto.commit=false`, never commits, unique `group.id`-less consumption; bounded by limit 500 and a time budget. Raw bytes as base64.
5. WebSocket `/api/stream` with `sub/tail/unsub/ping`; backpressure (drop oldest + `dropped` count).
6. Sampler every `KI_SAMPLE_INTERVAL` → H2/Postgres via Flyway; retention job; history endpoint returns the same shape as the simulator.
7. Lag evaluator in Java consuming `packages/core/test/lag-vectors.json` in JUnit — must produce identical verdicts.
8. Alert evaluator server-side; same rule model as phase 3.
9. Schema Registry proxy (read-only + compatibility check).
10. Serve the exported web app from `/app` and redirect `/` → `/app/`; SPA fallbacks for query-param routes.
11. `deploy/Dockerfile` (multi-stage: pnpm build web → copy `out` into agent resources → Gradle bootJar → distroless/temurin JRE, user 10001, `HEALTHCHECK /api/health`). `docker-compose.dev.yml` with Kafka (KRaft), Schema Registry, a small load generator, and the agent.
12. Testcontainers integration tests: topics, browse (no commits — assert group offsets unchanged), groups + lag, schemas, auth, read-only (no write routes: 404/405).
13. CI: add agent job (`./gradlew check`), Docker build on PR; `release.yml` pushing `ghcr.io/<owner>/kafka-inspector:<version>` on tag (owner from DECISIONS Q-02; ask if still open).

## Acceptance
- `docker compose -f docker-compose.dev.yml up` → sign in → real topics/groups/messages; Avro decodes in the browser.
- Lag test vectors pass in both languages.
- Browse never changes committed offsets (test).
- Image < 300 MB, starts < 10 s, runs as non-root.

## Stop and report
Test summary; image size/start time; any API change (update AGENT_API.md in the same commit).
