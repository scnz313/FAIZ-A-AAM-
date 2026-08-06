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
