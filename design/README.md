# Faiz E Aam school website — design package

This package is the design-first foundation for the school website.

## Canonical design prototype (V15, supersedes V14 — 8 September 2026)

The canonical design prototype is **`V15 Faiz E Aam School Platform.html`** (repository root). This is a single-file React application containing the complete design system, all screens, all components, and all interaction states. It is the source of truth for every design token, colour, typography choice, component specification, layout pattern, and screen composition in the project. V15 keeps the V14 palette, typography, radii, and breakpoints while adding richer page composition, the `q-head5`/`q-row5` five-column result queue, secondary evidence panels, facts-ledger/record-card primitives, and improved applicant-shell mobile behavior. **Copy V15 layout only — never its illustrative data, counts, actor names, or client-only authorization behavior.** Where V15's own responsive or accessibility behavior is weak, the application fixes beyond the prototype (owner decision).

**Visual thesis:** "A living school record: Kashmir material cues, literary typography, calm paper surfaces, fine rules, measured grids, and precise institutional information design."

**Design tokens:** ink navy `#0B1C2A` · paper `#F4EFE5` · saffron `#B96832` · willow `#536D57` · chalk `#FFFDF8` · madder `#A33B2E`. Type: Source Serif 4 + Public Sans + Noto Nastaliq Urdu. See `UX-BLUEPRINT.md` §2 for the complete token table.

**Dials:** variance 4 (public 5) · motion 3 · density 4-5. WCAG 2.2 AA targets; reduced-motion honoured.

## Start here

- `../PROJECT-BLUEPRINT.md` — canonical product and technical architecture; it takes precedence for implementation.
- `../PROJECT-STATUS.md` — current implementation truth and next gate.
- `../FEATURE-INTEGRATION-SPEC.md` — detailed role, relationship, context, synchronization, and feature-connection contract.
- `UX-BLUEPRINT.md` — **the canonical V15 design system reference**: colour tokens, typography, radii, layout, component specifications (§12.1), responsive breakpoints (§16), screen catalog (§17), role/route matrix (§18), navigation structure (§19), and implementation priority (§20).
- `RESEARCH-NOTES.md` — school/peer research and current primary sources for disclosure, payments, privacy, accessibility, and security.
- `../V15 Faiz E Aam School Platform.html` (repository root) — the interactive design prototype with all screens, components, and states.

## Design artifacts currently present

- **`../V15 Faiz E Aam School Platform.html`** (repository root) — the canonical V15 design prototype. Full redesign (V12→V14→V15). Contains: public website (13 screens), identity (7 screens), applicant (4 screens), guardian portal (13 screens), administrator (18 screens), principal (12 screens), UI states gallery (33 states), and system reference. All components, tokens, and layouts are defined in the embedded `<style>` block.
- `../V14 Faiz E Aam School Platform.html` (repository root) — the historical V14 reference, superseded by V15 for all implementation decisions.
- `mockups.html` + `styles.css` — earlier inspectable multi-screen concept (pre-V14, superseded).
- `parent-fees-mockup.jpg` and `results-timetable-mockup.jpg` — rendered early workflow concepts.
- `faiz-e-aam-*.png` and `landing-images/` — fictional generated visual concepts; see `STUDENT-IMAGE-SET.md`.
- `screenshots/` — browser evidence from later responsive/UI passes.

Do not cite missing historical renders or a screenshot filename as implementation evidence; use `../PROJECT-STATUS.md` and rerun the current gates.

To review the V15 prototype:

Open `../V15 Faiz E Aam School Platform.html` directly in a browser (or use its `#/{workspace}/{route}` hash router). It is a self-contained React application (via CDN) with a demo bar at the bottom for switching between workspaces: Website, Applicant, Guardian, Administrator, Principal, UI states, and System.

To review the earlier interactive mockup locally:

```sh
python3 -m http.server 4173 --directory design
```

Then open:

- `http://127.0.0.1:4173/mockups.html?screen=home`
- `http://127.0.0.1:4173/mockups.html?screen=portal`
- `http://127.0.0.1:4173/mockups.html?screen=apply`
- `http://127.0.0.1:4173/mockups.html?screen=academic`
- `http://127.0.0.1:4173/mockups.html?screen=career`

All people, names, amounts, dates, application references, grades, marks, and school details shown in the mockups and V15 prototype are fictional concept data. The FA mark is a placeholder, not the school's official crest. The interface direction is intentionally UI-led and does not require school photography. Imagery contract: no photography, no borrowed imagery; brand-derived SVG motifs only (eight-point star, chinder/chinar branch divider, contour-line field).
