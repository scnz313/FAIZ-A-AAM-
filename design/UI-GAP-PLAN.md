# UI Gap Plan — Faiz Aam School Platform Frontend

> Archived historical record. Superseded by [`../UI-COMPLETION-PLAN.md`](../UI-COMPLETION-PLAN.md), [`../FEATURE-INTEGRATION-SPEC.md`](../FEATURE-INTEGRATION-SPEC.md), and [`../PROJECT-STATUS.md`](../PROJECT-STATUS.md). This file records the narrower 3 August gap pass only and must not be used for current scope, status, or implementation decisions.

Status: archived; executed 3 August 2026 and reclassified as historical on 5 August 2026.
Audit basis: `PROJECT-BLUEPRINT.md` §4 (routes) + §5 (feature specs incl. §5.12 support, §5.13 staff), `UX-BLUEPRINT.md` §3–6 (component maps), and `design/mockups.html` (portal bell, topbar actions).

## Coverage today

- **Routes:** all 50 blueprint routes implemented and verified (build green, link crawl clean, 176-pair responsive audit zero problems).
- **Public site:** homepage (hero, trust line, service rail, story, school life, stages, dates, photo bands), about, academics, admissions (+apply), school-life (+gallery), notices (+detail), disclosure, careers (+vacancy detail), contact (+illustrated map), environment, 4 policies, 404.
- **Applicant centre:** 8-step student application (autosave, validation, review), status + offer acceptance, job application + status.
- **Portal:** overview, fees, invoice, receipts, results (+publication detail), timetable, notices, documents, profile, security, support.
- **Staff:** dashboard, admissions (+review), careers (+review), finance ×4, results (+batch detail), timetables, notices, content, users, audit, settings, facility workspace (7 pages + wallboard).

## Missing UI sections (this plan)

| # | Area | Missing UI | Blueprint reference | Priority |
|---|---|---|---|---|
| 1 | Global | `app/error.tsx` error boundary (editorial, retry, recoverable) | §11.4 UI state checklist | High |
| 2 | Global | Loading skeletons for `/portal` and `/staff` (`loading.tsx`) | §11.4 loading/skeleton without layout shift | Medium |
| 3 | Global | `app/sitemap.ts` + `app/robots.ts` | §14.4, launch checklist | Low |
| 4 | Global | `app/opengraph-image.tsx` social preview (crest + wordmark) | launch checklist §16 | Low |
| 5 | Shells | **Notification bell** in Portal + Staff topbars (unread count, dropdown, mark-read) — the mockup's topbar bell is currently absent | UX-BLUEPRINT §5 portal shell; mockups.html portal screen | High |
| 6 | Public | **Downloads block** on `/notices` (fee schedule, admission form, uniform list, calendar — demo rows) — spec says "Notices and downloads" | UX-BLUEPRINT §3 notices/downloads | Medium |
| 7 | Applicant | **Resume-draft entry** on `/admissions/apply` when a localStorage draft exists | UX-BLUEPRINT §4A autosave | Medium |
| 8 | Applicant | **Admission-fee step** after seat acceptance on the student status page (demo paid state) | UX-BLUEPRINT §4A step 9 | Medium |
| 9 | Staff | **Grievance inbox** `/staff/support` (list, status flow New → In progress → Resolved, response box) — completes §5.12 staff side | PROJECT-BLUEPRINT §5.12 | High |

## Deliberate exclusions (not missing)

- Achievement-proof + leadership pull-quote on the homepage — removed in the approved minimalism pass; `/about` retains the leadership quote. Restore only on request.
- Language switcher (Urdu/Kashmiri) — blocked on the confirmed launch-language decision (§17 workbook).
- Cookie/consent banner, live search, event calendar page — not in blueprint scope.

## Execution order

1. Global foundations (error boundary, loading, metadata, sitemap) + notification bell.
2. Public + applicant completions (downloads, resume draft, admission fee).
3. Staff grievance inbox + shell nav entry.
4. Integration: typecheck + build + link crawl + 176-pair responsive audit + screenshots.
5. Status update.

## Definition of done

- Each item renders with the editorial design system, demo-marked, WCAG AA.
- Build green (50+ routes), crawl clean, responsive audit zero problems, zero console errors in screenshots.

---

## Execution record (2026-08-03)

All nine items are **implemented and verified**:

1. `app/error.tsx` — editorial error boundary with retry + home link. ✅
2. `app/portal/loading.tsx` + `app/staff/loading.tsx` — ruled skeletons (no animation, aria-busy). ✅
3. `app/sitemap.ts` — all 54 routes with priorities (concept domain). ✅
4. `app/robots.ts` + `app/opengraph-image.tsx` — robots allow-all + sitemap; 1200×630 ink OG card with Urdu wordmark. ✅
5. **Notification bell** (`components/layouts/NotificationBell.tsx`) in both shells — unread chip, flat ruled dropdown, mark-all-read, outside-click/ESC/route-change close, focus management, live-region announce; demo data in `modules/notifications/demo.ts`. Hydration-safe (mounted-gated). ✅
6. **Downloads panel** on `/notices` — 4 fictional files (fee schedule, admission form, uniform/book list, calendar) with demo download buttons + live note. ✅
7. **Resume-draft island** on `/admissions/apply` — reads `fass-application-draft`, continue/start-over with live region. ✅
8. **Admission-fee step** on the student status page — accepted offers get a demo pay flow (processing → paid receipt, webhook note). ✅
9. **Staff grievance inbox** (`/staff/support`) — 6 seeded grievances (GRV-2026-0101…0106), status tabs, detail + response panel (New → In progress → Resolved, reopen), audit note. ✅

**Integration validation:** typecheck 0 errors · build 54/54 · link crawl clean (incl. `/staff/support`, sitemap, robots) · **184-pair responsive audit: zero problems across two consecutive runs** · hydration false-positives (prod-only #418 from the SSR'd live region and time-derived timestamps) eliminated via mounted-gates and `suppressHydrationWarning` on the bell's live region · screenshots `design/screenshots/90–93` clean.
