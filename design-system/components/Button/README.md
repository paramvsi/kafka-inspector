# Button

Starts an action; one copper **primary** per view, for the thing the screen is for.

## Variants

- `primary`: copper fill, `on-copper` text. "Reset offsets", "Create topic", "Investigate fraud-scorer". At most one per view.
- `secondary` (default): `surface` with a `line` border. Everything else.
- `ghost`: no border; toolbars, table-row actions, Cancel.
- `danger`: `crit-soft` fill, `crit-text` label. Delete topic, delete group, empty topic. Always behind a confirmation dialog that names the resource.

## Sizes

`sm` (28px) inside table rows, `md` (36px) default, `lg` (44px) for touch layouts and dialog footers.

## Copy

Verb first, sentence case, name the object: "Reset offsets", not "Reset" or "Submit". No exclamation marks.

## Consumer provides

Children (label, optional leading 14px icon), `onClick`, `disabled`. Native button props pass through.
