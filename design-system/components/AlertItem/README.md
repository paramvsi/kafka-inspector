# AlertItem

One firing or recent alert in a list: severity dot, title, one line of detail, time.

- Title = resource + what happened, lower-case resource names as they appear in Kafka: "fraud-scorer stalled".
- Detail = the evidence and, where known, the forecast: "9,312 behind · catch-up in ~14 min".
- `severity`: `crit` (red), `warn` (amber), `info` (copper). Sort critical first, then newest.
- Time in mono, 24-hour local time; older than a day shows the date.
