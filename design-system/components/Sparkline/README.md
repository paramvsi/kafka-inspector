# Sparkline

A tiny trend line for a table cell or KPI card; shape only, no axes.

- In the consumer-groups table it shows lag over the last hour, coloured by the group's status (`ok`, `warn`, `crit`).
- For throughput use `chart-1` (in) and `chart-2` (out), matching the large charts.
- Give it a `label` when it is the only place the trend is shown; otherwise it is decorative and hidden from screen readers.
- Default 90 x 18px; 1.5px stroke, round joins.
