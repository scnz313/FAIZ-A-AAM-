-- Slice 4 transactional assertions. This file runs after validate-rpcs.sql on
-- the same scratch database and exercises a sheet-native (legacy_batch_id is
-- NULL) result through release and correction supersession.

-- Synthetic configuration and isolated actors; no production data.
insert into auth.users(id) values
  ('10000000-0000-4000-8000-000000000020'),
  ('10000000-0000-4000-8000-000000000021'),
  ('10000000-0000-4000-8000-000000000022'),
  ('10000000-0000-4000-8000-000000000023'),
  ('10000000-0000-4000-8000-000000000024')
on conflict do nothing;
insert into public.people(id, given_name, family_name, display_name) values
  ('20000000-0000-4000-8000-000000000020', 'Slice', 'Teacher', 'Slice Teacher'),
  ('20000000-0000-4000-8000-000000000021', 'Slice', 'Reviewer', 'Slice Reviewer'),
  ('20000000-0000-4000-8000-000000000022', 'Slice', 'Publisher', 'Slice Publisher'),
  ('20000000-0000-4000-8000-000000000023', 'Slice', 'Manager', 'Slice Manager'),
  ('20000000-0000-4000-8000-000000000024', 'Slice', 'Unassigned', 'Slice Unassigned')
on conflict do nothing;
insert into public.user_accounts(id, person_id, status, verified_contact) values
  ('10000000-0000-4000-8000-000000000020', '20000000-0000-4000-8000-000000000020', 'active', 'slice-teacher@example.in'),
  ('10000000-0000-4000-8000-000000000021', '20000000-0000-4000-8000-000000000021', 'active', 'slice-reviewer@example.in'),
  ('10000000-0000-4000-8000-000000000022', '20000000-0000-4000-8000-000000000022', 'active', 'slice-publisher@example.in'),
  ('10000000-0000-4000-8000-000000000023', '20000000-0000-4000-8000-000000000023', 'active', 'slice-manager@example.in'),
  ('10000000-0000-4000-8000-000000000024', '20000000-0000-4000-8000-000000000024', 'active', 'slice-unassigned@example.in')
on conflict do nothing;
insert into public.staff_members(person_id, employment_status, title)
select person_id, 'active', 'Slice test staff'
  from public.user_accounts
 where id in (
   '10000000-0000-4000-8000-000000000020', '10000000-0000-4000-8000-000000000021',
   '10000000-0000-4000-8000-000000000022', '10000000-0000-4000-8000-000000000023',
   '10000000-0000-4000-8000-000000000024'
 )
on conflict (person_id) do nothing;
insert into public.role_grants(account_id, role_code, status, effective_from)
select v.account_id, v.role_code, 'active', now()
  from (values
    ('10000000-0000-4000-8000-000000000020'::uuid, 'teacher'),
    ('10000000-0000-4000-8000-000000000021'::uuid, 'exam_reviewer'),
    ('10000000-0000-4000-8000-000000000022'::uuid, 'result_publisher'),
    ('10000000-0000-4000-8000-000000000023'::uuid, 'timetable_manager'),
    ('10000000-0000-4000-8000-000000000024'::uuid, 'teacher')
  ) v(account_id, role_code)
 where not exists (select 1 from public.role_grants rg where rg.account_id = v.account_id and rg.role_code = v.role_code and rg.status = 'active');

-- Resolve the exact current academic scope used by the synthetic test.
insert into public.role_grant_academic_years(role_grant_id, academic_year_id)
select rg.id, ay.id
  from public.role_grants rg
  cross join public.academic_years ay
 where rg.account_id in ('10000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000022','10000000-0000-4000-8000-000000000023')
   and ay.label = '2026-27'
on conflict do nothing;
insert into public.role_grant_grade_sections(role_grant_id, grade_section_id)
select rg.id, gs.id
  from public.role_grants rg
  join public.grade_sections gs on gs.academic_year_id = (select id from public.academic_years where label = '2026-27')
 where rg.account_id in ('10000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000022')
   and gs.section_label = 'A'
on conflict do nothing;
insert into public.role_grant_grade_sections(role_grant_id, grade_section_id)
select rg.id, gs.id
  from public.role_grants rg
  join public.grade_sections gs on gs.academic_year_id = (select id from public.academic_years where label = '2026-27')
 where rg.account_id = '10000000-0000-4000-8000-000000000023'
   and gs.section_label = 'C'
on conflict do nothing;
insert into public.role_grant_subjects(role_grant_id, subject_id)
select rg.id, s.id
  from public.role_grants rg
  cross join public.subjects s
 where rg.account_id in ('10000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000022')
   and s.code = 'MAT'
on conflict do nothing;

insert into public.staff_assignments(staff_member_id, role_grant_id, academic_year_id, grade_section_id, subject_id, status, effective_from)
select sm.id, rg.id, ay.id, gs.id, s.id, 'active', now()
  from public.staff_members sm
  join public.user_accounts ua on ua.person_id = sm.person_id and ua.id = '10000000-0000-4000-8000-000000000020'
  join public.role_grants rg on rg.account_id = ua.id and rg.role_code = 'teacher' and rg.status = 'active'
  join public.academic_years ay on ay.label = '2026-27'
  join public.grade_sections gs on gs.academic_year_id = ay.id and gs.section_label = 'A'
  join public.grades g on g.id = gs.grade_id and g.code = '8'
  join public.subjects s on s.code = 'MAT'
on conflict do nothing;

-- A final exam definition has no legacy result batch in the fixture, so the
-- sheet created below proves native publication with batch_id = NULL.
insert into public.assessment_components(exam_definition_id, subject_id, name, max_marks, weight, sort_order)
select ed.id, s.id, c.name, c.max_marks, 1, c.sort_order
  from public.exam_definitions ed
  join public.grade_sections gs on gs.id = ed.grade_section_id and gs.section_label = 'A'
  join public.grades g on g.id = gs.grade_id and g.code = '8'
  join public.subjects s on s.code = 'MAT'
  cross join (values ('Written', 80::numeric, 0), ('Oral', 20::numeric, 1)) c(name, max_marks, sort_order)
 where ed.term = 'final'
on conflict do nothing;

-- Capture fixture IDs before switching to the authenticated role; the
-- transaction assertions below intentionally run through RLS.
select set_config('slice4.year', (select id::text from public.academic_years where label = '2026-27'), false);
select set_config('slice4.section', (select gs.id::text from public.grade_sections gs join public.grades g on g.id = gs.grade_id where gs.academic_year_id = (select id from public.academic_years where label = '2026-27') and g.code = '8' and gs.section_label = 'A'), false);
select set_config('slice4.subject', (select id::text from public.subjects where code = 'MAT'), false);
select set_config('slice4.exam', (select ed.id::text from public.exam_definitions ed where ed.academic_year_id = (select id from public.academic_years where label = '2026-27') and ed.grade_section_id = (select gs.id from public.grade_sections gs join public.grades g on g.id = gs.grade_id where gs.academic_year_id = (select id from public.academic_years where label = '2026-27') and g.code = '8' and gs.section_label = 'A') and ed.term = 'final'), false);
select set_config('slice4.student', (select e.student_id::text from public.enrollments e where e.academic_year_id = (select id from public.academic_years where label = '2026-27') and e.grade_section_id = (select gs.id from public.grade_sections gs join public.grades g on g.id = gs.grade_id where gs.academic_year_id = (select id from public.academic_years where label = '2026-27') and g.code = '8' and gs.section_label = 'A') and e.status = 'active' order by e.id limit 1), false);
select set_config('slice4.enrollment', (select e.id::text from public.enrollments e where e.academic_year_id = (select id from public.academic_years where label = '2026-27') and e.grade_section_id = (select gs.id from public.grade_sections gs join public.grades g on g.id = gs.grade_id where gs.academic_year_id = (select id from public.academic_years where label = '2026-27') and g.code = '8' and gs.section_label = 'A') and e.status = 'active' order by e.id limit 1), false);

select set_config('request.jwt.claims', '{"aal":"aal2"}', false);

do $$
declare
  v_year uuid;
  v_section uuid;
  v_subject uuid;
  v_exam uuid;
  v_student uuid;
  v_enrollment uuid;
  v_sheet jsonb;
  v_new_sheet jsonb;
  v_save jsonb;
  v_pub jsonb;
  v_release jsonb;
  v_request jsonb;
  v_approval jsonb;
  v_marks jsonb;
  v_new_marks jsonb;
  v_failed boolean;
  v_old_release uuid;
  v_new_release uuid;
  v_count int;
begin
  v_year := current_setting('slice4.year')::uuid;
  v_section := current_setting('slice4.section')::uuid;
  v_subject := current_setting('slice4.subject')::uuid;
  v_exam := current_setting('slice4.exam')::uuid;
  v_student := current_setting('slice4.student')::uuid;
  v_enrollment := current_setting('slice4.enrollment')::uuid;
  assert v_student is not null and v_enrollment is not null, 'slice fixture has an active 8-A enrollment';

  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000020', false);
  v_sheet := app.results_entry_sheet_create(v_exam, v_section, v_subject, 'slice4-sheet-create');
  assert (v_sheet ->> 'sheetId') is not null, 'sheet creation returns a sheet';
  assert (select legacy_batch_id is null from public.result_entry_sheets where id = (v_sheet ->> 'sheetId')::uuid), 'new sheet has no legacy batch';
  select jsonb_agg(jsonb_build_object('rosterId', rer.id, 'componentId', rec.id, 'obtained', 10, 'markStatus', 'present'))
    into v_marks
    from public.result_entry_sheet_rosters rer cross join public.result_entry_sheet_components rec
   where rer.sheet_id = (v_sheet ->> 'sheetId')::uuid and rec.sheet_id = (v_sheet ->> 'sheetId')::uuid;
  v_save := app.results_entry_sheet_save_draft((v_sheet ->> 'sheetId')::uuid, v_marks, 1, 'slice4-full-matrix');
  assert (select count(*) from public.result_entry_sheet_marks where sheet_id = (v_sheet ->> 'sheetId')::uuid) = (select count(*) from public.result_entry_sheet_rosters where sheet_id = (v_sheet ->> 'sheetId')::uuid) * (select count(*) from public.result_entry_sheet_components where sheet_id = (v_sheet ->> 'sheetId')::uuid), 'save persists every roster x component cell';
  v_failed := false;
  begin perform app.results_entry_sheet_save_draft((v_sheet ->> 'sheetId')::uuid, v_marks, 1, 'slice4-stale'); exception when others then v_failed := true; end;
  assert v_failed, 'stale sheet version is denied';

  perform set_config('request.jwt.claims', '{"aal":"aal1"}', false);
  v_failed := false;
  begin perform app.results_entry_sheet_submit((v_sheet ->> 'sheetId')::uuid, (v_save ->> 'version')::int, 'slice4-aal1'); exception when others then v_failed := true; end;
  assert v_failed, 'AAL1 teacher cannot submit';
  perform set_config('request.jwt.claims', '{"aal":"aal2"}', false);
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000024', false);
  v_failed := false;
  begin perform app.results_entry_sheet_create(v_exam, v_section, v_subject, 'slice4-wrong-assignment'); exception when others then v_failed := true; end;
  assert v_failed, 'teacher without exact assignment cannot create a sheet';

  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000020', false);
  perform app.results_entry_sheet_submit((v_sheet ->> 'sheetId')::uuid, (v_save ->> 'version')::int, 'slice4-submit');
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000022', false);
  v_failed := false;
  begin perform app.results_entry_sheet_moderate((v_sheet ->> 'sheetId')::uuid, 'approved', 'publisher cannot moderate', 3, 'slice4-publisher-checker'); exception when others then v_failed := true; end;
  assert v_failed, 'publisher cannot act as reviewer';
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000021', false);
  perform app.results_entry_sheet_moderate((v_sheet ->> 'sheetId')::uuid, 'approved', 'Independent check', 3, 'slice4-moderate');
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000022', false);
  v_failed := false;
  begin perform app.results_entry_sheet_moderate((v_sheet ->> 'sheetId')::uuid, 'approved', 'second checker', 4, 'slice4-second-check'); exception when others then v_failed := true; end;
  assert v_failed, 'reviewer state cannot be checked twice';
  v_pub := app.results_entry_sheet_publish((v_sheet ->> 'sheetId')::uuid, 4, 'slice4-publish');
  assert (select batch_id is null and source_entry_sheet_id = (v_sheet ->> 'sheetId')::uuid from public.result_publications where id = (v_pub ->> 'publicationId')::uuid), 'sheet-native publication has no fake legacy batch';
  v_release := app.results_report_release_publish(v_student, v_enrollment, v_year, 'final', jsonb_build_array(v_pub ->> 'publicationId'), null, 'slice4-release');
  v_old_release := (v_release ->> 'releaseId')::uuid;
  assert (select count(*) from public.result_report_release_items where release_id = v_old_release) = 1, 'release stores exact subject snapshot';
  v_failed := false;
  begin update public.result_report_release_items set snapshot = '{}'::jsonb where release_id = v_old_release; exception when others then v_failed := true; end;
  assert v_failed, 'release snapshot is immutable';

  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000020', false);
  v_request := app.results_request_correction(v_old_release, (v_pub ->> 'publicationId')::uuid, 'Correct oral mark', 'slice4-correction-request');
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000021', false);
  v_approval := app.results_approve_correction((v_request ->> 'requestId')::uuid, 1, 'slice4-correction-approve');
  v_new_sheet := jsonb_build_object('sheetId', v_approval ->> 'sheetId');
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000020', false);
  select jsonb_agg(jsonb_build_object('rosterId', rer.id, 'componentId', rec.id, 'obtained', 11, 'markStatus', 'present'))
    into v_new_marks
    from public.result_entry_sheet_rosters rer cross join public.result_entry_sheet_components rec
   where rer.sheet_id = (v_approval ->> 'sheetId')::uuid and rec.sheet_id = (v_approval ->> 'sheetId')::uuid;
  v_save := app.results_entry_sheet_save_draft((v_approval ->> 'sheetId')::uuid, v_new_marks, 1, 'slice4-correction-save');
  perform app.results_entry_sheet_submit((v_approval ->> 'sheetId')::uuid, (v_save ->> 'version')::int, 'slice4-correction-submit');
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000021', false);
  perform app.results_entry_sheet_moderate((v_approval ->> 'sheetId')::uuid, 'approved', 'Correction checked', 3, 'slice4-correction-moderate');
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000022', false);
  perform app.results_entry_sheet_publish((v_approval ->> 'sheetId')::uuid, 4, 'slice4-correction-publish');
  select id into v_new_release from public.result_report_releases where student_id = v_student and academic_year_id = v_year and term = 'final' and status = 'published';
  assert (select status = 'superseded' from public.result_report_releases where id = v_old_release), 'prior report release is superseded, not rewritten';
  assert v_new_release is not null and v_new_release <> v_old_release, 'correction creates a new report release';
  assert (select count(*) from public.result_report_release_items where release_id = v_new_release) = 1, 'superseding release preserves exact subject manifest';

  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000023', false);
  v_failed := false;
  begin perform app.timetable_save_draft(v_section, null, '[]'::jsonb, 0); exception when others then v_failed := true; end;
  assert v_failed, 'timetable manager scoped to 9-C cannot mutate 8-A';
  assert (app.timetable_save_draft((select id from public.grade_sections where academic_year_id = v_year and section_label = 'C' limit 1), null, '[]'::jsonb, 0) ->> 'status') = 'draft', 'scoped manager can mutate the assigned section';
end
$$;

set role authenticated;
do $$
begin
  assert (select count(*) from public.timetable_versions where grade_section_id = current_setting('slice4.section')::uuid) = 0, 'timetable manager cannot read another section';
end
$$;
reset role;
select 'SLICE 4 RESULTS/TIMETABLE SUITE PASSED' as result;
