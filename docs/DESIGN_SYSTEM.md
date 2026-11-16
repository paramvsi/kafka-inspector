# Design system: Copper Oxide — how to implement it

The brand book is `design-system/README.md` (principles, voice, colour roles, type, layout, data-vis, iconography, logo). The live reference is https://claude.ai/artifact/2jqJdzZqjvwLTA2ffAGR5w. This page says how to turn it into code.

## Source of truth

| File | Use |
| --- | --- |
| `design-system/tokens.json` | Canonical tokens (colours for dark + light, type styles, spacing, radius, shadow, sizes). Edit here first. |
| `design-system/tokens.css` | Compiled CSS variables: `:root, [data-theme="dark"]` then `[data-theme="light"]`; spacing/radius/size/font vars; `.page-title`, `.body` … type classes. Import once in `apps/web/app/globals.css`. |
| `design-system/components/bundle.css` | Reference styles for the 9 components (`co-*` classes). Port to `packages/ui` with Tailwind; keep the same look. |
| `design-system/components/bundle.js`, `index.d.ts`, `*/README.md` | Reference React components (no JSX, `window.CopperOxide`) + usage guidelines. Rebuild them as typed TSX in `packages/ui`; keep prop names and variants. |

Add a tiny script `pnpm tokens` (packages/ui/scripts) that regenerates `tokens.css` from `tokens.json` so they never drift.

## Tailwind mapping

```js
// tailwind.config.ts (excerpt)
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)', 'bg-sidebar': 'var(--bg-sidebar)',
        surface: { DEFAULT: 'var(--surface)', sunken: 'var(--surface-sunken)', hover: 'var(--surface-hover)' },
        line: { DEFAULT: 'var(--line)', subtle: 'var(--line-subtle)', strong: 'var(--line-strong)' },
        ink: { DEFAULT: 'var(--ink)', muted: 'var(--ink-muted)', subtle: 'var(--ink-subtle)' },
        copper: { DEFAULT: 'var(--copper)', strong: 'var(--copper-strong)', on: 'var(--on-copper)', soft: 'var(--copper-soft)' },
        verdigris: 'var(--verdigris)',
        chart: { 1: 'var(--chart-1)', 2: 'var(--chart-2)', 3: 'var(--chart-3)' },
        ok: { DEFAULT: 'var(--ok)', text: 'var(--ok-text)', soft: 'var(--ok-soft)' },
        warn: { DEFAULT: 'var(--warn)', text: 'var(--warn-text)', soft: 'var(--warn-soft)' },
        crit: { DEFAULT: 'var(--crit)', text: 'var(--crit-text)', soft: 'var(--crit-soft)' },
        focus: 'var(--focus-ring)',
      },
      fontFamily: { sans: 'var(--font-sans)', mono: 'var(--font-mono)' },
      borderRadius: { sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-lg)', full: 'var(--radius-full)' },
      spacing: { 1: 'var(--space-1)', 2: 'var(--space-2)', 3: 'var(--space-3)', 4: 'var(--space-4)', 5: 'var(--space-5)', 6: 'var(--space-6)', 8: 'var(--space-8)' },
      boxShadow: { popover: 'var(--shadow-popover)' },
      height: { 'control-sm': 'var(--control-sm)', 'control-md': 'var(--control-md)', 'control-lg': 'var(--control-lg)', topbar: 'var(--topbar-height)' },
      width: { sidebar: 'var(--sidebar-width)' },
    },
  },
};
```

Fonts: load **Sora** (400/500/600/700) and **Martian Mono** (400/500) with `next/font/google`, exposing them as `--font-sans` / `--font-mono` (override the token fallbacks).

## Components to build in packages/ui

From the system (match reference): `Button` (primary/secondary/ghost/danger × sm/md/lg), `StatusBadge` (healthy/warn/stalled/stopped/neutral), `KpiCard`, `Sparkline`, `SearchInput` (with kbd chip), `SegmentedControl`, `NavItem`, `AlertItem`, `DataTable`.

New, in the same style (add each to the design system later): `Dialog`, `Drawer`, `Tabs`, `Tooltip`, `Toast`, `CommandPalette`, `Select`, `TextField`, `Checkbox`, `Radio`, `Switch`, `Banner` (info/warn/crit), `Skeleton`, `EmptyState`, `CodeBlock` (mono, copy button), `JsonTree`, `HexDump`, `TimeSeriesChart`, `TopologyGraph`, `ClusterSwitcher`, `Kbd`.

Rules: borders not shadows (shadow only for popovers/dialogs); one primary button per view; status words always shown with status colours; text on copper uses `on-copper`; focus ring 2 px `focus-ring` with 2 px offset everywhere.

## Brand assets

`assets/brand/`: app icons (dark/light), marks on dark/light (transparent), lockups (PNG), favicons (16/32/180/512 + .ico). Copy into `apps/web/public/brand/`. The mark is two-colour: pick the file for the ground, don't recolour.

## Motion

See `docs/MOTION.md`. Motion tokens in Tailwind 4: `@utility duration-instant|fast|base|slow` in `apps/web/app/globals.css` read the `--dur-*` tokens (Tailwind 4 has no `--duration-*` theme namespace, so a `transitionDuration` config does nothing); easings are `--ease-*` theme variables (`ease-standard`).
