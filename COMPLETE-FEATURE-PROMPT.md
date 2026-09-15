# Faiz E Aam School Platform — Complete Feature Prompt

## Overview

Build a modular-monolith school management platform for a fictional school ("Faiz E Aam"). One Next.js App Router application serves public pages, applicant journeys, a guardian/student portal, and staff workspaces — all sharing one PostgreSQL database, one design system, and one account boundary. The platform covers admissions, careers, fees, payments, results, timetables, content, notifications, documents, support, audit, and an optional facility/IoT demonstrator.

---

## Roles

### External Users
| User | Description |
|---|---|
| Visitor | Browses public pages — no account |
| Admission Applicant (Guardian) | Starts/saves/submits/tracks a student admission application |
| Job Applicant | Applies to published vacancies, saves drafts, submits, withdraws, tracks status |
| Guardian | Views linked children: fees, receipts, results, timetable, notices, documents |
| Student | Views own results, timetable, notices, documents |

### Staff Roles (14 roles, additive but scoped)
| Role | Permissions |
|---|---|
| Content Editor | Draft pages/notices, preview. Cannot publish. |
| Content Publisher | Review and publish public content. Cannot administer users. |
| Admissions Officer | Review applications, request changes, record assessments, recommend. Cannot alter fees or publish results. |
| Admissions Approver | Approve offers, waitlist, or decline with reason. Cannot bypass capacity without recorded override. |
| Finance Officer | Configure fee schedules, issue invoices, reconcile payments, initiate approved refunds. Cannot edit results or HR. |
| Finance Approver | Approve refunds, write-offs, financial adjustments. Cannot delete ledger history. |
| Teacher | Enter assigned marks, view assigned class timetable. Cannot publish results or view unrelated students. |
| Exam Reviewer | Moderate, lock, return result batches. Cannot change source marks after lock without correction flow. |
| Result Publisher | Publish/withdraw approved result versions. Cannot silently edit a published result. |
| Timetable Manager | Create, validate, publish, override timetables. Cannot change results or payments. |
| HR Reviewer | Review assigned job applications, score candidates. Cannot see student/finance records. |
| HR Approver | Advance/reject/offer candidates. Cannot expose internal panel notes to applicants. |
| Support Officer | Help users, view limited diagnostics, respond to grievances, verify guardian links. Cannot impersonate or access documents by default. |
| Auditor | Read-only audit, workflow, and reconciliation evidence. |
| System Administrator | Manage configuration and access assignments. No business approvals. |

### Role Rules
- Roles are additive; sensitive actions require the specific functional role even for sysadmin.
- Staff must use MFA (AAL2).
- Maker/checker separation for refunds, result corrections, and high-risk decisions.
- UI visibility is NOT authorization — server enforces every check.
- Every staff workspace uses the active role + assignment/link scope.

---

## Route Map (76 routes)

### Public Website (14 routes)
| Route | Features |
|---|---|
| `/` | Homepage: school identity, promise, service rail, current notice, admissions CTA, contact/disclosure access |
| `/about` | History, mission, leadership, governance |
| `/academics` | Grades offered, curriculum, calendar, examination approach, learning stages |
| `/admissions` | Eligibility, dates, process, required documents, fee info, apply CTA |
| `/admissions/apply` | Multi-step admission application form (redirects to `/apply/student`) |
| `/school-life` | Facilities and activities (no unverified imagery) |
| `/notices` | Notice board: category, title, summary, date, expiry, attachment, audience filter |
| `/notices/[slug]` | Individual notice detail page |
| `/disclosure` | Affiliation and statutory documents |
| `/careers` | Open/closed vacancies listing |
| `/careers/[vacancySlug]` | Vacancy detail: title, department, type, location, responsibilities, criteria, apply CTA |
| `/contact` | Contact form, office hours, map/address, escalation info |
| `/environment` | Campus conditions, indoor comfort summary, AQI bands, seasonal advisories (demo) |
| `/policies/*` | Privacy, accessibility, terms, fees-and-refunds policies |

### Authentication & Account (7 routes)
| Route | Features |
|---|---|
| `/sign-in` | Sign in with email/phone + password or magic link |
| `/sign-in/verify` | OTP verification step |
| `/sign-in/totp` | TOTP MFA enrollment/verification for staff |
| `/sign-in/recovery` | Account recovery (does not reveal whether account exists) |
| `/sign-in/invite` | Staff invitation acceptance flow |
| `/register/applicant` | New applicant account registration |
| `/session-expired` | Session expiry redirect page |

### Applicant Centre (5 routes)
| Route | Features |
|---|---|
| `/apply/student` | Multi-step admission form: context → student identity → guardian/contact → address → previous education → support needs → documents → review/declaration. Autosave by section. |
| `/apply/student/[applicationRef]` | Resume/edit a saved draft application |
| `/apply/student/[applicationRef]/status` | Application status timeline: submitted, under review, changes requested, assessment, offered, waitlisted, declined, enrolled, withdrawn |
| `/apply/job/[slug]` | Job application form: personal details, qualifications, experience, screening questions, documents, references, review/declaration |
| `/apply/job/[slug]/status` | Job application status: submitted, shortlisted, interview, offered, not selected, withdrawn |

### Guardian/Student Portal (12 routes)
| Route | Features |
|---|---|
| `/portal` | Overview: active student switcher, fee summary band, recent results, timetable snapshot, notices, documents count |
| `/portal/fees` | Fee ledger: all invoices, filter (all/unpaid/paid), total outstanding, first unpaid invoice CTA |
| `/portal/fees/[invoiceRef]` | Invoice detail: line items, concessions, ledger entries, pay button, payment processing state |
| `/portal/receipts/[receiptRef]` | Receipt view: school identity, payer-safe details, invoice allocation, method, gateway ref, PDF download |
| `/portal/results` | Results list: academic year/term selector, publication status |
| `/portal/results/[publicationRef]` | Result detail: subjects, components, totals, grades, remarks, version/correction note, PDF download |
| `/portal/timetable` | Weekly class timetable: day/period grid, teacher, room, subject. Exam date sheet section. |
| `/portal/notices` | Portal notices: audience-targeted (family), category filter, pinned/urgent notices |
| `/portal/documents` | Document library: report cards, receipts, certificates, admissions evidence. Per-student scoped. |
| `/portal/profile` | Profile management: guardian details, contact info, linked students, edit profile |
| `/portal/security` | Security settings: active sessions, password change, MFA status, linked devices |
| `/portal/support` | Support/grievance form: subject, message, category, status tracking, response thread, reopen |
| `/portal/link-child` | Guardian link request: enter one-time school-issued reference to link a student |

### Staff Workspace (28 routes)
| Route | Features |
|---|---|
| `/staff` | Staff home: role-scoped operational queues (applications, payments, results, timetables, content, support), quick links, pending counts |
| `/staff/admissions` | Admissions queue: filter by year/grade/status/reviewer/date, completeness, duplicates, timeline |
| `/staff/admissions/[applicationRef]` | Application review: full form, documents (signed URLs), version history, review notes, assessment, decision (offer/waitlist/decline), change requests, enrollment conversion |
| `/staff/careers` | Careers queue: filter by vacancy/status, reviewer assignment |
| `/staff/careers/[applicationRef]` | Job application review: scorecard, interview scheduling, offer/reject, internal notes (never shown to applicant), status transitions |
| `/staff/finance` | Finance workspace: outstanding summary, collection, recent receipts, unpaid count, quick links |
| `/staff/finance/invoices` | Invoice register: all invoices, empty state, search by ref/student/status |
| `/staff/finance/payments` | Payment register: all payment attempts, status (success/pending/failed), gateway ref |
| `/staff/finance/reconciliation` | Reconciliation: gateway vs internal ledger comparison, exceptions (mismatch, duplicate, pending), resolve actions |
| `/staff/results` | Results batches: filter by status (draft/open/submitted/review/approved/published), class/subject |
| `/staff/results/[resultBatchRef]` | Batch detail: marks entry grid, subject components, max marks, grade bands, submit for review, approve, publish, withdraw, correct (versioned) |
| `/staff/results/[resultBatchRef]/entry` | Marks entry: teacher-scoped (assigned class + subject only), validate range, absent/exempt codes |
| `/staff/timetables` | Timetable manager: class selector, weekly grid editor, conflict detection (teacher/room/section double-booking), draft save, version history, publish with note, date sheet, overrides |
| `/staff/content` | Content management: public page review status (Draft → In Review → Published), notice list with status (draft/published/expired), review button (gated by content.publish) |
| `/staff/notices` | Notice publisher: create notice (title, body, category, audience, priority, schedule, expiry), edit draft, publish with note, unpublish, version history |
| `/staff/users` | User management: invite staff (name, email, role, reason), grant role, revoke role (with reason), suspend account (with reason), reactivate, expandable rows, gated by users.manage |
| `/staff/link-requests` | Link requests: pending guardian link requests, approve/reject (with reason), active links, revoke link, gated by links.verify |
| `/staff/audit` | Audit explorer: filter by actor/action/target/date/correlation ID, append-only event log, safe metadata only |
| `/staff/settings` | Settings: academic year, admission window, fee policy, results policy (grading scheme, two-reviewer requirement), notice defaults (expiry, email sender, SMS), working days, periods per day. Policy-pending flags. Save (gated by settings.manage). Reset demo data. |
| `/staff/support` | Grievance inbox: all grievances, status filter (New/In progress/Resolved), respond (with/without resolve), reopen resolved, assignment |
| `/staff/facility` | Facility overview: zone summary, current readings, alerts count, sparklines (demo data) |
| `/staff/facility/alerts` | Alerts: acknowledge/resolve alerts (gated by facility.manage), severity/status filter, trail text |
| `/staff/facility/devices` | Device registry: sensor devices, status, zone, last reading |
| `/staff/facility/history` | Reading history: 24h–30d charts with threshold bands, zone selector |
| `/staff/facility/reports` | Period reports: zone performance, alert summary, export |
| `/staff/facility/zones` | Zone list: all zones, current conditions |
| `/staff/facility/zones/[zoneId]` | Zone detail: live readings, threshold status, alert history |
| `/staff/facility/display` | Wallboard display: large-screen hallway view, zone conditions, alerts, manual pause (no auto-rotate) |

### API Routes
| Route | Features |
|---|---|
| `/api/adapter` | Session-protected operation dispatch to demo or Supabase adapter (zod-validated) |
| `/api/outbox` | Cron-protected outbox worker: claim pending events, send through provider, mark delivered |
| `/api/email/webhook` | Resend webhook: verify signature, deduplicate by svx-id, process bounce/complaint suppression |

### Utility Routes
| Route | Features |
|---|---|
| `/access-denied` | Access denied page for unauthorized users |
| `/ui-states` | UI state gallery: loading, empty, error states for all components |

---

## Feature Specifications

### 1. Content Management (CMS)
- **Workflow:** DRAFT → IN_REVIEW → SCHEDULED or PUBLISHED → ARCHIVED
- Editors draft; publishers approve and publish; scheduling uses school timezone
- Every content item has owner, last reviewed date, next review date
- Expired notices removed from current lists, retained in archive
- Attachments: title, type, size, language, accessible description
- Published revisions create history; rollback creates a new revision
- Unverified info never published as fact
- Urgent notices have explicit start/end time

### 2. Identity & Authentication
- **Account types:** Applicant (lightweight), Guardian (permanent, linked), Student (linked to one record), Staff (invited, MFA required)
- Email magic link/OTP and phone OTP for applicants/guardians
- Staff use MFA (AAL2) with shorter sessions
- Secure HttpOnly SameSite cookies — never localStorage
- Login/logout/recovery/MFA changes/suspicious failures/role changes audited
- Rate limiting on OTP, login, recovery, invitation endpoints
- Recovery does not reveal whether an account exists

### 3. Guardian/Student Linking
- Enrollment creates student record → school records guardian relationship → guardian signs in with matching contact or receives one-time linking invitation → system checks relationship → guardian confirms → link becomes active (audited)
- Manual linking requires authorised staff + recorded reason
- One guardian → many students; one student → many verified guardians
- Link revocation = immediate access revocation

### 4. Student Admission Registration
- **Form sections:** Application context, student identity, guardian/contact, address, previous education, support/accommodation, documents, review/declaration
- **Workflow:** DRAFT → SUBMITTED → UNDER_REVIEW → CHANGES_REQUESTED → UNDER_REVIEW → ASSESSMENT → DECISION_PENDING → OFFERED / WAITLISTED / DECLINED → OFFER_ACCEPTED → ENROLLED
- **Terminal states:** WITHDRAWN, EXPIRED, DUPLICATE_CLOSED
- Drafts autosave by section; submission creates immutable snapshot + reference
- Staff request changes with field identification + deadline
- Only admissions approver issues offer/waitlist/decline
- Offer records: expiry, conditions, acceptance requirements, admission payment
- Enrollment = controlled conversion creating student/enrollment/guardian links in one transaction
- Capacity override requires permission + reason
- Documents: configured checklist, type/size/scan enforcement, signed URLs, version retention
- Communications: draft reminder, submission ack, change request, assessment invite, decision notice, offer expiry reminder, enrollment confirmation

### 5. Job Vacancies & Applications
- **Vacancy content:** Title, department, type, location, summary, responsibilities, criteria, documents, opening/closing, contact, status
- **Form sections:** Personal/contact, qualifications, experience, screening questions, documents, references, review/declaration
- **Workflow:** DRAFT → SUBMITTED → ELIGIBILITY_REVIEW → SHORTLISTED → INTERVIEW → REFERENCE_CHECK → OFFERED → ACCEPTED
- **Terminal states:** NOT_SELECTED, WITHDRAWN, EXPIRED, VACANCY_CANCELLED
- Internal notes/scorecards never shown to applicants
- Applicant-safe status text separate from internal state
- Panel members see only assigned vacancies
- Conflict of interest recording removes reviewer
- Withdrawal is applicant-controlled until configured terminal point
- Retention/deletion schedule enforced by scheduled job

### 6. Fee Schedules, Invoices & Concessions
- **Fee config:** Academic year, grade applicability, category, amount, due schedule, tax, refundable flag, active dates
- Categories: tuition, admission, transport, examination, activity, other
- Config changes create versions — never rewrite issued invoices
- **Invoice model:** Header (student, year, issue/due date, status, currency, total, balance, ref) + line items + ledger entries
- **Invoice workflow:** DRAFT → ISSUED → PARTIALLY_PAID → PAID (+ OVERDUE, VOID, CREDITED)
- Concessions: explicit records with type, value, authority, reason, scope, approval
- Approved concession changes balance through ledger entry, not total mutation
- Manual adjustments require finance permission + reason + maker/checker above threshold
- Partial payment policy configurable per invoice/fee type
- Staff: issue individual/batch invoices, preview/validate, search, view immutable ledger, reports (outstanding, collection, settlement, exceptions)

### 7. Online Payments, Receipts, Refunds & Reconciliation
- **Payment flow:** Guardian selects invoice → server rechecks auth/balance/policy → creates payment_attempt + gateway order (idempotency key) → client opens provider checkout → browser shows PROCESSING (never final success on callback alone) → signed webhook verified against raw body → server stores gateway event once → confirmed success creates payment + ledger allocation in transaction → receipt number generated → outbox schedules receipt notification + PDF
- **Payment states:** CREATED → CHECKOUT_OPENED → PENDING → SUCCEEDED (+ FAILED, USER_DROPPED, EXPIRED, LATE_AUTHORISED, REFUND_PENDING, PARTIALLY_REFUNDED, REFUNDED, DISPUTED)
- **Webhook rules:** Store event ID/body hash, unique provider event ID prevents duplicates, handler acknowledges after durable storage, idempotent processing, unknown orders/mismatches go to exception queue
- **Receipts:** Sequential/policy-approved number, school identity, payer-safe details, student ref, invoice allocation, amount, method, gateway ref, date, status. PDF reproducible from stored records.
- **Refunds:** Finance officer creates request → validate refundable amount → finance approver approves (maker/checker) → gateway refund with idempotency → webhook/fetch confirms → ledger receives refund entry → parent sees status + updated balance
- **Reconciliation:** Daily job compares gateway vs internal records. Exceptions: gateway-only success, internal-only success, amount mismatch, duplicate reference, pending beyond threshold, failed notification, settlement mismatch. Finance resolves with audited action.
- **UPI:** UPI Intent/QR (not manual VPA Collect). Recurring mandates optional, require explicit opt-in.

### 8. Results, Report Cards & Publication
- **Config:** Academic year, term/exam, grades/sections, subjects, components, max marks, pass rules, grade bands, rounding, absent/exempt codes, aggregate/ranking visibility, publication window, report template
- **Workflow:** DRAFT → MARK_ENTRY_OPEN → SUBMITTED_FOR_REVIEW → UNDER_REVIEW → APPROVED → PUBLISHED (+ RETURNED_FOR_CORRECTION, WITHDRAWN, SUPERSEDED)
- Teachers see only assigned subject/class components
- Mark entry validates numeric range + allowed non-numeric statuses
- Bulk import requires preview (accepted/rejected rows)
- Submission locks teacher's current version
- Reviewer approves or returns with reason
- Publisher selects approved batch + audience → creates immutable publication
- **Corrections:** Authorised staff opens correction request → approver authorises → new version entered/reviewed → new publication supersedes old → users see correction date/status → prior version available to auditors
- Student/guardian view: year/term selector, publication state, subjects, grades, remarks, PDF download
- Search engines never receive result content

### 9. Class Timetables & Exam Date Sheets
- **Separate concepts:** Class timetable (repeating weekly), exam date sheet (dated), override (date-specific change)
- **Config:** Working days, period definitions, grades/sections, subjects, teachers, rooms/labs, effective date range
- **Workflow:** DRAFT → VALIDATED → PUBLISHED → SUPERSEDED
- **Conflict checks:** Teacher double-booked, room double-booked, section double-booked, invalid assignment, period outside school day. Hard conflicts block publication.
- **Overrides:** Date-specific substitute teacher/subject/room/cancellation/special period. Records reason, creator, effective date, audience, optional notice. Base timetable unchanged.
- **Exam date sheet:** Exam batch, year, grade/section, subject, date, time, room, instructions. Conflict validation. Revision creates new published version + targeted notice.

### 10. Notices & Notifications
- **Notice audiences:** Public, all authenticated, guardians/students by year/grade/section, staff by role/assignment, applicants by application/status
- **Notice model:** Title, summary, body, category, audience rule, priority, publish/expiry time, attachments, author, approval, revision
- Portal always shows authoritative notice even if email/SMS fails
- **Notification outbox:** Domain action creates outbox record in same transaction → scheduled worker claims with lock → resolves recipient + channel → renders versioned template → sends through provider → stores delivery state → retries with backoff → permanent failures to review state
- No sensitive marks/balances/credentials in email/SMS — use reference numbers + portal links
- Users manage non-essential preferences; transactional notices remain enabled

### 11. Documents, Downloads & Generated PDFs
- **Document classes:** Public CMS attachment, private admission document, private job document, generated receipt, generated result report, generated application ack, staff-only evidence/export
- **Upload pipeline:** Server authorizes → client uploads to quarantine → verify size/extension/type/filename → malware scan → clean file moves to final private location → document record stores checksum, type, size, uploader, source, scan state, version
- Private documents never public URLs — server checks auth before issuing short-lived signed URL
- Sensitive staff downloads audited
- Generated PDFs include template version + source record/version

### 12. Support & Grievance Handling
- Public contact/grievance form with rate limiting + safe categories
- Authenticated support request linked to user + optional safe record reference
- **Status:** OPEN → IN_PROGRESS → WAITING_FOR_USER → RESOLVED → CLOSED
- Assignment, internal notes, applicant-visible responses, resolution category
- Support staff see minimum record summary needed
- No passwords/OTPs/credentials requested through support
- Account linking/financial adjustment/application decision/result correction must use authorised workflow, not support shortcut
- Impersonation out of scope

### 13. Staff Dashboard, Configuration & Audit
- **Staff home:** Role-scoped queues (applications, payments, results, timetables, content, support, failed notifications)
- **Configuration:** School identity, academic years, grades, sections, subjects, periods, rooms, application windows, document requirements, fee categories/schedules, approval thresholds, result structures, grade bands, notification templates, retention policies, feature flags
- **Audit explorer:** Filter by actor, module, action, target ref, date, correlation ID. Safe before/after metadata. Append-only. Never log secrets.
- Configuration changes versioned where they affect existing records
- High-risk actions require reason + approval where configured

### 14. Campus Environment Monitoring (Optional Demonstrator)
- **Public page:** Outdoor conditions, indoor comfort by zone, sensor explainers, seasonal advisories
- **Staff facility workspace:** Live overview, zone detail, reading history with charts, alert ack/resolve, device registry, period reports
- **Wallboard:** Large-screen hallway view, manual pause (no auto-rotate)
- Thresholds in domain logic (thermal comfort, CO₂, PM2.5/CPCB AQI, noise, light)
- Readings append-only; alerts carry severity + ack/resolve trail
- Demo data explicitly marked; no real student/staff/building data fabricated as real
- Isolated from core modules — not in launch gate

---

## Cross-Module Integration Contracts

### Admission → Enrollment → Fees/Results/Timetable
1. Guardian submits application → admissions reviews/assesses/approves offer
2. Guardian accepts offer → optional admission payment (invoice → gateway → webhook → ledger)
3. Enrollment conversion creates student + enrollment + guardian links atomically (idempotent)
4. Fee invoices target enrollment/student in academic year
5. Result entry roster derived from eligible enrollments
6. Portal timetable derived from current/historical enrollment class/section + effective date
7. Deactivating/transferring enrollment updates future access without deleting history

### Domain Events (Outbox)
- `admission.application_submitted`, `admission.decision_made`, `admission.offer_accepted`
- `enrollment.converted`
- `payment.posted`, `payment.refunded`
- `results.published`, `results.withdrawn`, `results.corrected`
- `content.published`
- `link.approved`, `link.rejected`, `link.revoked`, `link.requested`

### Active Student Context
- One active student/enrollment context across overview, fees, receipts, results, timetable, notices, documents, support, profile
- Switching student context updates all dependent views
- Guardian access checks linked student + active/allowed historical enrollment

---

## Data Conventions
- Primary keys: UUIDs
- Public references: non-sequential reference strings (never raw DB IDs)
- Money: integer paise + ISO currency (INR configured)
- Time: UTC in storage; Asia/Kolkata for display
- Academic scope: every dependent record carries academic_year_id
- Status: constrained DB value + application-level transition validation
- Deletion: archive/soft-delete config records; never delete financial, submitted application, published result, or audit history
- Optimistic concurrency: version/revision field for staff-edited records
- Audit: actor, action, target type/ID, timestamp, request/correlation ID, safe metadata, reason

---

## Quality Gates
- typecheck (TypeScript strict)
- lint (0 errors, 0 warnings except pre-existing)
- test suite (329 web + 47 contract tests)
- build (76-route production build)
- Accessibility: WCAG 2.2 AA, keyboard navigation, visible focus, clear form errors, reduced motion, mobile usability
- Fictional data only in demos/fixtures/screenshots/tests — clearly marked
