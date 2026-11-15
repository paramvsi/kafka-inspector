# Motion — Copper Oxide

Motion in Kafka Inspector has one job: **show what changed and where it went**. It is a monitoring tool people stare at for hours, so motion is quiet, fast and never decorative on data. If an animation makes a number harder to read, or plays on every tick, it is wrong.

## Principles

1. **Explain change, don't decorate.** Animate when something appears, leaves, changes state, or moves between places. Never animate idle data.
2. **Fast.** Most UI motion is 80–220 ms. Nothing in the app is longer than 320 ms, except continuous status signals (Live dot, topology flow).
3. **Live data doesn't tween.** Numbers update instantly (tabular mono, no layout shift). At most a short tint flash shows that a value changed a lot.
4. **Status changes get one signal, once.** A group that turns Stalled pulses once and then sits still; the word and colour carry the rest.
5. **Only `transform` and `opacity`.** No animating width/height/top/left, box-shadow or filters on lists. Keep 60 fps during live updates.
6. **Respect the user.** `prefers-reduced-motion: reduce` → no movement: fades ≤ 120 ms or instant, no pulses, no flowing edges, no shimmer. Also a Settings toggle "Reduce motion" (follows the OS by default).
7. **Stop when unseen.** Continuous animations pause when the tab is hidden (`document.visibilityState`) or the element is off-screen.

## Tokens (add to `tokens.json` → `motion`, compiled to CSS vars)

| Token | Value | Use |
| --- | --- | --- |
| `--dur-instant` | 80ms | Hover, press, focus ring, toggles |
| `--dur-fast` | 150ms | Dialog/popover/toast/palette enter, tooltip, tab indicator, colour changes |
| `--dur-base` | 220ms | Drawer, banner, accordion, row insert |
| `--dur-slow` | 320ms | First chart draw, page-level reveal (landing), tour spotlight move |
| `--ease-standard` | cubic-bezier(0.2, 0, 0, 1) | Things that move within the screen |
| `--ease-enter` | cubic-bezier(0, 0, 0, 1) | Things arriving (decelerate) |
| `--ease-exit` | cubic-bezier(0.3, 0, 1, 1) | Things leaving (accelerate); exits use ~70 % of enter duration |
| `--pulse-period` | 2000ms | Live dot, firing-alert dot |
| `--flash-dur` | 600ms | Value-changed tint |

Under reduced motion, the `[data-motion="reduced"]` root sets every `--dur-*` to `0.01ms` except fades, which use 120 ms.

## Implementation

- **CSS transitions** for hover/press/focus/colour/tab indicator/theme.
- **`motion`** (motion.dev, the successor of Framer Motion) only for enter/exit presence (dialog, drawer, popover, toast, command palette, banners, tour) and the small number of layout moves. Wrap it in `packages/ui/motion` (`<Fade>`, `<SlideIn side>`, `<Pop>`, `<Presence>`, `useReducedMotion()`) so screens never use raw durations or easings.
- Durations and easings come from the tokens only — no literal `ms` values in components (lint rule / grep check).

## Catalogue

### Chrome and controls
| Element | Motion |
| --- | --- |
| Button, nav item, row hover | background/border colour, `--dur-instant` |
| Button press | `scale(0.98)`, `--dur-instant`; none under reduced motion |
| Focus ring | appears instantly (never animate focus visibility) |
| Tabs / SegmentedControl | active indicator slides between options, `--dur-fast`, `--ease-standard` |
| Sidebar collapse | width via `transform` on content + fade labels, `--dur-base` |
| Theme toggle | colours cross-fade `--dur-fast` on user toggle only, never on page load |
| Tooltip | fade + 4 px rise, `--dur-fast`, 300 ms open delay, instant close |

### Overlays
| Element | Enter | Exit |
| --- | --- | --- |
| Dialog | backdrop fade; panel fade + `scale(0.98→1)`, `--dur-fast`, `--ease-enter` | fade, ~100 ms, `--ease-exit` |
| Drawer (message, produce, config) | slide from right 24 px + fade, `--dur-base` | slide out, ~150 ms |
| Command palette | fade + `scale(0.98→1)`, 120 ms; results list no stagger | fade 80 ms |
| Toast | slide up 8 px + fade, `--dur-fast`; stack reflows with layout move | fade + slide right |
| Banners (read-only, disconnected, running incident) | height reveal via `grid-template-rows 0fr→1fr` + fade, `--dur-base` | reverse |
| Popover / select menu | fade + 4 px from the trigger side, `--dur-fast` | fade 80 ms |

### Live data
| Element | Motion |
| --- | --- |
| KPI value change | instant swap; if the change is > 10 % since the last tick, background tint `copper-soft` (or the status `-soft`) fades out over `--flash-dur`. Never more than one flash per card per 5 s |
| Counts in tables | instant; no flash (too many) |
| Live dot | opacity pulse 1 → 0.4, `--pulse-period`; static when paused, disconnected or reduced motion |
| Status badge change | colour cross-fade `--dur-fast`; on transition **into** Stalled/Stopped/Warn one ring pulse (box-shadow-free: a pseudo-element `scale 1→1.6`, opacity → 0, 600 ms), once |
| Needs attention / alert list | new item: slide down 8 px + fade, `--dur-base`; removal: fade, then siblings move up |
| Charts | first draw: line reveal left→right `--dur-slow`; then **no animation on ticks** — new points append and the window shifts; range change: cross-fade old/new 150 ms; crosshair follows pointer with no easing |
| Sparklines | never animate |
| Forecast line | dashed, static; label updates instantly |
| Disconnected | stale values fade to 50 % opacity over `--dur-base` |
| Skeletons | shimmer gradient 1.2 s loop; static fill under reduced motion; content replaces skeleton with a 120 ms fade, no layout shift |

### Message browser
| Element | Motion |
| --- | --- |
| Live tail rows | new rows fade in 150 ms (no slide) **only when the rate is < 20 msgs/s**; above that, rows appear instantly. Never animate scroll position |
| "N new — jump" pill | slide up + fade `--dur-fast`; count updates instantly |
| JSON tree expand/collapse | chevron rotate `--dur-instant`; children appear instantly (no height animation on large trees) |
| Copy actions | icon swaps to check for 1.2 s, cross-fade `--dur-fast` |
| Decode error row | no motion; colour and icon only |

### Signature moments
| Element | Motion |
| --- | --- |
| Topology edges | dashed stroke flows producer → topic → group via `stroke-dashoffset`; speed scales with msgs/s (clamped 0.5×–3×); stalled edges stop flowing; DLQ edges flow slower. Paused off-screen/hidden; static under reduced motion |
| Topology stalled node | one ring pulse when it turns Stalled, then a steady `crit` border |
| Topology highlight search | non-matching nodes fade to 30 % over `--dur-fast` |
| Chaos action triggered | the trigger button shows "Running" with a 2 px progress bar; affected cards elsewhere get one copper outline flash (600 ms) when their value first reacts |
| Reset offsets applied | lag value counts down live (real ticks, not a tween); status badge transitions back to Healthy with a single `ok` pulse |
| Guided tour | spotlight cut-out moves between targets `--dur-slow`, `--ease-standard`; step card fades; page scrolls target into view (smooth unless reduced motion) |

### Landing page (`/`)
| Element | Motion |
| --- | --- |
| Hero | headline + CTAs fade and rise 8 px, staggered 60 ms, `--dur-slow` once on load |
| Product shot | rises 16 px + fade, 100 ms after the hero text; optionally a short looping recording (muted WebM, ≤ 1.5 MB, poster image, paused under reduced motion) |
| Sections | reveal once on scroll into view (fade + 12 px rise, `--dur-slow`), never re-animate on scroll back |
| Pipeline chip row (`web-checkout → orders → payments-sink`) | copper dash flows between chips, same as topology |
| Comparison table, footer | no motion |

## Don'ts

- No count-up animations on numbers, no bouncing/spring overshoot, no parallax, no page-transition slides between app routes (a 120 ms content fade is the maximum).
- No animation that runs on every simulator tick across many elements.
- No motion that delays input: everything is interruptible, and clicks during an exit go straight through.

## Acceptance (applies to every screen)

- Motion tokens only (no literal durations/easings in components).
- With `prefers-reduced-motion: reduce` emulated, nothing moves; Live dot and topology are static; skeletons don't shimmer.
- Live tail at 1k msgs/s and Overview at 1 s ticks: no long tasks > 50 ms and no dropped frames from animation (Chrome performance trace).
- Every overlay can be dismissed mid-animation.
- Playwright: reduced-motion project runs the smoke suite (`reducedMotion: 'reduce'`).
