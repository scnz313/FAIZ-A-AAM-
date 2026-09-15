# Frontend Integration Plan — Faiz Aam School Platform

> **8 September 2026:** This file is an archived pre-V15 reference. Prior completion statements do not certify the new V15 UI. The active execution order is the opening section of `plan.md`; the current route acceptance checklist and evidence are in `PROJECT-STATUS.md`.

Status: completed frontend reference; backend cutover tracked in `plan.md` C0–C5
Owner: product/UI implementation team  
Audit date: 5 August 2026  
Phase: frontend completion verified; Supabase application cutover is the active phase

This document is the completed frontend integration reference. `PROJECT-BLUEPRINT.md` defines the product, `FEATURE-INTEGRATION-SPEC.md` defines detailed relationships and synchronization, `plan.md` defines the active Supabase cutover, and `PROJECT-STATUS.md` records what is actually verified.

> **Archived frontend handoff:** This file preserves the completed UI scope, route-level acceptance criteria, and demo-contract decisions. Historical implementation evidence belongs in `PROJECT-STATUS.md`; the active execution order is only `plan.md` C2–C5.

> **Portal consolidation delta (31 August 2026):** This archived reference predates the three-portal consolidation. Staff routes are now canonically `/administrator/*` (Administrator) and `/principal/*` (Principal) over the shared `/staff/*` implementation namespace, and the Guardian portal is `/portal/*`. Teacher portal and Student portal references in this document are historical: teachers are non-login school records with teaching assignments, and students are school records linked to guardians.

> **V15 design system adoption (8 September 2026, supersedes the 6 September V14 note):** The canonical design prototype is now `V15 Faiz Aam School Platform.html` (repository root; V14 remains as the historical reference). All design tokens, component specifications, layout patterns, responsive breakpoints, and screen compositions are documented in `design/UX-BLUEPRINT.md` §2 (tokens), §12.1 (components), §16 (responsive), §17 (screen catalog), and §18–20 (role matrix, nav, implementation priority). When implementing UI changes, use the V15 design system as the source of truth for visual appearance. Do not change the database, domain services, or backend logic — only update UI components, CSS modules, layouts, and page rendering. Copy V15 layout only, never its illustrative data, counts, actor names, or client-only authorization behavior.

The frontend handoff gate is complete. Do not add visual features here unless the product blueprint changes; continue implementation from `plan.md` C0–C5.

## 1. Goal and phase boundary

Keep the existing visual quality and working self-contained demo flows, then make the frontend behave as one integrated school system before choosing backend providers.

Frontend integration is complete only when:

- one shared account/role/relationship model drives all workspaces;
- one active student/enrollment context drives every family-portal feature;
- staff role plus assignment drives operational scope;
- each domain has one typed service used by all of its portal and staff consumers;
- cross-module actions propagate to the correct screens;
- demo persistence is deterministic and honestly labelled;
- denial, validation, conflict, processing, retry, partial-success, and recovery states are reviewable;
- tests prove isolation and propagation, not only route rendering.

The completed frontend phase did not provide production security, real payments,
permanent uploads, email/SMS, or a database. Those concerns are now governed by
the active Supabase cutover in `plan.md`; do not reopen frontend-only scope.

## 2. Current code-audit truth

The 5 August audit inspected the current route tree, layouts, components, domain services, fixtures, session/local storage, package scripts, tests, and rendered production build.

### Verified foundation

- Public, applicant, portal, staff, and isolated facility route groups render with one editorial design system.
- Student admission, job application, grievance, family payment, demo guardian sign-in, and staff admission decision browser journeys pass.
- Admissions, careers, finance, results, support, identity, and timetable have meaningful typed demo-service work.
- Payments are duplicate-safe within the demo finance service.
- Results and timetable preserve publication versions within their demo services.
- Mobile drawers, focus recovery, document-preview states, validation, and responsive layouts are implemented.
- Typecheck, lint, 87 tests, production build, route crawl, critical journeys, accessibility scan, focus smoke, and responsive sweep pass in the audited environment.

### Integration gaps confirmed by code and browser review

1. ~~`PortalShell` shows one hard-coded linked child~~ — **implemented**: the selector is service-driven with two linked children; a shared family-context provider drives the shell and every child-scoped page, and switching persists across navigation in the demo session.
2. ~~Portal overview/profile/documents/notices read fixed demo records directly~~ — **implemented**: overview, profile, documents, notices, fees, receipts, results, and timetable all read through typed services scoped to the active child (see I2 status).
3. ~~Finance records have no student/enrollment identity~~ — **implemented**: ledgers are keyed by student (two demo ledgers), staff finance pages read the same `financeService` with parity tests; gateway/refund/reconciliation policy rules remain backend work.
4. ~~Accepted admission offers use a local timer and fixed receipt~~ — **implemented**: accepting a seat issues one admission invoice through `financeService`; `AdmissionFeeStep` pays through the shared checkout (duplicate-safe, fresh receipt); readiness gates conversion; the paid invoice is adopted into the new student's ledger. Real gateway adapters and waiver/refund rules remain backend work.
5. ~~Admissions has no conversion~~ — **implemented**: `enrollmentConversionService` creates or matches the permanent student, enrollment, and guardian link idempotently (retries return the same references and never duplicate); the application becomes Enrolled with its permanent references and the applicant sees an acknowledgement with the portal link. Server persistence and real capacity/final-approval policy flags remain backend work.
6. ~~Portal marks still come from term fixtures~~ — **implemented**: portal results render the per-student published snapshot from `academicsService`; enrollment-derived rosters and teacher assignment scope remain `I4`.
7. ~~Timetable is split across two service paths~~ — **implemented**: one `timetableService` facade serves portal and staff; class context derives from the active enrollment; teacher/assignment scope remains `I4`.
8. ~~Pending links had no approval path~~ — **implemented**: `/staff/link-requests` approves/rejects pending links through the relationship service and the approved child immediately appears in the guardian context. Real verification evidence, revocation UI, and invitations remain backend work; identity-store requests are still separate from the relationship graph.
9. ~~Staff roles/assignments are visual/static~~ — **implemented at shell level**: the staff shell renders granted workspaces with role/year/assignment context and workspace switching with denial. Navigation/action filtering by role is `I4`; users/settings/audit now read typed demo services, but persistence and server enforcement remain backend.
10. ~~No integration tests for child switching/denial/parity~~ — **implemented**: two-child journey, unlinked-child and un-granted-workspace denial, finance parity tests, and per-module service tests all pass.
11. This directory is not currently a Git worktree, so commit/diff history is not available as validation evidence.

These are the active work items. Do not describe them as backend-only: shared frontend contracts and deterministic adapters must be settled first.

## 3. Frozen core scope

### Keep and integrate

1. Public site: home, about, academics, admissions, school life, notices/downloads, disclosure, careers, contact/grievance, and policies.
2. Identity states: sign in, verification, recovery, session expiry, access denial, role/workspace context, and guardian/student linking.
3. Student admissions: draft, submit, status, requested changes, assessment/decision, offer response, admission fee, and enrollment readiness/conversion.
4. Careers: vacancy, draft, submit, status, withdraw, reviewer decisions, and later onboarding boundary.
5. Family portal: shared student context, overview, fees, invoices, payments, receipts, results, timetable/date sheet, notices, documents, profile/security, and support.
6. Staff operations: admissions, careers, finance/reconciliation, results, timetable, notices/content, support, scoped users/roles, settings, and audit.

### Preserve but isolate

- `/environment` and `/staff/facility/*` remain a fictional optional demonstrator.
- Keep them out of core navigation, sitemap, launch route checks, backend work, and delivery estimates.
- Do not connect sensor data to students, staff identity, attendance, or health records.

### Do not add

- Attendance, homework/LMS, transport, library circulation, payroll, hostel, cafeteria, chat, social feeds, native apps, advanced analytics, recurring mandates, or a generic page-builder.
- Additional dashboards or decorative redesign work before the integration backlog is complete.

## 4. Frontend architecture contract

Use this dependency direction:

```text
route/page
  → feature component
  → domain service interface
  → deterministic demo adapter now
  → authenticated server adapter later
```

### Required shared contracts

- `Person`, `UserAccount`, `RoleGrant`, `StaffMember`, `StaffAssignment`
- `Guardian`, `Student`, `GuardianStudentLink`
- `AcademicYear`, `GradeSection`, `Enrollment`
- `FamilyPortalContext`, `StaffWorkspaceContext`
- domain record/public-reference/version/audit/outbox types

### Rules

- Pages/components do not import mutable record arrays from `modules/*/demo.ts` as an operational source.
- Formatters and immutable display metadata may remain shared.
- Every service read/write accepts or derives explicit actor and record scope.
- Every write returns the authoritative updated record plus typed errors.
- Demo adapters use deterministic references, the injected demo clock, and one namespaced store.
- Session storage is a demo convenience, not an authorization boundary.
- Local storage may hold recoverable, non-sensitive draft input only; it must be versioned and expiry-aware.
- A domain has one service facade. Remove overlapping result/timetable/content sources before the backend contract freezes.
- Cross-module work calls the owning service; it never mutates another module’s fixture or component state.

## 5. Ordered work packages

### I0 — canonical people, relationship, and context contracts

1. Add shared types and fictional fixtures for two guardians, at least two students, historical/current enrollments, one multi-role staff/guardian example, roles, and staff assignments.
2. Define active-link capabilities and restricted/ended states.
3. Add a family-context service: list accessible students, get/set active student, resolve active enrollment/year, and reject stale selections.
4. Add a staff-context service: active workspace role, assignments, and year.
5. Add unit tests for cardinality, active-enrollment selection, capability filtering, role switching, link revocation, and invalid context.

**Exit:** both portal and staff shells render from services, not constants; context survives route navigation within the demo session.

**Archived frontend reference (historical, 5 August 2026; see PROJECT-STATUS.md):** identity sessions carry stable account/person/guardian IDs and expired sessions sign out; sign-out clears identity plus relationship context; `familyContextService` exposes student contexts, account summaries, and link-request summaries; `staffContextService` exposes workspace summaries with role labels and assignments; `FamilyContextProvider`/`StaffContextProvider` wrap the portal/staff layouts; `PortalShell` renders the two-child selector, context strip, and service sign-out; `StaffShell` renders the workspace switcher and role/year/assignment context. Historical acceptance evidence (see PROJECT-STATUS.md): 112 tests across 15 files, 62-page build, 8/8 critical journeys, 53-route axe scan, 168-pair responsive sweep.

### I1 — linked-child synchronization

1. Make the portal selector controlled and populated from active links.
2. On child change, update overview, fees, receipts, results, timetable, notices, documents, support metadata, and profile.
3. Clear invalid invoice/term/document selections and protect dirty forms with save/discard confirmation.
4. Add child identity/class/year context to every scoped page header and consequential confirmation.
5. Add a pending-link status view and a deterministic staff approval/rejection demo path.

**Exit:** a two-child browser journey proves every portal module changes together and an unlinked child reference is denied.

**Archived frontend reference (historical, 5 August 2026; see PROJECT-STATUS.md):** `ActiveChildLine` shows the active child on overview, fees, invoice, receipt, results, timetable, notices, documents, profile, and support; switching persists across navigation and an unlinked child is denied with the previous selection preserved; `/staff/link-requests` provides the pending-link status view and deterministic approval/rejection path (journey-verified). Remaining I1 items — clearing stale invoice/term/document selections and per-student ledger/result/timetable data — move into `I2`, which parameterizes the domain services by student/enrollment context.

### I2 — service-boundary consolidation

1. Parameterize finance, results, timetable, documents, notices, and profile services by student/enrollment context.
2. Route staff finance pages through `financeService` so parent and staff balances/receipts agree.
3. Make portal marks come from a published student-result snapshot returned by the results service.
4. Consolidate timetable types, editing, versioning, and portal reads into one timetable service.
5. Add typed content, document, notification, user/role, settings, and audit services with deterministic demo adapters.
6. Remove or quarantine obsolete mutable fixture reads once each consumer is migrated.

**Exit:** static analysis shows operational pages consume service boundaries; parity tests pass for shared records.

**Archived frontend reference (historical, 5 August 2026; see PROJECT-STATUS.md):** finance ledgers are parameterized by student (`listInvoices(studentId)` / `listAllInvoices()` for staff) with per-student receipts and two demo ledgers; portal fees/receipts/overview read the service for the active child and staff finance pages aggregate both students with parity tests. Portal results render the per-student published snapshot (`academicsService.getStudentResultSnapshot`) with distinct fictional snapshots per child. Timetable is one facade (`timetableService`, formerly `timetable-demo.ts`) serving portal and staff; the academics timetable stub was removed. Typed demo adapters `contentService` (notice status/audience/version), `documentsService` (per-student bundles), `notificationsService` (per-account read state, demo clock), `usersService`, `settingsService`, and `auditService` drive their pages; the portal overview reads the active child's ledger and family-audience notices through services. Historical acceptance evidence (see PROJECT-STATUS.md): 150 tests across 21 files, 62-page build, 8/8 critical journeys, 53-route axe scan, 168-pair responsive sweep, clean route/link crawl, and an in-browser parity check (child switch changes overview band + ledger; staff finance shows both students).

### I3 — admissions to finance to enrollment

1. Extend accepted offer state with explicit conditions and `admissionInvoiceRef`.
2. Create the admission invoice once through finance; use the existing attempt/status/confirm/receipt model.
3. Replace `AdmissionFeeStep`’s timer/fixed receipt with the shared payment flow.
4. Derive `EnrollmentReadiness` from offer acceptance, fee paid/waived, required documents, capacity, and final approval.
5. Add an idempotent demo conversion service that creates/matches one student, creates one enrollment, activates approved guardian links, and records source references.
6. Show applicant acknowledgement, permanent student reference, portal invitation/link step, and failure recovery.

**Exit:** accepting and paying an offered seat updates finance and admissions, converts once on retry, and makes the enrolled child available to the correct guardian context.

**Archived frontend reference (historical, 5 August 2026; see PROJECT-STATUS.md):** accepting an offer issues one admission invoice (`financeService.createAdmissionInvoice`, idempotent per applicant); `AdmissionFeeStep` renders the ledger amount and pays through the shared `PayFlow` (attempt → processing → confirmed, exactly one payment and one receipt); `enrollmentConversionService.getEnrollmentReadiness` derives readiness from offer acceptance + fee paid + documents + capacity + final approval; `convertApplication` converts idempotently — creating the person/student/enrollment and activating the guardian link for fresh applications, or matching the already-enrolled child for an application that was already converted (spec: “creates or matches”, never duplicates), adopting the admission invoice into the new student's ledger, and marking the application Enrolled with its permanent references; the applicant acknowledgement shows the student reference, enrollment reference, and the portal link (or the honest pending-invitation state). Historical acceptance evidence (see PROJECT-STATUS.md): 157 tests across 22 files (new enrollment-conversion suite), 62-page build, 9/9 critical journeys (new admission-to-enrollment journey), 53-route axe scan, 168-pair responsive sweep, clean route/link crawl.

### I4 — teacher and staff assignment scope

1. Replace the generic demo administrator identity with role-aware fictional staff contexts.
2. Filter navigation and actions by role while keeping server-adapter denial the final authority.
3. Derive marks-entry choices from teacher assignments; moderation/publication require separate roles.
4. Derive timetable editing/teacher views from assignments and effective dates.
5. Scope HR panels, support queues, finance operations, content publishing, and audit access.
6. Add cross-role and wrong-assignment denial states/tests.

**Exit:** navigation, data, action controls, and service outcomes agree for each retained role.

**Archived frontend reference (historical, 5 August 2026; see PROJECT-STATUS.md):** `staff-authorization` maps roles to actions (home/admissions/careers/finance/results view+enter+publish/timetable view+manage/content publish/links.verify/users/audit/settings/support); the staff shell filters navigation by the ACTIVE workspace and adds a session-persistent demo identity picker (Sana Wani — finance/results/admissions; Firdous Ahmad — teacher; Aisha Lone — content/support/audit/admin); `StaffRouteGuard` denies every staff route by role with a direct workspace-switch when another granted workspace can do the job (marks-entry requires the teacher role); teacher marks entry is additionally scoped to the teacher's assigned classes (wrong-assignment denial); results approve/publish/correction are gated to publishers and entry links to teachers; the timetable editor is read-only for non-managers; support response is gated to support officers; the staff home dashboard (band, queues, quick links) is filtered by role. Historical acceptance evidence (see PROJECT-STATUS.md): 163 tests across 23 files (new authorization suite), 62-page build, 11/11 critical journeys (incl. staff role denial + identity switching and teacher assignment scope), 53-route axe scan, 168-pair responsive sweep, clean route/link crawl. Visual refinement pass applied on top (finer hairlines, white surfaces, softly rounded controls) and every gate re-run.

**Rebaselined per `plan.md` phases (6 August 2026):** the canonical grant model replaced the I4 matrix (Phase 1): every role holds exactly its maker/checker actions — content_editor drafts / content_publisher publishes; admissions_officer reviews / admissions_approver decides (self-approval rejected with the same actor account); finance_officer operates / finance_approver approves; hr_reviewer scores / hr_approver advances/offers; teacher enters assigned class+subject marks only; exam_reviewer moderates; result_publisher releases and corrects; timetable_manager manages; support_officer responds and verifies guardian links (`links.verify` limited to support + system administrator); auditor reads; system_administrator holds configuration/access grants only. Four demo identities (Sana, Firdous, Aisha, Rania Mir) exercise the split; admissions decisions and results entry/publish are journey-verified across the maker/checker boundary. The I4 status above remains the shell-level spine; Phase-1 grants are the authoritative action model.

### I5 — notifications, documents, settings, and audit propagation

1. Emit deterministic demo domain events for decisions, payments, publications, overrides, and support responses.
2. Project in-app notifications per account/audience with per-user read state.
3. Model generated documents as pending/ready/failed metadata tied to immutable source versions.
4. Make notice publishing persist/version and update public/portal consumers.
5. Record audit events for consequential demo actions.
6. Make settings effective/versioned enough to drive visible application windows, academic context, periods, and policy-pending flags.

**Exit:** one write visibly reaches every intended consumer and no unintended role/child.

### I6 — frontend contract freeze

1. Export backend-ready request/response/error schemas in `packages/contracts`.
2. Remove provider and demo-only fields from public service interfaces where they do not belong.
3. Document endpoint/action needs, idempotency keys, optimistic versions, audit effects, and event names.
4. Run all unit, integration, browser, accessibility, responsive, and build gates.
5. Update `PROJECT-STATUS.md` from evidence and freeze the handoff.

## 6. Feature-level UI acceptance

### 6.1 Public and content

- Public navigation and important calls to action resolve.
- Notices support category, urgent/pinned, scheduled, published, expired, filtered-empty, and file-state UI.
- Staff content changes persist in the demo service and appear on public/portal views.
- Unverified school facts remain visibly unverified; design concepts never become official claims.

### 6.2 Identity and relationships

- Sign-in/verify/recovery/session-expired/access-denied states remain honest demos.
- Portal access requires an active guardian/student link in the target contract.
- Pending link requests do not expose child records.
- Role/link changes refresh navigation and revoke stale access.

### 6.3 Admissions

- Eight sections validate, save, resume, review, and submit.
- Requested changes preserve earlier submitted versions.
- Staff reason/confirmation and applicant-safe timeline agree.
- Offer accept/decline is retry-safe.
- Admission fee uses finance; enrollment uses explicit readiness and converts once.

### 6.4 Careers

- Vacancy-specific draft recovery, documents, submit, acknowledgement, status, and withdrawal work.
- Staff shortlist/interview/offer/not-selected actions use allowed transitions and safe applicant wording.
- Internal notes/scorecards remain separate.
- Offer does not automatically grant staff access.

### 6.5 Fees and payments

- Family and staff use the same invoice and ledger source.
- Student context is visible and enforced.
- Created/processing/succeeded/failed/cancelled/delayed/retry paths are present.
- Confirmed posting creates one payment/receipt; redirects never mark paid by themselves.
- Adjustment/refund/reconciliation UI preserves history.

### 6.6 Results

- Teacher entry, validation, return, approval, publication, and correction are assignment/role scoped.
- Portal displays the exact per-student publication snapshot.
- Not-published/provisional/final/corrected states and version history are clear.
- Attendance and rank remain absent unless scope is approved.

### 6.7 Timetable/date sheet

- One staff/portal service owns period, teacher, room, conflict, draft, publish, version, and override state.
- Portal class/section derives from enrollment and date.
- Day/week/exam/print states remain accessible.

### 6.8 Notices, documents, and notifications

- Audience follows public/role/enrollment/application scope.
- Document metadata reflects pending/ready/missing/failed/quarantined/denied states.
- Notification delivery failure does not alter the domain record.
- Read state is per account.

### 6.9 Support, users, settings, and audit

- Requester thread and staff-private notes are distinct.
- Support cannot change another domain directly.
- Role grants and assignments require reason and visible result.
- Settings drive UI behavior through service values.
- Audit search shows safe actor/action/target/outcome without secrets.

## 7. Required QA gates

Run from the repository root against a fresh production build:

```sh
npm run typecheck
npm run lint
npm test
npm run build
node scripts/link-crawl.mjs http://127.0.0.1:PORT
node scripts/critical-journeys.cjs http://127.0.0.1:PORT
node scripts/accessibility-check.cjs http://127.0.0.1:PORT
node scripts/focus-check.cjs http://127.0.0.1:PORT
node scripts/responsive-check.cjs http://127.0.0.1:PORT
```

Add these browser journeys before handoff:

- two-child context propagation and wrong-child denial;
- link approval/revocation;
- admission offer → finance payment → enrollment conversion → linked portal child;
- payment/refund parity between family and staff;
- assigned teacher entry → moderator return/approve → publisher release → correct guardian result;
- timetable publish/override → correct section only;
- notice audience and document access isolation;
- multi-role staff/guardian workspace switch;
- stale-version conflict and safe recovery.

The responsive script must exit non-zero when problems are found before it can be used as a CI gate; its current implementation only reports them.

## 8. Backend handoff gate

Do not start broad backend implementation until:

1. work packages I0–I6 are verified;
2. `packages/contracts` contains the agreed domain/context schemas rather than only IoT types;
3. no core operational page depends on a mutable fixture array;
4. admissions/finance/enrollment and results/timetable portal propagation are proven;
5. roles, guardian links, assignments, authorization failures, and version conflicts are represented in service contracts;
6. school decisions are approved or explicitly represented as configuration/policy-pending;
7. backend provider choices have named owners, environments, credentials, and acceptance tests;
8. `PROJECT-STATUS.md` accurately separates UI verification from production readiness.

## 9. Historical acceptance reference

The frontend acceptance record is archived here for context. Current
implementation status, test counts, build output, and release evidence belong
only in `PROJECT-STATUS.md`; they must not be inferred from this completed
reference. The route, accessibility, focus, responsive, and cross-module
journey criteria remain the required UI contract for regressions.

### Active work pointer

Frontend work is archived as complete. The local backend/provider implementation
through migration `000030` is verified; continue with `plan.md` C5 staging/provider
verification. Results, timetable, and remaining operational facade work is no
longer a UI backlog; real provider and deployment evidence remains in C5.
