# Portal Feature Plans — Administrator & Principal

Owner-facing build plan for every staff-portal feature: what the UI must become (V15) and how the logic must behave (robust domain rules). Reconciled with `PROJECT-BLUEPRINT.md` (product scope), `FEATURE-INTEGRATION-SPEC.md` (relationships/sync), `plan.md` (UI-first execution order), `design/UX-BLUEPRINT.md` (V15 system), and the September 2026 code audits.

Status of this file: **plan, not evidence.** Nothing here is VERIFIED until built and gated per feature.

## 0. Conventions every feature follows

### 0.1 UI contract (V15, presentation only during UI acceptance)

- Tokens/components/breakpoints from `design/UX-BLUEPRINT.md` §2/§12.1/§16. Panels use zero outer padding (`.pn-head`/`.pn-body`); status uses single-dot badges; queues use `.q-row`/`.q-row5`; key/value uses facts-ledger/record-card; workflows use timeline/wizard/modal/callouts.
- Every data surface ships four states via one shared `AsyncState` pattern: **loading** (layout-matched skeleton bars), **empty** (honest reason + next step), **error** (what failed + Try-again retrying the same idempotent intent), **success** (names the completed step + next unmet condition).
- Responsive: 320/390 phones (stack, full-width primary actions, scroll-in-wrapper tables), 768–1023 tablets (drawer shells, 2-col grids), 1024–1440 desktop, ≥1920 wide. Zero page-level horizontal overflow at every width.
- Accessibility: skip link, 2px saffron-ink focus, 44px touch targets at mobile, aria-live announcements for context/status change, reduced-motion safe, keyboard-operable drawers/dialogs with focus trap + Escape.
- Anti-slop rules in `AGENTS.md` apply to all new UI (4px radii, quiet 0.15s hovers, Material Symbols only, no emojis, `·` separators).

### 0.2 Logic contract (robustness rules, implemented in the integration phase)

- Business rules live in domain services (`apps/web/modules/services/*`), never in components. Components call services; services call the adapter (`demo` now, Supabase via `/api/adapter` in server mode).
- Money as integer paise; timestamps UTC, displayed `Asia/Kolkata`; references opaque and non-enumerable.
- Every mutation: server-side authorization (granular `StaffAction` grants + AAL2 where required + scope), validation with field-level errors, optimistic-concurrency `expectedVersion`, idempotency keys on retries, append-only audit events with actor/reason/timestamp, outbox notification for cross-module propagation.
- Maker/checker: the account that requests/creates can never approve/publish its own work; UI hides the action AND server denies it.
- UI visibility is never authorization. Denied surfaces render the honest access-denied state with a safe next step.

### 0.3 Definition of done (per feature)

Happy path + denial + validation failure + retry-safety + recovery path verified; affected cross-module projections checked (e.g. finance post refreshes guardian ledger + receipts); unit + integration tests; responsive + a11y pass; `typecheck`/`lint`/`test`/`build` green; `PROJECT-STATUS.md` checkpoint updated with evidence only.

---

## X. Cross-cutting foundations (build first, reused by all)

- **X1 `AsyncState` kit** — one skeleton set (panel/table/queue/form variants), one error-with-retry block, one empty-state block with reason-specific copy. Retrofit targets: finance home, invoices/payments/reconciliation, results detail/entry loading, link-requests, notices page, audit.
- **X2 Retry-safe mutation hook** — wraps service calls with busy/disable, stable idempotency key per intent, error mapping to field + summary, success announcement. First consumer: support send/reopen (fixes silent failures).
- **X3 Responsive hardening** — breakpoints for the 10 route bundles with none (finance ×4, results ×3, notices page, link-requests, imports/exports pages, audit); marks-entry (720px) and timetable-editor (620px) reflow-or-scroll decision; teaching-record inline-form stacking.
- **X4 Honest-action audit** — every button either performs an authoritative command or is visibly policy-disabled with reason. Fixes: invoice print-only action, hardcoded home counters, dead settings inputs, XLSX dead option.

---

## F1 — Staff home / Overview (both portals)

- **Objective:** profile-led landing: who I am, my queue, what needs me.
- **Current:** renders greeting, work queue, `DashboardQueues`, maker-checker panels; some counters hardcoded `0`; errors silently zeroed (`StaffHomeWorkspace.tsx:90-106,164-194`).
- **UI:** V15 `page-head` (profile eyebrow + name + year context), metric-grid of live counts (each a link to its queue), `q-mini` queue preview (5 max + View-all), maker-checker callout for pending approvals, admin panels for Administrator. Skeleton grid loading; empty "All clear" state; error + Try again (never silent zero).
- **Logic:** `getStaffSummary(profile, actor)` returns counts from authoritative services (admissions/careers/finance/results/content/support queues), each count computed by the same filter the target queue uses. No new endpoints; composes existing list calls.
- **Acceptance:** counts equal queue contents; failure shows retry, never `0`; 320px stacks; screen reader announces profile.
- **Tests:** summary-composition unit; queue-parity integration.

## F2 — Admissions review (Principal maker; Administrator oversight)

- **Objective:** review → assess → offer/waitlist/decline with applicant-safe messaging.
- **Current:** GOOD foundation — `AdmissionsQueue` + `ApplicationReview.tsx:360-555` wired via `admissionsService`, reason gates, announcements, responsive to 479.
- **UI:** keep; add per-row assignment/flag context in queue, version-compare view (submitted vs requested-change), document-state panel, applicant-visible reason separated from internal notes; decision `ConfirmAction` modal (object + transition + consequences + reason).
- **Logic:** decisions as versioned transitions (`expectedVersion`), duplicate/eligibility/capacity indicators from service, enrollment-readiness checklist, offer triggers exactly one admission-fee invoice via `finance.createAdmissionInvoice` (idempotent on applicantRef); timeline events actor-safe.
- **Acceptance:** double-submit creates one decision; stale version shows who/when + reload; applicant status shows only approved content; offered → invoice → payment → readiness chain unbroken.
- **Tests:** transition-matrix unit; double-submit/stale-version integration; applicant-safe timeline test.

## F3 — Careers review (Principal/HR maker; Administrator oversight)

- **Objective:** eligibility → shortlist → interview → offer with scorecards.
- **Current:** good — `CareersQueue`, `JobReview.tsx` wired incl. scorecard save; terminal states hide actions.
- **UI:** add panel assignment + interview scheduling block, reviewer-notes (staff-private) vs applicant-timeline separation, vacancy identity/version pinned during review; thin scorecard error path gets full error+retry.
- **Logic:** `careers.ts` decisions versioned; reviewer assignment/scorecard/interview commands; offered candidate gets next-steps, never auto-created staff credentials; retention/deletion policy surfaced from vacancy.
- **Acceptance:** withdrawn application locks decisions; internal notes never leak to applicant projection; scorecard retry safe.
- **Tests:** decision-matrix unit; leak-prevention (applicant vs staff projection) test.

## F4 — Finance workspace: adjustments, refunds, posting (maker/checker)

- **Objective:** concessions/adjustments/write-offs and refunds with four-eyes control.
- **Current:** `FinanceActions.tsx:27-169` wires request/approve/reject/post; workspace has NO loading/empty/error (silent catch `:59-61`).
- **UI:** adjustment queue (`q-row`: ref/applicant+invoice/amount+type/status/action), request form (before/after amounts preview), approve/reject `ConfirmAction` with reason (hides for requester = maker/checker), post action on approved only, refund panel mirroring; X1 states throughout.
- **Logic:** reuse `finance.requestAdjustment/approveAdjustment/postAdjustment/requestRefund` (already versioned + idempotent: `post-adjustment:{ref}`, `refund:{payRef}:{opKey}`). Approval requires different actor + reason; posting appends ledger entries (never rewrites); outbox event refreshes guardian ledger/receipts/overview + staff registers.
- **Acceptance:** requester cannot approve own request (UI hidden, server denies); retry post = one ledger entry; refund shows pending→posted with receipt linkage.
- **Tests:** self-approval denial; double-post idempotency; ledger-parity (guardian vs staff views).

## F5 — Invoices register

- **Objective:** complete, filterable invoice truth.
- **Current:** table + StatusBadge in `.table--scroll`; only action is `window.print()` admitted as placeholder (`invoices/page.tsx:79-83`).
- **UI:** keep register; add status/term/class filters (URL-navigable seg + search), row → invoice detail drawer/page, honest actions per row (view receipt where paid, view attempts where pending); X1 states; ≤719 reflow.
- **Logic:** read-only over `finance.listAllInvoices`; filters are query params applied server-side in server mode; no mutations here (issue/adjust live in F4/admissions).
- **Acceptance:** filters compose; empty-filter state names the filter; receipt deep-links stay in staff context (fixes `/portal/receipts` leak — use `canonicalStaffUrl`).
- **Tests:** filter-parity unit; link-context test.

## F6 — Payments register

- **Objective:** every attempt visible with its reconciliation state.
- **Current:** merged ledger+attempts register; read-only; staff receipt link wrongly points at guardian portal (`:163-166`).
- **UI:** attempt rows with status badge (processing/succeeded/failed/delayed), attempt → detail (order ref, provider ref, timeline, linked receipt on success), safe **Refresh status** retry button per pending row (same idempotency intent, never a new charge); fix receipt links to staff context.
- **Logic:** `finance.refreshAttempt` polling for pending rows; webhook-verified posting is the only success path (browser return never marks paid); failed rows offer retry-as-new-attempt with fresh idempotency key.
- **Acceptance:** refresh never duplicates ledger postings; failed attempt retry creates exactly one new attempt; receipt appears once.
- **Tests:** refresh-idempotency; webhook-duplicate integration.

## F7 — Reconciliation

- **Objective:** gateway-vs-ledger agreement with actionable breaks.
- **Current:** comparison table + `ReconciliationRun`; supabase rows hardcode `method:"Challan"` (`:93-96`).
- **UI:** run summary (matched/unmatched/pending counts), break rows with reason + drill-down + resolve action (match-to-attempt / escalate), scheduled-run info; X1 states; ≤719 reflow.
- **Logic:** reconciliation job rows from server (no fabricated methods — unknown renders "Unknown", never a guessed value); resolve writes audited resolution entries; outbox notifies finance officers on new breaks.
- **Acceptance:** no fabricated data in any mode; resolving a break appends history; counts reconcile with F6.
- **Tests:** break-resolution audit test; unknown-method honesty test.

## F8 — Results moderation & publication (Administrator publisher; Principal submits)

- **Objective:** approve/return/publish/correct/withdraw batches with immutable releases.
- **Current:** `ResultsBatches.tsx` + batch detail with version history via `academicsService`; reportErrors region only, no retry.
- **UI:** batch queue (`q-head5/q-row5`: batch/term/entry/status/action), batch detail (entry progress, moderator return reasons, version history timeline), publish `ConfirmAction` (exam + class + version + audience summary) linking to the immutable version; X1 states incl. retry.
- **Logic:** entry (Principal `result_entry_officer` + AAL2) → submit → moderate (return with reason / approve) → publish creates immutable `result_publications` version; corrections create new versions with reason (never rewrite); guardian view reads only the published snapshot for linked children.
- **Acceptance:** publisher sees exact audience before confirm; published release immutable (correction = new version); unlinked guardian sees nothing; double-publish safe.
- **Tests:** version-immutability; audience-leak (wrong class/guardian sees nothing); self-approval denial.

## F9 — Marks entry (Principal)

- **Objective:** fast, validated marks capture.
- **Current:** `MarksEntry.tsx:97-271` fully wired (draft/submit/validate/approve-paths, per-action errors); 720px table scroll-only, no reflow, no skeleton.
- **UI:** keep grid; add column-sticky student names on scroll, validation summary linking to rows, absent/status quick-set, autosave indicator with resume; ≤719 decision: keep scroll-table (data-dense, justified) with sticky first column + `table-wrap` accessible region.
- **Logic:** `academicsService` draft save (partial allowed) vs submit (full validation: max-marks, absent/status coherence); stale-version conflict shows who/when + reload; submit locks editing until return.
- **Acceptance:** reload never loses draft; invalid rows block submit with focus to first error; concurrent edit conflict recoverable.
- **Tests:** validation-matrix unit; draft-persistence + conflict integration.

## F10 — Timetables & exam date sheets (Principal)

- **Objective:** conflict-checked weekly timetables + published date sheets from `teaching_assignments`.
- **Current:** `TimetableManager/Editor` wired (draft/resolve/publish/override/revoke, date-sheet publish); 620px editor scrolls; persistence demo-only (`timetables/page.tsx:26-28`).
- **UI:** class/section + effective-date context header, week editor grid, hard-conflict strip (teacher/room clash with details), override composer (one-day change preserving base), version history, date-sheet composer; add 1023 breakpoint; keep scroll-table at phones with sticky day column.
- **Logic:** conflict checks against authoritative `teaching_assignments` (independent of logins); publish versions (supersede, never overwrite); overrides reference base version; family day/week views derive from active enrollment + effective date; change triggers targeted notice via outbox.
- **Acceptance:** clash blocks publish with named conflict; override leaves base intact; guardian sees matching version + change labels; another class unaffected.
- **Tests:** conflict-matrix unit; supersession/version integration; guardian-projection parity.

## F11 — Teaching records (Principal)

- **Objective:** teacher roster + subject assignments feeding timetable logic.
- **Current:** roster table, create/assign/end inline forms wired with validation + live notice; no breakpoints; inline forms cramped in cells at phones.
- **UI:** roster ledger + assignment coverage panel (subject × class matrix showing gaps), create-teacher form, per-row assign/end (stacked full-row editor at ≤719 instead of in-cell); X1 states + skeleton.
- **Logic:** `teaching-staff.ts`: teachers are non-login records; assignments (staff, year, section, subject) independent of role grants; end-dating preserves history; timetable conflict engine reads these rows.
- **Acceptance:** ending an assignment keeps past timetables valid; uncovered subject flagged before timetable publish; no teacher account/grant ever created.
- **Tests:** coverage-gap detection; history-preservation on end-date.

## F12 — Notices publishing (both portals)

- **Objective:** audience-correct, scheduled, expirable notices.
- **Current:** `NoticePublisher.tsx:104-374` full pipeline (draft/review/approve/release/schedule/unpublish/edit); announcement-only failures; page lacks loading/empty.
- **UI:** composer with audience picker, schedule/expiry, preview (public vs portal rendering), approval checklist, register with status + delivery state; X1 states; error+retry on all transitions.
- **Logic:** `content.ts` immutable draft/review/publish/unpublish with versions; scheduled publish via outbox worker; expiry auto-hides; audience scoping enforced server-side per projection (public/family/staff).
- **Acceptance:** scheduled notice publishes on time; expired notice disappears everywhere; wrong-audience user never receives it; retry safe.
- **Tests:** schedule/expiry integration (fake clock); audience-projection test.

## F13 — Content / public pages (both portals)

- **Objective:** governed CMS for public pages.
- **Current:** page table + editor + workflow advance + stale-refresh; loadError without retry; no preview verified; 780px tables scroll-only.
- **UI:** page list (owner/review-date/status), editor with preview toggle (renders real public template), version history + broken-link check affordance, publish checklist; X1 states with retry; empty state.
- **Logic:** content versions immutable; preview renders unpublished draft without publishing; broken-link check blocks publish with named links; owner + review-date required.
- **Acceptance:** preview never leaks draft publicly; stale edit conflict offers reload/review; publish requires checklist pass.
- **Tests:** draft-isolation test; conflict-recovery test.

## F14 — Documents (both portals, read-only by design)

- **Objective:** private documents with safe access states.
- **Current:** BEST in portal — skeleton, empty, loadError+retry, access-denied workspace switch (`StaffDocumentsWorkspace.tsx`).
- **UI:** keep; add category/version/scan-state filters, preview/download readiness chips (ready/processing/missing/failed/quarantined/denied/expired), 1023/719 reflow for long metadata rows.
- **Logic:** `documents.ts` + private Storage: signed short-lived URLs, scan-before-availability, generated PDFs (receipts/reports) uploaded via service; retention states; every access audited.
- **Acceptance:** denied/expired shows safe state, never a raw URL; quarantined never downloadable; preview works after scan completes.
- **Tests:** signed-URL expiry; quarantine-denial; state-matrix test.

## F15 — Users & access (Administrator)

- **Objective:** invite, grant, revoke with reason; one profile per account.
- **Current:** roster + invite + revoke/suspend + profile change; loading + errors; empty roster = bare table; responsive to 479.
- **UI:** roster with grant chips + status + MFA, invite flow (profile select → scoped grants → expiry), grant detail (grantor/reason/scope/dates), revoke/suspend `ConfirmAction` with reason; empty state; keep responsive.
- **Logic:** `users.ts` + `staff-profiles/authorization`: exactly one active portal profile per account; grants record grantor/reason/scope; revocation immediate + session invalidation; self-revocation of last admin blocked; TOTP enrollment for privileged staff; audit every change.
- **Acceptance:** revoked grant denies within one navigation; last-admin protection holds; invite expiry enforced; no self-approval path.
- **Tests:** revocation-propagation; last-admin block; invite-expiry.

## F16 — Guardian links & invitations (Administrator)

- **Objective:** school-first onboarding: import/link → invite → OTP-bounded activation.
- **Current:** approve/reject/revoke queues exist; silent catches, no skeleton/retry, no breakpoints; no invite-campaign action.
- **UI:** claim queues (pending/active/ended) with guardian↔student evidence panel, approve/reject with reason, invite composer (channel: SMS OTP primary, email fallback; approved link set; expiry), link detail with versioned contact history; X1 states; ≤719 reflow.
- **Logic:** token-hash-only claims; invite bound to exact guardian + link set (student number/name/DOB/phone alone never activates); contact changes versioned; revocation ends links immediately and hides family data; activation creates/reuses exactly one guardian identity (idempotent).
- **Acceptance:** intercepted link cannot activate another child; expired invite refuses with re-invite path; revoked guardian loses access on next navigation; rapid child-switch never leaks sibling data.
- **Tests:** binding-bypass (negative) test; idempotent-activation; revocation-propagation.

## F17 — Support inbox (Principal maker; Administrator view)

- **Objective:** requester-safe conversations with private staff side.
- **Current:** `GrievanceInbox.tsx` full thread UI; **send/reopen failures silent (no catch)**; grid collapses at 1023.
- **UI:** filter chips + queue, detail with requester thread vs internal-notes tabs, response composer with send-state, resolve-after-send, reopen with reason; X2 mutation hook (busy + error + retry) on send/reopen.
- **Logic:** `support.ts`: requester-safe vs staff-private projections; public intake rate-limited; assign/reopen commands audited; SLA timestamps; provider notification via outbox (retryable, never blocking send).
- **Acceptance:** failed send preserves draft + offers retry; internal notes never in requester projection; reopen re-queues with audit.
- **Tests:** projection-leak test; send-failure recovery test.

## F18 — Data imports (Administrator)

- **Objective:** real private-CSV upload → map → validate → resolve → group-atomic commit → immutable report.
- **Current:** 6-step wizard UI exists; demo path never parses/uploads (`data/imports/page.tsx:92-130`); XLSX hard-blocked; no breakpoints.
- **UI:** Upload (signed browser upload to private store) → Map (column mapping with preview) → Validate (row errors inline, blocking vs warning) → Resolve (fix/reject per row) → Commit (group-atomic summary + confirm) → Report (immutable, downloadable); X1 states each step; retry/resume per step.
- **Logic:** `data-import.ts` + `data_import_parse` outbox handler: strict state machine, group-atomic commit (a family commits whole or not at all), no roster JSON over `/api/adapter` (file reference only), report artifact immutable.
- **Acceptance:** partial family never commits; retry same batch safe; malformed CSV gives row-level errors; report reproducible.
- **Tests:** atomicity (partial-family rollback); idempotent-retry; malformed-CSV matrix.

## F19 — Data exports (Administrator)

- **Objective:** governed, auditable extracts.
- **Current:** request form + requests table; `columns:[]` hardcoded, XLSX offered-then-rejected, no field picker, download only when ready+supabase, no retry.
- **UI:** catalog picker (domain → fields with select-all/sensitive-field warnings) → purpose + reason → request → status with progress → signed download + regenerate/retry; remove or honestly disable XLSX until supported; X1 states; ≤719 reflow.
- **Logic:** export catalogs with cursor pagination; opaque artifact keys; signed short-lived download; data-health prechecks; every request + download audited with purpose/reason; sensitive fields need extra grant.
- **Acceptance:** download works post-ready with retry; unauthorized field excluded server-side even if requested; artifact expires safely.
- **Tests:** field-authorization (negative); expiry test.

## F20 — Settings & school configuration (Administrator)

- **Objective:** versioned school policy with safe change process.
- **Current:** 7 sections render; 5+ inputs dead (no-op/disabled); save degrades to read-only.
- **UI:** grouped sections (access profile, academic year, admission window, partial-payment policy…) each with current-value + pending-change + effective-date pattern, change-request → review → apply flow per V15 settings spec; dead inputs become either live (with effective dating) or visibly policy-locked with reason.
- **Logic:** `settings/school-config.ts`: changes versioned with effective dates; consequential changes require maker/checker; audit trail; projections (admissions window, fee policy) read effective config.
- **Acceptance:** change takes effect only from its date; unapplied change never affects live flows; every change attributed.
- **Tests:** effective-dating unit; projection-reads-effective-config test.

## F21 — Audit explorer (Administrator)

- **Objective:** read-only, filterable truth of who did what.
- **Current:** `AuditExplorer` with filters + append-only callout; no loading/error; page CSS single grid.
- **UI:** safe-reference/actor/action/date/outcome filters (URL-persisted), row → read-only detail drawer, export-view (via F19 catalog), X1 loading/error; ≤719 filter collapse.
- **Logic:** `audit.ts` PostgreSQL read-only projection; append-only store (no update/delete API exists); actor attribution from session; retention policy surfaced.
- **Acceptance:** filters compose and persist; detail never exposes secrets/PII beyond grant; volume paginates with cursor.
- **Tests:** append-only (no-mutation-API) test; attribution test.

## F22 — Guardians placeholder (Administrator)

- **Objective:** honest planned-workspace marker, zero fake operations.
- **Current:** missing — route 404s.
- **UI:** placeholder panel: what the workspace will do (activation campaigns, link health), what exists today (links to Guardian-links queue + Imports), explicit "planned, not operational" copy; no mock controls.
- **Logic:** none (static). Activation/campaign behavior belongs to F16/integration backlog.
- **Acceptance:** route resolves; copy honest; no control implies a working operation.
- **Tests:** route smoke test; copy-lint (no operation verbs as live actions).

---

## Implementation slices (maps to `plan.md` UI-first order)

- **S1 — States & honesty (UI-only):** X1+X4 on F1/F4/F5/F6/F7/F16/F17/F21 + F22 placeholder + receipt-link fix + support catch/retry. Exit: no silent catch, no dead control, every surface has L/E/Err.
- **S2 — Responsive (UI-only):** X3 across the 10 breakpoint-less bundles + marks/timetable/teaching reflow + OTP/header edge cases. Exit: 0px page overflow at 320/390/768/1024/1440/1920 on every retained route.
- **S3 — Workflow depth (UI-only):** F2 version-compare, F3 interview/panel blocks, F8 publish confirm, F9 sticky columns + autosave, F10 preflight, F13 preview, F14 filters, F15 grant detail, F18–F20 honest flows. Exit: V15 acceptance rows checkable.
- **S4 — Logic hardening (integration):** versioning/idempotency/audit/outbox per F2–F4/F6–F12/F15–F21; maker/checker denials; projection parity. Exit: persistence + propagation evidence per slice.
- **S5 — Whole-application acceptance:** real journeys across all five personas with run IDs. **S6 — Providers/release:** staging gates per `plan.md` C5 (deferred, needs credential rotation).

Non-goals (unchanged): Redis/GraphQL/mobile app/LMS/transport/attendance/payroll/chat; Teacher/Student login portals; facility/environment beyond isolation.

## Owner decisions — resolved 10 September 2026

Four items were escalated from the S4 hardening wave because implementing them changes established contracts. All four are now decided and implemented:

1. **Requester-post after independent approval — allowed (no change to the flow, now locked by test).** The blueprint rule is that no account *approves* its own originating work; posting executes an already-approved decision rather than granting it. So the requester may post, while the approving officer still may never post their own approval. The boundary is documented on `postAdjustment`/`postRefund` and locked by a test (`finance-hardening.test.ts`).
2. **Adjustment idempotency — implemented in the demo facade.** The server already keyed `finance.applyConcession`; the demo now mirrors it through a session key with the same shape (`adjustment:<invoice>:l<ledger-state>:<hash>`): an overlapping double-submit collapses to one request, a still-pending identical request replays, and a deliberate re-request after settlement is still allowed.
3. **Concurrent enrollment conversion — serialized in-process.** Demo conversions now chain per application reference (`withConversionLock`), so overlapping submits observe the first stored result instead of racing counters. The Supabase path still needs the equivalent database transaction; that is a forward-migration item from `000061` for the integration phase, not a demo concern.
4. **Last-administrator protection extended to revoke and suspend.** Migration `000056` §5 already serializes `staff_profile_change` **and** `accounts_suspend` on the same advisory lock; the demo only guarded profile moves. The demo now refuses moving, revoking, or suspending the final effective `system_administrator` holder, with matching tests. Affected revocation/suspension tests now seed a second administrator first — which is what production requires anyway.
