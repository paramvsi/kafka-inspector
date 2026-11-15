# DataTable

The default way to list topics, partitions, consumer groups, brokers and messages.

- Column `kind`: `id` for Kafka names (mono), `num` for counts, offsets and lag (mono, right-aligned, tabular figures), `dim` for secondary text. Cells can hold a StatusBadge, Sparkline or Button (`sm`).
- Header row on `surface-sunken`, 12px `ink-muted`; row dividers `line-subtle`; hover `surface-hover`.
- Sort problem rows first (Stalled, Stopped, Warn) by default; every column is sortable.
- Over 200 rows: virtualise (TanStack Table + virtual). Wide tables scroll inside their card, never the page.

## Consumer provides

`columns` ({key, label, kind}), `rows` (objects keyed by column), `rowKey`, `caption` for screen readers.
