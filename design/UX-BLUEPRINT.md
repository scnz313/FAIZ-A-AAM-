# Faiz Aam Secondary School — Digital Experience Blueprint

Status: approved visual direction and relationship-aware UI contract; school identity/content still requires leadership validation. The public name observed online is **FAIZ E AAM SECONDARY SCHOOL BANDIPORA**. The official spelling, crest, board affiliation, school code, address, phone numbers, leadership names, and fee policy must be confirmed before launch.

Updated: 5 August 2026. Product relationships, domain ownership, and synchronization behavior are defined in `../FEATURE-INTEGRATION-SPEC.md`; this file defines how that behavior must appear in the interface.

## 1. Product definition

The website is one coherent school service with four clearly separated entrances:

1. **Public school website** — trust, school story, academics, notices, events, disclosures, contact.
2. **Admissions and careers centre** — new-student applications and vacancy-specific job applications.
3. **Parent and student portal** — fees, receipts, results, timetables, documents, notices.
4. **Staff operations** — admissions review, finance reconciliation, result publishing, timetable management, HR review, and content publishing.

The homepage must not expose private school operations. It should establish the school, then route each visitor to the correct secure journey.

## 2. Visual thesis

**A living school record:** Kashmir material cues, literary typography, measured grids, and quiet institutional precision. The tone is rooted, humane, and academically serious—not a glossy ed-tech startup.

### Visual system

- **Primary palette:** ink navy `#0B1C2A`, paper `#F4EFE5`, saffron `#B96832`, willow `#536D57`, chalk white `#FFFDF8`.
- **Typography:** a dignified editorial serif for identity and headlines; a highly legible sans-serif for navigation, forms, numbers, and tables. Two families maximum.
- **Imagery:** the core interface does not depend on campus photography. If the school later chooses to add photographs, use only verified, consented real school imagery as supporting editorial content.
- **Shape language:** fine rules, generous whitespace, squared or lightly rounded controls, almost no floating cards.
- **Motion:** a restrained hero text reveal, subtle typographic/grid depth on scroll, and precise underline/row transitions. Respect `prefers-reduced-motion`.

### What is deliberately excluded

- Crypto/SaaS gradients, glass panels, neon, blobs, floating dashboards, bento grids, icon clouds, pill-heavy navigation, decorative 3D, or oversized meaningless metrics.
- Carousels for core information. Notices and services remain visible and scannable.
- Public student result lookup by name or roll number.

## 3. Public information architecture

### Global header

- School crest or verified wordmark
- About
- Academics
- Admissions
- School life
- Notices
- Mandatory public disclosure (when required by the confirmed board)
- Contact
- Persistent utility actions: **Pay fees** and **Portal**

### Homepage component map

1. **Trust ribbon** — admissions cycle, location, board/affiliation only after verification.
2. **Full-bleed hero** — school name, one-sentence promise, admission CTA, and a typographic institutional graphic plane.
3. **Service rail** — Apply for admission, Pay school fees, View results, See timetable.
4. **Current notice line** — the newest urgent notice with date and category.
5. **School story** — concise history and educational approach; leadership message is secondary.
6. **Learning stages** — actual grades offered, shown as a simple curriculum timeline.
7. **Achievement proof** — a small, verified selection of outcomes and student work; never publish student names/photos without consent.
8. **School life editorial strip** — sports, arts, service, assemblies, trips.
9. **Upcoming dates** — admissions, examinations, holidays, events.
10. **Disclosure and contact footer** — policies, grievance contact, accessibility, privacy, terms, maps, phone, email.

### Public supporting pages

- About / leadership / history / mission
- Academics / curriculum / grade levels / examination policy
- Admissions overview / eligibility / required documents / dates / fee structure
- School life / facilities / activities / gallery
- Notices and downloads with categories and expiry dates
- Mandatory public disclosure, annual report, fee schedule, safety certificates, staff details, and affiliation documents as applicable
- Careers and vacancy detail pages
- Contact and grievance redressal
- Privacy, retention, accessibility, refund/cancellation, terms

## 4. Feature flows

### A. New-student registration

**Applicant journey**

1. Select academic year, grade, and campus if applicable.
2. Verify parent/guardian phone or email with OTP.
3. Create an application reference and autosaved draft.
4. Complete student, parent/guardian, address, prior-school, medical/accommodation, and declaration sections.
5. Upload only required documents with clear format/size rules.
6. Review a read-only summary and provide consent/declaration.
7. Submit once; receive an acknowledgement and reference number.
8. Track status: Draft → Submitted → Under review → Changes requested → Assessment/interview → Offered/Waitlisted/Declined.
9. If offered, accept the seat, pay the defined admission amount, and complete enrollment.
10. Only after enrollment should the system create the permanent student record and link it to guardian accounts.

**Operational requirements**

- Grade capacity and admission windows are configuration, not hard-coded copy.
- Staff can request a change without overwriting the originally submitted answer.
- Every status change is timestamped with actor and reason.
- Duplicate checks use verified parent contact plus student identity fields, with human review.
- Sensitive medical information has narrower permissions than general application data.

### B. Parent fee payment

**Parent journey**

1. Sign in and select a linked child.
2. See the authoritative fee ledger: opening balance, invoices, line items, concessions, payments, refunds, and amount due.
3. Choose one or more eligible invoices; partial payment is allowed only when policy permits.
4. The server creates a gateway order for the exact amount and a unique payment attempt.
5. Checkout offers UPI Intent/QR, card, net banking, and other enabled methods. The school site never stores raw card or UPI credentials.
6. After checkout, show **Processing** until the server verifies the signed provider event or fetches the order status.
7. A verified, idempotent webhook posts the payment to the ledger exactly once.
8. Generate a numbered receipt only after confirmed capture/success; make it downloadable and email/SMS-notifiable.
9. Failed, abandoned, late-authorised, refunded, disputed, and reconciled states remain visible to authorised finance staff.

**Non-negotiables**

- Browser redirects are not proof of payment.
- Webhook signatures are verified against the raw request body; duplicate events are idempotent.
- Amount, currency, student, invoice, order ID, provider payment ID, settlement state, and receipt number are auditable.
- Refunds are staff-controlled and append ledger entries rather than erasing the original payment.
- UPI manual Collect/VPA entry should not be the primary flow; use current Intent/QR flows.
- Optional recurring mandates require explicit opt-in, visible terms, pre-debit notices where applicable, and a clear pause/revoke path.

### C. Results

**Publishing workflow**

1. Exam office defines academic year, term/exam, classes, subjects, grading rules, and publication date.
2. Assigned teachers enter or import marks with validation against maximum marks and explicit absent/result status. Attendance is outside the first-release scope.
3. A reviewer/moderator checks anomalies and locks approved results.
4. An authorised publisher releases a version to selected classes/sections.
5. Students and guardians view only records for linked students.
6. Corrections create a new version with reason and audit trail; they never silently rewrite history.

**Student view**

- Term selector, subject rows, marks/grade, explicit result status, teacher remark, aggregate only where policy allows, and downloadable official report.
- Clear “provisional” versus “final” status.
- No public name/roll-number search and no search-engine indexing.

### D. Timetable

- Separate **class timetable** and **exam date sheet** concepts.
- Timetables are effective-dated and attached to class/section; teachers and rooms are conflict-checked.
- Student/parent view defaults to today, with week view and printable/downloadable version.
- Changes preserve the prior version and can trigger a targeted notice.
- Substitute periods and one-day changes appear as overrides without destroying the base schedule.

### E. Job applicant registration

1. HR publishes a vacancy with role, department, location, qualifications, documents, deadline, and status.
2. Applicant verifies email/phone, creates a draft, and applies to a specific vacancy.
3. Form collects only role-relevant information; CV, qualification, experience, and identity uploads are separately labelled.
4. Applicant reviews, consents, submits, receives a reference, and can withdraw.
5. HR workflow: Submitted → Eligibility review → Shortlisted → Interview/assessment → Reference check → Offered/Not selected/Withdrawn.
6. Reviewers use scorecards and notes with role-based visibility. Applicant status messages do not expose internal notes.
7. Retention period and deletion/anonymisation policy are stated at collection time.

### F. Admin and publishing

- CMS roles for notices, pages, events, downloads, gallery, and disclosures.
- Scheduled publish/unpublish, preview, version history, broken-link checks, and content owner/review date.
- Role model: super admin, content editor, admissions officer, finance officer, teacher, exam reviewer, timetable manager, HR reviewer, auditor/support.
- Permission checks are enforced server-side per action and per student/application—not just by hiding UI.

## 5. Portal component map

### Parent/student shell

- Compact school identity and signed-in role
- Linked-child switcher
- Primary navigation: Overview, Fees, Results, Timetable, Notices, Documents, Profile
- Session/security menu and sign out
- Contextual support/grievance action

### Fees workspace

- Current balance and due date
- Invoice/term selector
- Ledger table with status
- Payment method handoff
- Processing/reconciliation state
- Receipt viewer and refund/dispute status

### Results workspace

- Academic year and term controls
- Publication status
- Subject performance table
- Result status and approved remarks
- Official report download

### Timetable workspace

- Today/week toggle
- Date and class/section context
- Period list with subject, teacher, room, and change indicator
- Exam date-sheet switch

### Application centre

- Vacancy/grade selection
- Save-and-return draft status
- Section progress rail
- Inline validation and document checklist
- Review summary
- Submission receipt and status timeline

## 6. Data model boundaries

Core records should be independent and linked by stable IDs:

- `users`, `roles`, `user_roles`, `sessions`
- `guardians`, `students`, `guardian_student_links`
- `academic_years`, `grades`, `sections`, `subjects`, `enrollments`
- `admission_applications`, `application_versions`, `application_documents`, `application_events`
- `job_vacancies`, `job_applications`, `job_documents`, `job_reviews`, `job_events`
- `fee_schedules`, `invoices`, `invoice_items`, `concessions`, `payment_attempts`, `payments`, `refunds`, `receipts`, `gateway_events`
- `exams`, `assessment_components`, `marks`, `result_versions`, `result_publications`
- `timetables`, `timetable_periods`, `timetable_overrides`
- `notices`, `pages`, `media`, `content_versions`
- `audit_events`, `notification_deliveries`, `support_requests`

Uploaded documents belong in private object storage with short-lived signed access, not public URLs or the web root.

## 7. Quality and safety bar

- **Privacy:** data minimisation, purpose-specific notices, verifiable guardian consent where required for children, retention schedules, export/correction/withdrawal handling, no behavioural advertising to children.
- **Security:** TLS, secure `HttpOnly`/`SameSite` sessions, MFA for privileged staff, rate limiting, CSRF protection, strong server-side authorisation, encrypted secrets, audit logs, backup/restore tests.
- **Uploads:** allowlist types, verify actual file type, randomise stored filenames, size/page limits, malware scanning, and private storage.
- **Accessibility:** target WCAG 2.2 AA across public and portal screens; keyboard access, visible focus, adequate targets/contrast, labels and errors, status announcements, reduced motion, and redundant-entry reduction.
- **Performance:** responsive images, predictable layouts, cached public content, slow-network-friendly forms, draft recovery, and no essential interaction dependent on animation.
- **Reliability:** idempotent writes, immutable financial/result history, retryable notifications, reconciliation jobs, observability, and tested recovery procedures.

## 8. Recommended delivery sequence

### Phase 1 — foundation

- Verified identity/content inventory, public website, notices, disclosures, CMS, privacy/accessibility baseline.
- Authentication, roles, guardian/student linkage, audit framework, private file storage.

### Phase 2 — applications

- Student admissions and HR vacancies/applications, reviewer workspaces, notifications.

### Phase 3 — parent services

- Fee ledger, gateway integration, reconciliation, receipts/refunds, parent portal.

### Phase 4 — academics

- Timetable authoring/versioning and result entry/moderation/publication.

### Phase 5 — hardening

- Security review, accessibility audit, performance/load testing, backup restore drill, staff training, content governance, production release.

## 9. Decisions required before implementation

1. Official school spelling and logo/crest assets.
2. Board affiliation and grades offered.
3. Academic-year/admission calendar and admission decision policy.
4. Official fee schedule, partial-payment/refund/late-fee/mandate rules, and selected payment gateway merchant account.
5. Result grading policy, correction authority, report format, and publication dates.
6. Timetable rules, periods, rooms, teacher load, and substitution process.
7. Job categories, reviewers, scoring, and retention period.
8. Languages required at launch (English plus Urdu and/or Kashmiri).
9. Whether optional real school imagery will be used; if so, obtain verified assets and student/guardian media consents. Photography is not required for the core UI.

## 10. Research basis

- The school’s public Facebook identity and a public academic-achievement result confirmed the commonly used name.
- Regional school sites reviewed: Kashmir Harvard Educational Institute and Foundation World School. Useful patterns included clear learning stages, notices, careers, student/parent services, fee management, and legal disclosures; the new design intentionally avoids their carousel-heavy density.
- CBSE sources were used only as a conditional disclosure benchmark. They do not prove Faiz Aam’s board affiliation.
- Current payment, privacy, accessibility, and security sources are linked in `RESEARCH-NOTES.md`.

## 11. Relationship-aware UI architecture

The visual system must make scope obvious without turning the portal into a generic dashboard.

### Family context strip

The family shell owns one persistent context strip containing:

- active student name;
- current class/section and academic year;
- safe roll/student reference;
- linked-child selector when more than one link is active;
- relationship status/capability warning only when action is required.

The selector is a quiet institutional control in the side rail on wide screens and the top of content on narrow screens. It is not a decorative dropdown. A switch announces “Now showing …” and updates the page title/context before data rows appear.

When the selected child has no active enrollment for the current year, show a clear historical/no-current-enrollment state and offer an allowed year selector. Never silently reuse the previous child’s invoices, results, timetable, notices, or documents.

### Staff context strip

The staff shell shows:

- signed-in staff name;
- active workspace/role;
- active assignment or queue scope;
- academic year where relevant;
- a role switch only for genuinely granted roles.

Role switching changes navigation and data context together. A teacher/guardian sees an explicit “Family portal” versus “Staff workspace” switch; private family and staff information never share a single summary.

### Context hierarchy

Use this order on every protected page:

1. workspace/role eyebrow;
2. page title;
3. active person/student/class/year context;
4. status/action summary;
5. primary record content;
6. audit/version/support detail.

The current context must remain visible close to consequential actions even when the global shell has scrolled away.

## 12. Shared component inventory

Build and reuse these semantic components:

| Component | Purpose | Required behavior |
|---|---|---|
| `ActiveStudentContext` | Shows/switches child and enrollment | Controlled value, loading/empty/revoked states, dirty-form guard, live announcement |
| `WorkspaceRoleSwitch` | Changes family/staff or staff role context | Lists only granted roles, explains access change, returns to safe landing page |
| `RecordReference` | Displays a safe public reference | Copy action optional; never treated as authorization |
| `StatusBadge` | Encodes domain status | Text plus restrained tone; never color only |
| `StatusTimeline` | Applicant/payment/support history | Actor-safe events, chronological clarity, current marker, no leaked internal notes |
| `ContextHeader` | Repeats student/class/year or staff scope | Used on fees, results, timetable, documents, and high-risk confirmations |
| `ValidationSummary` | Collects form errors | Links/focuses fields, updates after submit, preserves inline errors |
| `ConfirmAction` | High-risk staff/user confirmation | Exact object, transition, consequences, required reason, cancel/default focus |
| `VersionHistory` | Shows result/timetable/content versions | Current/superseded state, actor/date/reason, safe comparison link |
| `AsyncState` | Loading/empty/error/retry/partial success | Specific wording and recoverable next step |
| `DocumentState` | Preview/download readiness | Ready, processing, missing, failed, quarantined, denied, expired |
| `NotificationBell` | Per-account in-app events | Audience-safe items, read state, deep links to authorized records |

Components may share layout and accessibility behavior. Domain transition rules and wording stay in their owning feature service.

## 13. Cross-feature synchronization in the interface

### Student switch

On selection:

1. mark the context region busy;
2. preserve the outgoing selection only until the new context is authorized;
3. clear child-specific sub-selections;
4. update the context header and all page data;
5. move focus only when necessary; otherwise announce the change politely;
6. show a safe error and keep the prior authorized context when loading fails.

### Admission offer to enrollment

The applicant status page uses one connected progression:

```text
Seat offered → Accept/decline confirmation → Admission invoice → Payment status
→ Enrollment readiness → Student/enrollment created → Guardian invitation/portal access
```

Never show “Enrolled” when only the seat was accepted or the browser returned from checkout. The success panel names the completed step and the next unmet condition.

### Payment propagation

After verified posting:

- invoice detail changes to paid/partial;
- family fee summary and overview balance refresh;
- new receipt appears in receipt and document lists;
- staff invoice/payment/reconciliation views read the same state;
- notification/PDF may display “being prepared” without changing the ledger success.

### Result publication

Staff publication confirmation names exam, class/section, version, and audience. Success links to the immutable version. The correct linked family sees the same publication reference and marks snapshot; another class or unlinked guardian sees nothing.

### Timetable publication

Staff success names class/section, effective date, and version. Portal day/week views show the matching version and mark overrides as changes. Another class keeps its own schedule.

### Relationship or role revocation

When access changes, replace protected content with an “Access changed” state, remove invalid navigation/context options, and provide a safe route to support or sign-in. Never leave previously loaded rows visible behind a warning.

## 14. Feature workspace maps

### Admissions applicant

- progress rail with eight labelled sections;
- autosave state and safe resume/start-over choice;
- contextual validation summary and inline errors;
- private-document checklist/state;
- read-only review and declaration;
- acknowledgement/reference;
- status timeline, requested-change action, offer response, finance step, enrollment readiness, and portal invitation.

### Admissions staff

- queue filters and assignment/flag context;
- application identity and version comparison;
- document state panel;
- eligibility/capacity/duplicate indicators;
- applicant-visible reason separate from internal notes;
- controlled decision panel with confirmation;
- enrollment-readiness checklist and conversion outcome.

### Careers applicant/staff

- vacancy identity/version remains visible during application;
- draft recovery handles current, stale, legacy, and malformed drafts;
- applicant status shows only approved timeline content;
- staff detail separates documents, scorecard, internal notes, panel assignment, interview, and decision;
- offered candidate receives next steps, not automatic staff credentials.

### Family finance

- active-student context, current balance, next due item;
- invoice ledger with line items/adjustments/allocations;
- payment attempt panel with processing and safe retry;
- receipt/refund/dispute/reconciliation status;
- printable HTML first, generated PDF supplementary.

### Staff finance

- the same student/invoice references and balances as the family view;
- queue/register filters, issue/adjustment actions, payments, refunds, and reconciliation;
- high-risk actions show before/after amounts and require reason/approval;
- no decorative revenue analytics in the first release.

### Results

- teacher assignment context and marks sheet;
- validation summary for missing/invalid/result-status rows;
- moderator return reason and resubmission;
- publisher confirmation and immutable version history;
- family report with term/version/status, subject rows, approved remarks, policy-controlled aggregate, and official-document state.

### Timetable

- staff section/week/version context;
- structured period editor with teacher/room conflict details;
- draft/save/validate/publish/override/version history;
- family day/week/exam modes derived from the active enrollment;
- print layout that retains class, dates, version, and change labels.

### Notices, documents, support, and administration

- notices: audience, schedule, expiry, preview, approval, version, delivery status;
- documents: owner/source, category, version, scan/generation/access state;
- support: requester-safe conversation separate from internal assignment/notes;
- users: person, role grants, assignments, status, reasoned revoke;
- settings: grouped school/academic/policy configuration with effective dates;
- audit: filters by safe reference/actor/action/date/outcome and a read-only detail view.

## 15. State and interaction rules

- Loading states never display another child’s or a previous role’s sensitive data.
- Empty states distinguish “none exists,” “not published,” “not in this filter,” and “not allowed.”
- Validation preserves entered values and focuses the summary/first invalid field.
- Retry repeats the same idempotent intent, not a new charge/submission/publication.
- Stale conflicts show who/when where safe, summarize the changed version, and offer reload/review.
- Partial success names what committed and what remains pending.
- Destructive/high-risk actions use a local confirmation panel or dialog with a safe default, not a browser `confirm()`.
- Success states remain available after navigation/reload because they come from the service record.
- Dates display in `Asia/Kolkata`; money displays INR derived from integer paise.

## 16. Responsive and accessibility behavior

- At 320 px, context, status, primary action, and recovery remain visible without horizontal page overflow.
- Wide tables provide an accessible scroll region and preserve row identity; important actions must not exist only off-screen.
- Drawers trap focus, close on Escape, restore focus, and lock background scroll.
- Dynamic context/status changes use restrained `aria-live` announcements and avoid duplicate chatter.
- Dialogs have labelled titles/descriptions, initial focus, Escape/cancel, focus containment, and return focus.
- Tabs use links when changing URL/resource state and buttons when changing only an in-page view.
- Touch targets, contrast, visible focus, zoom/reflow, reduced motion, and print styles are part of acceptance.
- Urdu/Kashmiri text uses correct language/direction metadata and must not be introduced as decorative pseudo-script.
