# Backend Handoff Matrix — Faiz E Aam School Platform

Serves the completed frontend/local-backend handoff and the active `plan.md` C5
staging gate: every service operation the UI performs is listed with its owning
service, actor/scope requirements, input/output schemas, validation, state
transition, idempotency key, expected version, audit event, outbox event, and
recovery behavior. A domain is complete only after its server loader or
`/api/adapter` branch satisfies this matrix; demo adapters remain available for
isolated design/tests but are never a fallback in Supabase mode.

Schema sources: `packages/contracts/src/core.ts` and `packages/contracts/src/relationships.ts`.

## Contract inventory

| Contract | Export | Shape |
|---|---|---|
| Actor context | `actorContextSchema` / `ActorContext` | `accountId` (uuid), `grantId` (uuid), `role` (string), `scopes: { academicYearIds, gradeSectionIds, subjectIds }`, `correlationId` |
| Record scope | `recordScopeSchema` / `RecordScope` | optional `academicYearId`, `gradeSectionId`, `subjectId`, `studentId`, `enrollmentId` (all uuid) |
| Command meta | `commandMetaSchema` / `CommandMeta` | `idempotencyKey` (string), `expectedVersion`? (int ≥ 0) |
| Money | `moneySchema` / `Money` | `amountPaise` (int ≥ 0), `currency: "INR"` |
| Public reference | `publicReferenceSchema` / `PublicReference` | non-empty string (`APP-2026-0424`, `INV-2026-0103`); display/search only, never authorization |
| Service result | `serviceResultSchema<T>` / `ServiceResult<T>` | success/failure envelope with `httpStatus`, `correlationRef`, `retryable`, and optional authoritative `currentVersion` / `currentState` |
| Service error | `serviceErrorSchema` / `ServiceError` | `code` (`ErrorCode`), `message`, `field`?, `retryable`? |
| Error codes | `errorCodeSchema` / `ErrorCode` | `unauthenticated`, `forbidden`, `not-found`, `validation`, `stale-version`, `conflict`, `duplicate`, `retryable`, `unavailable` |
| Domain event | `domainEventSchema` / `DomainEvent` | `id` (uuid), `type`, `correlationId`, `atIso`, `payload` (record) |
| Outbox record | `outboxRecordSchema` / `OutboxRecord` | durable pending/processing/delivered/failed state, attempts, next-attempt time, last error, and correlation evidence |
| Audit event | `auditEventSchema` / `AuditEvent` | `id`, `atIso`, `actorAccountId`, `action`, `targetKind`, `targetRef`, `reason`?, `beforeVersion`?, `afterVersion`?, `correlationId`? |
| Paged result | `pagedResultSchema<T>` / `PagedResult<T>` | `items: T[]`, `page` (≥ 1), `pageSize` (≥ 1), `total` (≥ 0) |

Cross-cutting rules (from `FEATURE-INTEGRATION-SPEC.md` §4–5):

- Every protected write takes `ActorContext` + `CommandMeta`; the server resolves the
  target record by reference, re-authorizes against the record, and returns the same
  `not-found` result for unknown and unauthorized targets where existence would leak.
- Writes are transactional where §5.2 lists them; outbox delivery (§5.3) may complete
  after the transaction and must never roll back the domain record.
- Mutable operational records carry an integer version; writes submit the last-seen
  version and a mismatch returns `stale-version` with the safe current state — never a
  silent overwrite. Ledger entries, submitted versions, publications, and audit rows are
  append-only; corrections add new entries/versions with reason and author.
- All timestamps are UTC ISO-8601 (`atIso`); presentation converts to `Asia/Kolkata`.
- `retryable` errors may be retried with the same `idempotencyKey`; the result is
  identical on retry. `stale-version` and `conflict` require user review, not retry.

## Current cutover checkpoint

This matrix is intentionally split between the contract inventory below and the
implementation state in `PROJECT-STATUS.md`:

- **C0–C4 locally verified:** migrations `000001–000030`, RLS/RPC denial tests,
  all retained domain facades, Storage/scanner/PDF jobs, Resend/Svix/outbox
  contracts, cron, health, and the protected-path cutover guard pass locally.
- **Live status:** migrations `000001–000015` were historically verified on the
  linked project; `000016–000030` are local-only until the staging ledger is
  re-read. No global Supabase switch is authorised yet.

### C5 activation ownership

| Boundary | Configuration owner | Application evidence required before global staging switch |
|---|---|---|
| Supabase project and migrations | Project owner + migration operator | Project identity, ledger before/after, dry-run/apply output, generated types, RLS/RPC tests, advisors |
| Auth | Identity administrator | Redirect allowlist, OTP/recovery/invite/TOTP journeys, AAL and revocation denials |
| Storage/scanner/PDF | Storage/security owner | Private policies, scan states, checksum/type/size evidence, signed expiry, generation retry |
| Resend/outbox/cron | Messaging/domain owner | Sender/domain, SMTP/API/webhook/cron, retry/suppression, safe logs, worker freshness |
| Finance | School finance owner | Sandbox parity, maker-checker adjustments/refunds, reconciliation; written decision before real gateway |
| Vercel preview | Deployment owner | Reviewed commit, staging-only env, Node 22 build, health, post-deploy gates, no secret exposure |
| Production | School owner + release owner | Separate project/build, approved data/policies, restore readiness, release and rollback record |

## Identity, account, and context operations

These contracts are implemented locally. C5 must prove that they resolve the
authenticated actor server-side with real staging sessions, preserve selected
context, and invalidate already-loaded protected data after revocation.

| Operation | Status | Required contract and denial coverage |
|---|---|---|
| `context.family` | Locally verified; staging pending | Read active guardian links, child/enrollment/year/capabilities, pending link state, and active-child selection; deny unauthenticated, wrong guardian, revoked link, and unlinked child; return only the authorised family projection. |
| `context.staff` | Locally verified; staging pending | Read active account, staff member, role grants, scopes, assignments, selected workspace, and AAL requirement; deny `aal1`, revoked grant, ended assignment, and wrong workspace. |
| `users.list` | Locally verified; staging pending | Return scoped staff directory without secrets or invite tokens; system administrator only; preserve neutral not-found/forbidden behavior. |
| `users.invites.create` | Locally verified; provider pending | Store intended role, scope, inviter, reason, and provider invitation reference; only system administrator may invite staff; retry is idempotent and delivery failure does not create a second invite. |
| `users.invites.accept` | Locally verified; staging pending | Verify provider-bound Auth subject/contact, expiry, reuse, revocation, wrong contact, and duplicate-account cases; transactionally link person/account/staff/grant/assignment/audit/outbox rows. |
| `accounts.suspend` / `accounts.reactivate` | Locally verified | Suspend atomically and revalidate sessions; reactivation does not re-grant roles automatically; every later grant is an explicit audited command. |
| `documents.upload-intent` / `documents.download` | Provider-ready locally; staging pending | Resolve owning application/student/assignment/module grant before issuing intent or signed URL; opaque object keys, server stat/checksum/type/size, scan state, short expiry, wrong-scope denial, and no public bucket access. |

## Admissions — owning service: **admissions** (one source of truth: application state and submitted versions)

Actors resolved from `ActorContext.grantId` + `scopes`; the application reference resolves
to an internal `applicationId` before any check. Consumers: applicant status, staff queue,
notifications, enrollment conversion.

| Operation | Actor / scope | Input → Output | Validation | State transition | Idempotency key / expected version | Audit event | Outbox event | Recovery |
|---|---|---|---|---|---|---|---|---|
| Submit application | Applicant account; one open application per applicant + session + grade | `ApplicationRecord` + `CommandMeta` → `ServiceResult<{ ref: PublicReference; application }>` | Every section valid (schema + consent); no duplicate open application; session/grade open and within calendar | `Draft` → `Submitted` (append-only first version) | Key `application:{accountId}:{session}:{grade}`; retry returns the same `ref`; duplicate open application → `duplicate` | `application.submitted` | `application.submitted` (applicant status, staff queue, notifications) | Retry with same key is a no-op returning the issued `ref`; validation errors carry `field` |
| Respond to offer | Applicant account holding the application | `{ decision: "accepted" \| "declined" }` + `CommandMeta` → `ServiceResult<{ application }>` | Application must be `Offered`; within offer-expiry window; not already responded | `Offered` → `Accepted` / `Declined` | Key `offer:{ref}:respond`; expectedVersion = application version | `application.offer.responded` (reason = decision) | `application.offer.responded` (finance invoice creation trigger on accept, notifications) | Retry-safe; stale/expired offer → `conflict` with current state; acceptance issues exactly one admission invoice (§ finance) |
| Decide (staff) | `admissions_officer` / `admissions_approver` scoped to the academic year; approver needed where policy requires | `{ decision: "under_review" \| "approved" \| "changes_requested" \| "rejected", reason }` + `CommandMeta` → `ServiceResult<{ application }>` | Allowed transition per decision machine; reason required for non-forward decisions; staff cannot decide their own application | `Submitted` → `Under review` → `Approved` / `Changes requested` / `Rejected` | Key `application:{ref}:decision:{decisionToken}`; expectedVersion = application version | `application.decision` (before/after versions, reason) | `application.decision` (applicant timeline, notifications) | Two staff acting concurrently → `stale-version` with current record; applicant re-submission after `changes_requested` is a new submitted version (append-only) |

## Enrollment — owning service: **student records** (student identity, enrollment placement, guardian links)

| Operation | Actor / scope | Input → Output | Validation | State transition | Idempotency key / expected version | Audit event | Outbox event | Recovery |
|---|---|---|---|---|---|---|---|---|
| Convert application | `admissions_approver` (final approval) | `{ applicationRef }` + `CommandMeta` → `ServiceResult<{ studentRef, enrollmentRef, linkRefs }>` | Readiness gates: `Offered` + `Accepted` + admission fee paid + required documents + capacity + final approval; application not already converted | `Application` → `Enrolled`; creates/matches one `Student`, one `Enrollment`, activates approved guardian links; adoption of the paid admission invoice into the student ledger — all one transaction | Key `application:{ref}:convert` (create-or-match; retry returns the same references, never duplicates) | `enrollment.converted` (source refs, before/after versions) | `enrollment.converted` (portal context, finance ledger adoption, notifications, invitation delivery) | Transaction rolls back as a whole on any failure; retry matches existing records; already-enrolled applicant returns the existing references (no duplicate student) |

## Finance — owning service: **finance ledger** (invoice balance and allocations; the gateway outcome is not itself the ledger)

| Operation | Actor / scope | Input → Output | Validation | State transition | Idempotency key / expected version | Audit event | Outbox event | Recovery |
|---|---|---|---|---|---|---|---|---|
| Create invoice (admission) | Admissions flow on behalf of `finance_officer`; invoice scoped to applicant/student | `{ kind: "admission", studentId?, applicationRef }` + `CommandMeta` → `ServiceResult<{ invoice }>` | Fee policy for the session/grade; exactly one admission invoice per accepted applicant; `Money.amountPaise > 0` | `Ledger` new entry: invoice `Issued` | Key `application:{ref}:admission-invoice`; one invoice per applicant — retry returns the same `INV-` ref | `invoice.created` | `invoice.created` (applicant/portal views, fee overview) | Retry-safe (same invoice ref); duplicate issuance → `duplicate` |
| Payment attempt | Payer (applicant/guardian) with access to the invoice | `{ invoiceRef }` + `CommandMeta` → `ServiceResult<{ attempt }>` | Invoice `Issued`, not already paid, amount matches `Money` | Invoice `Issued` → attempt `Pending` → `Processing` (no ledger posting) | Key `payment:{invoiceRef}:attempt:{attemptToken}`; one live attempt per invoice | `payment.attempted` | none (attempt is not a domain fact) | Stale attempt after gateway timeout → `retryable`; user may retry the same token or start a new attempt |
| Confirm payment (verified posting) | Server-verified gateway callback (adapter, never client-supplied) | `{ gatewayTxnId, invoiceRef, amount }` → `ServiceResult<{ receipt }>` | Gateway signature/status verified; amount matches the invoice exactly; invoice not already paid | `Processing` → `Paid`; allocation + receipt-number reservation + outbox row in one transaction | Key `gateway:{gatewayTxnId}` — exactly-once posting; redirects never mark paid by themselves | `payment.posted` (receipt ref) | `payment.posted` (ledger projections, notifications, enrollment readiness, documents) | Duplicate callback returns the same receipt; amount mismatch → `conflict`, gateway dispute path; notification failure never rolls back the payment |
| Refund | `finance_officer` (+ `finance_approver` where configured), scoped to the ledger | `{ invoiceRef, Money, reason }` + `CommandMeta` → `ServiceResult<{ invoice }>` | Refundable balance ≥ amount; policy (waiver/refund rules) satisfied; reason required | `Paid` → `Refunded` via append-only adjustment entry (history preserved) | Key `invoice:{ref}:refund:{refundToken}`; expectedVersion = invoice version | `refund.posted` (reason, before/after amounts) | `refund.posted` (portal overview, staff finance, notifications) | Concurrent adjustment → `stale-version` with safe current state; retry with same token is a no-op |

## Results — owning service: **results** (published snapshot/version is the only source the portal renders)

| Operation | Actor / scope | Input → Output | Validation | State transition | Idempotency key / expected version | Audit event | Outbox event | Recovery |
|---|---|---|---|---|---|---|---|---|
| Submit marks | `teacher`; `scopes.gradeSectionIds` + `subjectIds` must contain the batch's class/subject | `{ batchRef, marks[] }` + `CommandMeta` → `ServiceResult<{ batch }>` | Marks within maxima; no submission after entry lock; every student in roster present | `Draft` → `Submitted` (entry locked) | Key `batch:{ref}:submit`; expectedVersion = batch version | `marks.submitted` | `marks.submitted` (moderator queue) | Wrong assignment → `forbidden`; stale roster/version → `stale-version`; resubmission after return is a new version |
| Approve (moderate) | `exam_reviewer`, same scope as the batch | `{ batchRef, outcome: "approved" \| "returned", note? }` + `CommandMeta` → `ServiceResult<{ batch }>` | Batch `Submitted`; outcome reason for return | `Submitted` → `Approved` / `Returned` (unlocks entry) | Key `batch:{ref}:approve:{token}`; expectedVersion = batch version | `marks.approved` / `marks.returned` | `marks.approved` (publisher queue) / `marks.returned` (teacher) | Retry-safe; conflicting moderation → `stale-version` |
| Publish | `result_publisher`; publication scope = batch | `{ batchRef }` + `CommandMeta` → `ServiceResult<{ publication }>` | Batch `Approved`; publication version + per-student snapshot items committed transactionally (immutable snapshot) | `Approved` → `Published` (snapshot version N) | Key `batch:{ref}:publish:{token}`; expectedVersion = batch version | `results.published` (version) | `results.published` (portal snapshots, documents, notifications) | Retry returns the same publication version; never a partial snapshot |
| Withdraw / correct | `result_publisher`; reason required | `{ publicationRef, reason }` + `CommandMeta` → `ServiceResult<{ publication }>` | Publication exists; correction adds a new snapshot version (append-only), never edits the old one | `Published` → `Withdrawn` / `Corrected` (new version) | Key `publication:{ref}:withdraw:{token}`; expectedVersion = publication version | `results.withdrawn` / `results.corrected` (reason, versions) | `results.withdrawn` / `results.corrected` (portal re-read, documents) | Stale publication → `stale-version`; portals must re-read the authoritative snapshot |

## Timetable — owning service: **timetable** (one facade; effective version/override is the source)

| Operation | Actor / scope | Input → Output | Validation | State transition | Idempotency key / expected version | Audit event | Outbox event | Recovery |
|---|---|---|---|---|---|---|---|---|
| Publish | `timetable_manager`; scope = academic year / grade-section | `{ draftVersionRef }` + `CommandMeta` → `ServiceResult<{ timetableVersion }>` | Draft conflicts resolved or acknowledged; effective date set; assignment set complete for the section | `Draft` → `Published` (effective version + effective assignment set, one transaction) | Key `timetable:{yearId}:publish:{token}`; expectedVersion = timetable version | `timetable.published` (version, effective dates) | `timetable.published` (portal/teacher views, notices) | Retry-safe; conflicting edit by another manager → `stale-version`; override after publish is a new version, not an edit |

## Content — owning service: **content/notices** (notice body, audience, version)

| Operation | Actor / scope | Input → Output | Validation | State transition | Idempotency key / expected version | Audit event | Outbox event | Recovery |
|---|---|---|---|---|---|---|---|---|
| Publish notice | `content_publisher`; audience from notice config | `{ noticeRef }` + `CommandMeta` → `ServiceResult<{ notice }>` | `Draft`/`Review` → `Published`; audience and expiry validated; scheduled publications deliver via outbox | `Draft` / `Review` → `Scheduled` / `Published` → `Expired` / `Archived` | Key `notice:{ref}:publish:{token}`; expectedVersion = notice version | `notice.published` (version, audience) | `notice.published` (public/portal lists, notification outbox) | Retry-safe; concurrent edit → `stale-version`; notification failure never unpublishes the notice |

## Identity / links — owning service: **identity/access** (account, session, role grant, guardian/student link)

| Operation | Actor / scope | Input → Output | Validation | State transition | Idempotency key / expected version | Audit event | Outbox event | Recovery |
|---|---|---|---|---|---|---|---|---|
| Approve link request | `links.verify`-capable staff; target link must be `pending_verification` | `{ linkRef }` + `CommandMeta` → `ServiceResult<{ link }>` | Verification evidence present (staff review / enrollment invitation / imported / guardian request); requester not the approver | `pending_verification` → `active` (capabilities, effective dates) | Key `link:{ref}:approve`; expectedVersion = link version | `link.approved` (verification source) | `link.approved` (guardian portal context, session-revalidation marker) | Retry-safe; already-active link returns current state; revoked/ended link → `conflict` |
| Reject link request | same actor as approve | `{ linkRef, reason }` + `CommandMeta` → `ServiceResult<{ link }>` | Reason required; state `pending_verification` | `pending_verification` → `rejected` (append-only; no child data exposed to requester) | Key `link:{ref}:reject`; expectedVersion = link version | `link.rejected` (reason) | `link.rejected` (requester notification) | Retry-safe; a rejected link can only be re-requested, never silently re-approved |

## Support — owning service: **support** (requester-safe thread + staff-private notes are distinct)

| Operation | Actor / scope | Input → Output | Validation | State transition | Idempotency key / expected version | Audit event | Outbox event | Recovery |
|---|---|---|---|---|---|---|---|---|
| Respond | `support_officer` with queue access; requester can reply to their own thread | `{ threadRef, message, private? }` + `CommandMeta` → `ServiceResult<{ thread }>` | Message non-empty; thread open or reopenable; private notes never rendered to the requester | `Open` → `Awaiting requester` / `Resolved` / `Reopened` (thread append-only) | Key `thread:{ref}:response:{token}`; expectedVersion = thread version | `support.responded` (visibility flag) | `support.responded` (requester notification; only if not private) | Retry-safe; concurrent responses both append (no lost update); stale thread view → `stale-version` |

## Settings — owning service: **settings** (effective, versioned values drive UI behavior)

| Operation | Actor / scope | Input → Output | Validation | State transition | Idempotency key / expected version | Audit event | Outbox event | Recovery |
|---|---|---|---|---|---|---|---|---|
| Save setting | `system_administrator`; settings are global or policy-scoped | `{ settings: Record<string, unknown> }` + `CommandMeta` → `ServiceResult<{ settingsVersion }>` | Each key validated by its setting schema; policy-pending flags preserved until school approval | `Effective` → `Effective (version N+1)`; publish windows/periods take effect for new reads | Key `settings:{domain}:save:{token}`; expectedVersion = settings version | `settings.saved` (keys, before/after versions, reason) | `settings.saved` (revalidation marker for affected pages) | Two admins saving concurrently → `stale-version` with current values; save is versioned, never a silent overwrite |

## Users — owning service: **identity/access** (role grants and assignments require reason and visible result)

| Operation | Actor / scope | Input → Output | Validation | State transition | Idempotency key / expected version | Audit event | Outbox event | Recovery |
|---|---|---|---|---|---|---|---|---|
| Invite staff user | `system_administrator` only; support officers may issue guardian/applicant recovery invitations but not staff grants | `{ person, roleGrant, scope, reason }` + `CommandMeta` → `ServiceResult<{ account, grant }>` | Role valid; scope within the inviter's scope; no duplicate pending/active grant for the same account + role | None → account `invited` + grant `requested`/`granted` (one transaction with audit) | Key `invite:{email}:{role}` — duplicate pending/active invite → `duplicate` | `user.invited` (grant, reason, scope) | `user.invited` (invitation email/SMS delivery via outbox) | Retry returns the same account/grant; invitation delivery failure never creates a second invite; revocation is a separate append-only grant state |

## Local operation groups — verified locally; C5 staging evidence remains

The following local operations now have Supabase domain/adapter branches,
mapper/denial/retry tests, and scratch migration/RPC evidence. They remain
unverified against real staging sessions until C5.7.

- **Admissions → finance → enrollment:** draft save/resume, submit/status,
  requested changes, officer review, approver decision, offer response, invoice
  and payment-attempt reads/writes, readiness, and idempotent conversion.
- **Results:** batch/roster reads, teacher marks, submission, moderation,
  publication, withdrawal/correction, immutable versions, and per-student portal
  snapshots.
- **Timetable:** draft/save, conflict validation, publish, effective versions,
  overrides, date sheets, and assignment-scoped teacher/portal reads.
- **Careers:** cross-device drafts, applicant withdrawal, owned history,
  reviewer assignments, scorecards, interviews, and decision projections.
- **Content/notices:** create/edit/review/schedule/unpublish, audience projection,
  public reads, and notification projection.
- **Support:** requester create/read/reopen, staff assignment, public replies,
  private notes, and SLA/status projections.
- **Settings, audit, and notifications:** effective versioned settings reads and
  writes, PostgreSQL audit reads, per-account notification projection/read state,
  and outbox delivery/retry status.
- **Documents/PDF:** scan adapter states (`pending_scan`, `ready`, `quarantined`,
  `failed`), upload finalisation, generated-PDF upload-before-ready, retention,
  signed delivery, and duplicate generation protection. Metadata mapping is
  local; real Storage/scanner/PDF evidence is required in C5.4.

## Staging facade acceptance criteria

For each operation group, the implementation slice is not complete until:

1. Server Components use an authenticated server loader or server adapter
   boundary, and Client Components use the same-origin `/api/adapter` gateway.
2. Demo and Supabase contract tests agree on success, validation, denial,
   stale-version, idempotent retry, and recoverable failure envelopes.
3. The write returns authoritative server state, records audit/outbox effects,
   and refreshes every affected portal/staff projection.
4. Revoked grants/links remove already-loaded protected data on the next render;
   no operational `sessionStorage` or silent demo fallback remains in Supabase
   mode.
5. The corresponding real-session browser journey passes in C5 before the
   global staging adapter switch is accepted.

Storage/Resend provider configuration, remote migration-ledger verification,
advisors, restore rehearsal, and Vercel preparation are C5 gates and require
their own environment evidence.
