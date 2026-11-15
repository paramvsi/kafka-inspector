# SearchInput

The global search field in the top bar; it also opens the command palette with Ctrl/Cmd+K.

- Placeholder names what can be found: "Search topics, groups, offsets".
- The shortcut chip (`kbd`) shows the platform shortcut; pass `shortcut={null}` inside dialogs.
- Border turns `copper` on focus. Results open in a popover with `shadow-popover`.

## Consumer provides

Native input props (`value`, `onChange`, `placeholder`), `label` for screen readers, optional `width`.
