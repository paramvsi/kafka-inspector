# StatusBadge

Shows the health of a consumer group, partition, broker or connector in one word with a dot.

## Statuses

| status | label | tokens | meaning |
| --- | --- | --- | --- |
| `healthy` | Healthy | `ok-soft` / `ok-text` | Lag reached zero in the window, or is falling |
| `warn` | Warn | `warn-soft` / `warn-text` | Offsets move but lag keeps rising |
| `stalled` | Stalled | `crit-soft` / `crit-text` | Commits continue at the same offset while lag > 0 |
| `stopped` | Stopped | `crit-soft` / `crit-text` | No commit for longer than the whole window |
| `neutral` | any | `surface-hover` / `ink-muted` | Transitional states: Rebalancing, Empty, Unknown |

These follow the lag-evaluation rules in the feature spec. Never use a badge colour for anything other than its status.

## Consumer provides

`status`; optional `children` to override the label (keep it to one or two words); `dot={false}` in very dense tables.
