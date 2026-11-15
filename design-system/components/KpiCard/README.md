# KpiCard

One headline number for the dashboard's top row, with a short delta that says which way it is moving.

- `label` in `ink-muted`, sentence case, units in the label ("Messages in / s").
- `value` in the `metric` style (Martian Mono, tabular figures) so live updates don't jitter. Format with thousands separators; abbreviate above 100k ("48.2k") only when space forces it.
- `delta` is at most three words. `deltaTone`: `ok` (good direction), `warn` (bad direction), `crit` (threshold crossed), `neutral` (context such as "of 186").
- Optional `spark` (array of numbers) draws a 24px Sparkline under the value.

Use four in a row on desktop; they wrap to two, then one.
