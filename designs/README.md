# Screen designs

- `png/` — a rendered image of each screen, named by the number in `docs/SCREENS.md` (e.g. `09-GroupDetail.png`). Use these as the visual target; Claude Code can read them directly.
- `screens/` — the source of each design (`*.dc.html`). Use these for exact copy, numbers, spacing and inline styles.

## Viewing the HTML

The files use a tiny template runtime (`screens/support.js`, React bundled in) and load shared parts (`Sidebar`, `Topbar`) with `fetch`, so open them over HTTP, not `file://`:

```bash
# from the repo root
python3 -m http.server 8765
# then open http://localhost:8765/designs/screens/Main.dc.html
```

Template syntax, for reading the source:
- `{{ expr }}` — value computed by the `<script type="text/x-dc">` class at the bottom of the file (`renderVals()`).
- `<dc-import name="Sidebar" active="topics">` — includes `Sidebar.dc.html` with those props (`light`, `selfhosted` variants exist).
- `<x-import component-from-global-scope="CopperOxide.KpiCard" label=… value=…>` — a design-system component (`ds/copperoxide/components/bundle.js`); the real implementation goes in `packages/ui`.
- `<sc-if value="{{ demo }}">` — shown only when the value is true.
- `canvas.json` — board titles and the page each screen belongs to.

Logos point at `../../assets/brand/`. Re-render the PNGs after editing a design with any headless browser (wait for `html[data-dc-ready]`).

These files are references, not production code — don't import them into the app.
