# 04 — Phase 2b: Message browser, serdes, produce (weeks 2–3, part 2)

Context: `docs/FEATURES.md` Message browser (F-40…F-49) and Produce (F-50, F-51); `docs/ARCHITECTURE.md` Serdes, JS filter worker, Perf budgets; references `TopicMessages`, `TopicMessagesError`, `ProduceMessage`.

## Tasks
1. Serdes in `packages/core/serdes`: auto-detect order (Confluent magic byte → Avro via registry id / JSON Schema; else UTF-8 JSON; else UTF-8 text; else binary), explicit override per topic (key and value separately), Avro via `avsc` with schema cache by id, JSON Schema validation via `ajv`, hex dump for binary. Errors are values (`{ ok: false, reason, raw }`), never throws.
2. Browse: seek modes (newest, oldest, offset, timestamp, per-partition), page size 50/100/500, partition filter, key/value/header text search.
3. Live tail with pause/resume, buffer cap (5,000) and "N new — jump" pill; no jank at 1k msgs/s (virtualised list, batched updates).
4. JS filter: user expression evaluated in a dedicated worker with a 50 ms budget per batch; timeouts and errors shown inline; saved filters (F-49 storage per ARCHITECTURE).
5. Message drawer: Value (JSON tree with collapse + copy path), Key, Headers, Metadata (partition, offset, timestamp type, size, schema id/version link), Raw (hex). Deep link `msg=p:offset`.
6. Decode errors (06b): per-row marker; drawer shows reason, schema id tried, hex.
7. Masking (F-47): rules by JSON path/regex; masked in table, drawer, export.
8. Export (F-48): JSON Lines / CSV of current result set, respecting masking.
9. Produce drawer (F-50, demo only): key, value editor with schema-aware validation, headers, partition (auto/specific), "Produce" → appears in live tail. In read-only/agent mode the button is disabled with the read-only tooltip.

## Motion (docs/MOTION.md)
Tail rows fade in only below 20 msgs/s; "N new" pill slide-up; drawer slide; copy-to-check swap; JSON tree chevron only. Verify no animation cost at 1k msgs/s.

## Acceptance
- Matches references 06, 06b, 07.
- Avro, JSON, text and binary samples on the seeded cluster all decode as expected; malformed ones show 06b.
- Filter `value.amount > 500 && headers['region'] == 'eu'` works on 10k messages within budget (test).
- Tail at simulated 1k msgs/s: no long tasks > 50 ms (Playwright + performance trace).
- Unit tests for every serdes branch, including the Confluent header edge cases (short buffer, unknown id).

## Stop and report
GIF of tail + filter + drawer; serdes test table.
