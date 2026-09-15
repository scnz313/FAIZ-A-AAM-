# Faiz E Aam Secondary School — Digital Experience Blueprint

Status: approved visual direction and relationship-aware UI contract; school identity/content still requires leadership validation. The public name observed online is **FAIZ E AAM SECONDARY SCHOOL BANDIPORA**. The official spelling, crest, board affiliation, school code, address, phone numbers, leadership names, and fee policy must be confirmed before launch.

Updated: 8 September 2026. The canonical design prototype is **`V15 Faiz E Aam School Platform.html`** (repository root; full redesign V12→V14→V15). V15 supersedes V14 (owner decision, 8 September 2026). It keeps the V14 palette, typography, radii, and breakpoints while adding richer page composition, the `q-head5`/`q-row5` five-column result queue, secondary evidence panels, facts-ledger/record-card primitives, and improved applicant-shell mobile behavior. **Copy V15 layout only — never its illustrative data, counts, actor names, or client-only authorization behavior.** Where V15's own responsive or accessibility behavior is weak, the application fixes beyond the prototype. Product relationships, domain ownership, and synchronization behavior are defined in `../FEATURE-INTEGRATION-SPEC.md`; this file defines how that behavior must appear in the interface.

## 1. Product definition

The website is one coherent school service with four clearly separated entrances:

1. **Public school website** — trust, school story, academics, notices, events, disclosures, contact.
2. **Admissions and careers centre** — new-student applications and vacancy-specific job applications.
3. **Guardian portal** — fees, receipts, results, timetables, documents, notices.
4. **Two staff operations portals (Administrator and Principal)** — admissions review, finance reconciliation, result entry/approval/publishing, timetable management, HR review, and content publishing — sharing one implementation shell (`/staff/*` under canonical `/administrator/*` and `/principal/*` routes).

The homepage must not expose private school operations. It should establish the school, then route each visitor to the correct secure journey.

## 2. Visual thesis

**A living school record:** Kashmir material cues, literary typography, measured grids, and quiet institutional precision. The tone is rooted, humane, and academically serious—not a glossy ed-tech startup.

### Visual system (V15 canonical tokens — inherited from V14)

All CSS custom properties, component classes, and layout patterns are defined in the V15 prototype (`V15 Faiz E Aam School Platform.html`, repository root; V14 is the historical reference). The implementation must use these exact tokens.

#### Colour tokens

| Token | Hex | Usage |
|---|---|---|
| `--paper` | `#F4EFE5` | Page ground |
| `--paper-deep` | `#ECE4D4` | Tinted sections, disabled inputs |
| `--paper-edge` | `#E4DAC6` | Paper edge variation |
| `--chalk` | `#FFFDF8` | Surfaces: panels, cards, forms |
| `--chalk-2` | `#FBF6EC` | Hover surfaces, upload zones |
| `--ink` | `#0B1C2A` | Text, primary actions, dark bands (ribbon, ctx-bar, footer, CTA band) |
| `--ink-2` | `#22333F` | Secondary text, nav links |
| `--ink-3` | `#3E4F5C` | Tertiary text, queue metadata |
| `--muted` | `#5A6167` | Muted text, hints, labels |
| `--faint` | `#8D8674` | Nav group labels, state-cell tags |
| `--saffron` | `#B96832` | Accent: active nav underline, focus, CTAs (button bg) |
| `--saffron-ink` | `#8C4A1B` | Accent text form (kickers, arrow-links, saffron status text) |
| `--saffron-soft` | `#F2E0CE` | Pending/progress status background |
| `--saffron-line` | `#D8AE8B` | Pending/progress status border, pinned chip border |
| `--willow` | `#536D57` | Success, verified, calm confirmations (button bg) |
| `--willow-ink` | `#39513F` | Success status text, stamp colour |
| `--willow-soft` | `#E1E8DD` | Success status background, child avatar bg |
| `--willow-line` | `#B3C2B2` | Success callout border, verified chip border |
| `--madder` | `#A33B2E` | Errors, denial, destructive actions (button bg) |
| `--madder-ink` | `#7F2C1F` | Error status text, required asterisk, withdraw/danger text |
| `--madder-soft` | `#F3DDD6` | Error status background, bad callout bg |
| `--madder-line` | `#D9A99E` | Error status border, bad callout border, validation summary border |
| `--line` | `rgba(11,28,42,.16)` | Standard borders, panel borders, table row borders |
| `--line-soft` | `rgba(11,28,42,.09)` | Soft borders, dotted separators, table inner borders |
| `--line-strong` | `rgba(11,28,42,.34)` | Strong borders, input borders, ghost button borders |
| `--ink-soft-tint` | `rgba(11,28,42,.045)` | Hover tint for rows, nav items, queue rows |
| Warning amber | `#F1E7C8` bg / `#6E5A17` text | Delayed, stale, conflict, partial statuses |

#### Typography

| Token | Family | Usage |
|---|---|---|
| `--serif` | `Source Serif 4`, Georgia, serif | Headlines, identity, promises, amounts that matter, school wordmark, record-card values, drop caps. `font-optical-sizing:auto; font-weight:520; letter-spacing:-.005em` |
| `--sans` | `Public Sans`, -apple-system, system-ui, sans | Navigation, forms, numbers, tables, labels, body text. Tabular figures for ledgers. |
| `--urdu` | `Noto Nastaliq Urdu`, serif | Urdu strings (school name, motto). `line-height:2; direction:rtl` |
| Icons | `Material Symbols Rounded` | All UI icons. `font-variation-settings:'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24` |

Base: `font-size:16px; line-height:1.6` (17px at ≥1920px). Body `font-family:var(--sans)`. Headings `h1,h2,h3,.serif` use `var(--serif)`. Numbers use `font-variant-numeric:tabular-nums lining-nums`.

#### Radii and layout

| Token | Value | Usage |
|---|---|---|
| `--r` | `4px` | Panels, inputs, buttons, modals, callouts, notice strips |
| `--r-s` | `3px` | Nav items, small controls |
| `--r-pill` | `999px` | Status badges, chips, demo bar |
| `--wrap` | `1240px` | Public page max width (1320px at ≥1920px) |
| `--wrap-narrow` | `920px` | Narrow content pages (about, academics, notices, policy) |
| Portal page | `1160px` | Staff/portal content max width |
| Sidebar | `250px` | Portal sidebar width (280px as drawer on mobile) |

#### Paper texture

A fixed full-screen noise overlay at 5% opacity, `mix-blend-mode:multiply`, using an SVG fractal noise filter. Applied via `body::after`. Disabled in print.

#### Motion

- Hero entrance: `.reveal` class with `rise` keyframe (`translateY(14px)` → none, 0.7s cubic-bezier(.2,.7,.2,1)), staggered via `.d1`–`.d5` (0.05s–0.5s delays).
- Drawer: `slideL` keyframe (0.22s ease).
- Modal: `pop` keyframe (0.22s cubic-bezier(.2,.8,.3,1)) + `fade` overlay (0.18s ease).
- Upload scan bar: `scan` keyframe (1.4s alternate infinite).
- Spinner: `spin` (0.8s linear infinite).
- `prefers-reduced-motion`: all animations/transitions set to 0.01ms, `.reveal` shown immediately.

#### Imagery

- The core interface does not depend on campus photography. If the school later chooses to add photographs, use only verified, consented real school imagery as supporting editorial content.
- Brand-derived SVG motifs only: eight-point star emblem, chinder/chinar branch divider, contour-line field (hero background). No borrowed imagery.

### What is deliberately excluded

The following generic "AI-designed" patterns are forbidden (owner-approved anti-slop rules, 8 September 2026). See `AGENTS.md` §"Anti-slop rules" for the full 30-item mandatory list with rationale. Summary:

- Checkmark bullets; 3 pricing tiers; soft corner radius above 4px; purple-and-black; radial orbs; dot grids; sparkle icons; animated arrows; bouncy hover animations; neon colors; basic pastel palette; harsh gradients; Lucide icons; pure white background; rainbow coloring; drop shadows; 3 feature cards in a row; emojis; liquid glass; em dashes as sentence punctuation; Inter/Geist/Space Grotesk; decorative colored left stripes; fake testimonials; bento grids; terminal windows; "it's not X, it's Y" copy.
- The interface MUST have: real product demos (working flows), Terms of Service, Privacy Policy, and layout-matched skeleton loaders.
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

### Guardian portal shell

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
- CBSE sources were used only as a conditional disclosure benchmark. They do not prove Faiz E Aam’s board affiliation.
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

The staff shell is profile-led: the chrome names the active portal profile — Administrator or Principal — rather than offering a free role switch. It shows:

- signed-in staff name;
- active portal profile (Administrator or Principal) with its profile code;
- active assignment or queue scope;
- academic year where relevant;
- a legacy granular workspace switch only for pre-profile accounts.

Profile-led chrome changes navigation and data context together. A staff member who is also a guardian sees an explicit "Family portal" versus "Staff workspace" switch; private family and staff information never share a single summary.

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

### 12.1 V15 component specifications

Every component below is defined in the V15 prototype with exact CSS classes, spacing, and behaviour. The implementation must match these specifications. V15 additions over V14: panels use zero outer padding (.pn-head/.pn-body only), the result queue uses the five-column q-head5/q-row5 grids, facts-ledger and record-card are canonical primitives, and the applicant shell hides its chip/quick links at ≤719px.

#### Buttons (`.btn`)

| Variant | Class | Background | Text | Border | Usage |
|---|---|---|---|---|---|
| Primary | `.btn-primary` | `--ink` | `--paper` | transparent | Default action, sign-in, submit, approve |
| Accent | `.btn-accent` | `--saffron` | `#FFFDF8` | transparent | Pay, commit, begin application, CTA |
| Ghost | `.btn-ghost` | transparent | `--ink` | `--line-strong` | Secondary, cancel, preview, download |
| Quiet | `.btn-quiet` | transparent | `--ink` | transparent, underline | Tertiary link-button, withdraw text in `--madder-ink` |
| Danger | `.btn-danger` | `--madder` | `#FFFDF8` | transparent | Withdraw, destructive confirm |
| Paper | `.btn-paper` (CTA band only) | `--paper` | `--ink` | transparent | CTA on dark bands |
| Outline-paper | `.btn-outline-paper` (CTA band only) | transparent | `--paper` | `rgba(244,239,229,.4)` | Secondary on dark bands |

Sizes: `.btn-sm` (7px 13px, .83rem), default (11px 20px, .92rem), `.btn-lg` (14px 26px, 1rem). Icons at 17px (sm) / 19px (default). `:active` translates Y 1px. `[disabled]` sets opacity .45, `cursor:not-allowed`.

#### Status badges (`.st`)

Pill-shaped, 3px 10px, .72rem, font-weight 700, with a 6px dot `::before` in `currentColor`. Aliases map domain states to five semantic tones:

| Tone | Background | Text | States |
|---|---|---|---|
| Success | `--willow-soft` | `--willow-ink` | done, success, published, succeeded, ready, active, open, approved, paid, delivered |
| Pending | `--saffron-soft` | `--saffron-ink` | progress, pending, processing, uploading, scanning, queued, generating, review, draft, unpaid |
| Fail | `--madder-soft` | `--madder-ink` | fail, error, denied, failed, revoked, suspended, quarantined, overdue, closed, rejected, miss |
| Neutral | `--ink-soft-tint` | `--ink-3` | neutral, info, expired, cancelled, archived, super |
| Warning | `#F1E7C8` | `#6E5A17` | warning, delayed, stale, conflict, partial |

`.st-none` hides the dot. Use `none` prop when the dot is not needed.

#### Chips (`.chip`)

Pill-shaped, 3px 10px, .72rem, font-weight 650, `--line` border, `--chalk` background, `--ink-3` text. Used for reference numbers, categories, role tags, pinned/urgent flags (with custom border/bg colours).

#### Forms

- `.field`: flex column, 6px gap, 18px margin-bottom. Label: .82rem, 650 weight, `--ink-2`. Hint: .78rem, `--muted`. Error: .78rem, `--madder-ink`, with error icon.
- `.input`, `.select`, `.textarea`: 100% width, 10px 12px padding, `--chalk` bg, `--line-strong` border, `--r` radius, .95rem. Focus: `--ink` border + inset box-shadow. `aria-invalid="true"`: `--madder` border + inset shadow. Disabled: `--paper-deep` bg, `--muted` text.
- `.select`: custom dropdown arrow SVG, `appearance:none`, 34px right padding.
- `.textarea`: min-height 110px, `resize:vertical`.
- `.check`: flex, 10px gap, 17px checkbox with `accent-color:var(--ink)`.
- `.radio-row`: flex, 18px gap, 16px radio with `accent-color:var(--ink)`.
- `.otp-row`: flex, 10px gap. `.otp`: 52px × 60px, centered, 1.4rem serif, `--chalk` bg, `--line-strong` border. Responsive: `clamp(38px,12.5vw,52px)` width at ≤719px.
- `.val-summary`: `--madder-line` border, `--madder-soft` bg, 14px 16px padding. Strong title with error icon, linked field list.
- `.form-grid`: 2-column grid, 20px column gap. `.full` spans both columns. Collapses to 1fr at ≤719px.

#### Tables (`.ledger`)

Institutional ledger tables: 100% width, `border-collapse`, .9rem font. Caption: serif, 1.15rem, 600 weight, left-aligned. `th`: .68rem, 700 weight, .11em letter-spacing, uppercase, `--muted` text, 2px `--ink` top border, 1px `--line` bottom border. `td`: 12px 14px 12px 0, 1px `--line-soft` bottom border. Last row: 1px `--line` bottom. `.num` class: right-aligned, tabular-nums. `tbody tr:hover`: `--ink-soft-tint` bg. `.click` class: `cursor:pointer`. Wrap in `.table-wrap` for horizontal scroll on narrow screens (min-width:600px at ≤719px).

#### Panels (`.panel`)

`--chalk` bg, 1px `--line` border, `--r` radius, **zero outer padding** — all spacing comes from `.pn-head`/`.pn-body`. `.pn-head`: flex between, 14px 18px padding, 1px `--line-soft` bottom border, optional sub line. `.pn-body`: 18px padding. `.pn-body.flush`: 0 padding (for tables). Panel + panel: 18px margin-top.

#### Layout primitives

- `.wrap`: max-width 1240px, auto margins, `clamp(16px,4vw,40px)` padding.
- `.wrap-n`: max-width 920px, same padding.
- `.stack`: flex column. `.row`: flex, align-center, 12px gap. `.row-between`: flex, space-between, wrap. `.grid`: grid, 24px gap.
- `.g32`: 3fr 2fr grid, 22px gap. `.g34`: 3fr 2fr grid, 34px gap. `.g23`: 2fr 3fr grid, 44px gap. All collapse to 1fr at ≤1023px.
- `.label`: .68rem, 700 weight, .13em letter-spacing, uppercase, `--muted`.
- `.rule`: 1px `--line-soft` top border. `.rule-strong`: 2px `--ink` top border.
- `.underline-link`: `--ink` text, saffron underline (1.5px, 3px offset). Hover: `--saffron-ink`.
- `.arrow-link`: inline-flex, saffron-ink, 650 weight, with arrow icon. Hover: underline.
- `.leader`: flex baseline, 8px gap. `.dots`: flex-1, dotted bottom border. `.val`: tabular-nums, 650 weight. `.lbl`: `--muted`, .88rem.
- `.ref`: tabular-nums, .8rem, `--muted`, .02em letter-spacing. For reference numbers.
- `.kv`: grid `minmax(120px,180px) minmax(0,1fr)`, 6px 18px gap. `dt`: `--muted`, .8rem. `dd`: 550 weight. Collapses to 1fr at ≤719px.
- **V15 facts-ledger** (`.facts-ledger`): 2px `--ink` top border; `.fl-row` flex space-between with `.k` (uppercase label) and `.v` (serif 600 value). Collapses to stacked column at ≤719px.
- **V15 record card** (`.record-card`): `--chalk` bg, `--line-strong` border, `.rc-head` (label + chip) and `.rc-row` dotted key/value rows. Used on the hero specimen, About school-record sidebar, and AuthFrame identity card.

#### Public site components

- **Ribbon** (`.ribbon`): `--ink` bg, `--paper` text, .78rem. School unit, location, disclosure/notices/sign-in links. 38px min-height.
- **Site header** (`.site-head`): `--paper` bg, 1px `--line` bottom border. Brand lockup (emblem + name + sub), main nav, head CTAs. 76px min-height. Burger menu at ≤1120px.
- **Main nav** (`.main-nav`): 9px 12px padding, .9rem, 600 weight, `--ink-2` text. `.on`: `--ink` text + 2px saffron underline. Hover: `--ink` text + `--ink-soft-tint` bg.
- **Hero** (`.hero`): relative, overflow-hidden, contour SVG bg at 50% opacity. Grid `7fr 5fr`, `clamp(28px,5vw,72px)` gap. H1: `clamp(2.5rem,5.4vw,4.35rem)`, 540 weight, `--saffron-ink` italic emphasis. Lede: serif, `clamp(1.05rem,1.6vw,1.3rem)`. Record card on right with stamp SVG.
- **Sections** (`.sec`): `clamp(44px,6vw,84px)` padding. `.sec-tint`: `--paper-deep` bg. `.sec-chalk`: `--chalk` bg with top/bottom borders.
- **Service rail** (`.service-rail`): 4-column grid, `--line-strong` border, `--chalk` bg. Each cell: 22px padding, saffron-ink icon (26px), serif title, muted description, "Open →" link. 2 columns at ≤1023px, 1 column at ≤719px.
- **Notice strip** (`.notice-strip`): `--chalk` bg, 1px `--line` border, 16px 20px padding. Saffron-ink tag, serif title, muted date, arrow-link.
- **Story grid** (`.story-grid`): `3fr 2fr` grid. Narrative: serif, `clamp(1.12rem,1.8vw,1.42rem)`, drop cap on first letter (3.2em, saffron-ink). Facts ledger: 2px `--ink` top border, fl-row with label/value.
- **Stages** (`.stages`): 4-column grid, 2px `--ink` top border. Each stage: 24px 22px padding, saffron-ink grade label, serif title, muted description. 2 columns at ≤1023px, 1 column at ≤719px.
- **Life index** (`.life-index`): 2px `--ink` top border. Each row: grid `44px minmax(0,1fr) 30px`, 19px padding, willow-ink circle icon, sans title, muted description, chevron.
- **Dates ledger** (`.dates-ledger`): grid `130px minmax(0,1fr) auto`, 15px padding, tabular-nums date, description, tag.
- **CTA band** (`.cta-band`): `--ink` bg, `--paper` text, `--r` radius, `clamp(30px,4.5vw,54px)` padding. Grid `2fr auto`. Paper/outline-paper buttons.
- **Footer** (`.site-foot`): `--ink` bg, `#C9CFD4` text. 4-column grid `2fr 1fr 1fr 1fr`. Emblem (mono/paper), Urdu line, link columns. Foot-base: 1px top border, copyright, design-prototype notice.

#### Portal shell components

- **App shell** (`.app-shell`): grid `250px minmax(0,1fr)`, 100vh min-height. Sidebar becomes fixed drawer (280px, translateX(-102%)) at ≤1023px.
- **Sidebar** (`.side`): `--chalk-2` bg, 1px right border, sticky, 100vh, overflow-y auto. Side-head: 18px padding, avatar (38px circle, `--ink` bg, `--paper` text, serif), name, role. Side-nav: grouped links with 19px icons, `.on` state with 2px saffron left border + `--chalk` bg. Count badges: pill, .7rem, `--paper-deep` bg. Side-foot: 12px 16px, school name, exit button.
- **Context bar** (`.ctx-bar`): `--ink` bg, `--paper` text, sticky, z-index 70. School emblem + name (left), child switcher or staff extra (right). Child menu: `rgba(244,239,229,.1)` bg button, popover with `--chalk` bg, `--ink` border, child items with willow-soft avatars.
- **Page** (`.page`): `clamp(20px,3.2vw,36px) clamp(16px,3vw,32px) 64px` padding, 1160px max-width.
- **Page head** (`.page-head`): flex between, 26px margin-bottom. H1: `clamp(1.5rem,2.4vw,1.95rem)`, 580 weight. Sub: `--muted`, .92rem. Actions: flex, 10px gap.

#### Queue and workflow components

- **Queue** (`.queue`): 2px `--ink` top border. `.q-row`: grid `2.2fr 1.4fr 130px auto`, 14px gap, 14px padding, hover tint. `.q-head`: same grid, uppercase labels. `.q-mini`: `1fr auto auto` grid. `.q-adj`: `2fr 2fr 1fr auto` grid. **V15 result queue:** `.q-head5`/`.q-row5`: grid `2fr 1.15fr 1fr 150px auto` (Batch/Term/Entry/Status/Action). At ≤719px `.q-head5` hides and `.q-row5` uses grid-areas `"t a" "m a" "e a" "s a"` with 7px row-gap.
- **Maker-checker** (`.maker-checker`): inline-flex, .72rem, 700 weight, `--ink-3` text, dashed `--line-strong` border, pill radius, 14px icon.
- **Timeline** (`.timeline`): 26px left padding, 1px `--line-strong` vertical line. `.tl-item`: relative, 22px bottom padding, 11px circle `::before` (chalk bg, 2px muted border). `.done`: willow fill. `.cur`: saffron fill + 4px saffron-soft outline. When/date/title/description.
- **Wizard** (`.wizard`): grid `250px minmax(0,1fr)`, `clamp(24px,4vw,56px)` gap. `.wiz-rail`: sticky, top 24px. `.wr-item`: flex, 13px gap, 30px circle number (done=willow, cur=ink, default=line-strong border). `.wr-line`: 1px connector. `.wiz-form`: `--chalk` bg, 1px border, `--r` radius, `clamp(20px,3vw,32px)` padding. `.wiz-foot`: space-between, 20px top border. Collapses to 1fr at ≤1023px (rail becomes horizontal scroll).

#### Modal and drawer

- **Overlay** (`.overlay`): fixed inset, `rgba(11,28,42,.48)` bg, flex center, 20px padding, `fade` animation.
- **Modal** (`.modal`): `--paper` bg, **2px `--ink` border**, `--r` radius, `min(560px,100%)` width (wide: 720px), 88vh max-height, overflow-y auto, `pop` animation. `.m-head`: 18px 22px, 1px bottom border, title + close icon-btn. `.m-body`: 22px padding. `.m-foot`: flex end, 16px 22px, 1px top border.
- Focus trap: on mount, save `activeElement`, focus first focusable, trap Tab/Shift+Tab, restore focus on unmount. Escape closes. Click-outside closes.
- **Icon button** (`.icon-btn`): 34px square, `--r` radius, `--muted` text. Hover: `--ink-soft-tint` bg, `--ink` text.

#### Payment states (`.pay-state`)

Centered, 16px top padding. `.ps-ic`: 64px circle, 32px icon. `.ok`: willow-soft bg, willow-ink text. `.bad`: madder-soft bg, madder-ink text. `.wait`: saffron-soft bg, saffron-ink text. Spinner: 22px, 2.5px saffron-soft border, saffron top, 0.8s spin.

#### Callouts (`.callout`)

1px `--line-strong` border, `--r` radius, `--chalk` bg, 14px 18px padding, 20px icon. Variants: `.warn` (saffron), `.bad` (madder), `.good` (willow). Default: ink-3 icon.

#### Empty states (`.empty-ill`)

56px dashed circle, `--line-strong` border, `--faint` text, 26px icon. Used with title, description, and optional action button.

#### Upload slots (`.upload`)

1.5px dashed `--line-strong` border, `--r` radius, 26px 20px padding, `--chalk-2` bg, centered. Hover: `--ink` border, `--chalk` bg. Saffron-ink icon (30px), title, hint. `.up-file`: 1px border, `--chalk` bg, 11px 14px padding, file icon, name, metadata, scan progress bar (`.up-bar` with `scan` animation).

#### Demo bar (`.demo-bar`)

Fixed bottom-center, `--ink` bg, `--paper` text, pill border, z-index 1500. Workspace switcher buttons. Hidden in print. Horizontal scroll on narrow screens.

#### Brand SVG motifs

- **Emblem** (`Emblem`): 400×400 viewBox, eight-pointed star outline (ink fill, gold stroke), inner star rotation, book/open-book base with gold lines, contour detail. Mono variant for dark backgrounds (paper fill). Sizes: 46px (header), 52px (footer), 40px (auth), 26px (ctx-bar).
- **Star ornament** (`StarOrn`): 24×24 decorative star, `currentColor` fill.
- **Contours** (`Contours`): 1440×640 viewBox, contour-line paths at varying opacity, two saffron dots. Used as hero background at 50% opacity.
- **Stamp**: 92×92 SVG, double circle (willow stroke), "RECEIVED" + date text, rotated -7deg. Positioned absolute on record cards.

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

### V15 responsive breakpoints

| Breakpoint | Changes |
|---|---|
| ≥1920px | `--wrap` becomes 1320px, base font-size 17px |
| ≤1180px | Main nav padding reduces to 7px, head-cta buttons shrink, ghost CTA hidden |
| ≤1120px | Main nav hidden, burger menu shown |
| ≤1023px | Portal sidebar becomes fixed drawer (280px, translateX(-102%), `.open` slides in). Grids `.g32/.g34/.g23` collapse to 1fr. Hero becomes single column. Stages become 2 columns. Story grid becomes 1fr. CTA band becomes 1fr. Wizard becomes 1fr (rail becomes horizontal scroll). Service rail becomes 2 columns. Footer becomes 2 columns. Context burger shown. Head CTA hidden. Notice strip wraps. |
| ≤719px | Demo bar labels hidden. Life row becomes 2-column (icon + content). Segments wrap. Tables get min-width:600px with scroll. OTP inputs shrink to `clamp(38px,12.5vw,52px)`. Queue rows restructure with grid-areas (`q-row` `"t a"/"m a"/"s a"`; V15 `q-row5` `"t a"/"m a"/"e a"/"s a"` with `.q-head5` hidden). Form grid collapses to 1fr. Service rail becomes 1 column. Stages become 1 column. Dates ledger becomes 1 column. Footer becomes 1 column. KV becomes 1 column. Facts-ledger rows stack. Ribbon/context-bar hide secondary spans. V15 applicant shell: `.chip-m-hide` and `.app-shell-links` hidden. |
| ≤479px | Brand emblem shrinks to 38px. Brand name .95rem. Modal foot wraps, buttons flex-1. Hero CTAs full width. |

### Accessibility rules

- At 320 px, context, status, primary action, and recovery remain visible without horizontal page overflow.
- Skip link (`.skip`): fixed, top:-48px, z-index 3000, `--ink` bg, `--paper` text. `:focus` slides to top:12px.
- `:focus-visible`: 2px `--saffron-ink` outline, 2px offset, 2px border-radius.
- `::selection`: `--saffron-soft` background.
- `.sr-only`: 1px clipped, for screen-reader-only text.
- Wide tables provide an accessible scroll region (`.table-wrap`) and preserve row identity; important actions must not exist only off-screen.
- Drawers trap focus, close on Escape, restore focus, and lock background scroll.
- Dynamic context/status changes use restrained `aria-live` announcements and avoid duplicate chatter.
- Dialogs have labelled titles/descriptions, initial focus, Escape/cancel, focus containment, and return focus.
- Tabs use links when changing URL/resource state and buttons when changing only an in-page view. `role="tablist"`, `role="tab"`, `aria-selected`.
- Touch targets, contrast, visible focus, zoom/reflow, reduced motion, and print styles are part of acceptance.
- Urdu/Kashmiri text uses correct language/direction metadata (`dir="rtl"`, `.urdu` class) and must not be introduced as decorative pseudo-script.
- `prefers-reduced-motion`: all animations/transitions set to 0.01ms, `.reveal` shown immediately, scroll-behavior auto.

### Print styles

- Body bg white. Noise overlay, demo bar, sidebar, ctx-bar, site-head, ribbon, main-nav, burger hidden.
- App-shell becomes block. Page max-width none, 0 padding. Panels: no shadow, #999 borders.
- `.print-only` elements shown. `.no-print` elements hidden.

## 17. V15 screen catalog

The V15 prototype defines every screen the platform must implement. V15 composition changes: About gains a two-column g34 school-record sidebar; notice detail gains a notice-board sidebar and office panel; admissions preflight gains a key-dates facts-ledger; Administrator gains the Guardians planned-workspace placeholder (honest, no fake campaign operations) and richer evidence panels. Each screen has a canonical route, layout, and component composition documented in the HTML.

### Public website (`/public/*`)

| Screen | Route | Key components | Layout |
|---|---|---|---|
| Home | `home` | Hero (contours bg, kicker, h1 with italic emphasis, lede, CTAs, record card with stamp), service rail (4 cells), notice strip, story grid (narrative + facts ledger), stages (4), life index (6), dates ledger (5), CTA band | `.wrap` sections |
| About | `about` | PageHero, V15 two-column g34: history + mission + leadership narrative (left); school-record card (facts-ledger), verification callout, on-this-page index (right) | `.wrap` g34 |
| Academics | `academics` | PageHero, school day structure (ledger table), examination approach (4-cell grid), subjects by stage (ledger table) | `.wrap-n` |
| Admissions | `admissions` | PageHero, window callout, 4-step stages, eligibility & documents (2-column grid), CTA row | `.wrap-n` |
| Apply pre | `apply-pre` | Before-you-start screen, 3 numbered cards (eligibility, files, drafts), CTA row, V15 key-dates facts-ledger | `.wrap-n` |
| School life | `school-life` | PageHero, life index (6 items), facilities grid (4 items) | `.wrap-n` |
| Notices | `notices` | PageHero, category segments, notice strip list (pinned/urgent chips) | `.wrap-n` |
| Notice detail | `notice` | V15 two-column g34: back link, chips, h1, body, attachments panel (left); notice-board panel (recent notices) + office contact panel (right) | `.wrap` g34 |
| Disclosure | `disclosure` | PageHero, mandatory disclosure ledger table, downloads panel | `.wrap-n` |
| Careers | `careers` | PageHero, open vacancies (record cards), closed vacancies (muted) | `.wrap-n` |
| Vacancy detail | `vacancy` | Back link, chips, h1, lede, responsibilities/qualifications (2-col grid), required documents panel, apply CTA | `.wrap-n` max 820px |
| Contact | `contact` | PageHero, facts ledger (left), grievance form panel (right) with success state | `.wrap` g23 |
| Policy | `policy` | PageHero, fee schedule sections (2px ink top borders), pending callout | `.wrap-n` |

### Identity (`/identity/*`)

| Screen | Route | Key components |
|---|---|---|
| Sign in | `sign-in` | AuthFrame, phone/email + password fields, fail/ratelimit/provider error callouts, prototype shortcuts |
| Verify (OTP) | `verify` | AuthFrame, 6-digit OTP row, countdown timer, resend link, wrong/expired states |
| Recovery | `recovery` | AuthFrame, email field, success state with reference |
| Register | `register` | AuthFrame (wide), form-grid (name, phone, email, password), consent checkbox, success state |
| Staff sign-in | `staff` | AuthFrame (wide), work email + password + TOTP fields, demo role switcher |
| Session expired | `session-expired` | AuthFrame, pay-state (wait icon), sign-in CTA |
| Access denied | `access-denied` | AuthFrame, pay-state (bad icon), sign-in/support CTAs |

AuthFrame: site-head (brand only), centered card (`min(440px,100%)` or `min(560px,100%)` wide), record-card container, foot text.

### Applicant (`/applicant/*`)

| Screen | Route | Key components |
|---|---|---|
| Student wizard | `wizard` | 8-step wizard (wiz-rail + wiz-form), autosave indicator, validation summary, form-grid per step, upload slots, review KV, declaration checkbox, submit CTA |
| Application status | `status` | Reference + status badge, timeline panel, change-request panel, offer panel, readiness checklist, application facts KV, withdraw button |
| Job wizard | `job-wizard` | 4-step wizard, form-grid, upload slots, consent, submit |
| Job status | `job-status` | Reference + status, timeline, next steps, withdraw modal |

### Guardian portal (`/portal/*`)

| Screen | Route | Key components |
|---|---|---|
| Overview | `overview` | PageHead (greeting), fees panel (balance + ledger), results panel, notices panel, active child panel, quick actions, support |
| Fees | `fees` | PageHead, balance/next-due/concessions row, filter segments, invoice ledger table, concessions callout |
| Invoice | `invoice` | PageHead (crumb), line items (leader rows), payment attempts table, invoice facts KV, payment modal trigger |
| Receipt | `receipt` | PageHead (crumb), receipt panel (leader rows), allocation panel, PDF generation state |
| Results | `results` | PageHead, term tabs, subject marks ledger table, aggregate panel, released reports panel |
| Release detail | `release` | PageHead (crumb), immutable release callout, subjects ledger table |
| Timetable | `timetable` | PageHead, day/week/exam segments, day view (ledger table), week view (grid table), exam date sheet (ledger table), overrides callout |
| Notices | `notices` | PageHead, expandable notice panels (accordion) |
| Documents | `documents` | PageHead, documents ledger table (state badges, preview/download actions), quarantine callout |
| Profile | `profile` | PageHead, guardian panel, linked children panel, enrolment references KV |
| Security | `security` | PageHead, active sessions table, sign-in method panel |
| Support | `support` | PageHead, new request form, your requests list, response-time callout |
| Link child | `link-child` | PageHead, how-linking-works callout, claim reference form, submitted state |

### Administrator (`/administrator/*`)

| Screen | Route | Key components |
|---|---|---|
| Overview | `overview` | PageHead (role chips), work queue (6 q-mini rows), maker-checker panel, audit entries panel |
| Admissions | `admissions` | PageHead, stage filter segments, search, queue (q-row with maker-checker badges) |
| Admission detail | `admission-detail` | PageHead (crumb, status, maker-checker lock), application KV, documents table, decision panel (approve/request/regret), audit trail, guardian link |
| Careers | `careers` | PageHead (role chips), job queue, privacy callout |
| Job detail | `job-detail` | PageHead (crumb), scorecard ledger table, decision panel, interview panel |
| Finance | `finance` | PageHead (role chips), tabs (invoices/payments/reconciliation/adjustments), ledger tables, reconciliation KV, adjustment q-adj rows |
| Results | `results` | PageHead (role chips), V15 result batches queue (`q-head5`/`q-row5` five-column), immutability callout |
| Result batch | `result-batch` | PageHead (crumb, status), marks ledger table, V15 entry-progress panel, moderation panel, publication checklist |
| Notices | `notices` | PageHead, notices ledger table, publish modal |
| Content | `content` | PageHead, pages ledger table, versioning callout |
| Documents | `documents` | PageHead, documents oversight ledger table |
| Users | `users` | PageHead, staff ledger table, invite modal (role multi-select) |
| Link requests | `link-requests` | PageHead, claims ledger table, verify/reject actions, security callout |
| Guardians | `guardians` | PageHead, guardian activation summary, contacts and linked-students ledger, email send/resend/revoke actions |
| Imports | `imports` | PageHead, 6-step import wizard (upload/map/validate/resolve/commit/report) |
| Exports | `exports` | PageHead, exports ledger table, download details KV, format callout |
| Settings | `settings` | PageHead, versioned config panels, propose-change modal |
| Audit | `audit` | PageHead, audit ledger table, append-only callout |

### Principal (`/principal/*`)

| Screen | Route | Key components |
|---|---|---|
| Overview | `overview` | PageHead (role chips), work queue (6 q-row), maker-checker rule callout |
| Admissions review | `admissions` | PageHead, admissions queue |
| Admission review | `admission-review` | PageHead (crumb), file summary KV, review panel (note textarea, recommend/request/against), applicant-facing note panel |
| Careers (scorecard) | `careers` | PageHead (crumb), scorecard ledger table (rating selects), panel note textarea, submit |
| Finance operations | `finance` | PageHead (role chips), your requests panel, post-approved panel, fee ledger read view |
| Result entry | `results` | PageHead (crumb, maker-checker), marks entry table (editable inputs), flags, submit for moderation |
| Timetables | `timetables` | PageHead (role chips), tabs (class/exam/overrides), conflict callout, draft timetable grid, resolution, publish, override table |
| Teaching records | `teachers` | PageHead, teachers ledger table (assignments, no sign-in), new record modal, never-a-login callout |
| Content | `content` | PageHead, draft editor panel, your drafts list, review request |
| Documents | `documents` | PageHead, documents ledger table |
| Support | `support` | PageHead, support thread panel, thread rules, queue |
| Notices | `notices` | PageHead, draft notice form, notice states list |

### UI states gallery (`/states`)

A dedicated screen showing all 33 committed UI states: loading, empty, no published data, no filter results, not found, access denied, wrong profile, wrong child, revoked link, suspended account, TOTP required, session expired, validation failure, stale version, conflict, duplicate retry, provider unavailable, retryable failure, permanent failure, partial success, uploading, scanning, ready, quarantined, missing, expired, payment processing, payment failed, payment cancelled, payment delayed, notification queued, export ready, import failed at commit.

### System reference (`/system`)

Colour swatches, typography specimens, component gallery (buttons, statuses, chips, inputs), and the role/route matrix table.

## 18. V15 role and route matrix

| Area | Visitor | Applicant | Guardian | Administrator | Principal |
|---|---|---|---|---|---|
| Public site | Full | Full | Full | Full | Full |
| Admissions apply & track | Start only | Own application | None | Queue & approve | Review & recommend |
| Job applications | Vacancies only | Own application | None | HR decisions | Scorecards & interviews |
| Fees, invoices, receipts | None | Admission invoice | Own children | School finance | Requests & posting |
| Results | None | None | Published releases | Moderation & publish | Entry & review |
| Timetables | None | None | Own child | None | Edit, publish, override |
| Notices & content | Read | Read | Read | Approve & publish | Draft & request review |
| Users, links, settings, audit | None | None | Own security | Full administration | None |

Student records are always viewed through an authorized guardian or staff member; there is no student or teacher sign-in in this release. The internal staff namespace is never exposed in any navigation, button or copy.

## 19. V15 navigation structure

### Guardian portal nav

```
Overview
Your child: Fees · Results · Timetable · Notices · Documents
Account: Profile · Security · Support · Link a child
```

### Administrator nav

```
Overview
Work: Admissions (count) · Careers · Finance · Results
Content: Notices · Content (count)
Records: Documents · Users · Guardian links (count) · Guardians
Data & control: Imports · Exports (count) · Settings · Audit
```

### Principal nav

```
Overview
Work: Admissions · Careers (count) · Finance · Results (count)
Academics: Timetables · Teaching records
Content: Notices · Content
Office: Documents · Support (count)
```

## 20. Implementation priority

When implementing the V15 design in the existing Next.js codebase:

1. **Do not change the database, domain services, or backend logic.** Only update UI components, CSS modules, layouts, and page rendering.
2. **Map V15 CSS classes to existing CSS modules.** The V15 prototype uses semantic class names (`.panel`, `.ledger`, `.st`, `.btn`, etc.) that should be adopted as the canonical class naming convention.
3. **Adopt the V15 design tokens** as CSS custom properties in the global stylesheet, replacing any existing token definitions.
4. **Implement the V15 component catalog** (section 12.1) as shared React components, replacing existing ad-hoc components where they differ.
5. **Match the V15 screen layouts** for each route, using the screen catalog (section 17) as the reference for composition and component placement.
6. **Verify responsive behavior** against the V15 breakpoints (section 16) at 320px, 480px, 720px, 1024px, 1180px, 1440px, and 1920px.
7. **Verify accessibility** against the V15 patterns: skip link, focus-visible, reduced motion, ARIA roles, focus trap in modals/drawers.
8. **Preserve all existing functionality** — the V15 design is a visual/UX layer change, not a feature or data model change.
