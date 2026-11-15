# Copper Oxide

The design system behind **Kafka Inspector**, a real-time UI for Apache Kafka. Copper Oxide is calm, precise and dense: polished copper over deep patina green, numbers in a monospace face, borders instead of shadows. It is built for engineers who watch live data for hours, so the interface stays quiet until something needs attention.

## Principles

1. **Quiet until it matters.** Neutral surfaces carry the screen. Colour is reserved for the one primary action (`copper`), the data series (`chart-1`, `chart-2`) and health (`ok`, `warn`, `crit`). If everything is coloured, nothing is urgent.
2. **Numbers are the content.** Every offset, lag, count and rate is set in Martian Mono with tabular figures, so live values update without jitter and columns line up.
3. **Say what happened, then what happens next.** A good alert names the resource, the evidence and the forecast: "payments-sink lag rising · 9,312 behind · catch-up in ~14 min".
4. **Borders, not shadows.** Cards sit on `bg` with a 1px `line` border and `radius-lg`. Only floating layers (menus, the command palette, toasts) get `shadow-popover`.
5. **Both themes are first-class.** Dark is the default (a control-room tool); light mode is a full theme, not an inversion. Every token has a value for both.

## Voice and copy

- Sentence case everywhere: "Consumer groups", "Reset offsets".
- Kafka names appear exactly as they are, in mono: `payments-sink`, `orders`, partition 7.
- Buttons start with a verb and name the object: "Reset offsets", "Create topic", "Open partition 7".
- Units in labels, not values: "Messages in / s" → `48,213`.
- No exclamation marks, no emoji, no "Oops". Errors say what failed and what to do: "Couldn't reach broker 2. Retrying in 5 s."
- The demo always shows a "Simulated cluster" note; never present generated data as real.

## Colour

Tokens are semantic; never use a hex value directly. Dark is the first theme and the fallback.

| Role | Tokens | Rule |
| --- | --- | --- |
| Ground | `bg`, `bg-sidebar`, `surface`, `surface-sunken`, `surface-hover` | Page → rail → card → nested tile. One step of contrast between each. |
| Lines | `line`, `line-subtle`, `line-strong` | `line` for card and input borders, `line-subtle` for rows and gridlines. |
| Text | `ink`, `ink-muted`, `ink-subtle` | `ink` for content and numbers, `ink-muted` for labels and headers, `ink-subtle` only for small labels on `bg-sidebar`. |
| Brand | `copper`, `copper-strong`, `on-copper`, `copper-soft`, `verdigris` | Copper is the action colour. Text on copper is always `on-copper`. Verdigris is a brand hue for the logo and the second data series, never a status. |
| Data | `chart-1`, `chart-2`, `chart-3` | Series order: messages in, messages out, comparison. |
| Health | `ok`, `warn`, `crit` + `-text`, `-soft` | Only for status. Dots and lines use the base token; badge text uses `-text` on `-soft`. |
| Focus | `focus-ring` | 2px outline, 2px offset, on every interactive element. |

Health colours also differ in lightness and always come with a word (Healthy, Warn, Stalled, Stopped) so they never rely on hue alone. All text tokens meet 4.5:1 on their stated grounds in both themes.

## Typography

Two families, both from Google Fonts:

- **Sora** (`font-sans`) for the interface: `page-title` 24/32 600, `section-title` 15/22 600, `body` 13/20, `body-strong` 13/20 600, `small` 12/16, `overline` 11/16 500 in capitals.
- **Martian Mono** (`font-mono`) for data: `metric` 22/28 500 for KPI values, `data` 12/18 for names, offsets and lag, `data-small` 10/14 for counts, shortcut chips and axis labels.

Load both with:

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=Martian+Mono:wght@400;500&display=swap">
```

Martian Mono is wide; keep data at 12px and below in tables and use `metric` only in KPI cards.

## Layout, spacing and shape

- 4px base: `space-1` 4 · `space-2` 8 · `space-3` 12 · `space-4` 16 · `space-5` 20 · `space-6` 24 · `space-8` 32.
- App shell: sidebar `sidebar-width` 232px on `bg-sidebar`; top bar `topbar-height` 56px with breadcrumb, search (⌘K), time range and the Live indicator; content padded `space-6`, cards `space-4` apart.
- Radius: `radius-sm` 4 for badges and chips, `radius-md` 8 for controls, `radius-lg` 12 for cards and tables, `radius-full` for dots.
- Controls: `control-md` 36px by default, `control-sm` 28px in table rows, `control-lg` 44px on touch.

## Data visualisation

- Area and line charts: 2px line in the series token, area fill at 12–14% of it, gridlines `line-subtle`, baseline `line-strong`, axis labels `data-small` in `ink-muted`.
- Lag trends in tables use a Sparkline coloured by the group's status, not by series.
- Forecast copy sits next to the number it explains: "catch-up in ~14 min", "won't catch up at current rates".
- Never use red or green for series; they are reserved for health.

## Iconography

Line icons on a 24px grid, 2px stroke, round caps and joins, `currentColor` (Lucide is a close match and fine to use). Sizes 14px in inputs and buttons, 16px in navigation. Icons never replace a status word.

## Logo

The mark is a copper lens over three verdigris partition bars; the shorter middle bar ends in a copper dot, a consumer that has fallen behind. Use the files in `assets/Logos`:

- `kafka-inspector-icon-dark.svg` / `-light.svg`: app icon and favicon source, on its own rounded square.
- `kafka-inspector-mark-on-dark.svg` / `-on-light.svg`: the mark alone on a transparent ground, coloured for that ground.
- `kafka-inspector-lockup-dark.png` / `-light.png`: mark + name + tagline for READMEs and social cards.

Keep clear space of one bar height around the mark; minimum size 16px. Never recolour the mark, add effects, or place it next to the official Apache Kafka logo. "Kafka" is a trademark of the Apache Software Foundation; describe the product as a UI "for Apache Kafka".

## Components

`components/bundle.js` defines `window.CopperOxide` (React 18 on the page). Nine components cover the Overview screen: **Button**, **StatusBadge**, **KpiCard**, **Sparkline**, **SearchInput**, **SegmentedControl**, **NavItem**, **AlertItem**, **DataTable**. Each has its own guidelines. Class names are prefixed `co-`.

## Using the tokens in code

Theme switching is one attribute: `<html data-theme="dark">` or `"light"`. In the Next.js app, load `tokens.css` once and map the variables in Tailwind:

```js
// tailwind.config.js (excerpt)
colors: {
  bg: 'var(--bg)', surface: 'var(--surface)', line: 'var(--line)',
  ink: { DEFAULT: 'var(--ink)', muted: 'var(--ink-muted)' },
  copper: { DEFAULT: 'var(--copper)', strong: 'var(--copper-strong)', on: 'var(--on-copper)' },
  ok: 'var(--ok)', warn: 'var(--warn)', crit: 'var(--crit)',
},
fontFamily: { sans: 'var(--font-sans)', mono: 'var(--font-mono)' },
```
