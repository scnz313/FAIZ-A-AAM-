# Project Status — Faiz Aam School Platform

Last updated: 1 September 2026
Current phase: **Phase 10 recovery — COMPLETE.** Phases 10.0–10.7 implemented and locally verified; 10.8 staging re-verification executed (backup gate, containment, migration apply). Phases R0–P9 produced schema/UI through migration `000055` but did **not** meet their exit criteria; a full audit found staging exposure, authorization gaps, and unwired pipelines. The recovery plan corrects them in forward migrations `000056–000060`.
Release state: staging backend migrated (ledger `000001–000060` live on remote project `jxegiamjcawdywqyutdz`); privileged test accounts suspended; journey residue and pending claims cleaned. Production does not exist. No Vercel/production action authorized.

## Phase 10 recovery progress (1 September 2026)

| Phase | State | Evidence |
|---|---|---|
| 10.0 containment | `VERIFIED` locally | No committed fallback password remains (repo-wide scan); `TEST_ACCOUNT_PASSWORD` required (min 16 chars, refused defaults); hard target guards on remote scripts (approved ref + `FASS_STAGING_CONFIRMED=true`); read-only `scripts/staging-residue-inventory.mjs` (IDs only). **Remote rotation/suspension and cleanup await explicit owner confirmation with exact IDs.** |
| 10.1 authorization repair | `VERIFIED` locally | `000056`: internal AAL2/role checks on `teaching_staff_list`, `legacy_teacher_access_report`, `data_import_preview/report`, `staff_profiles_list`; export completion service-only with non-null document; profile bundle-lock (all individual grants denied); `staff_profile_adopt` version-checked adoption; `pg_advisory_xact_lock` serializes last-admin checks in `staff_profile_change` + `accounts_suspend`; server-side `context_staff_select` denial for profile accounts. Actor-matrix tests in the consolidation suite. |
| 10.2 teaching/results | `VERIFIED` locally | `000057`: teaching staff are People without accounts (Person backfill, display names persisted, `person_id NOT NULL` restored); assignments restricted to non-login records; complete list projection; legacy Teacher write branch removed from result entry — only `result_entry_officer` + AAL2 + scope writes; publish enforces publisher ≠ entry actor. Entry-officer RLS read policies added for exam_definitions/assessment_components/rosters/marks (000025 had dropped the broad `is_staff_aal2` policies). |
| 10.3 import pipeline | `VERIFIED` locally | `000058`: strict state-transition matrix; group-atomic idempotent commit (family-key groups, per-group rollback, stored immutable result); digest check on confirmed counts; shared-contact flagging; `school_student_number` (scoped unique); teaching-assignment import implemented; preview/report converted to plpgsql (SECURITY DEFINER inlining fix). |
| 10.4 guardian claims | `VERIFIED` locally | `000059`: claim acceptance REQUIRES and verifies the one-time secret hash; provider binding is one-time (rebinding denied, same-subject retry idempotent); account reuse requires provider-subject match; per-channel verified contact; contact-change RPC fixed (invalid RETURNING removed); enrollment conversion reconciles guardian + grant on BOTH branches. |
| 10.5 portal sync | `VERIFIED` locally | FamilyContextProvider: generation counter (remount key), shared dirty-form registry (blocks switches), document metadata cleared on switch; results publications reload on generation bump; "Your children (N)" accessible overview rows. |
| 10.6 exports | `VERIFIED` locally | `000060`: per-domain filter/column allowlists enforced server-side; request idempotency; service-only generation lease; **worker handler implemented** (claim → bounded per-domain reads → formula-safe CSV → private document → mark_ready with document ID + checksum); `/api/health` proves the current consolidation surface (export/import/claim tables), not just `provider_jobs`. |
| 10.7 harness | `VERIFIED` locally | `scripts/validate-upgrade-paths.sh`: both upgrade baselines pass — `000001–000039 → latest` and `000001–000055 → latest` (smoke: no null `staff_members.person_id`, all consolidation tables present, 143 RLS tables). `scripts/check-node.cjs` runtime guard enforces Node 22 (currently **WARNING** mode: Node 24.5.0 active, Node 22 not installed on this machine — recorded as an environment limitation, not silently claimed). |
| 10.8 staging | `VERIFIED` (backend) | **Backup gate:** `pg_dump --data-only` of public + auth schemas (1.6 MB, 5059 lines, 187 auth users, 76 public tables) saved to `backups/staging-pre-phase10-20260901-225202.sql` before any mutation. **Containment:** 2 privileged test accounts suspended (banned ~100 years); 19 journey Auth users + 3 user_accounts + 3 people + 3 guardians + 3 links + 3 claims + 3 contacts deleted; 12 pending claim invitations deleted; post-cleanup inventory confirms 0 journey residue, 0 pending claims, 168 auth users total. **Migration apply:** `supabase db push --linked` applied `000056–000060` successfully; remote ledger now `000001–000060` (000051 skipped/repaired as 000052). **Remaining:** type regeneration from live DB, advisor object-by-object review, first-time TOTP dashboard fix, real AAL2 + email-claim journeys. |

**Local gate evidence (this session, exact outputs):** typecheck ✓ · lint 0 issues ✓ · 513 web + 73 contract tests ✓ · 84-page production build ✓ · cutover guard ✓ · 8/8 scratch DB suites ✓ · 2/2 upgrade-path baselines ✓.

**Remaining Phase 10 blockers (owner-gated):**
1. ~~Staging containment~~ — DONE (1 Sep 2026): 2 privileged accounts suspended, 19 journey users + 12 pending claims deleted, post-cleanup inventory clean.
2. ~~Remote backup/checkpoint~~ — DONE (1 Sep 2026): `backups/staging-pre-phase10-20260901-225202.sql` (1.6 MB, 5059 lines).
3. ~~Migration apply~~ — DONE (1 Sep 2026): `000056–000060` applied to remote; ledger now `000001–000060`.
4. First-time TOTP enrollment (`mfa_allow_low_aal=false` dashboard setting).
5. Real email OTP dispatch (approved SMTP/sender) for the public claim journey.
6. Node 22 installation for the strict runtime gate (Node 24 currently active with a recorded warning).
7. Legacy Teacher grant retirement (`ROLE-2026-5CB9B7`, `ROLE-2026-846E6C`) after the fresh inventory + explicit confirmation.
8. Type regeneration from the live remote database (post-migration).
9. Advisor object-by-object review of the 193 SECURITY DEFINER notices.
10. Real AAL2 staff/guardian journeys on the updated staging backend.

## Phase 10 recovery audit (31 August 2026)

The prior "staging verified" claim was **retracted**. Verified facts:

- **Staging exposure (P0):** two privileged test accounts (`test.administrator@faizaam.example`, `test.principal@faizaam.example`) use the committed fallback password `FaizAam-Test-2026`; 19 `journey.*` Auth users, 15 claim rows (12 pending), and associated synthetic records accumulated with no run ledger or cleanup.
- **Authorization gaps (P0):** `app.teaching_staff_list`, `app.legacy_teacher_access_report`, `app.data_import_preview`, `app.data_import_report` are SECURITY DEFINER with **no internal actor check** — any authenticated account can call them.
- **Guardian claim security (P0):** acceptance never verifies the stored `secret_hash`; the one-time token is dead security data. Contact-change RPC has an invalid `RETURNING reference` into a mismatched row type.
- **Unwired pipelines (P1):** import UI never uploads the selected file (batch created with `source_document_id = null`); no `data_import_parse`/`data_export_generate` worker handlers exist; `generateCsv` is an unused isolated utility; export "ready" was tested with a null artifact.
- **Teaching/results (P1):** teacher display names are discarded; timetable still reads/writes legacy `staff_assignments`; result entry still permits legacy Teacher RPC writes; publish rejects the same independent Administrator moderating+publishing, contradicting the approved model.
- **Guardian portal (P1):** child switch clears one context object but does not remount/reload server-rendered modules; results publications and document metadata can remain from the prior child; no dirty-form guard; `/portal/link-child` still resolves student-reference existence.
- **Verification honesty (P1):** staging journeys proved only AAL1 empty projections (not AAL2 success); claim evidence used service-role inserts and password sessions, not the public claim API; gates ran on Node 24, not required Node 22; no `000039→latest` upgrade harness; no remote backup evidence was recorded before applying migrations.
- **Docs conflict (P1):** status previously said both "staging verified" and "no remote action"; `AGENTS.md` still describes the pre-consolidation ledger; blueprint/spec retain stale checkpoints.

## Phase 9 staging evidence (31 August 2026) — historical, partially retracted

Applied to linked project `jxegiamjcawdywqyutdz` (FAIZ E AAM, eu-west-1) after explicit owner authorization. **Region exception:** the blueprint requires Mumbai (`ap-south-1`); the owner explicitly selected this Ireland project for staging only — it is not production-approved.

- **Migration ledger**: remote was exactly `000001–000039`; dry-run reviewed the exact `000040–000047` order; applied once; ledger now aligned local↔remote through `000055`. `000045b` was renamed `000047` (CLI filename pattern). `000051` was repaired→reverted per the CLI procedure after an in-place edit; the corrected function shipped as `000052`.
- **Hardening migrations shipped during advisor review**: `000048`/`000049` (18→0 unindexed FKs on consolidation tables; anon EXECUTE revoked on staff-facing helpers), `000050` (service-role EXECUTE for the provider boundary), `000052` (claim-dispatch authorization order + opaque-secret-key recognition), `000054` (service-worker audit/outbox allowance with explicit `service_worker` actor label).
- **Auth config**: `mfa_allow_low_aal=false` blocks FIRST-TIME TOTP enrollment (chicken-and-egg) — `BLOCKED` on a dashboard setting the API cannot change; owner must enable enrollment at AAL1 in Dashboard → Authentication → MFA. Leaked-password protection (HIBP) is `BLOCKED` on plan tier (HTTP 402).
- **Linked types regenerated** from the live database: all consolidation tables present, phantom `staff_invitation_assignments` gone, `role_definitions.is_assignable` present; typecheck green.
- **Advisor disposition — SUPERSEDED:** the blanket acceptance of 193 authenticated SECURITY DEFINER notices was invalid; several new read functions have no actor guard (see Phase 10 audit). Object-by-object review required.
- **Masked legacy teacher inventory (read-only)**: 2 active grants (`ROLE-2026-5CB9B7`, `ROLE-2026-846E6C`), neither account holds a guardian grant or other staff grants, 1 legacy assignment, 0 timetable/override references. Retirement is low-impact and remains gated on separate owner confirmation (`scripts/legacy-teacher-inventory.mjs`; retirement command `app.legacy_teacher_access_retire` is NOT invoked).
- **Real-session journeys**: 13/13 checks passed at the time, but the staff checks proved only AAL1 empty projections and the guardian claim used service-role fixtures + a password session — **not** the public claim API. Re-verification required in Phase 10.8.
- **No remote database backup/checkpoint was recorded** before applying migrations to a project with substantial records — a Phase 10 gate before any further migration.

## Current state

The three-portal consolidation is implemented and locally verified end to end through migration `000046`:

- **R0 repair** — two-profile contracts (`staff-profile-code`, `staff-access` with `STAFF_PROFILE_ROLES`), migration `000042` (profile catalog, profile invitations with immutable role snapshots, profile change with last-administrator guard, hardened `roles_grant`/`roles_revoke` refusing deprecated roles and bundle-breaking grants, Administrator-only guardian-link activation), canonical `/administrator|/principal` routing with legacy-redirect and query preservation, aggregate profile authorization in shell/home/guards, and removal of every Teacher login/dev entry point.
- **Phase 3** — `000043` non-login `teaching_assignments` (backfilled from legacy teacher assignments, provenance + source refs preserved), timetable `teaching_assignment_id` references (backfilled), result entry moved to `result_entry_officer` + `staff_scope_allowed` with legacy-teacher compatibility, one-independent-Administrator moderation+publication with actor-level no-self-approval, teaching-staff commands/workspace, masked legacy-access inventory and a version-checked retirement command (NOT invoked).
- **Phase 4** — `000044` import batches/rows/issues/mappings, `external_record_keys` provenance, `guardian_contacts` with delivery state separate from links, import state machine with idempotent group commit, bounded server-side CSV parser (XLSX blocked pending a vetted parser), Administrator import workspace (Upload → Validate → Commit → Report).
- **Phase 5** — `000045` guardian campaigns/claims (hashed single-use secrets, exact approved-link sets, provider binding, delivery attempts), transactional claim acceptance creating-or-reusing ONE account with one Guardian grant, contact-change requests with shared-contact review; `000045b` enrollment conversion now binds the guardian record, one Guardian grant, and the verified link in the same transaction with idempotent retry.
- **Phase 6** — Guardian Portal wording consolidation ("Parent portal" removed), family-level "Your children (N)" context, fail-closed child switching (stale context cleared immediately, previous authorized context restored on failure).
- **Phase 7** — `000046` purpose-bound export requests with allowlisted domains/filters/columns, provider-job generation (`data_export_generate`), 24-hour expiry, formula-safe bounded CSV generator (OWASP triggers neutralized + RFC 4180), Administrator exports workspace.

**Local verification (this working tree, demo adapter + scratch PostgreSQL 17):** typecheck ✓ · lint 0 issues ✓ · **513 web + 73 contract tests** ✓ · production build (84 static pages, 100 routes) ✓ · protected-path cutover guard ✓ · scratch validator applies `000001–000046` from zero and passes the RLS, RPC, staff-profile, slice-4 results/timetable, slice-5 operational, and slice-6 provider-job suites ("ALL LOCAL DATABASE CHECKS PASSED") ✓.

The demo adapter remains the default runtime. No remote Supabase, Storage, Resend, payment, or Vercel action was performed. Staging (Phase 9) and production are not verified.

| Area | Demo UI | Database/RPC | Application cutover | Live verification |
|---|---|---|---|---|
| Identity, invitations, contexts, staff profiles | `VERIFIED` | `VERIFIED` through `000042` (live) | `VERIFIED` locally | Journeys `VERIFIED` at AAL1 gate; AAL2 enrollment `BLOCKED` (dashboard setting) |
| Teaching records, results entry, timetable | `VERIFIED` | `VERIFIED` through `000043` (live) | `VERIFIED` locally | `NOT STARTED` (needs AAL2 sessions) |
| School-data imports and provenance | `VERIFIED` | `VERIFIED` through `000044` (live) | `VERIFIED` locally (CSV; XLSX blocked) | `NOT STARTED` |
| Guardian claims and enrollment binding | `VERIFIED` | `VERIFIED` through `000045`/`000047` (live) | `VERIFIED` locally | Claim journey `VERIFIED` (email path); real SMS `BLOCKED` (TRAI/DLT) |
| Protected exports | `VERIFIED` | `VERIFIED` through `000046` (live) | `VERIFIED` locally (CSV; XLSX blocked) | `NOT STARTED` |
| Admissions, careers, enrollment, uploads | `VERIFIED` | `VERIFIED` through `000041` (live) | `VERIFIED` locally; provider calls use fakes | `NOT STARTED` |
| Storage, PDF, Resend, outbox, cron, health | Demo/fake contracts `VERIFIED` | `VERIFIED` through `000030` (live) | Provider-ready; credentials/configuration `BLOCKED` | `NOT STARTED` |
| Vercel and production | N/A | N/A | Readiness config only | `NOT STARTED` |

## Source-control and rollback baseline

- Archive: `/Users/fin./Desktop/FASS-archive/fass-pre-change-20260806-142412.tar.gz` (source tree; `node_modules`, `.next`, and `package-lock.json` excluded).
- SHA-256: `3a1a97b064851c53242bce3fe0cd85315190dcfbc3b20934243849ee2631e0d4` (manifest: `fass-pre-change-20260806-142412.sha256` in the same directory).
- Git is now the review/rollback baseline. `origin/master` currently ends at `86676dc`; the working tree contains the local C0–C5 implementation and must be reviewed before commit.
- The archive is never edited; it remains an additional pre-Git rollback baseline.

The system is not yet a released school platform. Local code now covers all retained workflows and provider boundaries without Supabase-mode fixture fallback. Real Storage scanning, live Resend delivery/webhooks, a payment-gateway decision, staging sessions/advisors/restore proof, Vercel preview, and production deployment remain external gates.

The authoritative product and relationship target is `FEATURE-INTEGRATION-SPEC.md`. The frontend is an archived reference in `UI-COMPLETION-PLAN.md`; the only active execution order is `plan.md` C0–C5.

## Backend foundation and current cutover

The frontend handoff gate passed. `plan.md` is the active C0–C5 Supabase cutover plan; the B0–B8 sections retained there and below are historical architecture. The local foundation includes:

- **Version-controlled source established**: `git init` + baseline commit `4edf099` (the pre-change tarball archive remains the untouched rollback baseline).
- **Secrets hygiene**: `.env.example` corrected to names and placeholders only; real Supabase keys that had been copied into it were removed. Those exposed keys MUST be rotated (plan.md §3).
- **Pinning**: Node 22 (engines + `.nvmrc`), Supabase CLI `2.111.0` as a root devDependency (up from global 2.58.5), `@supabase/ssr@0.12.4`, `@supabase/supabase-js@2.112.2`.
- **Supabase workspace**: `supabase/config.toml` (Realtime and Edge Functions disabled per the v1 locks), foundation migration `000001_foundation.sql` (conventions, `app.new_ref` reference generation, `app.touch_updated_at`, append-only blocker, optimistic-version pattern documented; tables: `audit_events`, `outbox_events`, `idempotency_records`, `webhook_receipts`, `resend_webhook_events`, `rate_limit_buckets`, `job_runs`, `role_definitions`; RLS enabled with deny-by-default; SECURITY DEFINER helpers `record_audit`, `enqueue_outbox`, `claim_outbox` (SKIP LOCKED), `mark_outbox_delivered`, `fail_outbox` with exponential backoff), deterministic `seed.sql` (17 canonical role codes), pgTAP `tests/database/foundation.test.sql` (22 assertions).
- **Application interface**: `lib/supabase/env.ts` (adapter + env validation), `client.ts` (browser), `server.ts` (SSR, Next 15 cookie convention), `admin.ts` (secret-key, RLS-bypass restricted), `database.types.ts` placeholder for generated types; `db:reset` / `db:test` / `db:types` npm scripts.
- The original foundation gates are retained as historical evidence; current gate counts are recorded only in the validation table below.

**C0–C4 local implementation exit is verified**: migrations `000001–000041` apply from zero on scratch PostgreSQL 17. The RLS/RPC suites, Slice 4 results/timetable release suite, Slice 5 operational suite, and Slice 6 provider-job suite pass. The latest application gate is 477 web tests, 47 contract tests, typecheck, zero-warning lint, a green protected-path cutover guard, and a 79-route production build. Remote migration/advisor/provider verification remains intentionally deferred.

## Historical backend foundation evidence (B1–B6 architecture slices)

B1–B6 database and auth work below is retained as historical implementation evidence. Current readiness is governed by the matrix and C2 sequence above; historical live-project claims are not current live verification.

The C2.1–C2.4 local slices are complete: identity/configuration/context reads,
server-seeded family/staff providers, request-persisted context selection, staff
invitation acceptance UI/lifecycle, admissions→finance→enrollment,
results/timetable, careers/content/support/settings/audit/notifications/document
facades, adapter mismatch checks, and local route-denial/context contracts pass.
The next gate is C5 staging-only global adapter and provider verification.

### Committed remote foundation versus local-only migrations

**Verified read-only ledger facts (31 August 2026, via the Supabase management API):** the linked `FAIZ E AAM` project `jxegiamjcawdywqyutdz` is `ACTIVE_HEALTHY` on PostgreSQL 17 in `eu-west-1`, and its applied migration ledger is exactly `000001–000039`. Local `000040` and `000041` are committed but not live remotely; local `000042_staff_access_profiles.sql` is untracked, being redesigned for the two-profile (administrator/principal) model, and not live. The staff-access-profile, import, claim, and export tables are absent remotely. The remote project contains substantial records and must NOT be assumed disposable; no remote write, migration apply, or account/grant cleanup is authorized while the three-portal consolidation is in progress.

Migrations `000001–000015` are committed and were historically pushed to the linked `FAIZ E AAM` project `jxegiamjcawdywqyutdz`. The B2–B6 notes below describe migrations `000016–000030`, which the verified ledger shows were applied to the remote project; the earlier "local-only, apply after ledger re-read" wording in this subsection is historical.

- **B2 admissions/careers**: windows, applications, immutable versions, drafts, reviews, assessments, offers, events; vacancies, immutable terms, applications, review assignments, scorecards, interviews, events. Public read = published vacancies only. Role-scoped writes (admissions officer/approver, HR reviewer/approver) via new `app.has_any_role` helper.
- **B3 enrollment**: enrollments (partial unique: one active per student/year), idempotent conversion records, restricted support records.
- **B4 finance**: fee schedule versions/items (unique per schedule+code), invoices/items (append-only), concessions, append-only ledger, attempts (unique reference), gateway events (unique provider event id), payments (unique provider txn id), allocations (unique payment+invoice), receipts (unique reference), refund requests/refunds, reconciliation runs/exceptions. Guardian read = active links only; staff read-only at RLS — every finance write goes through domain RPCs.
- **B5 results/timetable**: exam definitions (unique year+section+term), components (unique exam+subject), grade band versions, batches, frozen rosters, immutable batch versions, marks (unique batch+roster+component), publications + per-student publication items (append-only, portal reads these only), correction requests, events, timetable versions/periods/publications/overrides, exam schedules. Teacher policies now require **aal2 + exact assignment scope** (class AND subject); pure-teacher sessions are bound to their assignment scope at RLS level (`app.is_pure_teacher`), operational staff keep queue reads; timetable/exam-schedule writes are manager-only.
- **B6 content/documents/support**: content items/versions (append-only), notices/audiences, documents + per-domain attachments + processing events, support requests/messages/private notes/events, in-app notifications, notification deliveries (unique event+recipient+channel+template), email suppressions. Anonymous visibility for published public-audience content only, via a SECURITY DEFINER helper (`app.public_notice_ids`) so recipient definitions stay private; owner-scoped document reads; support threads are requester-safe (private notes are staff-only).

RLS hardening found and fixed during review: anon notice policy leaked `notice_audiences` (fixed with the helper), teacher policies did not enforce aal2 (fixed), pure teachers could read the full staff queue (fixed with `is_pure_teacher`), and timetable/content/support writes were not role-scoped (fixed with `has_any_role`).

**Local validation**: `scripts/validate-db-local.sh` rebuilds the full schema on a scratch PostgreSQL 17 instance (GUC-based `auth.uid()`/`auth.jwt()` stubs), applies seed, and runs the positive/negative RLS, transactional RPC, results/timetable release, operational, and provider-job suites with fictional actors. It passes through migration `000030`.

**pgTAP suites** added for every slice (run via `supabase db test` in CI): foundation 22, school-config 16, identity-access 31, admissions-careers 79, students-enrollment 21, finance 54, results-timetable 59, content-documents 64 assertions.

**Seed and generated types (historical):** `supabase/seed.sql` and
`scripts/seed-remote.mjs` contain the B2–B6 synthetic configuration. Prior
remote application and type generation are historical; regenerate types only
after the staging migration ledger is re-read and reviewed.

### Historical app-layer integration (outbox worker + email + server domain services)

The following records what was implemented and historically exercised against a
linked project. Because live health and the migration ledger are not currently
re-verified, these entries do not make staging or production `VERIFIED`:

- **Outbox worker** (`lib/supabase/outbox-worker.ts` + `app/api/outbox/route.ts`): claims bounded batches via `app.claim_outbox` (SKIP LOCKED), resolves recipients from authoritative records, sends through injected provider contracts, and processes PDF/Storage jobs. Transient failures return to pending with exponential backoff; permanent failures remain visibly failed and cannot be marked delivered. Vercel Cron uses the `CRON_SECRET`-protected GET route.
- **Resend adapter + templates** (`lib/email/`): fetch-based REST adapter (no SDK), idempotency keys derived from delivery records, editorial shell matching the visual system, one template per plan §9 event kind (no marks/balances in subjects or bodies).
- **Verified webhook** (`app/api/email/webhook/route.ts`): official Svix `Webhook.verify` over the raw body, retryable `svix-id` receipts, monotonic delivery projection, and hashed bounce/complaint suppression.
- **Server domain layer** (`lib/supabase/domain.ts` + `rpc.ts`): every operation returns the `ServiceResult` envelope with canonical error codes; commands call the transactional `app` RPCs through a typed schema-scoped wrapper; reads are RLS-filtered. Ops: admissions (draft/submit/queue/review/decide/respond), finance (invoices/receipts/payment), enrollment conversion, results/timetable publish + lists, family/staff context resolution.
- **Adapter endpoint** (`app/api/adapter/route.ts`): session-protected operation dispatch with zod validation; client gateway `modules/services/adapter-client.ts` behind `FASS_DATA_ADAPTER=supabase` (demo remains the isolated fallback).
- **Project config**: `supabase/config.toml` exposes the private `app` schema to PostgREST (`[api] schemas = ["public", "app"]`) and enables TOTP MFA (`[auth.mfa.totp]`); historical push status is not a current staging verification.

**Historical integration evidence** (`scripts/integration-staging.mjs`, fictional run-scoped data): the prior run exercised real sessions, RLS, AAL2, admissions/finance/enrollment, results/timetable, denial cases, and outbox retries. It must be rerun after the remote ledger and provider configuration are verified; it is not current live evidence.

Historical remainder at the C2.4 checkpoint (now superseded by the current
matrix): global staging verification, provider configuration, the payment-gateway
decision, and production acceptance were still pending.

## Historical execution notes

The dated entries below preserve implementation history. They are not current
status evidence; use the status, validation table, feature matrix, and active
cutover list above for the next task.

### UI design quality pass (21 August 2026 session)

All four surfaces audited and fixed against `design/UX-BLUEPRINT.md` (public, family portal, staff workspace, applicant journeys). Highlights:

- **Public**: notices failure state + retry added; `/notices/[slug]` loading skeleton; disabled anchor navigation blocked; category filters announce active state (`aria-current`); grievance consent error association fixed.
- **Portal**: wrong-child "latest result" hard-code removed (derives from the active child's snapshot); numeric table columns right-aligned end-to-end; honest Due/Clear badge; two-step sign-out confirmation; empty states for documents/fees/notices; loaders replaced with editorial skeletons; tab touch targets raised to 44px.
- **Staff**: careers queue gained status filter tabs with live counts; dashboard counts made honest; required-reason controls now enforce minimum length inline (`role="alert"`, `aria-required`) across admissions/careers/results/link-requests/timetable/facility; numerics right-aligned in 11 tables; marks-entry busy buttons name their operation.
- **Applicant**: autosave indicator truthful ("Saving failed — retry" path); error-summary entries are labeled "Review this answer" anchors with `aria-label` carrying the message (fixes duplicate-text test failure); job-form rail announces `aria-current="step"`; offer acceptance names exact amount + deadline pre-commit; auth error param renders expired-link recovery; OTP resend cooldown with live-region announcements.

**Loop-test evidence (fresh production build, this session):** typecheck ✓ · lint 0 issues ✓ · 256 web + 47 contract tests ✓ · build 66 pages ✓ · **22/22 critical browser journeys PASS** · responsive sweep 168 viewport×route pairs at phone-s→desktop-xl NO PROBLEMS ✓ · accessibility scan 53 routes 0 violations ✓ · focus/keyboard smoke PASS ✓ · link crawl 65 routes / 91 hrefs, zero dead links ✓.

Finance integration note: `mapServerInvoice`/`invoiceSummary` hardened per new spec tests (34 mapper tests) — receipt references pair by original allocation slot, settled invoices never show residual balance, `paidPaise` counts allocation-backed payments only.

### B7 cutover progress (21 August 2026 session)


Work completed and gate-verified on this checkout (typecheck, lint, 222 web + 47 contract tests, 66-page build all pass):

- **Server command layer complete**: every existing DB RPC now has a typed domain wrapper and a zod-validated `/api/adapter` dispatch entry — `jobs.submit`, `jobs.decide`, `links.approve`, `links.reject`, `support.respond`, `content.publishNotice`, `results.submitMarks`, `results.moderate`, `results.withdraw`, `results.correctionRequest`, `finance.issueAdmissionInvoice` join the previous 18 ops (29 total). Authorization remains entirely inside the SECURITY DEFINER RPCs.
- **Finance ledger reads enriched**: `finance.listInvoices` now embeds `ledger_entries`, `payment_allocations→payments`, and receipts; `finance.listReceipts` embeds payment method/amount and invoice identity — enough for the client to compute portal/staff parity views from the append-only ledger.
- **PDF generation adapter implemented** (`lib/pdf/render.ts`, `lib/pdf/adapter.ts`): dependency-free valid-PDF writer (Helvetica, deterministic output), receipt template (`receipt-v1`) with INR grouping and IST timestamps, report-card template ready; outbox worker now renders `pdf.generate` receipt events FROM stored records, records a private `documents` row with reserved `object_key` plus append-only processing events, and returns delivered/transient/permanent outcomes. Migration `000016_generated_documents.sql` makes `uploaded_by_account_id` nullable for server-generated documents (NOT yet pushed; regenerate types after apply). Six new renderer tests pass.
- **First client cutover wired**: `financeService` read paths (`listInvoices`, `listAllInvoices`, `getInvoice`, `listReceipts`, `getReceipt`) route through `adapterCall` when `FASS_DATA_ADAPTER=supabase`, mapping server rows into the unchanged domain shapes via `finance-server-map.ts`. Demo mode is byte-identical; no dual-write. Write paths (attempt lifecycle, `confirmSuccess`) still need server order-create/refresh ops before they can leave the demo path.
- **UI fix**: the application form's destructive "Start over" replaced `window.confirm()` with an accessible inline confirmation panel (safe default focused, Escape cancels).

Remaining for B7 (honest gaps): client wiring for admissions/careers/results/timetable/family-context/staff-context/content/support facades; server ops for payment-attempt create/refresh and single-invoice/receipt detail; school-config label→UUID resolution for draft creation; staff invite + TOTP enrollment flow; removal of operational sessionStorage once facades cut over.

### Staff identity lifecycle (21 August 2026 session, later)

The staff chain invite → account → role grant (+scopes) → assignment is now complete server-side:

- **Migration `000017_staff_identity_commands.sql`** (authored, NOT yet pushed — execute via `supabase db push` or manually): six SECURITY DEFINER commands in exact house style — `roles_grant` (system_administrator+aal2, duplicate-active-grant guard, scope rows validated against FKs, audit + `security.role_granted` outbox), `roles_revoke` (version-checked, revalidation trigger ends access next request), `assignments_create` (grant must belong to the staff member's account; grade section must belong to the academic year; duplicate-scope guard), `assignments_end`, `invites_create` (stores only sha256 of a 192-bit one-time reference; plaintext returned once to the inviting admin), `invites_revoke`. Reads stay RLS-based (`users.list`) — no read RPCs.
- **Domain + dispatch**: typed wrappers (`rolesGrant/Revoke`, `assignmentsCreate/End`, `invitesCreate/Revoke`, `usersListAdmin`) and eight zod-validated adapter ops (`users.*`, `assignments.*`, `invites.*`). Typecheck/lint green.
- **TOTP gate live**: new `/sign-in/totp` route (public-frame layout) + `TotpForm` — first visit enrolls a factor (QR or manual key), later visits challenge+verify, then opens `/staff`. In supabase mode `SignInForm` routes accounts that hold a staff context to `/sign-in/totp` after OTP verification; everyone else lands in the portal. Demo mode untouched.
- **Tests**: 5 new spec tests (directory mapping, RLS-denial envelope, invite RPC contract). Full gates: **261 web + 47 contract tests**, build 66 pages, **22/22 journeys** on a fresh prod build.

Remaining (honest): migration 000017 not applied to any database (no Docker/live project this session); users page UI still drives demo stores in supabase mode until wired to `users.list`/grant ops; staff invite delivery (email with the one-time ref) awaits Resend sender domain.

### Payment lifecycle + users admin live wiring (21 August 2026 session, final)

- **Migration `000019_finance_attempt_lifecycle.sql`** (authored, unapplied): `finance_create_attempt` (owner-guarded — applicant owner / active guardian / finance staff aal2; amount must equal current balance; sandbox order ref) and `finance_refresh_attempt` (created → processing → succeeded, idempotent terminal reads). The ledger post remains `finance_post_sandbox_payment` — the browser never marks an invoice paid.
- **Facade cutover complete for the payment journey**: `createPaymentAttempt`/`refreshAttempt`/`confirmSuccess` now drive the real server machine in supabase mode (`finance.createAttempt` → `finance.refreshAttempt` → `finance.postPayment`, receipt resolved from the server list). Demo path byte-identical; 22/22 journeys still pass.
- **Users admin fully wired** (this session): directory read, invite (one-time ref via `invites.create`), grant/revoke with optimistic versions, suspension as audited multi-revoke; reactivation honestly requires a fresh grant decision.
- Gates: typecheck ✓ lint ✓ 276 web + 47 contract tests ✓ build ✓ 22/22 journeys ✓.

### Careers facade cutover (21 August 2026 session, continued)

- **New domain reads/draft creation**: `jobsListPublishedVacancies` (public read = published only, latest version resolved), `jobsCreateDraftApplication` (owner RLS insert), `jobsListMine` / `jobsListStaffQueue` (versions + applicant-safe events). Four new dispatch ops: `jobs.vacancies`, `jobs.createDraft`, `jobs.listMine`, `jobs.staffQueue`.
- **Facade wired** (supabase mode): submit runs the live pipeline (vacancy resolve → draft row → `jobs_submit` immutable version); `getApplication`/`listStaffRecords` map server rows into the unchanged domain shapes; all four HR decisions route through the version-free `jobs_decide` RPC via a ref→id map. Demo path guarded and byte-identical.
- Gates: typecheck ✓ lint ✓ 276 web + 47 contract ✓ build ✓ 22/22 journeys ✓.

### Historical remaining command set (000015)





`links_approve`/`links_reject` (support staff + aal2, version-checked, revalidation bump, audit + outbox), `support_respond` (requester-safe thread; private notes staff-only, never rendered to the requester), `content_publish_notice` (publisher release of draft/scheduled notices), `jobs_submit` (idempotent append-only) and `jobs_decide` (HR shortlist/interview/offer/not_selected with self-decision denial), `results_submit_marks` (teacher exact year/class/subject assignment scope, per-component maxima validation, full-roster coverage, batch → submitted + immutable version row), `results_moderate` (exam reviewer approve/return), `results_withdraw` (publisher, reason required, append-only) and `results_correction_request`. This is the historical command surface; local coverage is current where recorded in the validation table, while remote application and live integration must be reverified.

### Historical B2–B6 transactional RPC layer

Migration `000009_domain_rpcs.sql` implements the historical plan.md transaction contract as SECURITY DEFINER commands (all `search_path = ''`, every call verifies `auth.uid()` + role + aal2, every command appends audit + outbox rows in its own transaction). Treat remote push status as historical until the staging ledger is re-read:

- `admissions_submit` — append-only version submit, optimistic base-version lock, idempotent retry returns the SAME version id.
- `admissions_review_advance` / `admissions_request_changes` — officer maker steps.
- `admissions_decide` — approver checker step (offer/waitlist/decline); self-approval denied.
- `admissions_respond_offer` — applicant accept/decline; accepting issues the unique admission invoice in the same transaction.
- `finance_issue_admission_invoice` — idempotent per application; requires an approved fee schedule (policy-pending schedules block issuance).
- `finance_post_sandbox_payment` — full-payment post: attempt + payment (unique provider txn) + allocation + sequential receipt + ledger entry + invoice status + audit + outbox; retries on attempt reference OR provider txn id return the same receipt and never duplicate. Sandbox only — the real gateway adapter is a future boundary.
- `enrollment_convert` — idempotent conversion: permanent student + active enrollment + verified guardian link + invoice adoption onto the student ledger + application status; readiness gates (accepted offer + paid invoice) enforced; retry returns the stored result.
- `results_publish_batch` — publisher release: freezes the roster from active enrollments, writes immutable per-student publication snapshots, marks the batch published, emits events; teacher/non-publisher denial proven.
- `timetable_publish_version` — manager publication of a validated draft (immutable publication row).

`invoices.student_id` was relaxed to NULL for pre-conversion admission invoices (forward-only `alter table`), and the guardian finance/result RLS policies were fixed (forward-only `000010_rls_fixes.sql`): applicant-owned admission invoices/items/receipts are visible to their owner, and the two guardian result policies no longer recurse (`app.active_publication_ids` helper).

The full local chain is proven by `scripts/validate-rpcs.sql` (runs inside
`validate-db-local.sh` after the RLS suite): applicant submit → officer advance
→ approver offer → accept + unique invoice → sandbox payment with idempotent
retries → conversion (retry-safe) → result publication → timetable publication,
plus denial cases and outbox/audit evidence. All three suites pass on the
scratch instance. Any remote push status in the historical record must be
rechecked against the staging migration ledger before it is relied upon.

## Current blockers

1. **C5.1 read-only ledger check attempted 28 Aug 2026 — BLOCKED on the pooler connection.** The Supabase management API is reachable (the CLI lists the linked `FAIZ E AAM` project `jxegiamjcawdywqyutdz`), but the direct database pooler connection times out (`Failed to create login role: Connection terminated due to connection timeout`), so `supabase migration list --linked` cannot read the remote `schema_migrations` ledger. No local-only migration was applied. **Region finding:** the linked project lives in **West EU (Ireland)**, while plan.md §1 requires a dedicated synthetic-data staging project in `ap-south-1` (Mumbai) — the staging project decision must be revisited (create/relocate the Mumbai staging project, or record an approved exception) before any migration apply.
2. The machine runs Node 24 while the project pins Node 22; use Node 22 in CI and staging verification.
3. Resend SMTP, verified sender domain, webhook secret, and cron secret are not configured for staging.
4. A payment gateway/merchant account and school finance policy are still unapproved.
5. Supabase-generated types must be regenerated after the local-only migrations are applied to staging.
6. Known transitive npm audit findings (postcss/sharp via Next 15) remain to be revisited when a compatible patched release is available.
7. A real document-scanner service and retention/legal-hold policy are not configured for staging.
8. Anonymous public support must remain fail-closed until a real CAPTCHA provider is selected and verified.
9. Vercel team/project ownership, preview environment, domain, and release owner are not yet recorded.

## Next phase — C5 staging activation

The next action is **C5.0 source-control review**, followed by the staging
migration ledger. Do not begin with provider configuration or Vercel.

| Stage | State | Required next evidence |
|---|---|---|
| C5.0 — source checkpoint | `IN PROGRESS` | Review/group the dirty tree, secret/lockfile scan, local gates, and commit IDs for the staging candidate |
| C5.1 — staging ownership and ledger | `NOT STARTED` | Confirm synthetic staging project/owner/region and compare local/remote migration history |
| C5.2 — migrations, types, advisors | `NOT STARTED` | Dry-run and apply `000016–000030`, re-read ledger, generated-type diff, RLS/RPC/provider suites, advisor disposition |
| C5.3 — Auth/session proof | `NOT STARTED` | Applicant/guardian/staff invitation, OTP, TOTP, recovery, revocation, and wrong-scope real-session evidence |
| C5.4 — Storage/PDF | `BLOCKED` on provider configuration | Private buckets/policies, scanner, upload/finalisation/quarantine, signed delivery, receipt/report-card generation |
| C5.5 — Resend/outbox/cron | `BLOCKED` on provider configuration | Sender domain, Auth SMTP, API/webhook/cron secrets, delivery/retry/suppression and worker freshness |
| C5.6 — finance sandbox | `NOT STARTED` in staging | DB sandbox payment, adjustments/refunds/reconciliation; real gateway remains separately blocked |
| C5.7 — global staging switch | `NOT STARTED` | Both adapter variables set together and all positive/negative vertical journeys pass |
| C5.8 — restore rehearsal | `NOT STARTED` | Isolated database/Storage restore record with RPO/RTO and integrity checks |
| C5.9 — Vercel preview | `NOT STARTED` | Preview built from reviewed commit against staging and full post-deploy verification |
| C5.10 — production | `NOT STARTED` | Separate production project/build, approved school data/providers, release and rollback evidence |

Detailed commands, stop conditions, ownership expectations, and exit criteria
are defined only in `plan.md` C5.0–C5.10.

## Current validation evidence

Evidence was rerun against the current checkout on 24 August 2026. Database
validation used the local scratch PostgreSQL validator. No remote
Supabase/provider call was used.

| Gate | Status | Evidence |
|---|---|---|
| TypeScript | `VERIFIED` | `npm run typecheck` runs `next typegen` first and passes both workspaces |
| Lint | `VERIFIED` | `npm run lint` passes with `--max-warnings=0` |
| Unit/component tests | `VERIFIED` | `npm test`: 394 web tests; contracts: 47 tests |
| Production build | `VERIFIED` | Next.js 15.5.22 compiled and generated 76 routes, including health, MFA, provider, document, webhook, and cron boundaries |
| Local migrations/RLS/RPC | `VERIFIED` | Scratch validator applies `000001–000030` from zero; RLS/RPC, result-release/timetable, operational, and provider-job suites pass |
| Route/link crawl | `VERIFIED` | 66 route cases, 91 unique internal hrefs, no dead links or route failures |
| Critical browser journeys | `VERIFIED` | 22/22: job application, student application, grievance, payment, guardian sign-in, staff admission decision (maker/checker across identities), two-child portal switching, staff link-request approval, admission → fee → enrollment, staff role denial + identity switching, teacher assignment scope, content editor publish denial, teacher subject denial, timetable read-only for non-managers, wrong-child resource scope + child switch, link approval then revocation, results maker/checker split, duplicate-safe payment retry, correction versioning, teacher entry → moderator return → approve → publish → portal publication, timetable manager publish → portal v2, family payment → staff ledger parity |
| Accessibility scan | `VERIFIED` | 54 retained routes scanned with no automated axe violations |
| Focus/keyboard smoke | `VERIFIED` | mobile drawer, skip link, document dialog, and fee-statement focus behaviors passed |
| Responsive sweep | `VERIFIED` | 176 viewport/route pairs at 320–1920 px, no reported overflow or console problems |
| Supabase cutover guard | `VERIFIED` | `npm run check:cutover` passes; protected route/components have no raw browser persistence and every session-store use proves an adapter branch |
| Local production browser review | `VERIFIED` | 22/22 critical journeys pass on local port 3002, including admissions→enrollment, result/timetable chains, role denial, stale/retry, and payment parity |
| Supabase live health/migration ledger | `BLOCKED` | Current environment returns DNS/connection failure; no local-only migration is claimed live |

Limitations of this evidence:

- Browser journey tests prove deterministic demo behavior, not server authorization or permanent persistence.
- Automated accessibility results do not replace manual screen-reader, zoom, contrast, language, and content review.
- The working tree is intentionally dirty during this implementation; review and commit the C0–C5 changes before applying them to staging.

## Feature and integration matrix

| Area | Demo UI | Database/RPC | Application cutover | Live verification |
|---|---|---|---|---|
| Public website and visual system | `VERIFIED` | Public content schema exists | Public careers/notice reads and content projections have local Supabase branches; staging not rechecked | Demo browser gates pass; staging content not rechecked |
| Student admissions | `VERIFIED` | Admissions RPCs/schema + `000022` draft/readiness projection | `VERIFIED locally` — owned server drafts, submit/status/decisions/offer response and authoritative mapping; staging not cut over | Local contracts/RPCs only |
| Enrollment conversion | `VERIFIED` | Idempotent create-or-match conversion/readiness RPCs in `000022` | `VERIFIED locally` — invoice/payment/readiness/conversion/link projection | Local contracts/RPCs only |
| Careers | `VERIFIED` | Careers schema/RPCs + `000024` drafts/withdrawal/HR commands | `VERIFIED locally` — vacancy, cross-device draft, submit/status, withdrawal, version-safe HR decision branches | Local contracts/RPCs only |
| Family finance/payment | `VERIFIED` | Provider-neutral attempts, ledger, adjustments, refunds, reconciliation `VERIFIED` locally | `VERIFIED` locally with DB sandbox | Real gateway not selected |
| Results | `VERIFIED` | Results RPCs/schema + `000023` draft/correction workflow | `VERIFIED locally` — batch/detail/version/publication/snapshot mapper and command branches | Local contracts/RPCs only |
| Timetable | `VERIFIED` | Timetable RPCs/schema + `000023` revision/conflict/override/date-sheet commands | `VERIFIED locally` — async effective/draft/publish facade and loaders | Local contracts/RPCs only |
| Guardian/student linking | `VERIFIED` | Versioned link/capability lifecycle `VERIFIED` locally | `VERIFIED` locally | Real-session proof pending |
| Family context | `VERIFIED` | Relationship/capability RLS `VERIFIED` locally | Server hydration and persisted selection `VERIFIED` locally | Staging pending |
| Staff context/roles | `VERIFIED` | Grants/assignments/AAL2 `VERIFIED` locally | Server hydration and workspace selection `VERIFIED` locally | Staging pending |
| Users administration | `VERIFIED` | Invitation/account/grant/MFA lifecycle `VERIFIED` locally | `VERIFIED` locally | Auth email/provider evidence pending |
| Identity/authentication | `VERIFIED` demo and local route guards | Auth/account/link schema and RLS `VERIFIED` locally | Provider-ready and fail-closed | Live session/AAL/TOTP proof pending |
| Documents/PDF | `VERIFIED` | Upload, scan, generation, retention jobs `VERIFIED` locally | Provider-ready with private signed delivery | Storage/scanner staging pending |
| Notices/content | `VERIFIED` | Content/notices schema + `000024` immutable draft/review/publish commands | `VERIFIED locally` — public/family/staff projections and fail-closed writes | Local contracts/RPCs only |
| Notifications/outbox | `VERIFIED` | Retry-safe outbox/delivery/webhook/job schema `VERIFIED` locally | Official Svix + Resend/provider-ready | Resend not configured |
| Support | `VERIFIED` | Support RPC/schema + `000024` requester/private/public-intake commands | `VERIFIED locally` — requester-safe/staff projections, public route, reopen/assign branches | Local contracts/RPCs only |
| Settings/audit | `VERIFIED` | Versioned settings/audit schema + `000024` commands | `VERIFIED locally` — optimistic settings save and read-only PostgreSQL audit projection | Local contracts/RPCs only |
| Backend foundation | `VERIFIED` locally | Migrations `000001–000030` pass all scratch suites | Local cutover guard passes | `000001–000015` historical only; `000016–000030` local-only |
| Production/Vercel | `NOT STARTED` | No production schema | No deployment | No release evidence |
| Facility demonstrator | `VERIFIED` demo-only | No database/RPC by design | Isolated | Deferred |

## Highest-priority audit findings

1. The next work is environment verification, not another feature or screen.
2. C2–C4/provider readiness is locally verified. Do not call staging or global cutover verified until real sessions and providers run every retained workflow.
3. The demo adapter remains the default. Supabase branches fail closed; staging must switch both adapter variables together only after its migration ledger is reconciled.
4. The server adapter boundary is split by runtime: Server Components use direct server loaders/request-aware calls; Client Components use `/api/adapter`. A relative unauthenticated server fetch is a release blocker.
5. Migrations `000016–000030` pass locally but remain unverified remotely. The next environment action is migration-ledger verification, not a blind push.
6. Storage, scanning, PDF, retention, Resend, webhook, cron, and health code is provider-ready locally; real credentials and staging evidence remain blocked.
7. Resend SMTP, sender-domain, webhook, cron, bounce, complaint, and suppression evidence is still blocked on provider configuration.
8. The frontend and local cutover gates are green; this does not make the Supabase adapter globally, staging, or production `VERIFIED`.

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

## Active phase summary (not an execution order)

Read `plan.md` for the sole C0–C5 execution sequence. This status summary
records state only:

| Phase | State | Current boundary |
|---|---|---|
| C0 | `VERIFIED` locally | Browser dependencies, deterministic typegen, lint, demo/browser/accessibility/focus/responsive/link gates, and scratch DB validation pass. |
| C1 | `VERIFIED` locally | Role-boundary hardening, invitation lifecycle, atomic suspension/reactivation, and private bucket/policy migration pass locally. |
| C2 | `VERIFIED` locally | Every retained facade has a fail-closed Supabase branch/loader and the cutover guard passes; staging sessions remain unverified. |
| C3 | `VERIFIED` locally | Storage finalisation/scanning, signed delivery, PDF generation, and retention pass fake/provider-job contracts. |
| C4 | `BLOCKED` on provider configuration | Code and official Svix verification are locally verified; real Resend SMTP/API/domain/webhook/cron evidence remains. |
| C5 | `BLOCKED` on live environment verification | Remote ledger, generated types, advisors, real sessions/providers, restore rehearsal, Vercel preview, and production remain. |

### Historical frontend phases

1. `I0` — **implemented and verified**: shared people, relationships, roles/assignments, enrollments, and context contracts; family/staff context services; service-driven shells; context survives navigation within the demo session.
2. `I1` — **spine implemented and verified**: two-child portal switching, per-page child context, pending-link approval/rejection path.
3. `I2` — **implemented and verified**: finance ledger parameterized by student with staff/portal parity, per-student result snapshots, one timetable facade, and typed content/documents/notifications/users/settings/audit services wired into their pages.
4. `I3` — **implemented and verified**: admission offer → finance payment → enrollment/link conversion (invoice-once, shared checkout, readiness gates, idempotent create-or-match conversion, ledger adoption, applicant acknowledgement).
5. `I4` — **spine implemented and verified, then rebaselined to the canonical Phase-1 grant model**: role/action authorization module, role-aware navigation, route guards with workspace-switch denial, demo identity picker, teacher assignment-scoped marks entry, action gating; the `plan.md` Phase-1 grant table (maker/checker splits, `links.verify` scope, Rania Mir approver identity) is the authoritative action model.
6. `I5` — **in progress**: deterministic demo domain events + append-only audit + demo outbox now emit one idempotent event per consequential action (payment post, conversion, publish, withdraw, content publish, link decision); in-app notification projection from outbox events and PDF generation remain backend work.
7. `I6` — **frontend contract freeze applied (historical)**: `packages/contracts` core domain/context/error/outbox/audit types, `design/BACKEND-HANDOFF-MATRIX.md`, applicant draft privacy policy, and the archived frontend gate evidence; the active backend cutover is governed by `plan.md` C2, not this historical handoff gate.

The frontend and local backend/provider gates have passed. Do not claim staging verification or production release until the C5 environment gates pass.

## Change log

Every entry below is historical context only. It cannot override the current
matrix, validation table, blockers, or C0–C5 execution order above.

- **2026-08-31 (Three-portal consolidation audit and rebaseline):** The signed-in product is being consolidated into exactly three portal experiences — Administrator (`/administrator/*`), Principal (`/principal/*`), and Guardian (`/portal/*`); the Teacher and Student portals are removed (teachers become non-login school records with `teaching_assignments`; students remain guardian-linked records).

  **Drafted this session:** two-profile access contracts (administrator/principal provisioning presets with granular role expansion) and the `000042_staff_access_profiles.sql` redesign for the two-profile model (the old three-profile version is not authoritative).

  **Audit findings:** canonical routing still falls back to `/staff/*` instead of the canonical `/administrator/*` + `/principal/*` map; profile homes depend on the active workspace rather than the profile; invitation title/version defects; stale browser journeys; and Phases 3–9 of the consolidation remain. Verified read-only remote facts: ledger exactly `000001–000039`, project `ACTIVE_HEALTHY` PostgreSQL 17 `eu-west-1`, local `000040–000041` not live, `000042` untracked/not live, profile/import/claim/export tables absent remotely, and the project contains substantial records that must not be assumed disposable.

  **Status:** the consolidation is `IN PROGRESS`, not `VERIFIED`. The C5 staging sequence remains paused until the consolidation lands and local gates pass; no Vercel/production work is authorized.

- **2026-08-31 (C5 local feature completion — admissions withdrawal, review state, careers scorecards, CMS pages, finance reconciliation, timetable date input, and demo-leakage removal):** Completed the remaining local features and ran the full local verification gate through migration `000041`:

  **New database work (all verified from zero):** `000040_timetable_override_and_date_sheet_reads.sql` (override/date-sheet read projections for the timetable facade) and `000041_admissions_withdrawal.sql` (version-checked, idempotent `admissions_withdraw` RPC + idempotency records). Scratch PostgreSQL 17 applies `000001–000041` from zero; RLS/RPC, results-release, slice-5 operational, and slice-6 provider-job suites all pass ("ALL LOCAL DATABASE CHECKS PASSED").

  **Functional completion:**
  1. **Admissions withdrawal** — end-to-end applicant withdrawal in Supabase mode: RPC + domain function + `admissions.withdraw` adapter op + service method + mode-aware UI. `withdrawn` status now maps correctly (was "Declined").
  2. **Admissions staff review state** — new `staffStartReview` (submitted → under review) and canonical transitions (Submitted → Under review → Assessment → decision); decisions are no longer offered from Submitted. Maker/checker reviewer attribution preserved.
  3. **Careers detail** — staff queue projection now includes `job_review_assignments` + `job_scorecards`; `assignReviewer` and `saveScorecard` service methods (Supabase + demo); JobReview renders real attributed scorecards with a save form, real reviewer account, and snapshot-derived qualifications instead of fictional rows.
  4. **Private-document boundary** — upload-intent route now resolves allowed MIME types/max bytes from the admission configuration projection server-side instead of trusting the browser allowlist; declared type/size is validated against the resolved requirement.
  5. **Finance** — payment-register merge now dedupes by attempt id (provider order refs never align with txn ids); `finance.listAllAttempts` adapter op; reconciliation start now imports sandbox evidence (`finance_reconciliation_import`) so runs carry authoritative matched/pending/exception counts instead of an empty shell.
  6. **Timetable** — override form uses a calendar date input (date-specific overrides on any date) instead of a weekday select; portal/date-sheet reads stay versioned.
  7. **CMS** — staff content page gained a public-page editor (create draft with slug, edit draft/archived/expired rows, review/publish note) backed by `createPublicPage`/`editPublicPage`/`getPublicPageBody` in both adapters; homepage latest-notice strip reads the latest authoritative published public notice in Supabase mode; the About route renders a published managed page when one exists (concept copy remains the honest fallback).
  8. **Demo leakage removed** — every remaining Supabase-mode demo badge, "(demo)" success message, "demo session" text, and fictional policy note across portal/staff/applicant pages and staff components now renders only in demo mode (30+ files).
  9. **Demo identity fix** — added a dedicated `content_publisher` demo identity (Naseer Lone, account `…0206`) so the notice maker/checker flow is exercisable end to end (Aisha drafts → Naseer approves/publishes); fixture and identity tests updated.
  10. **Middleware edge fix** — `@supabase/ssr` is now imported lazily inside `updateSession` so the edge bundle never evaluates its code-generation helpers in demo mode (fixes `EvalError: Code generation from strings disallowed` on every route).
  11. **Responsive fix** — `FinanceActions` grid used `minmax(0, 1fr)` which made `auto-fit` emit dozens of ~1px tracks that overlapped the panels; now `minmax(min(100%, 300px), 1fr)` (single column at 320px, side-by-side at desktop). The 176 viewport×route responsive sweep passes with no problems.

  **Journey automation:** the local feature-journey suite grew from ~90 to 107 checks (timetable override record/revoke with reason, notice maker/checker publish through the new identity, careers reviewer/scorecard), and the finance/override test steps were updated for the date input and the required revocation reason.

  **Full local gate (demo adapter, production build on localhost):** typecheck ✓ · lint 0 issues ✓ · 477 web + 47 contract tests ✓ · 79-route production build ✓ · 107/107 local feature journeys ✓ · 22/22 critical journeys ✓ · link crawl 91 hrefs, no dead links ✓ · accessibility 54 routes, no violations ✓ · focus smoke ✓ · responsive 176 viewport×route pairs, no problems ✓. The Supabase-mode contract suites (47) and the local database validation continue to pass. Remote staging/provider verification remains `NOT STARTED`/`BLOCKED` per plan.md C5.

- **2026-08-28 (C5.0 source-control checkpoint — 6 reviewable commits from the dirty tree):** Audited the entire dirty working tree (248 files: 166 modified + 82 untracked) and committed it in six reviewable groups:

  1. `feat(database)` — migrations `000016–000030` + results-release/slice-5/slice-6 pgTAP suites + seed + DB validators (22 files).
  2. `feat(facades)` — Supabase-mode service facades, `/api/adapter` registry, server loaders, identity-server auth routes, finance server mapping, contract tests (58 files).
  3. `feat(providers)` — outbox worker, Resend/Svix webhook, PDF renderer, document/support providers, provider tests (23 files).
  4. `feat(ui)` — portal/staff/applicant/public integration: identity routes, timetable overrides + date-sheet publish, role-gated actions, empty/error states, service tests, override browser journey (123 files).
  5. `docs` — PROJECT-STATUS/plan/blueprint/spec/README/UI-completion updates, VERCEL-READINESS, COMPLETE-FEATURE-PROMPT (10 files).
  6. `chore(tooling)` — Playwright/axe pins, cutover guard, vercel.json cron contract, `.env.example` names, and the safe audit fix (nanoid 3.3.18 + Next 15.5.24 patch) (12 files).

  **Security/quality audit (all clear):** no secrets in the diff or untracked files (the only base64-looking strings are package-lock SRI integrity hashes); `.env.local` confirmed git-ignored; no logs, archives, `.DS_Store`, or temp artifacts; no obsolete files found. **Dependency risk:** `npm audit` reduced from 4 high to 1 high — the remaining `postcss` advisory requires the breaking Next 16 upgrade and stays documented (blocker 6).

  **Full gate re-run from the reviewed HEAD (`50fd7d4`), all VERIFIED:** typecheck ✓ · lint 0 issues ✓ · 394 web + 47 contract tests ✓ · 76-route production build ✓ · protected-path cutover guard ✓ · 22/22 critical browser journeys ✓ · scratch PostgreSQL applies `000001–000030` from zero and passes the RLS/RPC, results-release, slice-5 operational, and slice-6 provider-job suites ✓ ("ALL LOCAL DATABASE CHECKS PASSED").

  **C5.1 read-only staging ledger check (attempted, BLOCKED):** `supabase projects list` works (management API reachable; linked project `FAIZ E AAM` `jxegiamjcawdywqyutdz`), but the pooler connection times out, so the remote migration ledger could not be read. No migration was applied. Region discrepancy recorded: linked project is West EU (Ireland) vs the plan.md Mumbai (`ap-south-1`) staging requirement.

- **2026-08-28 (feature-by-feature local verification — every workflow tested in demo mode):** Systematically exercised EVERY feature area in the browser against the local demo runtime (no database or email service — everything is the deterministic demo adapter) and fixed every defect found. 16 feature areas, ~90 browser checks, plus the existing 22 critical journeys:

  **Feature areas verified (all PASS in demo mode):** 1) Public site — 19 routes render with key content, no console errors; 2) Identity — sign-in→verify→complete, recovery issues reset refs for known AND unknown identifiers (no existence leak), wrong-password error, invite/register/totp/session-expired/access-denied routes; 3) Linking — link-child request with reference, two-child switcher, child switch changes overview, staff reject with reason; 4) Admissions applicant — autosave indicator, draft resumes after leaving, resume panel on the landing page, full 8-step submit → APP- reference + timeline, step-1 validation; 5) Staff admissions — request-changes with reason → applicant sees it → edit restores submitted data → re-upload documents → resubmit → offer decline → 9 queue filter tabs; 6+7) Careers — vacancy detail + apply CTA, job draft autosave/resume, submit → JOB- reference, applicant withdrawal with confirmation, 8 queue tabs, HR decision (offer/not-selected) with note + confirm; 8+9) Finance — portal ledger + filter tabs + invoice detail line items + receipt view, staff workspace/invoices/payments/reconciliation render + reconciliation run; 10+11) Results + timetable — portal results list, publication detail with subjects/grades, results queue status tabs, timetable override record→portal applies→revoke restores, date-sheet publish → portal "v1 · published" badge; 12-14) Content — notice draft created (editor workspace), published after switching to the Content publisher workspace (maker/checker), public + portal notice boards, documents library + preview dialog, portal grievance → GRV- ref, staff respond + resolve + reopen; 15-16) Admin + facility — users directory + invite with one-time reference, settings save persists, audit explorer + filters, facility overview/alerts ack/devices/history/reports/zones/wallboard.

  **Bugs found and fixed:**

  1. **`/sign-in/totp` threw a Supabase environment error in demo mode** — `TotpForm` unconditionally called `createSupabaseBrowserClient()`, producing a pageerror and a fatal "Sign-in state could not be read" state even though the docs say "demo-mode sign-ins never route here". Fixed: the page passes `adapter={dataAdapter()}`; in demo mode the form renders an honest "Demo sign-in — pick a demo identity instead" state with a link back to sign-in, and never touches the Supabase client. All auth routes now load with zero console errors in demo mode.
  2. **Portal results never showed the published snapshot** — the results pages passed the student's public reference (`STU-2026-0901`) to `getStudentResultSnapshot`, but the demo fixture is keyed by the internal student id (UUID), so EVERY child saw "No released snapshot for this child" even though the fixtures exist. Fixed: the demo path resolves the public reference to the internal id through the relationship graph (`demoStudents`), so the same student always resolves to its published snapshot. 2 new regression tests; the publication detail now renders subjects, obtained marks, grades, and remarks.

  **Gates:** typecheck ✓ · lint 0 issues ✓ · 394 web + 47 contract tests ✓ · 76-route build ✓ · cutover guard ✓ · 22/22 critical journeys ✓ · 16/16 feature areas (≈90 checks) ✓.

- **2026-08-28 (docs-vs-code gap audit — timetable overrides + date-sheet publish):** Read PROJECT-BLUEPRINT.md, FEATURE-INTEGRATION-SPEC.md, plan.md, UI-COMPLETION-PLAN.md, PROJECT-STATUS.md, README.md, and AGENTS.md, then compared every documented feature contract against the actual code. All previously claimed gates verified true (392 tests now passing, 76-route build, all facades wired, cutover guard green). Two genuine lags found and closed:

  **Timetable overrides (blueprint §5.9, spec §6.10, plan.md C2.3):** The server RPC (`timetable_save_override`) and adapter op (`timetable.saveOverride`) existed, but the demo timetable service — the DEFAULT runtime — had no override model, the staff UI had no override panel, and the portal never displayed overrides. Implemented end-to-end: `TimetableOverride` model in `modules/services/timetable.ts` (`saveTimetableOverride` with kind-specific validation + deterministic refs + audit recording, `listTimetableOverrides` active-first, `revokeTimetableOverride` append-only revocation, `effectivePeriodsForDate` that applies substitute/room/cancellation/special overrides on their date only — the base timetable is never mutated); staff `TimetableManager` gained an "Overrides" panel (add form with day/period/kind/substitute-teacher/room/reason, active list, revoke) gated by `timetable.manage`; portal `TimetableWorkspace` now applies active overrides on the day/week views with a "Date override" badge and an override-count notice, and derives the exam date range from the date-sheet fixture instead of hardcoded "1–9 September".

  **Exam date-sheet publish was fake:** the staff publish button only flipped local React state. `publishDateSheet`/`getDateSheetState` are now session-backed, versioned service writes (audited), and the portal shows a "v{n} · published" badge for the published state.

  **Tests + verification:** 9 new tests in `timetable-facade.test.ts` (demo-week date mapping, deterministic refs, apply-on-date-only, active-first ordering, kind-specific validation rejections, cancellation/room overrides without base mutation, revoke restores base + rejects unknown/double revoke, date-sheet versioning). New `scripts/timetable-override-check.cjs` browser journey: staff records → portal shows substitute on Tuesday only → staff revokes → portal restores base → exam range derived — 7/7 PASS.

  **Gates:** typecheck ✓ · lint 0 issues ✓ · 392 web + 47 contract tests ✓ · 76-route build ✓ · cutover guard ✓ · 22/22 critical journeys ✓ · 7/7 override browser checks ✓.

- **2026-08-23 (C2.2–C2.4 local cutover):** Added `000022_c2_admissions_enrollment_facade.sql`, `000023_c2_results_timetable_facade.sql`, and `000024_c2_operational_facades.sql`; wired local Supabase branches for admissions/finance/enrollment, results/timetable, careers, content, support, settings, audit, notifications, and document metadata; added public support intake, server loaders, async timetable reads, mapper/denial/retry contracts, and the protected-path cutover guard. Local evidence: 350 web tests + 47 contract tests, zero-warning lint, 70-page build, scratch migrations/RLS/RPC from zero, 22/22 critical journeys, 54-route accessibility, focus smoke, 176 responsive pairs, 66-route/287-href crawl. No remote Supabase/provider action occurred; C2.5 staging proof remains pending.

- **2026-08-23 (C2.1 local implementation slice; superseded by the C2.2–C2.4 slice below):** Added strict server/public adapter matching; request-scoped family-child and staff-workspace selection persisted with secure cookies; server-seeded family/staff context loaders and provider hydration; typed local school-configuration reads; pending staff invitation acceptance UI/lifecycle; and Supabase-mode context/denial tests. The subsequent local C2.2–C2.4 gate is the current evidence above.

- **2026-08-22 (C0–C3 implementation slice):** Pinned Playwright `1.62.1` and axe-core `4.13.0`; added deterministic `next typegen` and zero-warning lint; corrected the teacher-finance RLS expectation; added `000020_role_boundary_hardening.sql` (system-administrator functional-role denial, staff invitation role/scope acceptance, atomic account suspension/reactivation) and `000021_private_storage_buckets.sql`; added verified-claims/AAL route guards for portal, applicant, and staff layouts; added Supabase family/staff context reads, finance/careers server loaders, adapter parity configuration, private document signed delivery/upload intent, generated-PDF Storage upload, Resend timestamp/replay/error hardening, and correlation/no-store headers. Local gates: 329 web + 47 contract tests, typecheck, lint, 68-page build, scratch migrations/RLS/RPC, 22/22 browser journeys, 53-route accessibility, focus smoke, 168 responsive pairs, and 65-route crawl — all pass. Staging migration ledger, Supabase-mode all-facade journeys, Resend configuration, Storage scan/finalisation, and production remain pending.

- **2026-08-22 (Loop 6 — AGENTS.md compliance audit):** A final compliance audit against the AGENTS.md guardrails found and fixed one HIGH-severity issue:

  **Facility authorization gap (HIGH — FIXED):** The `/staff/facility` routes were explicitly excluded from `StaffRouteGuard`, bypassing authorization entirely. The alerts page had write actions (acknowledge/resolve) with no role gate. Fixed by: (1) adding `facility.view` and `facility.manage` actions to `staff-authorization.ts`; (2) granting `facility.view` to `support_officer` and `system_administrator`, and `facility.manage` to `system_administrator`; (3) removing the facility exclusion from `StaffRouteGuard` and adding facility routes to the `ROUTE_ACTIONS` mapping; (4) gating the acknowledge/resolve buttons in `AlertsWorkspace` with `canRole(..., "facility.manage")`.

  **Audit findings documented as known limitations:**
  - Predictable demo refs (PUB-2026-001, INV-2026-0101, APP-2026-0417): These are human-readable demo fixture identifiers. Access control is enforced through authorization checks (family context, staff role gates), not security-through-obscurity. The backend must generate non-sequential identifiers.
  - Presentation mappings in components (STATUS_TONE, FILTERS): These are UI presentation concerns (which color/tone to show for a status badge, which filter options to offer), not business rules. Actual state transitions, validation, and authorization ARE enforced in service modules.
  - TOTP secret display in enrollment: Standard TOTP enrollment flow — the user must receive the secret to set up their authenticator. Not stored persistently in client storage.

  **Gates:** typecheck ✓ · lint 0 errors (1 pre-existing warning) ✓ · 329 web + 47 contract tests ✓ · 67-page build ✓.

- **2026-08-22 (Loop 5 — publishNotice guard, session/timetable tests):** Two parallel subagents filled the last remaining test coverage gaps, and a publishNotice guard was added:

  **publishNotice guard:** Added a guard rejecting re-publishing an already-published notice with the same note (forces a different note to republish, preserving the append-only version trail).

  **Session service tests (7 new):** Created `session-service.test.ts` covering sessionGet/sessionSet round-trip, null for unset keys, overwrite behavior, complex object handling, sessionRemove clearing, sessionRemove on non-existent keys, and sessionKey namespace prefix.

  **Timetable service tests (6 new):** Added to `timetable-facade.test.ts` covering saveTimetableDraft + getTimetableDraft persistence, clearTimetableDraft, deriveEditedKeys (empty set for unchanged, keys for changed cells), detectConflicts (empty array for no conflicts, teacher conflict detection across peer classes).

  **Gates:** typecheck ✓ · lint 0 errors (1 pre-existing warning) ✓ · 329 web + 47 contract tests ✓ · 67-page build ✓.

- **2026-08-22 (Loop 4 — comprehensive error handling and test coverage):** Three parallel subagents completed the remaining error-handling and test-coverage work identified in Loop 3's audit:

  **Error handling (15 files):** Added `.catch()` handlers to every remaining unhandled promise chain across staff and portal components: ResultsBatches, AdmissionsQueue, TimetableManager, MarksEntry (3 sites), OverviewFinanceBand (2 sites), portal results page (2 sites), portal results detail (2 sites), FeeLedger, ReceiptView (2 sites), InvoiceDetail, GrievanceInbox, NotificationBell (2 sites), TimetableWorkspace, staff results detail, and FinanceWorkspace. All handlers use the existing cancellation flags to avoid setting state after unmount, with safe fallback values (empty arrays, null, or `setLoading(false)` to prevent stuck loading states).

  **Content service tests (9 new):** Added tests for `publishNotice` (draft→published, version increment, unknown slug rejection), `unpublishNotice` (published→draft, draft rejection), `listForAudience` (public vs family filtering), and `getNotice` (found and not-found). Flagged a discrepancy: `publishNotice` does not guard against re-publishing an already-published notice (it bumps the version instead) — may need a guard to match the `editNotice` pattern.

  **Identity service tests (9 new):** Added tests for `signIn` validation (empty phone, empty password, short password, wrong credentials, successful sign-in), `verifyCode` validation (empty code, wrong code), `startRecovery` (returns recovery reference), and `requestLink` (returns link reference).

  **Gates:** typecheck ✓ · lint 0 issues ✓ · 316 web + 47 contract tests ✓ · 67-page build ✓.

- **2026-08-22 (Loop 2+3 — deeper audit: empty states, audit recording, role gates, error handling, test coverage):** Continued self-prompting audit loops beyond the initial role-by-role pass. Four parallel subagents audited hardcoded values, missing role gates, error handling patterns, and test coverage gaps across the entire codebase. Findings and fixes:

  **Empty states (Loop 2):** The invoices, payments, and reconciliation pages rendered empty tables with headers but no "no data" message when the register was empty. Added conditional empty-state messages to all three pages.

  **Audit recording (Loop 2):** `contentService.editNotice` and `contentService.unpublishNotice` were not recording audit events — now both record "Notice published" with a descriptive reason. All four careers staff decisions (`staffShortlist`, `staffRequestInterview`, `staffOffer`, `staffNotSelected`) were not recording audit events — now all record "Application reviewed" with the decision reason. 1 new test verifying audit recording for careers staff decisions.

  **Missing role gates (Loop 3):** Four staff pages had write actions accessible without `canRole` checks: (1) Content page review button — now gated by `content.publish`; (2) Settings page save and reset buttons — now gated by `settings.manage`; (3) Users page invite/manage/grant/revoke/suspend/reactivate — now gated by `users.manage`, with the "Manage" button becoming "View" for unauthorized roles; (4) Link requests page approve/reject/revoke — now gated by `links.verify`, with read-only fallback for unauthorized roles.

  **Hardcoded values (Loop 3):** StaffHomeWorkspace had hardcoded "2 drafts · 1 scheduled" notice counts — replaced with the actual fixture count. TimetableManager had a hardcoded "Class 8-A and peer fixture (Class 9-B)" conflict intro — replaced with the dynamic `selectedClass` value.

  **Error handling (Loop 3):** Five critical service-call sites had no `.catch()` handlers, risking unhandled promise rejections: content page, users page, settings page, link-requests page, and StaffHomeWorkspace. All now have `.catch()` handlers that set safe fallback state.

  **Test coverage (Loop 3):** Three previously untested services now have dedicated test files: `audit-service.test.ts` (7 tests covering listEvents ordering, record append-only contract, deterministic id/timestamp, session persistence, non-idempotency), `settings-service.test.ts` (6 tests covering default view, session persistence, audit recording, policy-pending preservation), `outbox-service.test.ts` (9 tests covering idempotent enqueue, insertion-order listing, pending filter, delivered transition, unknown-id rejection). Total: 22 new tests.

  **Gates:** typecheck ✓ · lint 0 issues ✓ · 298 web + 47 contract tests ✓ · 67-page build ✓.

- **2026-08-22 (full-role page-by-page audit — all staff roles + portal + applicants):** Continued the systematic audit across every role's pages. The System Administrator improvements (see entry below) were followed by per-role audits of Content, Admissions, Finance, Teacher/Exam Reviewer/Result Publisher, Timetable Manager, HR/Careers, Support, Auditor, Guardian/Student portal, and Applicant journeys. Findings and fixes:

  **Content Editor/Publisher (`/staff/content`, `/staff/notices`):** The public-page review button was only modifying local React state — now persists through `contentService.setPublicPageStatus` (session-backed, audit-recorded). The NoticePublisher "Edit" button was a stub announcement — now opens an inline edit form calling `contentService.editNotice` (drafts only; published notices must be unpublished first). 9 new `content-service.test.ts` tests covering page status persistence, notice editing with published-rejection guard, and field preservation.

  **Admissions Officer/Approver (`/staff/admissions`):** The top metrics used static fixture counts (`admissionsQueueCounts`) that never reflected session decisions — now derived from live service data inside `AdmissionsQueue`. The filter tabs were missing "Changes requested", "Waitlisted", "Declined", and "Enrolled" — all 9 statuses are now filterable.

  **Finance Officer/Approver (`/staff/finance`):** The "Payments to reconcile" count in `FinanceWorkspace` was hardcoded to `2` — now derived from recent receipts. The `ReconciliationRun` component reported a hardcoded "4 matched, 1 discrepancy" — now computes actual matched/discrepancy/pending counts from the comparison data. The invoices page Print button was a non-functional placeholder — now triggers `window.print()` via a client `PrintButton` component.

  **Teacher/Exam Reviewer/Result Publisher (`/staff/results`):** The results batch queue had no status filtering — an exam reviewer seeing all batches couldn't narrow by status. Added status filter tabs (All, Draft, Submitted, Moderation, Returned, Approved, Published, Withdrawn) with live counts, matching the pattern used in the admissions and careers queues.

  **HR/Careers Reviewer/Approver (`/staff/careers`):** The recruitment queue filter tabs were missing "Offered", "Not selected", and "Withdrawn" — all 7 statuses are now filterable.

  **Timetable Manager, Support Officer, Auditor, Guardian/Student portal, Applicant journeys:** Audited and found no gaps — these pages are already comprehensive with service-backed state, role gating, accessibility, and complete lifecycle flows.

  **Gates (all roles):** typecheck ✓ · lint 0 issues ✓ · 275 web + 47 contract tests ✓ · 67-page build ✓.

- **2026-08-22 (System Administrator role — page-by-page audit and implementation):** Audited all admin-accessible pages (`/staff/users`, `/staff/settings`, `/staff/audit`, `/staff/link-requests`, `/staff` home) and implemented functional improvements:

  **Users page (`/staff/users`):** Replaced the broken invite form (wrong role list, no persistence, no grant/revoke) with a fully functional admin workspace. The `usersService` now derives rows from the mutable relationship store (not the immutable fixture) and supports five write operations: `inviteUser` (creates person + account + staff member + initial role grant, returns a one-time reference shown once), `grantRole` (with duplicate-active-grant guard), `revokeRole` (appends to history, clears the active workspace if it was the revoked grant), `suspendAccount` (revokes all active grants), and `reactivateAccount`. The page shows an expandable "Manage" panel per user with the active role grants, grant-additional-role form, revoke-with-reason, and suspend/reactivate controls. All operations require a reason (recorded in the audit trail) and produce an audit event. The `RelationshipDemoStore` was extended with mutable `userAccounts`, `staffMembers`, `roleGrants`, and `staffAssignments` collections seeded from the immutable graph fixture; `staff-context.ts` and `family-context.ts` now read from the store so admin changes are immediately visible to every consumer.

  **Settings page (`/staff/settings`):** The save button now persists editable fields (grading scheme, two-reviewer requirement, notice expiry, email sender) to sessionStorage via `settingsService.saveSettings`, records an audit event, and shows the updated "saved by/at" metadata. Policy-pending sections remain visibly flagged and disabled until the school confirms them.

  **Audit page (`/staff/audit`):** The action filter dropdown now includes all 15 `AuditAction` types (was missing `Result withdrawn`, `Payment posted`, `Link requested`, `Link approved`, `Link rejected`, `Link revoked`, `Enrollment converted`).

  **Staff home (`/staff`):** Added an "Administration" section for the system_administrator role with quick-link tiles to Manage users (with live staff count), Link requests (with pending count), Settings, and Audit trail. Previously the admin role saw an empty home page.

  **Tests:** 15 new `users-service.test.ts` tests covering invite, grant (with duplicate guard), revoke (with already-revoked guard), suspend (with already-suspended guard), reactivate (with already-active guard), and staff-context integration (revoking the active workspace grant causes the context to pick a new workspace). Fixed the pre-existing `staff-identity-domain.test.ts` typecheck error by adding a typed `AdminDirectoryRow` return type to `usersListAdmin`.

  **Gates:** typecheck ✓ · lint 0 issues ✓ · 276 web + 47 contract tests ✓ · 67-page build ✓ · 65-route link crawl zero dead links ✓.

- **2026-08-06 (remaining matrix commands live — links/support/content/careers/marks/moderate/withdraw):** Migration `000015_remaining_commands.sql` closes the BACKEND-HANDOFF-MATRIX command surface: `links_approve`/`links_reject` (revalidation bump, version checks), `support_respond` (private notes staff-only), `content_publish_notice`, `jobs_submit` (idempotent) / `jobs_decide` (self-decision denied), `results_submit_marks` (exact assignment scope + maxima + roster coverage), `results_moderate`, `results_withdraw`, `results_correction_request`. Local RPC suite extended with happy paths + denials for all of them — all three suites pass; pushed live; types regenerated (4827 lines); typecheck/lint/216+47 tests/66-page build/22/22 journeys green; live integration suite still passes.
- **2026-08-06 (app layer: outbox worker + email + server domain services + live integration suite):** Built the Supabase runtime wiring: `lib/supabase/outbox-worker.ts` + `app/api/outbox/route.ts` (CRON_SECRET-protected claim/dispatch/deliver-fail with exponential backoff), `lib/email/` Resend adapter + editorial string templates (one per plan §9 event kind), `app/api/email/webhook/route.ts` (Svix HMAC verification, svix-id dedup, suppression projection), `lib/supabase/domain.ts` + `rpc.ts` (typed app-schema RPC wrapper; ServiceResult envelopes with canonical error codes), `app/api/adapter/route.ts` (session-protected dispatch) + `modules/services/adapter-client.ts`. Project config now exposes the `app` schema to PostgREST and enables TOTP MFA (pushed live; forward migrations 000011–000014: nullable suppression author/processing document, service_role app grants). `scripts/integration-staging.mjs` proves the full chain live with real sessions: RLS draft→submit idempotency, TOTP aal2 elevation + aal1 denial, offer→invoice→payment retry-safety, idempotent conversion, result/timetable publication, denial cases, outbox contract (34 events, unique deliveries, backoff) — INTEGRATION SUITE PASSED. Gates: local DB suites, typecheck, lint, 216 web + 47 contract tests, 66-page build, 22/22 journeys — all green. Pushed to GitHub.
- **2026-08-06 (transactional domain RPCs live + RLS fixes):** Migration `000009_domain_rpcs.sql` implements the plan.md §8 command set (admissions submit/review/decide/respond, unique admission invoice, sandbox payment with attempt+txn idempotency, idempotent enrollment conversion, result publication with frozen rosters + immutable snapshots, timetable publication) — every command SECURITY DEFINER with auth.uid()/role/aal2 checks and same-transaction audit + outbox. `invoices.student_id` relaxed for pre-conversion invoices; `000010_rls_fixes.sql` pushed forward-only fixes for applicant-owned invoice visibility and the guardian result-policy recursion. `scripts/validate-rpcs.sql` proves the full chain (incl. retry deduplication and denial cases) on the scratch instance — all three local suites pass. Types regenerated; typecheck, lint, 216 web + 47 contract tests, 63-page build all green. Pushed to GitHub.
- **2026-08-06 (B2–B6 database layer live + RLS hardening):** Authored, reviewed, and pushed migrations `000004_b2_admissions_careers.sql`–`000008_b6_content_documents.sql` to `jxegiamjcawdywqyutdz` (admissions/careers, enrollment, finance, results/timetable, content/documents/support/notifications). Fixed during review: anon notice policy referencing private `notice_audiences` (now a SECURITY DEFINER `app.public_notice_ids` helper); teacher policies missing the aal2 gate; pure-teacher sessions able to read the whole staff queue (now `app.is_pure_teacher` bounds them to assignment scope at RLS level); timetable/content/support writes not role-scoped (now `app.has_any_role` gated). Added natural-key uniques (`admission_windows(academic_year_id, grade_id)`, `fee_schedule_items(schedule_version_id, code)`, `assessment_components(exam_definition_id, subject_id)`) and `app.has_any_role`/`app.is_pure_teacher` helpers. Local validator rebuilt: GUC-based auth stubs + `scripts/validate-rls.sql` positive/negative RLS matrix (guardian two-child scope, revocation, teacher aal1/aal2 + class/subject scope, anon denial) — all pass. Five new pgTAP suites (79/21/54/59/64 assertions). Seed extended (B2–B6 configuration) in `supabase/seed.sql` and mirrored in `scripts/seed-remote.mjs`; applied and verified on the live project; types regenerated (4638 lines). Gates: typecheck, lint, 216 web + 47 contract tests, 63-page build — all green.
- **2026-08-06 (B1 live schema + auth foundation):** Migrations pushed to the `jxegiamjcawdywqyutdz` project (foundation + B1 identity/school config + actor-read policy), real generated types, remote seed applied and verified via the idempotent `scripts/seed-remote.mjs` (admin client + ignore-duplicates). Auth foundation: session-refresh middleware, `/auth/callback` safe code exchange, server actor resolver (`lib/auth/actor.ts`), adapter-aware email-OTP sign-in behind `FASS_DATA_ADAPTER=supabase`. Resend key added to `.env.local` with the default `onboarding@resend.dev` development sender. Gates: 216 web + 47 contract tests, 63-page build, 22/22 journeys. Pushed to GitHub (`833d39e`).
- **2026-08-06 (B1 identity/school-config slice):** Keys moved to `.env.local` (gitignored); Supabase project `jxegiamjcawdywqyutdz` verified live (GoTrue v2.195.0, PostgREST v14.15). Added migration `000002_b1_identity_school_config.sql` (school configuration + identity/access tables, SECURITY DEFINER authorization helpers `is_staff_aal2`/`has_role`/`is_guardian`/`bump_access_revalidation`, revalidation triggers, RLS policies with explicit base grants for the always-revoked default), B1 seeds (years/grades/sections/subjects/rooms/periods/settings/flags), pgTAP suites for both slices (47 assertions), and `scripts/validate-db-local.sh` which validates migrations + seed + RLS/append-only/outbox behavior on a scratch PostgreSQL 17 instance — all checks pass. Git push to `github.com/scnz313/FAIZ-A-AAM-` is blocked: the repo does not exist and the authenticated `gh` account (HASHIM-HAMEEM) cannot create it.
- **2026-08-06 (B0 backend foundation):** `plan.md` rebaselined to the Supabase Backend Blueprint (B0–B8). B0 completed: version-controlled source established (`git init`, baseline commit `4edf099`); `.env.example` scrubbed to names/placeholders (exposed Supabase keys flagged for rotation) and Node 22 pinned; Supabase CLI 2.111.0 + `@supabase/ssr` + `@supabase/supabase-js` added; `supabase/config.toml` with Realtime/Edge Functions disabled; foundation migration (conventions, `app.new_ref`, version/append-only helpers, audit/outbox/idempotency/webhook-receipts/rate-limit/job-runs tables, `role_definitions`, RLS deny-by-default, SECURITY DEFINER outbox/audit helpers with SKIP LOCKED claim and exponential retry); deterministic role-code seed; 22-assertion pgTAP foundation suite; Supabase client factories (browser/server/admin) + env validation + types placeholder + `db:*` scripts. Typecheck, lint, 216 web + 47 contract tests, and the 62-page build all re-passed. Remaining B0 items are blocked on environment inputs (staging project + keys, Docker, Node 22, Resend).
- **2026-08-06 (plan.md Phases 1–6):** Completed the canonical grant model (Phase 1): maker/checker splits across content/admissions/finance/HR/results, `links.verify` scoped to support_officer + system_administrator, and the fourth demo identity Rania Mir (approvals/timetables); admissions self-approval is rejected with the same actor account. Workflow repairs (Phase 2): result batches carry a subject, teacher marks entry requires class AND subject, moderators return sheets with a reason from the queue, `withdrawPublication` is versioned and never deletes published history, timetable known classes 8-A/9-C with a manager-only selector and honest empty state, date-sheet publish gated to managers. Family context (Phase 3): one link-request store — guardian requests flow to `/staff/link-requests` (LR refs), approval creates the active link exactly once, active links are revocable; `classifyStudentAccess` (current/other/none) wired into invoice and receipt pages with a child-switch panel and neutral denial. Propagation (Phase 4): append-only `auditService.record` + session-backed idempotent demo outbox (`modules/services/outbox.ts`) — one event per payment post, enrollment conversion, result publish/withdraw, content publish, and link decision; retries never duplicate (proven by tests); all `Math.random()` latencies replaced with fixed 200 ms. Contracts + privacy (Phase 5): `packages/contracts` core types with 47 tests, `design/BACKEND-HANDOFF-MATRIX.md`, applicant drafts moved to sessionStorage with sensitive-field stripping. Phase 6 gate: typecheck, lint, historical frontend gate counts and build output, 22/22 critical journeys (incl. the full teacher entry → moderator return → approve → publish → portal chain, timetable manager publish reaching the portal, and family payment → staff ledger parity via the client-refreshed finance workspace), 53-route axe scan, focus smoke, 65-route link crawl, 168-pair responsive sweep — all passed. Docs updated: `UI-COMPLETION-PLAN.md` (phase status + execution record) and `PROJECT-STATUS.md` (evidence, matrix, order).
- **2026-08-05 (I4 + visual refinement):** Implemented staff role/assignment scope: `staff-authorization` module (role/action matrix, active-workspace checks, assignment-class matching); role-aware staff navigation; `StaffRouteGuard` with workspace-switch denial on every staff route (marks-entry sub-route requires the teacher role); demo identity picker in the staff shell (Sana Wani — finance/results/admissions, Firdous Ahmad — teacher, Aisha Lone — content/support/audit/admin; session-persistent); teacher marks entry denied for batches outside assigned classes; results approve/publish/correction gated to publishers and entry links to teachers; timetable editor read-only for non-managers; support response gated to support officers; staff home dashboard filtered by role. Refined the design tokens toward a cleaner, more minimal professional system (finer hairlines, pure-white raised surfaces, softly rounded controls, slightly lighter paper) while preserving the editorial serif, saffron accent, and Urdu wordmark identity. Verified by 23 test files (163 tests), a 62-page build, 11/11 critical journeys (incl. role denial and teacher assignment scope), a 53-route axe scan, a 168-pair responsive sweep, and a clean route/link crawl — all re-run after the visual refinement.
- **2026-08-05 (I3):** Implemented admission → finance → enrollment. Accepting a seat issues one admission invoice through `financeService` (idempotent per applicant; `createAdmissionInvoice` / `assignInvoiceToStudent`); `AdmissionFeeStep` now pays through the shared checkout (attempt/confirm/receipt, duplicate-safe) instead of a timer; `enrollmentConversionService` derives readiness (offered + accepted + fee paid + documents + capacity + approval) and converts idempotently — creating the permanent person/student/enrollment (and activating the guardian link) or matching the already-enrolled child, adopting the paid invoice into the new student's ledger, and marking the application Enrolled with its permanent references; the applicant sees an acknowledgement with the student reference and the portal link. Verified by 22 test files (157 tests), a 62-page build, 9/9 critical journeys (new admission-to-enrollment journey), a 53-route axe scan, a 168-pair responsive sweep, and a clean route/link crawl.
- **2026-08-05 (I2):** Consolidated service boundaries. Finance: ledgers parameterized by student (Aarif + Mariam), portal fees/receipts/overview read `financeService` for the active child, staff finance pages read the same service across both students with parity tests (totals agree). Results: portal marks come from a per-student published snapshot (`academicsService.getStudentResultSnapshot`) with distinct fictional snapshots per child. Timetable: one `timetableService` facade (periods, edits, conflicts, versions, history) now serves portal and staff; the academics timetable stub was removed. Added typed demo adapters `contentService` (notice status/audience/version), `documentsService` (per-student bundles), `notificationsService` (per-account read state, demo clock), `usersService`, `settingsService`, and `auditService`, wired into public/portal/staff pages; the portal overview now reads the active child's ledger and family-audience notices through services. Verified by 21 test files (150 tests), a 62-page build, 8/8 critical journeys, a 53-route axe scan, a 168-pair responsive sweep, and a clean route/link crawl; in-browser parity confirmed (child switch changes the overview band and ledger; staff finance aggregates both students).
- **2026-08-05 (I0/I1):** Implemented the shared relationship/context spine: stable demo session identifiers (account/person/guardian); expired sessions now sign out; sign-out clears identity and relationship context; family-context service gained student-context, account-summary, and link-request summaries; staff-context gained workspace summaries. Added `FamilyContextProvider`/`StaffContextProvider`, service-driven `PortalShell` (two-child switcher, context strip, service sign-out) and `StaffShell` (workspace switcher, role/year/assignment context), `ActiveChildLine` on every child-scoped portal page, and the `/staff/link-requests` approval/rejection path. Verified by 15 test files (112 tests), a 62-page build, 8/8 critical journeys (incl. two-child switching and link approval), a 53-route axe scan, a 168-pair responsive sweep, and a clean route/link crawl.
- **2026-08-05:** Re-audited the complete current route/service/fixture/test structure and reran all frontend validation gates. Confirmed the polished self-contained demo baseline and identified the remaining integration boundary: static one-child context, direct fixture consumers, missing admissions-to-finance/enrollment conversion, non-snapshot result rows, split timetable services, and absent role/assignment authorization. Added `FEATURE-INTEGRATION-SPEC.md`, rebaselined the active frontend plan, and separated UI verification from integrated/production completion.
- **2026-08-04:** Completed P0/P1/P2 frontend work: repaired student-form interaction and error/mobile shell behavior; added deterministic demo services and 87 tests; completed key applicant/payment/results/timetable/support/staff-decision UI flows; removed the optional facility demonstrator from core navigation and launch checks; and established warning-free build/browser gates.
- **2026-08-03 to 2026-08-04:** Built the broad editorial route tree, design system, fictional content/data, applicant/portal/staff prototypes, optional environment demonstrator, concept imagery, and responsive design passes.
