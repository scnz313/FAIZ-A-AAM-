-- =============================================================================
-- 000123 school configuration assertions.
--
-- The Slice 3 setup RPCs let system_administrator and timetable_manager build
-- the academic structure (years, grades, sections, subjects, exam terms,
-- assessment components) from the workspace. This suite locks the contract on
-- the local scratch instance:
--   * anonymous sessions can never execute the functions, authenticated can;
--   * every function requires AAL2 plus one of the two configuring roles;
--   * the standard catalog fills only missing grades;
--   * section status transitions and the active-enrollment archive refusal;
--   * exam term creation writes definitions + components once (skip on
--     replay) and component writes refuse once marks exist;
--   * promoting a year to current demotes the incumbent in one transaction.
-- Run by scripts/validate-db-local.sh.
-- =============================================================================

\set ON_ERROR_STOP on

-- Match real Supabase behavior: auth.uid() reads the request GUC.
create or replace function auth.uid() returns uuid language sql as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

begin;

-- Synthetic actors (fixed UUIDs; local validation only).
insert into auth.users (id) values
  ('10000000-0000-4000-8000-000000000201'),
  ('10000000-0000-4000-8000-000000000202');

insert into public.people (id, given_name, family_name, display_name) values
  ('20000000-0000-4000-8000-000000000201', 'Config', 'Admin', 'Config Admin'),
  ('20000000-0000-4000-8000-000000000202', 'Config', 'Principal', 'Config Principal'),
  ('20000000-0000-4000-8000-000000000211', 'Enrolled', 'Child', 'Enrolled Child');

insert into public.user_accounts (id, person_id, status, verified_contact) values
  ('10000000-0000-4000-8000-000000000201', '20000000-0000-4000-8000-000000000201', 'active', 'config.admin@example.test'),
  ('10000000-0000-4000-8000-000000000202', '20000000-0000-4000-8000-000000000202', 'active', 'config.principal@example.test');

insert into public.role_grants (account_id, role_code, status, effective_from) values
  ('10000000-0000-4000-8000-000000000201', 'system_administrator', 'active', now()),
  ('10000000-0000-4000-8000-000000000202', 'timetable_manager', 'active', now());

-- Grant boundary: anon never executes, authenticated does.
do $$
begin
  assert not has_function_privilege('anon', 'app.school_setup_read(uuid)', 'EXECUTE'),
    'anonymous callers must never read school configuration';
  assert not has_function_privilege('anon', 'app.grades_upsert(uuid, text, text, integer, text)', 'EXECUTE'),
    'anonymous callers must never write grades';
  assert not has_function_privilege('anon', 'app.exam_terms_create(uuid, text, uuid[], jsonb, text)', 'EXECUTE'),
    'anonymous callers must never create exam terms';
  assert has_function_privilege('authenticated', 'app.school_setup_read(uuid)', 'EXECUTE'),
    'authenticated staff read the configuration projection';
  assert has_function_privilege('authenticated', 'app.grade_sections_copy_from_year(uuid, uuid, text)', 'EXECUTE'),
    'authenticated staff may copy sections';
  assert (
    select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'school_setup_read'
  ), 'the setup read must run security definer';
end
$$;

-- AAL1 sessions are refused even with a configuring role.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000201', true);
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal1"}', true);
do $$
declare v_denied boolean := false;
begin
  begin
    perform app.school_setup_read(null);
  exception when others then v_denied := true; end;
  assert v_denied, 'aal1 staff sessions must be refused the setup read';
end
$$;
reset role;

-- AAL2 system administrator: the full happy path.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000201', true);
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal2"}', true);

do $$
declare
  v_read jsonb;
  v_year_id uuid;
begin
  v_read := app.school_setup_read(null);
  assert v_read ->> 'selectedAcademicYearId' is not null, 'the read resolves a selected year';
  assert jsonb_array_length(v_read -> 'academicYears') >= 2, 'seeded years are listed';
  assert jsonb_array_length(v_read -> 'sections') >= 2, 'current-year sections are listed';
  assert jsonb_array_length(v_read -> 'exams') >= 2, 'seeded exams are listed';
  select id into v_year_id from public.academic_years where status = 'current';
  assert v_read ->> 'selectedAcademicYearId' = v_year_id::text, 'the current year is the default selection';
end
$$;

do $$
declare
  v_inserted jsonb;
begin
  /* Seeded grades are 6-10 (5 rows); the catalog adds the other 8. */
  v_inserted := app.grades_add_standard_catalog('apply the standard catalog');
  assert jsonb_array_length(v_inserted) = 8,
    'the catalog inserts only the 8 missing grades (got ' || jsonb_array_length(v_inserted)::text || ')';
  assert (select count(*) from public.grades) = 13, 'the catalog yields 13 grades in total';
  v_inserted := app.grades_add_standard_catalog('apply the standard catalog again');
  assert jsonb_array_length(v_inserted) = 0, 'a second catalog apply is a no-op';
end
$$;

do $$
declare
  v_year jsonb;
  v_year_id uuid;
  v_result jsonb;
  v_denied boolean := false;
begin
  v_year := app.academic_years_create('2027-28', '2027-04-01', '2028-03-31', 'open the next admission cycle');
  assert v_year ->> 'status' = 'upcoming', 'a new year starts upcoming';
  v_year_id := (v_year ->> 'id')::uuid;

  begin
    perform app.academic_years_create('2027-28', '2027-04-01', '2028-03-31', 'duplicate label');
  exception when others then v_denied := true; end;
  assert v_denied, 'a duplicate year label is refused';
  v_denied := false;

  v_result := app.academic_years_set_status(v_year_id, 'current', 'begin the new academic year');
  assert v_result ->> 'status' = 'current', 'the upcoming year becomes current';
  assert jsonb_array_length(v_result -> 'demotedReferences') = 1, 'the incumbent year is demoted';
  assert (select count(*) from public.academic_years where status = 'current') = 1,
    'exactly one current year remains';

  begin
    perform app.academic_years_set_status(v_year_id, 'closed', 'skip straight to closed');
  exception when others then v_denied := true; end;
  assert v_denied, 'current to closed is not a legal transition';
end
$$;

do $$
declare
  v_grade_id uuid;
  v_target_year uuid;
  v_section jsonb;
  v_section_id uuid;
  v_denied boolean := false;
begin
  select id into v_grade_id from public.grades where code = '5';
  select id into v_target_year from public.academic_years where label = '2027-28';

  /* Section lifecycle: planned → active → archived and back. */
  v_section := app.grade_sections_create(v_target_year, v_grade_id, ' b ', 'add a second section for class 5');
  assert v_section ->> 'sectionLabel' = 'B', 'section labels normalise to upper case';
  assert v_section ->> 'status' = 'planned', 'a new section starts planned';
  v_section_id := (v_section ->> 'id')::uuid;

  begin
    perform app.grade_sections_create(v_target_year, v_grade_id, 'B', 'duplicate section');
  exception when others then v_denied := true; end;
  assert v_denied, 'a duplicate section for the year is refused';
  v_denied := false;

  begin
    perform app.grade_sections_set_status(v_section_id, 'archived', 'cannot archive a planned section');
  exception when others then v_denied := true; end;
  assert v_denied, 'planned to archived is not a legal transition';

  perform app.grade_sections_set_status(v_section_id, 'active', 'open the section for enrolment');
  assert (select status from public.grade_sections where id = v_section_id) = 'active';
end
$$;
reset role;

-- Enrollment fixture for the archive refusal (privileged rows: inserted as
-- postgres, never through the role under test).
insert into public.students (id, reference, person_id, status) values
  ('40000000-0000-4000-8000-000000000211', 'STU-TEST-ENROLLED', '20000000-0000-4000-8000-000000000211', 'active');
insert into public.enrollments (student_id, academic_year_id, grade_section_id, status)
select '40000000-0000-4000-8000-000000000211', ay.id, gs.id, 'active'
  from public.academic_years ay
  join public.grade_sections gs on gs.academic_year_id = ay.id
  join public.grades g on g.id = gs.grade_id
 where ay.label = '2027-28' and g.code = '5' and gs.section_label = 'B';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000201', true);
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal2"}', true);
do $$
declare
  v_section_id uuid;
  v_target_year uuid;
  v_denied boolean := false;
  v_copied jsonb;
begin
  select id into v_target_year from public.academic_years where label = '2027-28';
  select gs.id into v_section_id from public.grade_sections gs
    join public.grades g on g.id = gs.grade_id
   where gs.academic_year_id = v_target_year and g.code = '5' and gs.section_label = 'B';

  begin
    perform app.grade_sections_set_status(v_section_id, 'archived', 'archive with enrolled child');
  exception when others then
    v_denied := true;
    assert sqlerrm like '%active enrollments%', 'the refusal names the enrollment blocker';
  end;
  assert v_denied, 'archiving a section with an active enrollment is refused';

  /* Copy: the seeded year sections land in the target year as planned. */
  v_copied := app.grade_sections_copy_from_year(
    (select id from public.academic_years where label = '2026-27'),
    v_target_year,
    'carry the class structure forward'
  );
  assert jsonb_array_length(v_copied) = 2, 'both seeded sections copy to the new year';
  assert (select count(*) from public.grade_sections where academic_year_id = v_target_year) = 3,
    'the target year holds the created plus copied sections';
  assert (select count(*) from public.grade_sections where academic_year_id = v_target_year and status = 'planned') = 2,
    'copied sections arrive planned';
end
$$;
reset role;

do $$
declare
  v_year_id uuid;
  v_section_id uuid;
  v_subject_id uuid;
  v_result jsonb;
  v_exam_id uuid;
  v_component_id uuid;
begin
  select ay.id into v_year_id from public.academic_years ay where ay.label = '2026-27';
  select gs.id into v_section_id from public.grade_sections gs
    join public.grades g on g.id = gs.grade_id
   where gs.academic_year_id = v_year_id and g.code = '8' and gs.section_label = 'A';
  select s.id into v_subject_id from public.subjects s where s.code = 'MAT';

  /* midterm already exists for 8-A: term creation reports it skipped. */
  v_result := app.exam_terms_create(
    v_year_id, ' Midterm ', array[v_section_id],
    jsonb_build_array(jsonb_build_object('subjectId', v_subject_id, 'name', 'Midterm', 'maxMarks', 100)),
    'schedule the midterm exam'
  );
  assert jsonb_array_length(v_result -> 'created') = 0, 'an existing exam definition is not duplicated';
  assert jsonb_array_length(v_result -> 'skipped') = 1, 'the existing exam is reported skipped';

  /* A new term creates the definition plus components. */
  v_result := app.exam_terms_create(
    v_year_id, 'Unit Test', array[v_section_id],
    jsonb_build_array(
      jsonb_build_object('subjectId', v_subject_id, 'name', 'Written', 'maxMarks', 40),
      jsonb_build_object('subjectId', (select id from public.subjects where code = 'SCI'), 'name', 'Practical', 'maxMarks', 20)
    ),
    'schedule the unit test'
  );
  assert jsonb_array_length(v_result -> 'created') = 1, 'the unit test exam is created';
  select id into v_exam_id from public.exam_definitions
   where academic_year_id = v_year_id and grade_section_id = v_section_id and term = 'unit test';
  assert (select count(*) from public.assessment_components where exam_definition_id = v_exam_id) = 2,
    'both components are written with the exam';
  assert (select status from public.exam_definitions where id = v_exam_id) = 'planned',
    'a new exam starts planned';

  /* Component edits are allowed while no marks exist. The live unique key
     is (exam, subject, lower(name)), so the same-name upsert updates in
     place rather than inserting a second row. */
  v_result := app.assessment_components_upsert(v_exam_id, v_subject_id, 'written', 50, 'raise the written maximum');
  v_component_id := (v_result ->> 'id')::uuid;
  assert (v_result ->> 'maxMarks')::numeric = 50, 'the component update takes effect';
  assert (select name from public.assessment_components where id = v_component_id) = 'written',
    'the update keeps the stored component name';
  assert (select count(*) from public.assessment_components where exam_definition_id = v_exam_id) = 2,
    'the same-name upsert updates rather than duplicating';

  perform app.exam_definitions_set_status(v_exam_id, 'open', 'open the unit test for marks entry');
end
$$;
reset role;

-- Marks-existence fixture (privileged row: inserted as postgres).
insert into public.result_batches (exam_definition_id, grade_section_id, subject_id, status)
select ed.id, gs.id, s.id, 'draft'
  from public.exam_definitions ed
  join public.grade_sections gs on gs.id = ed.grade_section_id
  join public.grades g on g.id = gs.grade_id
  join public.subjects s on s.code = 'MAT'
 where ed.term = 'unit test' and g.code = '8' and gs.section_label = 'A'
   and ed.academic_year_id = (select id from public.academic_years where label = '2026-27');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000201', true);
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal2"}', true);
do $$
declare
  v_year_id uuid;
  v_read jsonb;
  v_exam_id uuid;
  v_subject_id uuid;
  v_mat_component uuid;
  v_sci_component uuid;
  v_denied boolean := false;
begin
  /* exam_definitions and assessment_components carry only scoped RLS read
     policies — a configuring administrator sees no rows directly, so the
     identifiers come through the staff read RPC instead. */
  select ay.id into v_year_id from public.academic_years ay where ay.label = '2026-27';
  v_read := app.school_setup_read(v_year_id);
  select (e ->> 'id')::uuid into v_exam_id
    from jsonb_array_elements(v_read -> 'exams') e
   where e ->> 'term' = 'unit test';
  select (s ->> 'id')::uuid into v_subject_id
    from jsonb_array_elements(v_read -> 'subjects') s
   where s ->> 'code' = 'MAT';
  select (c ->> 'id')::uuid into v_mat_component
    from jsonb_array_elements(v_read -> 'exams') e
    cross join lateral jsonb_array_elements(e -> 'components') c
   where e ->> 'term' = 'unit test' and c ->> 'subjectCode' = 'MAT';
  select (c ->> 'id')::uuid into v_sci_component
    from jsonb_array_elements(v_read -> 'exams') e
    cross join lateral jsonb_array_elements(e -> 'components') c
   where e ->> 'term' = 'unit test' and c ->> 'subjectCode' = 'SCI';

  /* Component writes are refused once a result batch references the
     exam + subject. */
  begin
    perform app.assessment_components_upsert(v_exam_id, v_subject_id, 'Tamper', 99, 'marks exist');
  exception when others then
    v_denied := true;
    assert sqlerrm like '%marks already exist%', 'the refusal names the marks blocker';
  end;
  assert v_denied, 'component edits are refused once a result batch exists';
  v_denied := false;

  begin
    perform app.assessment_components_delete(v_mat_component, 'marks exist');
  exception when others then v_denied := true; end;
  assert v_denied, 'component deletes are refused once a result batch exists';
  v_denied := false;

  /* The other subject (no batch) still deletes. */
  perform app.assessment_components_delete(v_sci_component, 'drop the practical component');
  v_read := app.school_setup_read(v_year_id);
  assert (select count(*)
            from jsonb_array_elements(v_read -> 'exams') e
            cross join lateral jsonb_array_elements(e -> 'components') c
           where e ->> 'term' = 'unit test') = 1,
    'the practical component is gone once deleted';

  /* Exam lifecycle: open → closed → open; components lock while closed. */
  perform app.exam_definitions_set_status(v_exam_id, 'closed', 'close the exam');
  begin
    perform app.assessment_components_delete(v_mat_component, 'locked while closed');
  exception when others then v_denied := true; end;
  assert v_denied, 'components are locked while the exam is closed';
end
$$;

-- A timetable_manager session (Principal profile) configures equally.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000202', true);
do $$
declare v_subject jsonb;
begin
  v_subject := app.subjects_upsert(null, 'geo', 'Geography', 'add geography for the middle school');
  assert v_subject ->> 'code' = 'GEO', 'subject codes normalise to upper case';
end
$$;
reset role;

-- An account without a configuring role is refused even at AAL2.
insert into auth.users (id) values ('10000000-0000-4000-8000-000000000203');
insert into public.people (id, given_name, family_name, display_name) values
  ('20000000-0000-4000-8000-000000000203', 'Plain', 'Staff', 'Plain Staff');
insert into public.user_accounts (id, person_id, status, verified_contact) values
  ('10000000-0000-4000-8000-000000000203', '20000000-0000-4000-8000-000000000203', 'active', 'plain.staff@example.test');
insert into public.role_grants (account_id, role_code, status, effective_from) values
  ('10000000-0000-4000-8000-000000000203', 'admissions_officer', 'active', now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000203', true);
do $$
declare v_denied boolean := false;
begin
  begin
    perform app.subjects_upsert(null, 'HIS', 'History', 'not my grant');
  exception when others then v_denied := true; end;
  assert v_denied, 'admissions_officer must not configure subjects';
end
$$;
reset role;

-- Empty catalog: every one of the 13 standard grades inserts.
truncate public.assessment_components, public.exam_definitions,
  public.result_batches, public.enrollments, public.admission_windows,
  public.grade_sections, public.grades cascade;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000201', true);
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal2"}', true);
do $$
declare v_inserted jsonb;
begin
  v_inserted := app.grades_add_standard_catalog('fill an empty grades table');
  assert jsonb_array_length(v_inserted) = 13, 'an empty catalog inserts all 13 grades';
  assert (select count(*) from public.grades) = 13;
end
$$;
reset role;

rollback;

select 'SCHOOL CONFIGURATION PASSED' as result;
