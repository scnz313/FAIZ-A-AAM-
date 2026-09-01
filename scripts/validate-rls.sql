-- =============================================================================
-- Local RLS positive/negative suite (driven by scripts/validate-db-local.sh).
--
-- The scratch instance stubs the Supabase auth surface. This suite upgrades
-- the stubs to read the request GUCs (like real Supabase), seeds fictional
-- actors (plan.md §14: synthetic only), and asserts the plan.md §7 policy
-- matrix: guardian scope, entry-officer scope, aal2 enforcement, link
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
  ('10000000-0000-4000-8000-000000000002');  -- Firdous Ahmad (entry officer)

insert into public.people (id, given_name, family_name, display_name) values
  ('20000000-0000-4000-8000-000000000001', 'Sana', 'Wani', 'Sana Wani'),
  ('20000000-0000-4000-8000-000000000002', 'Firdous', 'Ahmad', 'Firdous Ahmad'),
  ('20000000-0000-4000-8000-000000000003', 'Aarif', 'Wani', 'Aarif Wani'),
  ('20000000-0000-4000-8000-000000000004', 'Mariam', 'Wani', 'Mariam Wani'),
  ('20000000-0000-4000-8000-000000000005', 'Zaid', 'Lone', 'Zaid Lone');

insert into public.user_accounts (id, person_id, status, verified_contact) values
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'active', 'guardian.demo@example.in'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'active', 'entry.officer@example.in');

insert into public.role_grants (account_id, role_code, status, effective_from) values
  ('10000000-0000-4000-8000-000000000001', 'guardian', 'active', now()),
  ('10000000-0000-4000-8000-000000000002', 'result_entry_officer', 'active', now());

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

-- Capability fixtures are explicit: the same guardian link may be active while
-- one business capability is restricted. Both synthetic children begin with
-- the five launch capabilities so the positive matrix has a known baseline.
insert into public.guardian_link_capabilities (link_id, capability)
select l.id, c.capability
  from public.guardian_student_links l
 cross join (values ('academics'), ('finance'), ('documents'), ('notices'), ('profile')) as c(capability)
on conflict do nothing;

insert into public.staff_members (person_id, employment_status, title) values
  ('20000000-0000-4000-8000-000000000002', 'active', 'Teacher');

-- Teacher assignment: exact 8-A + Mathematics scope for the current year.
insert into public.staff_assignments (staff_member_id, role_grant_id, academic_year_id, grade_section_id, subject_id, status, effective_from)
select sm.id, rg.id, ay.id, gs.id, sub.id, 'active', now()
  from public.staff_members sm
  join public.role_grants rg on rg.account_id = '10000000-0000-4000-8000-000000000002' and rg.role_code = 'result_entry_officer'
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

-- Result batches: 8-A Mathematics (entry-officer scope) and 9-C Science (denial).
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

-- 17-role authorization matrix actors. These use a disjoint synthetic UUID
-- namespace so they cannot collide with the 1000... actors used by the RPC
-- flow. Every matrix account has exactly one canonical role.
insert into auth.users (id)
select ('30000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
  from generate_series(1, 17) n
on conflict do nothing;
insert into public.people (id, given_name, family_name, display_name)
select ('40000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       'Matrix', 'Role ' || n::text, 'Matrix Role ' || n::text
  from generate_series(1, 17) n
on conflict do nothing;
insert into public.user_accounts (id, person_id, status, verified_contact)
select ('30000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       ('40000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       'active', 'matrix-' || n::text || '@example.in'
  from generate_series(1, 17) n
on conflict do nothing;
insert into public.role_grants (account_id, role_code, status, effective_from)
select ('30000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       (array['guardian','student','content_editor','content_publisher','admissions_officer','admissions_approver','finance_officer','finance_approver','hr_reviewer','hr_approver','result_entry_officer','exam_reviewer','result_publisher','timetable_manager','support_officer','auditor','system_administrator'])[n],
       'active', now()
  from generate_series(1, 17) n
on conflict do nothing;
insert into public.staff_members (person_id, employment_status, title)
select person_id, 'active', 'Matrix staff' from public.user_accounts
 where id >= '30000000-0000-4000-8000-000000000003'::uuid
   and id <= '30000000-0000-4000-8000-000000000017'::uuid
on conflict (person_id) do nothing;
insert into public.guardians (person_id, status)
select person_id, 'active' from public.user_accounts where id = '30000000-0000-4000-8000-000000000001'
on conflict (person_id) do nothing;
insert into public.guardian_student_links (guardian_id, student_id, relationship_label, status, verification_source)
select g.id, s.id, 'Parent', 'active', 'staff_review'
  from public.guardians g
  join public.user_accounts ua on ua.person_id = g.person_id and ua.id = '30000000-0000-4000-8000-000000000001'
  cross join public.students s
 where s.person_id in ('20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004');
insert into public.guardian_link_capabilities (link_id, capability)
select l.id, c.capability from public.guardian_student_links l
 cross join (values ('academics'),('finance'),('documents'),('notices'),('profile')) c(capability)
 where l.guardian_id in (select g.id from public.guardians g join public.user_accounts ua on ua.person_id = g.person_id where ua.id = '30000000-0000-4000-8000-000000000001')
on conflict do nothing;
insert into public.students (person_id, status)
select person_id, 'active' from public.user_accounts where id = '30000000-0000-4000-8000-000000000002'
on conflict do nothing;
insert into public.staff_assignments (staff_member_id, role_grant_id, academic_year_id, grade_section_id, subject_id, status, effective_from)
select sm.id, rg.id, ay.id, gs.id, sub.id, 'active', now()
  from public.staff_members sm
  join public.people p on p.id = sm.person_id
  join public.user_accounts ua on ua.person_id = p.id and ua.id = '30000000-0000-4000-8000-000000000011'
  join public.role_grants rg on rg.account_id = ua.id and rg.role_code = 'result_entry_officer' and rg.status = 'active'
  join public.academic_years ay on ay.label = '2026-27'
  join public.grade_sections gs on gs.academic_year_id = ay.id and gs.section_label = 'A'
  join public.grades g on g.id = gs.grade_id and g.code = '8'
  join public.subjects sub on sub.code = 'MAT'
on conflict do nothing;

-- One record per protected business surface for positive role assertions.
insert into public.admission_applications (owner_account_id, academic_year_id, grade_id, current_status, student_name, parent_name)
select '10000000-0000-4000-8000-000000000001', ay.id, g.id, 'submitted', 'Matrix Applicant', 'Sana Wani'
  from public.academic_years ay cross join public.grades g where ay.label = '2026-27' and g.code = '8';
insert into public.job_vacancies (title, department, current_status) values ('Matrix Vacancy','HR','published');
insert into public.job_vacancy_versions (vacancy_id, version, terms)
select id, 1, '{"title":"Matrix Vacancy"}'::jsonb from public.job_vacancies where title = 'Matrix Vacancy';
insert into public.job_applications (vacancy_id, vacancy_version, owner_account_id, current_status, applicant_name)
select v.id, 1, '10000000-0000-4000-8000-000000000001', 'submitted', 'Matrix Applicant'
  from public.job_vacancies v where v.title = 'Matrix Vacancy';
insert into public.job_review_assignments (application_id, reviewer_account_id)
select id, '30000000-0000-4000-8000-000000000009' from public.job_applications where applicant_name = 'Matrix Applicant';
insert into public.support_requests (requester_account_id, category, subject)
values ('30000000-0000-4000-8000-000000000015', 'general', 'Matrix support request');
insert into public.reconciliation_runs (status, summary, created_by_account_id)
values ('completed', '{"matrix":true}'::jsonb, '30000000-0000-4000-8000-000000000007');
insert into public.content_versions (content_item_id, version, title, body, author_account_id, review_status)
select id, 1, 'Matrix draft', '{"matrix":true}'::jsonb, '30000000-0000-4000-8000-000000000003', 'draft'
  from public.content_items where slug = 'notice-admissions-2026-27';

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
  assert app.has_role('result_entry_officer') = false, 'guardian is not an entry officer';
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

-- 3c. Result entry officer (Firdous): aal1 denied, aal2 accepted, exact
-- class+subject scope via staff_scope_allowed. The legacy teacher role is
-- non-assignable (000042); entry is central (000057).
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
select set_config('request.jwt.claims', '{"aal":"aal1"}', false);
do $$
begin
  assert app.has_role('result_entry_officer') = true, 'result entry officer grant active';
  assert app.is_staff_aal2() = false, 'aal1 is denied for staff data';
  assert (select count(*) from public.result_batches) = 0,
    'aal1 entry officer sees no batches';
  assert (select count(*) from public.invoices) = 0,
    'aal1 entry officer sees no finance rows';
end $$;

select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
do $$
begin
  assert app.is_staff_aal2() = true, 'aal2 staff context resolves';
  assert (select count(*) from public.result_batches) = 1,
    'entry officer sees exactly own 8-A Mathematics batch (got ' || (select count(*) from public.result_batches) || ', scope=' || app.staff_scope_allowed(array['result_entry_officer'], (select academic_year_id from public.exam_definitions where term = 'midterm' limit 1), null, null) || ', has_role=' || app.has_role('result_entry_officer') || ')';
  assert (select count(*) from public.result_batches rb
            join public.grade_sections gs on gs.id = rb.grade_section_id
           where gs.section_label = 'C') = 0,
    'entry officer never sees out-of-scope 9-C batches';
  assert (select count(*) from public.invoices) = 0,
    'pure entry officer (aal2) is denied finance rows';
end $$;
reset role;

-- 3d. Positive/negative matrix for every canonical role. Each actor proves
-- one owned functional read and one unrelated-business denial.
set role authenticated;
do $$
declare
  v_codes text[] := array['guardian','student','content_editor','content_publisher','admissions_officer','admissions_approver','finance_officer','finance_approver','hr_reviewer','hr_approver','result_entry_officer','exam_reviewer','result_publisher','timetable_manager','support_officer','auditor','system_administrator'];
  v_positive int;
  v_finance int;
begin
  for i in 1..array_length(v_codes, 1) loop
    perform set_config('request.jwt.claim.sub', ('30000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid::text, false);
    perform set_config('request.jwt.claims', '{"aal":"aal2"}', false);
    case v_codes[i]
      when 'guardian' then select count(*) into v_positive from public.enrollments;
      when 'student' then select count(*) into v_positive from public.students;
      when 'content_editor', 'content_publisher' then select count(*) into v_positive from public.content_versions;
      when 'admissions_officer', 'admissions_approver' then select count(*) into v_positive from public.admission_applications;
      when 'finance_officer', 'finance_approver' then select count(*) into v_positive from public.invoices;
      when 'hr_reviewer', 'hr_approver' then select count(*) into v_positive from public.job_applications;
      when 'result_entry_officer', 'exam_reviewer', 'result_publisher' then select count(*) into v_positive from public.result_batches;
      when 'timetable_manager' then select count(*) into v_positive from public.timetable_versions;
      when 'support_officer' then select count(*) into v_positive from public.support_requests;
      when 'auditor' then select count(*) into v_positive from public.reconciliation_runs;
      when 'system_administrator' then select count(*) into v_positive from public.settings_versions;
    end case;
    assert v_positive > 0, 'role positive read failed for ' || v_codes[i];
    select count(*) into v_finance from public.invoices;
    if v_codes[i] not in ('guardian','finance_officer','finance_approver') then
      assert v_finance = 0, 'unrelated finance read leaked to ' || v_codes[i];
    end if;
  end loop;
end $$;

-- 3e. Guardian capability denial is independent of active-link status.
reset role;
delete from public.guardian_link_capabilities
 where capability in ('finance', 'notices', 'profile')
   and link_id in (
     select l.id from public.guardian_student_links l
      join public.guardians g on g.id = l.guardian_id
      join public.user_accounts ua on ua.person_id = g.person_id
     where ua.id = '30000000-0000-4000-8000-000000000001'
   );
set role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
do $$
begin
  assert (select count(*) from public.invoices) = 0, 'guardian finance capability is enforced';
  assert (select count(*) from public.notices where status = 'published') = 1, 'public notice remains visible without guardian notices capability';
  assert (select count(*) from public.students where id in (select l.student_id from public.guardian_student_links l join public.guardians g on g.id = l.guardian_id join public.user_accounts ua on ua.person_id = g.person_id where ua.id = '30000000-0000-4000-8000-000000000001')) = 0, 'guardian profile capability denies child students';
  assert (select count(*) from public.people where id in (select s.person_id from public.students s join public.guardian_student_links l on l.student_id = s.id join public.guardians g on g.id = l.guardian_id join public.user_accounts ua on ua.person_id = g.person_id where ua.id = '30000000-0000-4000-8000-000000000001')) = 0, 'guardian profile capability denies child people';
  assert (select count(*) from public.guardian_student_links where guardian_id in (select g.id from public.guardians g join public.user_accounts ua on ua.person_id = g.person_id where ua.id = '30000000-0000-4000-8000-000000000001')) = 2, 'guardian can still select linked children without profile capability';
  assert (select count(*) from public.guardian_link_capabilities where link_id in (select l.id from public.guardian_student_links l join public.guardians g on g.id = l.guardian_id join public.user_accounts ua on ua.person_id = g.person_id where ua.id = '30000000-0000-4000-8000-000000000001')) = 4, 'guardian can still read remaining capability rows';
end $$;

reset role;
insert into public.guardian_link_capabilities (link_id, capability)
select l.id, c.capability
  from public.guardian_student_links l
  cross join (values ('finance'), ('notices'), ('profile')) c(capability)
  join public.guardians g on g.id = l.guardian_id
  join public.user_accounts ua on ua.person_id = g.person_id
 where ua.id = '30000000-0000-4000-8000-000000000001'
on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
do $$
begin
  assert (select count(*) from public.invoices) = 1, 'guardian finance capability restores finance access';
  assert (select count(*) from public.notices where status = 'published') = 2, 'guardian notices capability restores targeted notices';
  assert (select count(*) from public.students where id in (select l.student_id from public.guardian_student_links l join public.guardians g on g.id = l.guardian_id join public.user_accounts ua on ua.person_id = g.person_id where ua.id = '30000000-0000-4000-8000-000000000001')) = 2, 'guardian profile capability restores child students';
  assert (select count(*) from public.people where id in (select s.person_id from public.students s join public.guardian_student_links l on l.student_id = s.id join public.guardians g on g.id = l.guardian_id join public.user_accounts ua on ua.person_id = g.person_id where ua.id = '30000000-0000-4000-8000-000000000001')) = 2, 'guardian profile capability restores child people';
end $$;

-- 3f. No session (auth.uid() null): helpers deny and protected data is empty.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claims', '', false);
do $$
begin
  assert app.is_staff_aal2() = false, 'no session is not staff';
  assert app.is_guardian() = false, 'no session is not a guardian';
end $$;

select 'RLS SUITE PASSED' as result;
