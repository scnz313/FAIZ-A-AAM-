-- =============================================================================
-- 000057 — Teaching records, timetable, and result workflow repair
--
-- Forward-only repair of live Phase 3 defects:
--   1. Teaching staff are People without accounts: backfill Person rows for
--      null-person staff members, persist the real display name, and restore
--      person_id NOT NULL once no nulls remain.
--   2. teaching_staff_create stores the display name; assignments are
--      restricted to non-login teaching records.
--   3. teaching_staff_list returns the complete contract shape.
--   4. Result entry: remove the legacy Teacher write branch — only
--      result_entry_officer + AAL2 + scope writes marks.
--   5. Maker/checker: the Principal-originating account cannot moderate or
--      publish; ONE independent Administrator may moderate AND publish a
--      Principal-originated sheet (actor-level no-self-approval preserved).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Teaching staff are People without accounts
-- ---------------------------------------------------------------------------

-- Backfill Person rows for teaching staff created without one.
insert into public.people (given_name, family_name, display_name)
select sm.title, '', coalesce(nullif(btrim(sm.title), ''), 'Teaching staff')
  from public.staff_members sm
 where sm.person_id is null
   and not exists (
     select 1 from public.people p where p.display_name = coalesce(nullif(btrim(sm.title), ''), 'Teaching staff')
       and p.given_name = sm.title);

update public.staff_members sm
   set person_id = p.id
  from public.people p
 where sm.person_id is null
   and p.display_name = coalesce(nullif(btrim(sm.title), ''), 'Teaching staff')
   and p.given_name = sm.title;

-- Restore the canonical invariant once no nulls remain.
do $$
begin
  if exists (select 1 from public.staff_members where person_id is null) then
    raise warning 'staff_members.person_id still has nulls — NOT NULL not restored';
  else
    alter table public.staff_members alter column person_id set not null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Teaching staff commands: persist names, restrict to non-login records
-- ---------------------------------------------------------------------------

create or replace function app.teaching_staff_create(
  p_display_name text,
  p_title text,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_staff_id uuid;
  v_staff_ref text;
  v_person_id uuid;
  v_name_parts text[];
  v_given text;
  v_family text;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['timetable_manager'])) then
    raise exception 'teaching records require the timetable manager and aal2';
  end if;
  if p_display_name is null or length(btrim(p_display_name)) < 2 then
    raise exception 'display name is required';
  end if;
  if p_title is null or length(btrim(p_title)) < 1 then
    raise exception 'job title is required';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'reason is required';
  end if;

  -- Split the display name into given/family for the Person record.
  v_name_parts := string_to_array(btrim(p_display_name), ' ');
  v_given := v_name_parts[1];
  v_family := coalesce((select string_agg(part, ' ') from unnest(v_name_parts[2:]) part), '');

  insert into public.people (given_name, family_name, display_name)
  values (coalesce(v_given, 'Teaching'), v_family, btrim(p_display_name))
  returning id into v_person_id;

  insert into public.staff_members (person_id, employment_status, title)
  values (v_person_id, 'active', btrim(p_title))
  returning id, reference into v_staff_id, v_staff_ref;

  perform app.record_audit('Teaching staff record created', 'staff_member', v_staff_ref, 'Success', btrim(p_reason), 'Timetable manager');
  return jsonb_build_object('staffMemberId', v_staff_id, 'reference', v_staff_ref,
                            'displayName', btrim(p_display_name), 'title', btrim(p_title), 'status', 'active');
end
$$;

create or replace function app.teaching_assignment_create(
  p_staff_member_id uuid,
  p_academic_year_id uuid,
  p_grade_section_id uuid,
  p_subject_id uuid,
  p_effective_from timestamptz default null,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_assignment public.teaching_assignments%rowtype;
  v_year uuid;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['timetable_manager'])) then
    raise exception 'teaching assignments require the timetable manager and aal2';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'reason is required';
  end if;
  -- Assignments attach ONLY to non-login teaching records: the staff member
  -- must have no active user account.
  if not exists (
    select 1 from public.staff_members sm
     where sm.id = p_staff_member_id
       and not exists (
         select 1 from public.user_accounts ua
          where ua.person_id = sm.person_id
            and exists (select 1 from public.role_grants rg
                         where rg.account_id = ua.id and rg.status = 'active'
                           and rg.role_code not in ('guardian', 'student')))
  ) then
    raise exception 'assignments attach only to non-login teaching records';
  end if;
  select academic_year_id into v_year from public.grade_sections where id = p_grade_section_id;
  if v_year is null or v_year <> p_academic_year_id then
    raise exception 'grade section does not belong to the academic year';
  end if;
  if not exists (select 1 from public.subjects where id = p_subject_id) then
    raise exception 'subject not found';
  end if;
  if exists (
    select 1 from public.teaching_assignments
     where staff_member_id = p_staff_member_id and academic_year_id = p_academic_year_id
       and grade_section_id = p_grade_section_id and subject_id = p_subject_id
       and status in ('scheduled', 'active')
  ) then
    raise exception 'an active teaching assignment already exists for this class and subject';
  end if;

  insert into public.teaching_assignments
    (staff_member_id, academic_year_id, grade_section_id, subject_id, status,
     effective_from, provenance, created_reason, created_by_account_id)
  values
    (p_staff_member_id, p_academic_year_id, p_grade_section_id, p_subject_id, 'active',
     coalesce(p_effective_from, now()), 'manual', btrim(p_reason), auth.uid())
  returning * into v_assignment;

  perform app.record_audit('Teaching assignment created', 'teaching_assignment', v_assignment.reference, 'Success', btrim(p_reason), 'Timetable manager');
  return jsonb_build_object('assignmentId', v_assignment.id, 'reference', v_assignment.reference,
                            'status', v_assignment.status, 'version', v_assignment.version);
end
$$;

-- Complete contract-shape projection: displayName, status, legacyAccountId,
-- and full assignment audit fields.
create or replace function app.teaching_staff_list()
returns setof jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'staffMemberId', sm.id, 'staffRef', sm.reference,
    'displayName', p.display_name, 'title', sm.title,
    'status', sm.employment_status,
    'legacyAccountId', (select ua.id from public.user_accounts ua where ua.person_id = sm.person_id limit 1),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ta.id, 'reference', ta.reference, 'staffMemberId', ta.staff_member_id,
        'academicYearId', ta.academic_year_id, 'gradeSectionId', ta.grade_section_id,
        'subjectId', ta.subject_id, 'status', ta.status,
        'effectiveFromIso', ta.effective_from, 'effectiveToIso', ta.effective_to,
        'version', ta.version, 'provenance', ta.provenance, 'sourceRef', ta.source_ref,
        'createdReason', ta.created_reason, 'createdAtIso', ta.created_at,
        'updatedByAccountId', ta.updated_by_account_id,
        'gradeLabel', g.label, 'sectionLabel', gs.section_label, 'subjectName', s.name)
        order by ta.created_at)
      from public.teaching_assignments ta
      left join public.grade_sections gs on gs.id = ta.grade_section_id
      left join public.grades g on g.id = gs.grade_id
      left join public.subjects s on s.id = ta.subject_id
     where ta.staff_member_id = sm.id), '[]'::jsonb)
  )
    from public.staff_members sm
    join public.people p on p.id = sm.person_id
   where app.is_staff_aal2()
     and (app.has_any_role(array['timetable_manager', 'auditor', 'exam_reviewer', 'result_publisher'])
          or app.has_role('system_administrator'))
     and not exists (
        select 1 from public.user_accounts ua
         where ua.person_id = sm.person_id
           and exists (select 1 from public.role_grants rg
                        where rg.account_id = ua.id and rg.status = 'active'
                          and rg.role_code not in ('guardian', 'student')))
$$;

-- ---------------------------------------------------------------------------
-- 3. Result entry: remove the legacy Teacher write branch
-- ---------------------------------------------------------------------------

create or replace function app.result_entry_sheet_scope(p_sheet_id uuid, p_roles text[])
returns boolean language sql security definer set search_path = '' as $$
  select exists (
    select 1
      from public.result_entry_sheets res
      where res.id = p_sheet_id
        and (
          (app.has_role('result_entry_officer') and app.staff_scope_allowed(array['result_entry_officer'], res.academic_year_id, res.grade_section_id, res.subject_id))
          or (not app.has_role('result_entry_officer') and app.staff_scope_allowed(array_remove(p_roles, 'teacher'), res.academic_year_id, res.grade_section_id, res.subject_id))
        )
  )
$$;

create or replace function app.results_entry_sheet_create(
  p_exam_definition_id uuid,
  p_grade_section_id uuid,
  p_subject_id uuid,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_exam public.exam_definitions%rowtype;
  v_sheet public.result_entry_sheets%rowtype;
  v_hash text := md5(jsonb_build_object('exam', p_exam_definition_id, 'section', p_grade_section_id, 'subject', p_subject_id)::text);
  v_cached jsonb;
  v_component_count int;
  v_roster_count int;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('result_entry_officer') and app.staff_scope_allowed(array['result_entry_officer'],
    (select academic_year_id from public.exam_definitions where id = p_exam_definition_id), p_grade_section_id, p_subject_id)) then
    raise exception 'result entry officer role, aal2, and exact class/subject scope required';
  end if;
  if p_idempotency_key is not null then
    v_cached := app.results_idempotency_begin('sheet-create:' || p_idempotency_key, v_hash);
    if v_cached is not null then return v_cached; end if;
  end if;
  select * into v_exam from public.exam_definitions where id = p_exam_definition_id;
  if v_exam.id is null or v_exam.grade_section_id <> p_grade_section_id then raise exception 'exam and section do not match'; end if;
  if not exists (select 1 from public.subjects where id = p_subject_id) then raise exception 'subject not found'; end if;
  select * into v_sheet
    from public.result_entry_sheets
   where exam_definition_id = p_exam_definition_id
     and grade_section_id = p_grade_section_id
     and subject_id = p_subject_id
     and state in ('draft','submitted','moderation','returned','approved')
   order by created_at desc limit 1 for update;
  if v_sheet.id is null then
    insert into public.result_entry_sheets (exam_definition_id, academic_year_id, grade_section_id, subject_id, state, version, last_entry_by_account_id)
    values (p_exam_definition_id, v_exam.academic_year_id, p_grade_section_id, p_subject_id, 'draft', 1, auth.uid())
    returning * into v_sheet;
    insert into public.result_entry_sheet_components (sheet_id, assessment_component_id, name, max_marks, weight, component_order)
      select v_sheet.id, ac.id, ac.name, ac.max_marks, ac.weight, ac.sort_order
        from public.assessment_components ac
       where ac.exam_definition_id = p_exam_definition_id and ac.subject_id = p_subject_id
       order by ac.sort_order, ac.id;
    insert into public.result_entry_sheet_rosters (sheet_id, student_id, enrollment_id, roster_order)
      select v_sheet.id, e.student_id, e.id, row_number() over (order by e.student_id)
        from public.enrollments e
       where e.academic_year_id = v_exam.academic_year_id
         and e.grade_section_id = p_grade_section_id
         and e.status = 'active';
    insert into public.result_entry_sheet_versions (sheet_id, version, state, note, actor_account_id)
    values (v_sheet.id, v_sheet.version, v_sheet.state, 'Entry sheet created', auth.uid());
  elsif not exists (select 1 from public.result_entry_sheet_versions rev where rev.sheet_id = v_sheet.id) then
    insert into public.result_entry_sheet_versions (sheet_id, version, state, note, actor_account_id)
    values (v_sheet.id, v_sheet.version, v_sheet.state, 'Entry sheet history initialized', auth.uid());
  end if;
  select count(*) into v_component_count from public.result_entry_sheet_components where sheet_id = v_sheet.id;
  select count(*) into v_roster_count from public.result_entry_sheet_rosters where sheet_id = v_sheet.id;
  if v_component_count = 0 then raise exception 'entry sheet has no assessment components'; end if;
  if v_roster_count = 0 then raise exception 'entry sheet has no eligible roster'; end if;
  v_result := jsonb_build_object(
    'sheetId', v_sheet.id, 'reference', v_sheet.reference, 'examDefinitionId', v_sheet.exam_definition_id,
    'academicYearId', v_sheet.academic_year_id, 'gradeSectionId', v_sheet.grade_section_id,
    'subjectId', v_sheet.subject_id, 'state', v_sheet.state, 'version', v_sheet.version,
    'rosterCount', v_roster_count, 'componentCount', v_component_count
  );
  if p_idempotency_key is not null then return app.results_idempotency_finish('sheet-create:' || p_idempotency_key, v_hash, v_result); end if;
  return v_result;
end
$$;

create or replace function app.results_entry_sheet_save_draft(
  p_sheet_id uuid,
  p_marks jsonb,
  p_expected_version int,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_sheet public.result_entry_sheets%rowtype;
  v_mark jsonb;
  v_hash text := md5(coalesce(p_marks, '[]'::jsonb)::text || ':' || p_expected_version::text);
  v_cached jsonb;
  v_expected int;
  v_distinct int;
  v_total int;
  v_status text;
  v_obtained numeric;
  v_max numeric;
  v_mark_status text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  select * into v_sheet from public.result_entry_sheets where id = p_sheet_id for update;
  if v_sheet.id is null then raise exception 'entry sheet not found'; end if;
  if not (app.has_role('result_entry_officer') and app.staff_scope_allowed(array['result_entry_officer'], v_sheet.academic_year_id, v_sheet.grade_section_id, v_sheet.subject_id)) then
    raise exception 'result entry officer role, aal2, and exact class/subject scope required';
  end if;
  if v_sheet.state not in ('draft','returned') then raise exception 'entry sheet is not open for editing'; end if;
  if v_sheet.version <> p_expected_version then raise exception 'entry sheet version mismatch (expected %, found %)', p_expected_version, v_sheet.version; end if;
  if jsonb_typeof(coalesce(p_marks, '[]'::jsonb)) <> 'array' then raise exception 'marks must be an array'; end if;
  if p_idempotency_key is not null then
    v_cached := app.results_idempotency_begin('sheet-save:' || p_sheet_id::text || ':' || p_idempotency_key, v_hash);
    if v_cached is not null then return v_cached; end if;
  end if;
  select count(*) into v_total
    from public.result_entry_sheet_rosters rer cross join public.result_entry_sheet_components rec
   where rer.sheet_id = p_sheet_id and rec.sheet_id = p_sheet_id;
  select count(distinct (coalesce(v ->> 'rosterId','') || ':' || coalesce(v ->> 'componentId','')))
    into v_distinct from jsonb_array_elements(coalesce(p_marks,'[]'::jsonb)) as values(v);
  if jsonb_array_length(coalesce(p_marks,'[]'::jsonb)) <> v_total or v_distinct <> v_total then
    raise exception 'every roster student and assessment component is required exactly once';
  end if;
  for v_mark in select * from jsonb_array_elements(coalesce(p_marks,'[]'::jsonb)) loop
    if not exists (select 1 from public.result_entry_sheet_rosters where id = nullif(v_mark ->> 'rosterId','')::uuid and sheet_id = p_sheet_id) then raise exception 'mark roster is outside this entry sheet'; end if;
    select rec.max_marks into v_max from public.result_entry_sheet_components rec where rec.id = nullif(v_mark ->> 'componentId','')::uuid and rec.sheet_id = p_sheet_id;
    if v_max is null then raise exception 'mark component is outside this entry sheet'; end if;
    v_obtained := nullif(v_mark ->> 'obtained','')::numeric;
    v_mark_status := coalesce(nullif(v_mark ->> 'markStatus',''), case when coalesce((v_mark ->> 'absent')::boolean,false) then 'absent' when v_obtained is null then 'pending' else 'present' end);
    if v_mark_status not in ('pending','present','absent','exempt','not_applicable') then raise exception 'invalid result mark status'; end if;
    if v_obtained is not null and (v_obtained < 0 or v_obtained > v_max) then raise exception 'mark exceeds the component maximum (%)', v_max; end if;
    if v_mark_status = 'present' and v_obtained is null then raise exception 'present mark requires a numeric value'; end if;
    if v_mark_status <> 'present' and v_obtained is not null then raise exception 'non-present mark cannot carry a numeric value'; end if;
    insert into public.result_entry_sheet_marks(sheet_id, roster_id, component_id, obtained, mark_status, remark)
    values (p_sheet_id, (v_mark ->> 'rosterId')::uuid, (v_mark ->> 'componentId')::uuid, v_obtained, v_mark_status, nullif(v_mark ->> 'remark',''))
    on conflict (sheet_id, roster_id, component_id) do update
      set obtained = excluded.obtained, mark_status = excluded.mark_status, remark = excluded.remark, updated_at = now();
  end loop;
  update public.result_entry_sheets
     set version = version + 1, state = 'draft', last_entry_by_account_id = auth.uid(), updated_at = now()
   where id = p_sheet_id returning version, state into v_expected, v_status;
  insert into public.result_entry_sheet_versions(sheet_id, version, state, note, actor_account_id)
  values (p_sheet_id, v_expected, v_status, 'Draft saved', auth.uid());
  v_result := jsonb_build_object('sheetId', p_sheet_id, 'version', v_expected, 'state', v_status, 'status', v_status);
  if p_idempotency_key is not null then return app.results_idempotency_finish('sheet-save:' || p_sheet_id::text || ':' || p_idempotency_key, v_hash, v_result); end if;
  return v_result;
end
$$;

create or replace function app.results_entry_sheet_submit(
  p_sheet_id uuid,
  p_expected_version int,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_sheet public.result_entry_sheets%rowtype;
  v_hash text := md5(p_sheet_id::text || ':' || p_expected_version::text);
  v_cached jsonb;
  v_total int;
  v_complete int;
  v_version int;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  select * into v_sheet from public.result_entry_sheets where id = p_sheet_id for update;
  if v_sheet.id is null then raise exception 'entry sheet not found'; end if;
  if not (app.has_role('result_entry_officer') and app.staff_scope_allowed(array['result_entry_officer'], v_sheet.academic_year_id, v_sheet.grade_section_id, v_sheet.subject_id)) then
    raise exception 'result entry officer role, aal2, and exact class/subject scope required';
  end if;
  if v_sheet.version <> p_expected_version then raise exception 'entry sheet version mismatch (expected %, found %)', p_expected_version, v_sheet.version; end if;
  if v_sheet.state not in ('draft','returned') then raise exception 'entry sheet is not open for submission'; end if;
  if p_idempotency_key is not null then
    v_cached := app.results_idempotency_begin('sheet-submit:' || p_sheet_id::text || ':' || p_idempotency_key, v_hash);
    if v_cached is not null then return v_cached; end if;
  end if;
  select count(*) into v_total from public.result_entry_sheet_rosters rer cross join public.result_entry_sheet_components rec where rer.sheet_id = p_sheet_id and rec.sheet_id = p_sheet_id;
  select count(*) into v_complete from public.result_entry_sheet_marks rem where rem.sheet_id = p_sheet_id and rem.mark_status <> 'pending';
  if v_total = 0 or v_complete <> v_total then raise exception 'every roster row and component mark must be complete before submission'; end if;
  update public.result_entry_sheets set version = version + 1, state = 'submitted', updated_at = now() where id = p_sheet_id returning version into v_version;
  insert into public.result_entry_sheet_versions(sheet_id, version, state, note, actor_account_id) values (p_sheet_id, v_version, 'submitted', 'Marks submitted', auth.uid());
  perform app.record_audit('Result entry sheet submitted', 'result_entry_sheet', v_sheet.reference, 'Success');
  perform app.enqueue_outbox('email.result_entry_sheet_submitted:' || v_sheet.reference || ':v' || v_version, 'email.deliver', 'result_entry_sheet', v_sheet.reference, jsonb_build_object('channel','email'));
  v_result := jsonb_build_object('sheetId', p_sheet_id, 'reference', v_sheet.reference, 'version', v_version, 'state', 'submitted', 'status', 'submitted');
  if p_idempotency_key is not null then return app.results_idempotency_finish('sheet-submit:' || p_sheet_id::text || ':' || p_idempotency_key, v_hash, v_result); end if;
  return v_result;
end
$$;

-- Maker/checker: the Principal-originating account cannot moderate or
-- publish; ONE independent Administrator (exam_reviewer AND result_publisher
-- grants, differing from the entry actor) may moderate AND publish a
-- Principal-originated sheet. No account approves its own originating work.
-- This migration redefines publish; moderation (000028) already enforces
-- checker ≠ entry actor, which is exactly the two-profile split.

create or replace function app.results_entry_sheet_publish(
  p_sheet_id uuid,
  p_expected_version int,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_sheet public.result_entry_sheets%rowtype;
  v_pub public.result_publications%rowtype;
  v_hash text := md5(p_sheet_id::text || ':' || p_expected_version::text);
  v_cached jsonb;
  v_version int;
  v_count int;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['result_publisher'])) then raise exception 'result publisher role and aal2 required'; end if;
  select * into v_sheet from public.result_entry_sheets where id = p_sheet_id for update;
  if v_sheet.id is null then raise exception 'entry sheet not found'; end if;
  if not app.result_entry_sheet_scope(p_sheet_id, array['result_publisher']) then raise exception 'result publisher scope does not include this academic section/subject'; end if;
  if v_sheet.state <> 'approved' then raise exception 'only approved entry sheets can be published'; end if;
  if v_sheet.version <> p_expected_version then raise exception 'entry sheet version mismatch (expected %, found %)', p_expected_version, v_sheet.version; end if;
  -- Actor-level separation: the publisher differs from the entry actor.
  if v_sheet.last_entry_by_account_id = auth.uid() then raise exception 'publisher must be independent from the entry actor'; end if;
  if p_idempotency_key is not null then
    v_cached := app.results_idempotency_begin('sheet-publish:' || p_sheet_id::text || ':' || p_idempotency_key, v_hash);
    if v_cached is not null then return v_cached; end if;
  end if;
  select count(*) into v_count
    from public.result_entry_sheet_rosters rer cross join public.result_entry_sheet_components rec
   where rer.sheet_id = p_sheet_id and rec.sheet_id = p_sheet_id;
  if v_count = 0 or (select count(*) from public.result_entry_sheet_marks rem where rem.sheet_id = p_sheet_id and rem.mark_status <> 'pending') <> v_count then
    raise exception 'entry sheet is incomplete';
  end if;
  select coalesce(max(rp.version), 0) + 1 into v_version from public.result_publications rp where rp.source_entry_sheet_id = p_sheet_id;
  insert into public.result_publications(batch_id, version, status, published_by_account_id, source_entry_sheet_id)
  values (v_sheet.legacy_batch_id, v_version, 'final', auth.uid(), p_sheet_id)
  returning * into v_pub;
  insert into public.result_publication_items(publication_id, student_id, snapshot)
  select v_pub.id, rer.student_id,
         jsonb_build_object(
           'subject', s.name, 'term', ed.term, 'academicYearId', ed.academic_year_id,
           'entrySheetRef', v_sheet.reference, 'entrySheetVersion', v_sheet.version,
           'marks', coalesce((select jsonb_agg(jsonb_build_object(
               'component', rec.name, 'max', rec.max_marks, 'obtained', rem.obtained,
               'status', rem.mark_status, 'remark', rem.remark) order by rec.component_order, rec.id)
             from public.result_entry_sheet_marks rem
             join public.result_entry_sheet_components rec on rec.id = rem.component_id
            where rem.sheet_id = p_sheet_id and rem.roster_id = rer.id), '[]'::jsonb)
         )
    from public.result_entry_sheet_rosters rer
    join public.subjects s on s.id = v_sheet.subject_id
    join public.exam_definitions ed on ed.id = v_sheet.exam_definition_id
   where rer.sheet_id = p_sheet_id;
  update public.result_entry_sheets set state = 'published', version = version + 1, published_by_account_id = auth.uid(), updated_at = now() where id = p_sheet_id returning version into v_version;
  insert into public.result_entry_sheet_versions(sheet_id, version, state, note, actor_account_id) values (p_sheet_id, v_version, 'published', 'Subject publication released', auth.uid());
  perform app.record_audit('Result entry sheet published', 'result_publication', v_pub.reference, 'Success');
  perform app.enqueue_outbox('email.result_publication:' || v_pub.reference, 'email.deliver', 'result_publication', v_pub.reference, jsonb_build_object('channel','email'));
  if v_sheet.source_sheet_id is not null then
    perform app.results_supersede_releases_for_sheet(v_sheet.source_sheet_id, v_pub.id, p_sheet_id, auth.uid());
  end if;
  v_result := jsonb_build_object('publicationId', v_pub.id, 'publicationRef', v_pub.reference, 'version', v_pub.version, 'sheetId', p_sheet_id, 'state', 'published');
  if p_idempotency_key is not null then return app.results_idempotency_finish('sheet-publish:' || p_sheet_id::text || ':' || p_idempotency_key, v_hash, v_result); end if;
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Legacy batch marks flow: result_entry_officer replaces teacher scope
-- ---------------------------------------------------------------------------

-- The result_batches RLS read policy (000025) only listed checker/publisher
-- roles. The central entry officer needs read access to their scoped batches.
create or replace function app.result_batch_scope(p_batch_id uuid, p_roles text[])
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.result_batches b
      join public.exam_definitions ed on ed.id = b.exam_definition_id
     where b.id = p_batch_id
       and (
         app.staff_scope_allowed(p_roles, ed.academic_year_id, b.grade_section_id, b.subject_id)
         or (app.has_role('result_entry_officer')
             and (auth.jwt() ->> 'aal') = 'aal2'
             and exists (
           select 1 from public.staff_assignments sa
            join public.staff_members sm on sm.id = sa.staff_member_id
            join public.user_accounts ua on ua.person_id = sm.person_id
           where ua.id = auth.uid()
             and sa.status = 'active'
             and sa.academic_year_id = ed.academic_year_id
             and sa.grade_section_id = b.grade_section_id
             and sa.subject_id = b.subject_id
             and sa.effective_from <= now()
             and (sa.effective_to is null or sa.effective_to > now())
         ))
       )
  )
$$;

-- The result_batches RLS read policy (000025) only listed checker/publisher
-- roles; the central entry officer needs read access to their scoped batches.
drop policy if exists scope_results_batches_read on public.result_batches;
create policy scope_results_batches_read on public.result_batches for select to authenticated
  using (app.result_batch_scope(id, array['exam_reviewer','result_publisher','auditor']));
drop policy if exists scope_results_rosters_read on public.result_rosters;
create policy scope_results_rosters_read on public.result_rosters for select to authenticated
  using (exists (select 1 from public.result_batches b where b.id = result_rosters.batch_id and app.result_batch_scope(b.id, array['exam_reviewer','result_publisher','auditor'])));
drop policy if exists scope_results_versions_read on public.result_batch_versions;
create policy scope_results_versions_read on public.result_batch_versions for select to authenticated
  using (exists (select 1 from public.result_batches b where b.id = result_batch_versions.batch_id and app.result_batch_scope(b.id, array['exam_reviewer','result_publisher','auditor'])));
drop policy if exists scope_results_marks_read on public.mark_entries;
create policy scope_results_marks_read on public.mark_entries for select to authenticated
  using (exists (select 1 from public.result_batches b where b.id = mark_entries.batch_id and app.result_batch_scope(b.id, array['exam_reviewer','result_publisher','auditor'])));

-- The central entry officer needs read access to exam definitions,
-- assessment components, rosters, and marks for their scoped assignments
-- (000025 dropped the broad is_staff_aal2 read policies; the replacement
-- policies only covered checker/publisher/teacher roles).

drop policy if exists scope_entry_officer_exam_read on public.exam_definitions;
create policy scope_entry_officer_exam_read on public.exam_definitions for select to authenticated
  using (app.has_role('result_entry_officer')
     and (auth.jwt() ->> 'aal') = 'aal2'
     and exists (
       select 1 from public.staff_assignments sa
        join public.staff_members sm on sm.id = sa.staff_member_id
        join public.user_accounts ua on ua.person_id = sm.person_id
       where sa.academic_year_id = exam_definitions.academic_year_id
         and sa.grade_section_id = exam_definitions.grade_section_id
         and ua.id = auth.uid()
         and sa.status = 'active'
         and sa.effective_from <= now()
         and (sa.effective_to is null or sa.effective_to > now())));

drop policy if exists scope_entry_officer_components_read on public.assessment_components;
create policy scope_entry_officer_components_read on public.assessment_components for select to authenticated
  using (app.has_role('result_entry_officer')
     and (auth.jwt() ->> 'aal') = 'aal2'
     and exists (
       select 1 from public.exam_definitions ed
        join public.staff_assignments sa on sa.academic_year_id = ed.academic_year_id
        join public.staff_members sm on sm.id = sa.staff_member_id
        join public.user_accounts ua on ua.person_id = sm.person_id
       where ed.id = assessment_components.exam_definition_id
         and assessment_components.subject_id = sa.subject_id
         and ed.grade_section_id = sa.grade_section_id
         and ua.id = auth.uid()
         and sa.status = 'active'
         and sa.effective_from <= now()
         and (sa.effective_to is null or sa.effective_to > now())));

drop policy if exists scope_entry_officer_rosters_read on public.result_rosters;
create policy scope_entry_officer_rosters_read on public.result_rosters for select to authenticated
  using (exists (
    select 1 from public.result_batches b
     join public.exam_definitions ed on ed.id = b.exam_definition_id
     join public.staff_assignments sa on sa.academic_year_id = ed.academic_year_id
     join public.staff_members sm on sm.id = sa.staff_member_id
     join public.user_accounts ua on ua.person_id = sm.person_id
    where b.id = result_rosters.batch_id
      and b.grade_section_id = sa.grade_section_id
      and b.subject_id = sa.subject_id
      and ua.id = auth.uid()
      and sa.status = 'active'
      and app.has_role('result_entry_officer')
      and (auth.jwt() ->> 'aal') = 'aal2'));

drop policy if exists scope_entry_officer_marks_read on public.mark_entries;
create policy scope_entry_officer_marks_read on public.mark_entries for select to authenticated
  using (exists (
    select 1 from public.result_batches b
     join public.exam_definitions ed on ed.id = b.exam_definition_id
     join public.staff_assignments sa on sa.academic_year_id = ed.academic_year_id
     join public.staff_members sm on sm.id = sa.staff_member_id
     join public.user_accounts ua on ua.person_id = sm.person_id
    where b.id = mark_entries.batch_id
      and b.grade_section_id = sa.grade_section_id
      and b.subject_id = sa.subject_id
      and ua.id = auth.uid()
      and sa.status = 'active'
      and app.has_role('result_entry_officer')
      and (auth.jwt() ->> 'aal') = 'aal2'));

create or replace function app.results_submit_marks(
  p_batch_id uuid,
  p_marks jsonb,
  p_expected_version int
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.result_batches%rowtype;
  v_assigned boolean;
  v_roster_count int;
  v_covered int;
  v_mark jsonb;
  v_component_max numeric;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not app.is_staff_aal2() then
    raise exception 'staff aal2 required';
  end if;
  select * into v_batch from public.result_batches where id = p_batch_id;
  if v_batch.id is null then
    raise exception 'batch not found';
  end if;
  if v_batch.version <> p_expected_version then
    raise exception 'batch version mismatch (expected %, found %)', p_expected_version, v_batch.version;
  end if;
  if v_batch.status not in ('draft', 'returned') then
    raise exception 'batch is not open for entry (state: %)', v_batch.status;
  end if;

  -- Central entry: result_entry_officer + exact staff_assignments scope
  -- replaces the legacy teacher-assignment check (000057 — Teacher RPC
  -- writes are denied). Scope is assignment-exact, not role-grant-unscoped.
  select exists (
    select 1 from public.staff_assignments sa
     join public.staff_members sm on sm.id = sa.staff_member_id
     join public.user_accounts ua on ua.person_id = sm.person_id
    where ua.id = auth.uid()
      and sa.status = 'active'
      and sa.academic_year_id = (select academic_year_id from public.exam_definitions where id = v_batch.exam_definition_id)
      and sa.grade_section_id = v_batch.grade_section_id
      and sa.subject_id = v_batch.subject_id
      and sa.effective_from <= now()
      and (sa.effective_to is null or sa.effective_to > now())
  ) into v_assigned;
  if not v_assigned then
    raise exception 'result entry officer role, aal2, and exact class/subject scope required';
  end if;

  select count(*) into v_roster_count from public.result_rosters where batch_id = p_batch_id;
  if v_roster_count = 0 then
    raise exception 'batch has no frozen roster';
  end if;
  select count(distinct r.id) into v_covered
    from public.result_rosters r
    join public.result_batches rb on rb.id = r.batch_id
   where r.batch_id = p_batch_id
     and exists (select 1 from jsonb_array_elements(p_marks) m
                  where m ->> 'rosterId' = r.id::text);
  if v_covered <> v_roster_count then
    raise exception 'marks must cover every roster row exactly once';
  end if;
  for v_mark in select * from jsonb_array_elements(p_marks) loop
    if not exists (select 1 from public.result_rosters where id = nullif(v_mark ->> 'rosterId','')::uuid and batch_id = p_batch_id) then
      raise exception 'mark roster is outside this batch';
    end if;
    select ac.max_marks into v_component_max
      from public.assessment_components ac
     where ac.id = nullif(v_mark ->> 'componentId','')::uuid
       and ac.exam_definition_id = v_batch.exam_definition_id;
    if v_component_max is null then
      raise exception 'mark component is outside this batch';
    end if;
    if coalesce(nullif(v_mark ->> 'obtained','')::numeric, 0) > v_component_max then
      raise exception 'mark exceeds the component maximum (%)', v_component_max;
    end if;
    insert into public.mark_entries (batch_id, roster_id, component_id, obtained)
    values (p_batch_id, (v_mark ->> 'rosterId')::uuid, (v_mark ->> 'componentId')::uuid, nullif(v_mark ->> 'obtained','')::numeric)
    on conflict (batch_id, roster_id, component_id) do update
      set obtained = excluded.obtained, updated_at = now();
  end loop;
  update public.result_batches set status = 'submitted', version = v_batch.version + 1, updated_at = now()
   where id = p_batch_id;
  perform app.record_audit('Result marks submitted', 'result_batch',
    (select reference from public.result_batches where id = p_batch_id), 'Success');
end;
$$;

commit;
