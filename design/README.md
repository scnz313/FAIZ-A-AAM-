# Faiz Aam school website — design package

This package is the design-first foundation for the school website.

## Start here

- `../PROJECT-BLUEPRINT.md` — canonical product and technical architecture; it takes precedence for implementation.
- `../PROJECT-STATUS.md` — current implementation truth and next gate.
- `../FEATURE-INTEGRATION-SPEC.md` — detailed role, relationship, context, synchronization, and feature-connection contract.
- `UX-BLUEPRINT.md` — component map, roles, feature flows, data boundaries, safety bar, and delivery phases.
- `RESEARCH-NOTES.md` — school/peer research and current primary sources for disclosure, payments, privacy, accessibility, and security.
- `mockups.html` + `styles.css` — responsive, inspectable high-fidelity mockups.

## Design artifacts currently present

- `mockups.html` + `styles.css` — the inspectable multi-screen concept.
- `parent-fees-mockup.jpg` and `results-timetable-mockup.jpg` — rendered early workflow concepts.
- `faiz-e-aam-*.png` and `landing-images/` — fictional generated visual concepts; see `STUDENT-IMAGE-SET.md`.
- `screenshots/` — browser evidence from later responsive/UI passes.

Do not cite missing historical renders or a screenshot filename as implementation evidence; use `../PROJECT-STATUS.md` and rerun the current gates.

To review the interactive mockup locally:

```sh
python3 -m http.server 4173 --directory design
```

Then open:

- `http://127.0.0.1:4173/mockups.html?screen=home`
- `http://127.0.0.1:4173/mockups.html?screen=portal`
- `http://127.0.0.1:4173/mockups.html?screen=apply`
- `http://127.0.0.1:4173/mockups.html?screen=academic`
- `http://127.0.0.1:4173/mockups.html?screen=career`

All people, names, amounts, dates, application references, grades, marks, and school details shown in the mockups are fictional concept data. The FA mark is a placeholder, not the school’s official crest. The interface direction is intentionally UI-led and does not require school photography.
