-- =============================================================================
-- Deterministic synthetic seed (plan.md §11 B0: "deterministic seed files").
--
-- B0 seeds reference data only. Domain synthetic data arrives with its phase
-- (school configuration in B1, fictional applicants in B2, and so on).
-- Every statement is idempotent so `supabase db reset` reproduces the same
-- state without dashboard-only SQL.
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
select ay.id, d.day_of_week, p.period_number, p.starts_at, p.ends_at
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
