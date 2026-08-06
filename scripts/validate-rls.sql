-- =============================================================================
-- Local RLS positive/negative suite (driven by scripts/validate-db-local.sh).
--
-- The scratch instance stubs the Supabase auth surface. This suite upgrades
-- the stubs to read the request GUCs (like real Supabase), seeds fictional
-- actors (plan.md §14: synthetic only), and asserts the plan.md §7 policy
-- matrix: guardian scope, teacher assignment scope, aal2 enforcement, link
-- revocation, anon denial, and cross-student denial.
--
-- Any failed assertion raises P0004 and aborts the run (ON_ERROR_STOP).
-- =============================================================================

-- 1. Auth stubs read the request GUCs (matches real Supabase behavior).
create or replace function auth.uid() returns uuid language sql as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function auth.jwt() returns jsonb language sql as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb
$$;

-- 2. Fictional actors (fixed UUIDs; local validation only).
insert into auth.users (id) values
  ('10000000-0000-4000-8000-000000000001'),  -- Sana Wani  (guardian)
  ('10000000-0000-4000-8000-000000000002');  -- Firdous Ahmad (teacher)

insert into public.people (id, given_name, family_name, display_name) values
  ('20000000-0000-4000-8000-000000000001', 'Sana', 'Wani', 'Sana Wani'),
  ('20000000-0000-4000-8000-000000000002', 'Firdous', 'Ahmad', 'Firdous Ahmad'),
  ('20000000-0000-4000-8000-000000000003', 'Aarif', 'Wani', 'Aarif Wani'),
  ('20000000-0000-4000-8000-000000000004', 'Mariam', 'Wani', 'Mariam Wani'),
  ('20000000-0000-4000-8000-000000000005', 'Zaid', 'Lone', 'Zaid Lone');

insert into public.user_accounts (id, person_id, status, verified_contact) values
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'active', 'guardian.demo@example.in'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'active', 'teacher.demo@example.in');

insert into public.role_grants (account_id, role_code, status, effective_from) values
  ('10000000-0000-4000-8000-000000000001', 'guardian', 'active', now()),
  ('10000000-0000-4000-8000-000000000002', 'teacher', 'active', now());

insert into public.guardians (person_id, status) values
  ('20000000-0000-4000-8000-000000000001', 'active');

insert into public.students (person_id, status) values
  ('20000000-0000-4000-8000-000000000003', 'active'),  -- Aarif
  ('20000000-0000-4000-8000-000000000004', 'active'),  -- Mariam
  ('20000000-0000-4000-8000-000000000005', 'active');  -- Zaid (unlinked)

insert into public.guardian_student_links (guardian_id, student_id, relationship_label, status, verification_source)
select g.id, s.id, 'Parent', 'active', 'enrollment_invitation'
  from public.guardians g
  cross join public.students s
 where s.person_id in ('20000000-0000-4000-8000-000000000003',
                       '20000000-0000-4000-8000-000000000004');

insert into public.staff_members (person_id, employment_status, title) values
  ('20000000-0000-4000-8000-000000000002', 'active', 'Teacher');

-- Teacher assignment: exact 8-A + Mathematics scope for the current year.
insert into public.staff_assignments (staff_member_id, role_grant_id, academic_year_id, grade_section_id, subject_id, status, effective_from)
select sm.id, rg.id, ay.id, gs.id, sub.id, 'active', now()
  from public.staff_members sm
  join public.role_grants rg on rg.account_id = '10000000-0000-4000-8000-000000000002' and rg.role_code = 'teacher'
  cross join public.academic_years ay
  cross join public.grade_sections gs
  cross join public.subjects sub
 where ay.label = '2026-27'
   and gs.section_label = 'A'
   and gs.academic_year_id = ay.id
   and gs.grade_id in (select id from public.grades where code = '8')
   and sub.code = 'MAT';

-- Enrollments: Aarif → 8-A, Mariam → 9-C (current year).
insert into public.enrollments (student_id, academic_year_id, grade_section_id, status, effective_from)
select s.id, ay.id, gs.id, 'active', now()
  from public.students s
  cross join public.academic_years ay
  cross join public.grade_sections gs
 where ay.label = '2026-27'
   and ((s.person_id = '20000000-0000-4000-8000-000000000003' and gs.section_label = 'A' and gs.grade_id in (select id from public.grades where code = '8'))
     or (s.person_id = '20000000-0000-4000-8000-000000000004' and gs.section_label = 'C' and gs.grade_id in (select id from public.grades where code = '9')));

-- Invoices: Aarif (linked) and Zaid (unlinked — denial target).
insert into public.invoices (student_id, academic_year_id, schedule_version_id, term, status, issue_date, due_date)
select s.id, ay.id, fsv.id, '2026-27', 'unpaid', '2026-08-01', '2026-09-01'
  from public.students s
  cross join public.academic_years ay
  cross join public.fee_schedule_versions fsv
 where ay.label = '2026-27' and fsv.version = 1
   and s.person_id in ('20000000-0000-4000-8000-000000000003',
                       '20000000-0000-4000-8000-000000000005');

insert into public.invoice_items (invoice_id, label, amount_paise)
select i.id, 'Tuition fee', 1200000
  from public.invoices i
 where i.student_id in (select id from public.students
                         where person_id in ('20000000-0000-4000-8000-000000000003',
                                             '20000000-0000-4000-8000-000000000005'));

-- Result batches: 8-A Mathematics (teacher scope) and 9-C Science (denial).
insert into public.result_batches (exam_definition_id, grade_section_id, subject_id, status)
select ed.id, ed.grade_section_id, sub.id, 'draft'
  from public.exam_definitions ed
  cross join public.subjects sub
 where ed.term = 'midterm'
   and ((ed.grade_section_id in (select id from public.grade_sections where section_label = 'A') and sub.code = 'MAT')
     or (ed.grade_section_id in (select id from public.grade_sections where section_label = 'C') and sub.code = 'SCI'));

-- Section-targeted notice for 8-A (guardian positive target).
insert into public.content_items (kind, slug, current_status) values
  ('notice', 'notice-rls-section-8a', 'published')
on conflict (slug) do nothing;

insert into public.notices (content_item_id, category, status, published_at)
select ci.id, 'Academic', 'published', now()
  from public.content_items ci
 where ci.slug = 'notice-rls-section-8a'
on conflict (content_item_id) do nothing;

insert into public.notice_audiences (notice_id, audience, grade_section_id)
select n.id, 'grade_section', gs.id
  from public.notices n
  join public.content_items ci on ci.id = n.content_item_id
  cross join public.grade_sections gs
 where ci.slug = 'notice-rls-section-8a'
   and gs.section_label = 'A';

-- Documents: one clean receipt for Aarif's invoice, one for Zaid's (denial).
insert into public.documents (owner_domain, owner_record_id, category, object_key, safe_filename, mime_type, size_bytes, scan_status, visibility, uploaded_by_account_id)
select 'invoice', i.id, 'receipt', 'invoice/' || i.id || '/receipt.pdf', 'receipt.pdf', 'application/pdf', 1024, 'clean', 'private',
       '10000000-0000-4000-8000-000000000001'
  from public.invoices i
 where i.student_id in (select id from public.students
                         where person_id in ('20000000-0000-4000-8000-000000000003',
                                             '20000000-0000-4000-8000-000000000005'));

-- 3. Assertions.
-- 3a. Anonymous: public notice visible; family/section notices and private
--     documents are NOT.
set role anon;
do $$
begin
  assert (select count(*) from public.notices where status = 'published') = 1,
    'anon must see exactly the public-audience notice';
  assert (select count(*) from public.documents) = 0,
    'anon must never see private documents';
  assert not has_table_privilege('anon', 'public.invoices', 'SELECT'),
    'anon has no privilege on invoices';
  assert not has_table_privilege('anon', 'public.enrollments', 'SELECT'),
    'anon has no privilege on enrollments';
  assert not has_table_privilege('anon', 'public.result_batches', 'SELECT'),
    'anon has no privilege on result batches';
  assert not has_table_privilege('anon', 'public.notice_audiences', 'SELECT'),
    'anon must not read notice audience definitions';
end $$;
reset role;

-- 3b. Guardian Sana (two active children).
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
do $$
begin
  assert app.is_guardian() = true, 'guardian context resolves';
  assert app.has_role('teacher') = false, 'guardian is not a teacher';
  assert app.is_staff_aal2() = false, 'guardian is not staff even with aal2';

  assert (select count(*) from public.enrollments where status = 'active') = 2,
    'guardian sees enrollments of both active links';
  assert (select count(*) from public.invoices) = 1,
    'guardian sees only linked children invoices (Aarif), not Zaid';
  assert (select count(*) from public.invoice_items) = 1,
    'guardian sees invoice items only for linked children';
  assert (select count(*) from public.documents) = 1,
    'guardian reads only own children clean documents';
  assert (select count(*) from public.notices where status = 'published') = 2,
    'guardian sees public + 8-A section notices';
end $$;

-- Revocation ends access immediately without deleting history (the link
-- update itself is a staff command; run it outside the RLS-scoped block).
reset role;
update public.guardian_student_links
   set status = 'ended', effective_to = now()
 where student_id = (select id from public.students
                      where person_id = '20000000-0000-4000-8000-000000000004');
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
do $$
begin
  assert (select count(*) from public.enrollments where status = 'active') = 1,
    'revoked link removes access immediately';
  assert (select count(*) from public.invoices) = 1,
    'revocation does not delete invoice history';
end $$;

reset role;
update public.guardian_student_links
   set status = 'active', effective_to = null
 where student_id = (select id from public.students
                      where person_id = '20000000-0000-4000-8000-000000000004');
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
do $$
begin
  assert (select count(*) from public.enrollments where status = 'active') = 2,
    'reactivated link restores access';
end $$;

-- 3c. Teacher Firdous: aal1 denied, aal2 accepted, exact class+subject scope.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
select set_config('request.jwt.claims', '{"aal":"aal1"}', false);
do $$
begin
  assert app.has_role('teacher') = true, 'teacher grant active';
  assert app.is_staff_aal2() = false, 'aal1 is denied for staff data';
  assert (select count(*) from public.result_batches) = 0,
    'aal1 teacher sees no batches';
  assert (select count(*) from public.invoices) = 0,
    'aal1 teacher sees no finance rows';
end $$;

select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
do $$
begin
  assert app.is_staff_aal2() = true, 'aal2 staff context resolves';
  assert (select count(*) from public.result_batches) = 1,
    'teacher sees exactly own 8-A Mathematics batch';
  assert (select count(*) from public.result_batches rb
            join public.grade_sections gs on gs.id = rb.grade_section_id
           where gs.section_label = 'C') = 0,
    'teacher never sees out-of-scope 9-C batches';
  assert (select count(*) from public.invoices) = 2,
    'staff (aal2) reads finance rows for operations';
end $$;
reset role;

-- 3d. No session (auth.uid() null): helpers deny and protected data is empty.
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claims', '', false);
do $$
begin
  assert app.is_staff_aal2() = false, 'no session is not staff';
  assert app.is_guardian() = false, 'no session is not a guardian';
end $$;

select 'RLS SUITE PASSED' as result;
