# SegmentedControl

Picks one of 2 to 5 short options that change a view in place, such as the time range.

- Labels are short and in `data-small` mono: "15m", "1h", "24h", "7d".
- The selected option is filled with `ink` in light mode and `line` in dark mode; the others are `ink-muted`.
- Each option is a real button with `aria-pressed`; the group has an `aria-label`.
- More than five options, or options longer than one word: use a select menu instead.
