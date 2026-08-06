# Project Status — Faiz Aam School Platform

Last updated: 6 August 2026  
Current phase: backend foundation (plan.md B0)  
Release state: not deployed; no backend or production authorization exists

## Current state

The repository contains a broad, polished frontend prototype for the public site, applicant journeys, family portal, and staff workspaces. The retained self-contained demo journeys are functional and the current frontend quality gates pass. Execution follows `plan.md` (pointer index in this repo): privacy controls, canonical role/scope authorization, workflow integrity, cross-module event propagation, contract freeze, and the full handoff gate — all before backend selection. Phases 0–5 are implemented; the Phase 6 verification gate ran against the current checkout with fresh build and the evidence below.

## Rollback baseline (no Git)

- Archive: `/Users/fin./Desktop/FASS-archive/fass-pre-change-20260806-142412.tar.gz` (source tree; `node_modules`, `.next`, and `package-lock.json` excluded).
- SHA-256: `3a1a97b064851c53242bce3fe0cd85315190dcfbc3b20934243849ee2631e0d4` (manifest: `fass-pre-change-20260806-142412.sha256` in the same directory).
- The archive is never edited; it is the rollback baseline for the current change cycle.

The system is not yet an integrated school platform. The portal now runs on a shared relationship/context spine with student-scoped services (finance, results, timetable, documents, notices, notifications), admission-fee payment is part of the finance ledger, admissions converts to a permanent student/enrollment/guardian link idempotently, and staff role/assignment enforcement is canonical at the UI/service layer with maker/checker splits. Staff authentication, protected documents, database persistence, provider integrations, and server authorization are `NOT STARTED`.

The authoritative target for those connections is `FEATURE-INTEGRATION-SPEC.md`. The ordered frontend work is in `UI-COMPLETION-PLAN.md`.

## Backend foundation (plan.md B0)

The frontend handoff gate passed (22/22 journeys) and `plan.md` is now the Supabase Backend Blueprint (phases B0–B8). B0 completed in this environment:

- **Version-controlled source established**: `git init` + baseline commit `4edf099` (the pre-change tarball archive remains the untouched rollback baseline).
- **Secrets hygiene**: `.env.example` corrected to names and placeholders only; real Supabase keys that had been copied into it were removed. Those exposed keys MUST be rotated (plan.md §3).
- **Pinning**: Node 22 (engines + `.nvmrc`), Supabase CLI `2.111.0` as a root devDependency (up from global 2.58.5), `@supabase/ssr@0.12.4`, `@supabase/supabase-js@2.112.2`.
- **Supabase workspace**: `supabase/config.toml` (Realtime and Edge Functions disabled per the v1 locks), foundation migration `000001_foundation.sql` (conventions, `app.new_ref` reference generation, `app.touch_updated_at`, append-only blocker, optimistic-version pattern documented; tables: `audit_events`, `outbox_events`, `idempotency_records`, `webhook_receipts`, `resend_webhook_events`, `rate_limit_buckets`, `job_runs`, `role_definitions`; RLS enabled with deny-by-default; SECURITY DEFINER helpers `record_audit`, `enqueue_outbox`, `claim_outbox` (SKIP LOCKED), `mark_outbox_delivered`, `fail_outbox` with exponential backoff), deterministic `seed.sql` (17 canonical role codes), pgTAP `tests/database/foundation.test.sql` (22 assertions).
- **Application interface**: `lib/supabase/env.ts` (adapter + env validation), `client.ts` (browser), `server.ts` (SSR, Next 15 cookie convention), `admin.ts` (secret-key, RLS-bypass restricted), `database.types.ts` placeholder for generated types; `db:reset` / `db:test` / `db:types` npm scripts.
- Gates re-run after the scaffolding: typecheck, lint, 216 web + 47 contract tests, 62-page build — all passed.

**B0 exit not yet proven**: the schema cannot yet reset locally because there is no Docker on this machine and no `fass-staging` project exists. Remaining B0 items — staging project creation, local/remote reset + type generation, security/performance advisors — are `BLOCKED` on environment/credentials (see below).

## Blocking environment inputs for B0/B1

1. Create the `fass-staging` Supabase project in `ap-south-1` (Mumbai) and provide new-format publishable + secret keys (store locally in `.env.local`; never in `.env.example`).
2. Rotate the Supabase keys that were previously copied into `.env.example` (plan.md §3).
3. Docker Desktop (or an alternative local stack) to run `supabase db reset` / `db test` / `db:types` locally, OR link the staging project and run migrations against it.
4. Local Node 22 (nvm/volta or `brew install node@22`) to match the pinned runtime; the machine currently runs Node 24.
5. Resend API key + sender domain (staging testing subdomain) — required from B1 (Auth email) onward.
6. Known transitive npm audit findings (postcss/sharp via Next 15) have no non-breaking fix; revisit when Next 15.x or the dependency chain provides a patched release.

## Current validation evidence

Evidence was rerun against the current checkout and a fresh production build on `http://localhost:3000` on 6 August 2026 (plan.md Phase 6 gate).

| Gate | Status | Evidence |
|---|---|---|
| TypeScript | `VERIFIED` | `npm run typecheck` passed for `@fass/web` and `@fass/contracts` |
| Lint | `VERIFIED` | `npm run lint` passed without warnings/errors |
| Unit/component tests | `VERIFIED` | `npm test`: 29 web test files, 216 tests passed; `packages/contracts`: 1 file, 47 tests passed (core contract types) |
| Production build | `VERIFIED` | `npm run build`: Next.js 15.5.22 compiled successfully and generated 62 pages |
| Route/link crawl | `VERIFIED` | 65 route cases, 91 unique internal hrefs, no dead links or route failures |
| Critical browser journeys | `VERIFIED` | 22/22: job application, student application, grievance, payment, guardian sign-in, staff admission decision (maker/checker across identities), two-child portal switching, staff link-request approval, admission → fee → enrollment, staff role denial + identity switching, teacher assignment scope, content editor publish denial, teacher subject denial, timetable read-only for non-managers, wrong-child resource scope + child switch, link approval then revocation, results maker/checker split, duplicate-safe payment retry, correction versioning, teacher entry → moderator return → approve → publish → portal publication, timetable manager publish → portal v2, family payment → staff ledger parity |
| Accessibility scan | `VERIFIED` | 53 retained routes scanned with no automated axe violations |
| Focus/keyboard smoke | `VERIFIED` | mobile drawer, skip link, document dialog, and fee-statement focus behaviors passed |
| Responsive sweep | `VERIFIED` | 168 viewport/route pairs at 320–1920 px, no reported overflow or console problems |
| In-app browser review | `VERIFIED` | Fresh build: canonical Phase-1 grants across four demo identities (Sana Wani / Firdous Ahmad / Aisha Lone / Rania Mir); one link-request store (guardian requests + graph links + active-link revocation); results batch subject column with class+subject teacher scope, queue-level return-with-reason for moderators, and versioned withdrawal; timetable class selector (8-A / 9-C empty state) for managers only; wrong-child panels on invoice/receipt pages with child switch; staff finance workspace re-reads the same ledger on the client so browser-session payments appear to the office; append-only audit + demo outbox; cleaner token-based visual system rendered across public/portal/staff |

Limitations of this evidence:

- Browser journey tests prove deterministic demo behavior, not server authorization or permanent persistence.
- Automated accessibility results do not replace manual screen-reader, zoom, contrast, language, and content review.
- The current directory is not a Git worktree, so no commit, branch, or diff evidence is available.

## Feature and integration matrix

| Area | Status | Proven now | Required next |
|---|---|---|---|
| Editorial design system and shared shells | `VERIFIED` | Public/portal/staff layouts, responsive drawers, focus behavior, fictional-data labels | Preserve; add service-driven identity/context |
| Public pages | `VERIFIED` | Core pages/routes render and links pass | Verified school content, persistent CMS boundary, approvals |
| Student admission UI | `VERIFIED` | 8-step validation/draft/submit/status/change edit/offer-response and staff decisions in demo | Applicant ownership, versions/documents, finance handoff, conversion |
| Careers UI | `VERIFIED` | Vacancy draft/submit/status/withdraw and staff decisions in demo | Applicant auth, private uploads, assignment/scorecard/onboarding boundary |
| Family payment UI/service | `IN PROGRESS` | Student-scoped ledgers: portal fees/receipts/overview read `financeService` for the active child; staff finance pages read the same service across both students with parity (totals agree); attempts/retry/receipt flows unchanged | Concessions/refund/reconciliation policy rules and gateway adapters remain backend work |
| Results UI/service | `IN PROGRESS` | Staff workflow and publication list/versioning work; portal marks come from a per-student published snapshot returned by `academicsService`; batches carry a subject and teacher entry scope matches class AND subject; versioned `withdrawPublication` removes the live portal entry while the published record stays on file; publish/withdraw emit one outbox event + audit row each | Enrollment-derived rosters and moderation/correction authority remain backend work |
| Timetable UI/service | `IN PROGRESS` | One `timetableService` facade (periods, edits, conflicts, versions, history) serves portal and staff; class derives from the active enrollment; known classes 8-A/9-C with a manager-only selector and an honest empty state for 9-C; all workspace state keyed by class; non-managers read-only | Per-teacher assignment scope and exam date-sheet process remain |
| Support UI/service | `IN PROGRESS` | Submission, staff response, reopen, requester-safe thread | Ownership/auth, private notes, assignment/SLA, notification |
| Identity demo states | `IN PROGRESS` | Guardian sign-in/verify/recovery/session and pending link request; sessions now carry stable account/person/guardian IDs, expired sessions are signed out, and sign-out clears identity plus relationship context | Real route protection, staff MFA, role workspace, invitations/revocation |
| Guardian/student linking | `IN PROGRESS` | One link-request store: guardian requests raised through “Link another child” appear on `/staff/link-requests` (LR refs) alongside school-created pending graph links; approval creates the active link exactly once (idempotent, unresolvable refs stay honest); rejection is terminal with a visible reason; active links can be revoked and access ends immediately; every decision records one audit row + outbox event | Real verification evidence, invitations, and server revocation remain backend work |
| Shared family portal context | `IN PROGRESS` | I0/I1 spine verified: one family-context provider drives the shell and every child-scoped page; two-child selector, active-child persistence, denial of unlinked children, and context strip work in browser | Server reauthorization is backend work |
| Student/enrollment records | `IN PROGRESS` | `enrollmentConversionService` creates/matches the permanent student, enrollment, and guardian link idempotently from an accepted, fee-paid application; converted children appear in the guardian portal context; adoption moves the paid admission invoice into the new student's ledger | Server persistence, capacity/final-approval policy flags, and real grade-section placement remain backend work |
| Admission fee to enrollment | `IN PROGRESS` | Accepting an offer issues one admission invoice through `financeService`; the shared PayFlow posts the fee exactly once; readiness (offered + accepted + fee paid + documents + capacity + approval) gates conversion; retries never duplicate | Real gateway adapters, waiver/refund rules, and invitation delivery remain backend work |
| Staff role and assignment scope | `IN PROGRESS` | Canonical Phase-1 grant model with maker/checker splits (content editor/publisher, admissions officer/approver with self-approval rejection, finance officer/approver, HR reviewer/approver, teacher enter / exam reviewer approve / result publisher release, timetable manager, support officer + `links.verify`, auditor, system administrator); four demo identities (Sana / Firdous / Aisha / Rania Mir); route guards, action gating, teacher class+subject scope, and service outcomes agree; privacy controls applied (sitemap/robots/noindex) | Server-side enforcement is backend work |
| Notices/content persistence | `IN PROGRESS` | One `contentService` owns notice status/audience/version; public, portal, and staff publisher read the same record (audience-filtered); draft/expired/scheduled states present | Persistent CMS boundary, approvals, scheduling, propagation (I5) |
| Documents/PDF | `IN PROGRESS` | `documentsService` returns per-student report-card/receipt/ref metadata for the active child; accessible preview/missing/denied states retained | Private storage contract, auth delivery, scan/generation/retention |
| Notifications | `IN PROGRESS` | `notificationsService` with per-account lists and read state, deterministic demo-clock timestamps | Outbox-driven per-account audience and delivery state |
| Users/settings/audit | `IN PROGRESS` | Typed demo adapters: `usersService` (accounts/role grants), `settingsService` (policy-pending flags, working days/periods), `auditService` (seeded trail + append-only `record` with deterministic ids/timestamps) drive the staff pages; consequential actions (link decisions, conversions, publications, withdrawals, payment posts) record audit rows and enqueue idempotent demo outbox events | Authoritative typed services, persistence, reasons, effective versions |
| Backend/database/auth/providers | `NOT STARTED` | None | Begin only after frontend handoff gate and school decisions |
| Production deployment | `NOT STARTED` | None | Named environment, deployment evidence, post-deploy checks |
| Campus environment demonstrator | `VERIFIED` | Isolated fictional frontend demonstrator | Deferred; exclude from core launch and do not build backend |

## Highest-priority audit findings

1. The next feature is not another screen. It is the shared person/account/guardian/student/staff/enrollment/context contract.
2. The linked-child selector is now the integration spine: a shared family-context provider drives the shell and every child-scoped page, with two linked children switching together and denial of unlinked references.
3. Fixed `demoStudent` and direct mutable fixture imports must not become backend contracts; the remaining fixture reads are concept content (policies/careers/admissions copy) and the isolated environment demonstrator.
4. Admission-fee payment now uses the finance ledger: the accepted offer issues one admission invoice, the shared checkout posts exactly once, and conversion adopts the paid invoice into the new student's ledger. Real gateway adapters remain backend work.
5. Enrollment conversion now atomically produces the permanent student, enrollment, and guardian link exactly once — a retry returns the same references and never duplicates; an application for an already-enrolled child matches the existing records instead of creating a duplicate.
6. Results must publish and display a per-student immutable snapshot, not pair publication metadata with separate term fixtures — the portal now renders the per-student snapshot; roster generation and corrections remain backend/I4.
7. Timetable has one service used by staff and portal; scope now derives from enrollment, and teacher/assignment scope remains I4.
8. Staff roles are additive; assignments and active workspace limit scope. I4 now proves navigation, route guards, action controls, and service outcomes agree for each retained demo role; UI visibility is still not authorization and the backend adapter remains the final authority.
9. Cross-module synchronization is proven by the two-child browser journey and denial tests; I2 parameterizes finance, results, timetable, documents, notices, and notifications by student/enrollment context with parity tests for shared records.

## Scope decision

Core launch scope remains the public site, identity/relationships, student admissions, careers, family fees/results/timetable/notices/documents/support, and the minimum staff workspaces needed to operate them.

Do not add attendance, LMS/homework, transport, payroll, library circulation, hostel/cafeteria, chat/social feeds, native apps, advanced analytics, recurring mandates, or a generic workflow/page builder. The environment/facility module stays isolated and deferred.

## Blocking school decisions

These decisions are `BLOCKED` on school/provider confirmation, not on engineering effort:

1. Official school name/spelling, logo/crest, affiliation, school code, grades/sections, contacts, languages, and approved public media.
2. Guardian verification evidence, relationship restrictions, student-account policy, and who owns identity/provider accounts.
3. Admission calendar, eligibility/capacity, withdrawal, offer expiry, admission-fee prerequisite, and enrollment approval authority.
4. Fee schedule, concessions, partial/late/refund/write-off rules, gateway merchant/provider, receipt numbering, and reconciliation ownership.
5. Result subjects/components/maxima, grading, absent/result status, aggregate/remarks/report layout, moderation, publication, and correction authority. Attendance is outside scope unless explicitly approved.
6. Timetable working days, periods, rooms, teacher assignments/load, substitute/override, and exam date-sheet process.
7. Vacancy approval, reviewer panels, scoring/interview/reference checks, applicant-facing wording, and retention.
8. Notice approval/audiences/channels, document retention, support SLA/escalation, privacy rights/retention, disclosures, hosting/domain, and provider ownership.

The UI must keep unconfirmed values fictional/demo or policy-pending.

## Active implementation order

1. `I0` — **implemented and verified**: shared people, relationships, roles/assignments, enrollments, and context contracts; family/staff context services; service-driven shells; context survives navigation within the demo session.
2. `I1` — **spine implemented and verified**: two-child portal switching, per-page child context, pending-link approval/rejection path.
3. `I2` — **implemented and verified**: finance ledger parameterized by student with staff/portal parity, per-student result snapshots, one timetable facade, and typed content/documents/notifications/users/settings/audit services wired into their pages.
4. `I3` — **implemented and verified**: admission offer → finance payment → enrollment/link conversion (invoice-once, shared checkout, readiness gates, idempotent create-or-match conversion, ledger adoption, applicant acknowledgement).
5. `I4` — **spine implemented and verified, then rebaselined to the canonical Phase-1 grant model**: role/action authorization module, role-aware navigation, route guards with workspace-switch denial, demo identity picker, teacher assignment-scoped marks entry, action gating; the `plan.md` Phase-1 grant table (maker/checker splits, `links.verify` scope, Rania Mir approver identity) is the authoritative action model.
6. `I5` — **in progress**: deterministic demo domain events + append-only audit + demo outbox now emit one idempotent event per consequential action (payment post, conversion, publish, withdraw, content publish, link decision); in-app notification projection from outbox events and PDF generation remain backend work.
7. `I6` — **frontend contract freeze applied**: `packages/contracts` core domain/context/error/outbox/audit types (47 tests), `design/BACKEND-HANDOFF-MATRIX.md`, applicant draft privacy policy, and the full Phase-6 gate evidence; the backend handoff gate itself remains blocked on the school decisions in `FEATURE-INTEGRATION-SPEC.md` §11.

Do not begin broad backend work before the `UI-COMPLETION-PLAN.md` handoff gate passes.

## Change log

- **2026-08-06 (B0 backend foundation):** `plan.md` rebaselined to the Supabase Backend Blueprint (B0–B8). B0 completed: version-controlled source established (`git init`, baseline commit `4edf099`); `.env.example` scrubbed to names/placeholders (exposed Supabase keys flagged for rotation) and Node 22 pinned; Supabase CLI 2.111.0 + `@supabase/ssr` + `@supabase/supabase-js` added; `supabase/config.toml` with Realtime/Edge Functions disabled; foundation migration (conventions, `app.new_ref`, version/append-only helpers, audit/outbox/idempotency/webhook-receipts/rate-limit/job-runs tables, `role_definitions`, RLS deny-by-default, SECURITY DEFINER outbox/audit helpers with SKIP LOCKED claim and exponential retry); deterministic role-code seed; 22-assertion pgTAP foundation suite; Supabase client factories (browser/server/admin) + env validation + types placeholder + `db:*` scripts. Typecheck, lint, 216 web + 47 contract tests, and the 62-page build all re-passed. Remaining B0 items are blocked on environment inputs (staging project + keys, Docker, Node 22, Resend).
- **2026-08-06 (plan.md Phases 1–6):** Completed the canonical grant model (Phase 1): maker/checker splits across content/admissions/finance/HR/results, `links.verify` scoped to support_officer + system_administrator, and the fourth demo identity Rania Mir (approvals/timetables); admissions self-approval is rejected with the same actor account. Workflow repairs (Phase 2): result batches carry a subject, teacher marks entry requires class AND subject, moderators return sheets with a reason from the queue, `withdrawPublication` is versioned and never deletes published history, timetable known classes 8-A/9-C with a manager-only selector and honest empty state, date-sheet publish gated to managers. Family context (Phase 3): one link-request store — guardian requests flow to `/staff/link-requests` (LR refs), approval creates the active link exactly once, active links are revocable; `classifyStudentAccess` (current/other/none) wired into invoice and receipt pages with a child-switch panel and neutral denial. Propagation (Phase 4): append-only `auditService.record` + session-backed idempotent demo outbox (`modules/services/outbox.ts`) — one event per payment post, enrollment conversion, result publish/withdraw, content publish, and link decision; retries never duplicate (proven by tests); all `Math.random()` latencies replaced with fixed 200 ms. Contracts + privacy (Phase 5): `packages/contracts` core types with 47 tests, `design/BACKEND-HANDOFF-MATRIX.md`, applicant drafts moved to sessionStorage with sensitive-field stripping. Phase 6 gate: typecheck, lint, 29 web test files (216 tests) + 47 contract tests, 62-page build, 22/22 critical journeys (incl. the full teacher entry → moderator return → approve → publish → portal chain, timetable manager publish reaching the portal, and family payment → staff ledger parity via the client-refreshed finance workspace), 53-route axe scan, focus smoke, 65-route link crawl, 168-pair responsive sweep — all passed. Docs updated: `UI-COMPLETION-PLAN.md` (phase status + execution record) and `PROJECT-STATUS.md` (evidence, matrix, order).
- **2026-08-05 (I4 + visual refinement):** Implemented staff role/assignment scope: `staff-authorization` module (role/action matrix, active-workspace checks, assignment-class matching); role-aware staff navigation; `StaffRouteGuard` with workspace-switch denial on every staff route (marks-entry sub-route requires the teacher role); demo identity picker in the staff shell (Sana Wani — finance/results/admissions, Firdous Ahmad — teacher, Aisha Lone — content/support/audit/admin; session-persistent); teacher marks entry denied for batches outside assigned classes; results approve/publish/correction gated to publishers and entry links to teachers; timetable editor read-only for non-managers; support response gated to support officers; staff home dashboard filtered by role. Refined the design tokens toward a cleaner, more minimal professional system (finer hairlines, pure-white raised surfaces, softly rounded controls, slightly lighter paper) while preserving the editorial serif, saffron accent, and Urdu wordmark identity. Verified by 23 test files (163 tests), a 62-page build, 11/11 critical journeys (incl. role denial and teacher assignment scope), a 53-route axe scan, a 168-pair responsive sweep, and a clean route/link crawl — all re-run after the visual refinement.
- **2026-08-05 (I3):** Implemented admission → finance → enrollment. Accepting a seat issues one admission invoice through `financeService` (idempotent per applicant; `createAdmissionInvoice` / `assignInvoiceToStudent`); `AdmissionFeeStep` now pays through the shared checkout (attempt/confirm/receipt, duplicate-safe) instead of a timer; `enrollmentConversionService` derives readiness (offered + accepted + fee paid + documents + capacity + approval) and converts idempotently — creating the permanent person/student/enrollment (and activating the guardian link) or matching the already-enrolled child, adopting the paid invoice into the new student's ledger, and marking the application Enrolled with its permanent references; the applicant sees an acknowledgement with the student reference and the portal link. Verified by 22 test files (157 tests), a 62-page build, 9/9 critical journeys (new admission-to-enrollment journey), a 53-route axe scan, a 168-pair responsive sweep, and a clean route/link crawl.
- **2026-08-05 (I2):** Consolidated service boundaries. Finance: ledgers parameterized by student (Aarif + Mariam), portal fees/receipts/overview read `financeService` for the active child, staff finance pages read the same service across both students with parity tests (totals agree). Results: portal marks come from a per-student published snapshot (`academicsService.getStudentResultSnapshot`) with distinct fictional snapshots per child. Timetable: one `timetableService` facade (periods, edits, conflicts, versions, history) now serves portal and staff; the academics timetable stub was removed. Added typed demo adapters `contentService` (notice status/audience/version), `documentsService` (per-student bundles), `notificationsService` (per-account read state, demo clock), `usersService`, `settingsService`, and `auditService`, wired into public/portal/staff pages; the portal overview now reads the active child's ledger and family-audience notices through services. Verified by 21 test files (150 tests), a 62-page build, 8/8 critical journeys, a 53-route axe scan, a 168-pair responsive sweep, and a clean route/link crawl; in-browser parity confirmed (child switch changes the overview band and ledger; staff finance aggregates both students).
- **2026-08-05 (I0/I1):** Implemented the shared relationship/context spine: stable demo session identifiers (account/person/guardian); expired sessions now sign out; sign-out clears identity and relationship context; family-context service gained student-context, account-summary, and link-request summaries; staff-context gained workspace summaries. Added `FamilyContextProvider`/`StaffContextProvider`, service-driven `PortalShell` (two-child switcher, context strip, service sign-out) and `StaffShell` (workspace switcher, role/year/assignment context), `ActiveChildLine` on every child-scoped portal page, and the `/staff/link-requests` approval/rejection path. Verified by 15 test files (112 tests), a 62-page build, 8/8 critical journeys (incl. two-child switching and link approval), a 53-route axe scan, a 168-pair responsive sweep, and a clean route/link crawl.
- **2026-08-05:** Re-audited the complete current route/service/fixture/test structure and reran all frontend validation gates. Confirmed the polished self-contained demo baseline and identified the remaining integration boundary: static one-child context, direct fixture consumers, missing admissions-to-finance/enrollment conversion, non-snapshot result rows, split timetable services, and absent role/assignment authorization. Added `FEATURE-INTEGRATION-SPEC.md`, rebaselined the active frontend plan, and separated UI verification from integrated/production completion.
- **2026-08-04:** Completed P0/P1/P2 frontend work: repaired student-form interaction and error/mobile shell behavior; added deterministic demo services and 87 tests; completed key applicant/payment/results/timetable/support/staff-decision UI flows; removed the optional facility demonstrator from core navigation and launch checks; and established warning-free build/browser gates.
- **2026-08-03 to 2026-08-04:** Built the broad editorial route tree, design system, fictional content/data, applicant/portal/staff prototypes, optional environment demonstrator, concept imagery, and responsive design passes.
