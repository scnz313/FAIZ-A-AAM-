-- =============================================================================
-- Deterministic synthetic seed (plan.md §11 B0: "deterministic seed files").
--
-- B0 seeds reference data; domain configuration arrives with its phase
-- (school configuration in B1, admission windows/fee schedule/exam/timetable
-- configuration in B2–B6). Rows that require an authenticated user account
-- (applications, staff, students, documents, content versions) are created
-- only by authorized commands — never by this seed. Every statement is
-- idempotent so `supabase db reset` reproduces the same state without
-- dashboard-only SQL.
--
-- No real student, guardian, applicant, job, financial, result, or document
-- data may ever enter these seeds (plan.md §14).
-- =============================================================================

-- Canonical role codes — the same role model the frontend authorization
-- module exposes (apps/web/modules/services/staff-authorization.ts), so the
-- server grant model and the UI action model stay in agreement.
insert into public.role_definitions (code, label, description) values
  ('guardian', 'Guardian', 'Family portal access through verified guardian/student links.'),
  ('student', 'Student', 'Own student records; disabled until the school approves the student-account policy.'),
  ('content_editor', 'Content editor', 'Drafts notices and public content (content.draft).'),
  ('content_publisher', 'Content publisher', 'Reviews and publishes notices and content (content.publish).'),
  ('admissions_officer', 'Admissions officer', 'Reviews applications and moves them to assessment (admissions.review).'),
  ('admissions_approver', 'Admissions approver', 'Decides offers, waitlists, and declines (admissions.approve).'),
  ('finance_officer', 'Finance officer', 'Finance operations and payment handling (finance.operate).'),
  ('finance_approver', 'Finance approver', 'Approves refunds, write-offs, and reconciliation (finance.approve).'),
  ('hr_reviewer', 'HR reviewer', 'Scores and reviews job applications (careers.review).'),
  ('hr_approver', 'HR approver', 'Advances, rejects, and offers on job applications (careers.approve).'),
  ('teacher', 'Teacher', 'Enters marks for assigned class/subject batches and views own timetable (results.enter).'),
  ('exam_reviewer', 'Exam reviewer', 'Moderates and approves result batches (results.approve).'),
  ('result_publisher', 'Result publisher', 'Publishes, corrects, and withdraws result publications (results.publish).'),
  ('timetable_manager', 'Timetable manager', 'Creates, validates, publishes, and overrides timetables (timetable.manage).'),
  ('support_officer', 'Support officer', 'Responds to support requests and verifies guardian links (support.respond, links.verify).'),
  ('auditor', 'Auditor', 'Read-only audit and reconciliation projections (audit.view).'),
  ('system_administrator', 'System administrator', 'Manages accounts, grants, and configuration — never business approvals (users.manage, settings.manage).')
on conflict (code) do nothing;

-- =============================================================================
-- B1 school configuration (synthetic; plan.md §14 — no real school data)
-- =============================================================================

insert into public.academic_years (label, starts_on, ends_on, status) values
  ('2025-26', '2025-04-01', '2026-03-31', 'historical'),
  ('2026-27', '2026-04-01', '2027-03-31', 'current')
on conflict (label) do nothing;

insert into public.grades (code, label, sort_order) values
  ('6', 'Class 6', 6),
  ('7', 'Class 7', 7),
  ('8', 'Class 8', 8),
  ('9', 'Class 9', 9),
  ('10', 'Class 10', 10)
on conflict (code) do nothing;

-- Sections match the frontend demo placement (Class 8-A, Class 9-C).
insert into public.grade_sections (academic_year_id, grade_id, section_label, status)
select ay.id, g.id, s.section_label, 'active'
  from (values ('8', 'A'), ('9', 'C')) as s(grade_code, section_label)
  join public.grades g on g.code = s.grade_code
  join public.academic_years ay on ay.label = '2026-27'
on conflict (academic_year_id, grade_id, section_label) do nothing;

insert into public.subjects (code, name) values
  ('MAT', 'Mathematics'),
  ('SCI', 'General Science'),
  ('ENG', 'English'),
  ('URD', 'Urdu'),
  ('KAS', 'Kashmiri'),
  ('SST', 'Social Science'),
  ('COM', 'Computer Science')
on conflict (code) do nothing;

insert into public.rooms (code, label, kind) values
  ('R21', 'Room 21 · 8-A', 'classroom'),
  ('R11', 'Room 11 · 9-B', 'classroom'),
  ('LAB2', 'Lab 2', 'lab'),
  ('CLAB', 'Computer lab', 'lab'),
  ('GRD', 'Ground', 'hall'),
  ('CTYD', 'Courtyard', 'other'),
  ('DINE', 'Dining hall', 'other')
on conflict (code) do nothing;

-- Working days Mon–Sat, periods 08:30–14:30 for the current year.
insert into public.period_definitions (academic_year_id, day_of_week, period_number, starts_at, ends_at)
select ay.id, d.day_of_week, d.period_number, d.starts_at, d.ends_at
  from (values
    (1, 1, '08:30'::time, '08:45'::time),
    (1, 2, '08:45'::time, '09:30'::time),
    (1, 3, '09:30'::time, '10:15'::time),
    (1, 4, '10:15'::time, '11:00'::time),
    (1, 5, '11:15'::time, '12:00'::time),
    (1, 6, '12:00'::time, '12:45'::time),
    (1, 7, '13:30'::time, '14:15'::time),
    (1, 8, '14:15'::time, '15:00'::time),
    (2, 1, '08:30'::time, '08:45'::time),
    (2, 2, '08:45'::time, '09:30'::time),
    (2, 3, '09:30'::time, '10:15'::time),
    (2, 4, '10:15'::time, '11:00'::time),
    (2, 5, '11:15'::time, '12:00'::time),
    (2, 6, '12:00'::time, '12:45'::time),
    (2, 7, '13:30'::time, '14:15'::time),
    (2, 8, '14:15'::time, '15:00'::time),
    (3, 1, '08:30'::time, '08:45'::time),
    (3, 2, '08:45'::time, '09:30'::time),
    (3, 3, '09:30'::time, '10:15'::time),
    (3, 4, '10:15'::time, '11:00'::time),
    (3, 5, '11:15'::time, '12:00'::time),
    (3, 6, '12:00'::time, '12:45'::time),
    (3, 7, '13:30'::time, '14:15'::time),
    (3, 8, '14:15'::time, '15:00'::time),
    (4, 1, '08:30'::time, '08:45'::time),
    (4, 2, '08:45'::time, '09:30'::time),
    (4, 3, '09:30'::time, '10:15'::time),
    (4, 4, '10:15'::time, '11:00'::time),
    (4, 5, '11:15'::time, '12:00'::time),
    (4, 6, '12:00'::time, '12:45'::time),
    (4, 7, '13:30'::time, '14:15'::time),
    (4, 8, '14:15'::time, '15:00'::time),
    (5, 1, '08:30'::time, '08:45'::time),
    (5, 2, '08:45'::time, '09:30'::time),
    (5, 3, '09:30'::time, '10:15'::time),
    (5, 4, '10:15'::time, '11:00'::time),
    (5, 5, '11:15'::time, '12:00'::time),
    (5, 6, '12:00'::time, '12:45'::time),
    (5, 7, '13:30'::time, '14:15'::time),
    (5, 8, '14:15'::time, '15:00'::time),
    (6, 1, '08:30'::time, '08:45'::time),
    (6, 2, '08:45'::time, '09:30'::time),
    (6, 3, '09:30'::time, '10:15'::time),
    (6, 4, '10:15'::time, '11:00'::time),
    (6, 5, '11:15'::time, '12:00'::time),
    (6, 6, '12:00'::time, '12:45'::time),
    (6, 7, '13:30'::time, '14:15'::time),
    (6, 8, '14:15'::time, '15:00'::time)
  ) as d(day_of_week, period_number, starts_at, ends_at)
  join public.academic_years ay on ay.label = '2026-27'
on conflict (academic_year_id, day_of_week, period_number) do nothing;

-- Settings start policy-pending; nothing becomes effective until approved.
insert into public.settings_versions (version, status, policy, change_reason) values
  (1, 'policy_pending', '{"payment": {"partial_payments": true, "refund_policy": "pending"}, "results": {"grade_bands": "pending"}, "admissions": {"window_policy": "pending"}}'::jsonb,
   'Synthetic policy-pending defaults — school decisions required (plan.md §14).')
on conflict (version) do nothing;

insert into public.feature_flags (code, enabled, note) values
  ('student_accounts', false, 'Disabled until the school approves the student-account policy.'),
  ('payment_gateway', false, 'Disabled until a gateway and merchant are approved.')
on conflict (code) do nothing;

-- =============================================================================
-- B2 admission windows (synthetic configuration; policy-pending until the
-- school approves the admission calendar — plan.md §14)
-- =============================================================================
insert into public.admission_windows (academic_year_id, grade_id, opens_at, closes_at, capacity, policy, status)
select ay.id, g.id, '2026-08-01T00:00:00+05:30', '2026-10-31T23:59:59+05:30', 60, '{"synthetic": true, "admission_policy": "pending"}'::jsonb, 'planned'
  from public.academic_years ay
  join public.grades g on g.code in ('6', '7', '8', '9', '10')
 where ay.label = '2026-27'
on conflict (academic_year_id, grade_id) do nothing;

-- Document requirements are configuration data: without them the applicant
-- form renders no file inputs and no application document can attach.
insert into public.admission_document_requirements
  (admission_window_id, code, label, required, allowed_mime_types, max_bytes, status, version)
select aw.id, d.code, d.label, true, d.allowed_mime_types, d.max_bytes, 'active', 1
  from public.admission_windows aw
  join public.academic_years ay on ay.id = aw.academic_year_id and ay.label = '2026-27'
  cross join (values
    ('birth', 'Birth certificate', array['application/pdf', 'image/jpeg', 'image/png']::text[], 5242880::bigint),
    ('photo', 'Student photograph', array['image/jpeg', 'image/png']::text[], 5242880::bigint),
    ('reportCard', 'Previous report card', array['application/pdf', 'image/jpeg', 'image/png']::text[], 5242880::bigint),
    ('addressProof', 'Address proof', array['application/pdf', 'image/jpeg', 'image/png']::text[], 5242880::bigint)
  ) as d(code, label, allowed_mime_types, max_bytes)
on conflict (admission_window_id, code, version) do nothing;

-- =============================================================================
-- B4 fee schedule (synthetic draft; never effective until approved)
-- =============================================================================
insert into public.fee_schedule_versions (version, status, policy) values
  (1, 'draft', '{"synthetic": true, "school_decision": "pending"}'::jsonb)
on conflict (version) do nothing;

insert into public.fee_schedule_items (schedule_version_id, code, label, amount_paise, period, kind, sort_order)
select fsv.id, s.code, s.label, s.amount_paise, s.period, s.kind, s.sort_order
  from public.fee_schedule_versions fsv
  cross join (values
    ('tuition', 'Tuition fee', 1200000, 'annual', 'fee', 10),
    ('admission', 'Admission fee', 500000, 'once', 'fee', 20),
    ('development', 'Development fund', 300000, 'annual', 'fee', 30),
    ('exam', 'Examination fee', 200000, 'annual', 'fee', 40)
  ) as s(code, label, amount_paise, period, kind, sort_order)
 where fsv.version = 1
on conflict (schedule_version_id, code) do nothing;

-- =============================================================================
-- B5 exam configuration and draft timetable (synthetic; planned/draft only)
-- =============================================================================
insert into public.grade_band_versions (version, status, bands) values
  (1, 'draft', '{"synthetic": true, "bands": [{"min": 90, "grade": "A1"}, {"min": 75, "grade": "A"}, {"min": 60, "grade": "B"}, {"min": 45, "grade": "C"}, {"min": 33, "grade": "D"}, {"min": 0, "grade": "E"}], "school_decision": "pending"}'::jsonb)
on conflict (version) do nothing;

insert into public.exam_definitions (academic_year_id, grade_section_id, term, status)
select ay.id, gs.id, d.term, 'planned'
  from public.academic_years ay
  join public.grade_sections gs on gs.academic_year_id = ay.id
  cross join (values ('midterm'), ('final')) as d(term)
 where ay.label = '2026-27'
on conflict (academic_year_id, grade_section_id, term) do nothing;

insert into public.assessment_components (exam_definition_id, subject_id, name, max_marks, weight, sort_order)
select ed.id, s.id, ed.term, 100, 1, 0
  from public.exam_definitions ed
  join public.grade_sections gs on gs.id = ed.grade_section_id
  join public.subjects s on s.code in ('MAT', 'SCI', 'ENG', 'URD', 'KAS', 'SST', 'COM')
  where ed.term = 'midterm'
on conflict do nothing;

-- Draft timetable for 8-A (Monday only; a draft is never visible to families).
insert into public.timetable_versions (grade_section_id, status, version, effective_from)
select gs.id, 'draft', 1, '2026-04-06'
  from public.grade_sections gs
  join public.grades g on g.id = gs.grade_id
 where g.code = '8'
   and gs.section_label = 'A'
   and gs.academic_year_id in (select id from public.academic_years where label = '2026-27')
on conflict (grade_section_id, version) do nothing;

insert into public.timetable_periods (timetable_version_id, day_of_week, period_number, starts_at, ends_at, subject_id, room_id, kind)
select ttv.id, 1, p.period_number, p.starts_at, p.ends_at, s.id, r.id, p.kind
  from public.timetable_versions ttv
  cross join (values
    (1, '08:30'::time, '08:45'::time, 'assembly', 'MAT'),
    (2, '08:45'::time, '09:30'::time, 'class', 'MAT'),
    (3, '09:30'::time, '10:15'::time, 'class', 'SCI'),
    (4, '10:15'::time, '11:00'::time, 'class', 'ENG'),
    (5, '11:15'::time, '12:00'::time, 'break', null),
    (6, '12:00'::time, '12:45'::time, 'class', 'URD'),
    (7, '13:30'::time, '14:15'::time, 'class', 'KAS'),
    (8, '14:15'::time, '15:00'::time, 'class', 'SST')
  ) as p(period_number, starts_at, ends_at, kind, subject_code)
  left join public.subjects s on s.code = p.subject_code
  left join public.rooms r on r.code = case when p.kind = 'assembly' then 'GRD' when p.period_number = 2 then 'R21' when p.period_number = 5 then null else 'R11' end
 where ttv.version = 1 and ttv.status = 'draft'
   and not exists (
     select 1 from public.timetable_periods tp
      where tp.timetable_version_id = ttv.id and tp.day_of_week = 1 and tp.period_number = p.period_number);

-- =============================================================================
-- B6 notices (published + scheduled; both public-audience fixtures, mirroring
-- the 000079 backfill rule; content pages are authored by staff through the
-- CMS and never seeded)
-- =============================================================================
insert into public.content_items (kind, slug, current_status) values
  ('notice', 'notice-admissions-2026-27', 'published'),
  ('notice', 'notice-annual-day', 'scheduled')
on conflict (slug) do nothing;

insert into public.notices (content_item_id, category, urgent, status, published_at, expires_at)
select ci.id, n.category, n.urgent, n.status, n.published_at::timestamptz, n.expires_at::timestamptz
  from public.content_items ci
  join (values
    ('notice-admissions-2026-27', 'Admissions', false, 'published', '2026-08-01T09:00:00+05:30', '2026-12-31T23:59:59+05:30'),
    ('notice-annual-day', 'Events', false, 'scheduled', null, null)
  ) as n(slug, category, urgent, status, published_at, expires_at) on n.slug = ci.slug
on conflict (content_item_id) do nothing;

insert into public.notice_audiences (notice_id, audience)
select ntc.id, 'public'
  from public.notices ntc
  join public.content_items ci on ci.id = ntc.content_item_id
 where ci.slug in ('notice-admissions-2026-27', 'notice-annual-day')
   and not exists (
     select 1 from public.notice_audiences na
      where na.notice_id = ntc.id and na.audience = 'public');
