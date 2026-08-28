-- =============================================================================
-- 000023 — C2.3 results and timetable application facades
--
-- Draft commands are optimistic and return authoritative JSON state. Published
-- result snapshots remain immutable. Timetable drafts carry a separate
-- revision counter and publication supersedes the previous effective version
-- for the same section. All commands are local-first and remain behind RLS.
-- =============================================================================

begin;

alter table public.timetable_versions
  add column if not exists revision int not null default 0;

-- ---------------------------------------------------------------------------
-- Results draft persistence and correction workflow
-- ---------------------------------------------------------------------------
create or replace function app.results_save_draft(
  p_batch_id uuid,
  p_marks jsonb,
  p_expected_version int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.result_batches%rowtype;
  v_assigned boolean;
  v_mark jsonb;
  v_max numeric;
  v_next int;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not app.is_staff_aal2() then raise exception 'staff aal2 required'; end if;
  select * into v_batch from public.result_batches where id = p_batch_id for update;
  if v_batch.id is null then raise exception 'batch not found'; end if;
  if v_batch.version <> p_expected_version then
    raise exception 'batch version mismatch (expected %, found %)', p_expected_version, v_batch.version;
  end if;
  if v_batch.status not in ('draft', 'returned') then
    raise exception 'batch is not open for entry (state: %)', v_batch.status;
  end if;
  select exists (
    select 1 from public.staff_assignments sa
    join public.staff_members sm on sm.id = sa.staff_member_id
    join public.user_accounts ua on ua.person_id = sm.person_id
    join public.exam_definitions ed on ed.id = v_batch.exam_definition_id
    where ua.id = auth.uid() and sa.status = 'active'
      and sa.academic_year_id = ed.academic_year_id
      and sa.grade_section_id = v_batch.grade_section_id
      and sa.subject_id = v_batch.subject_id
      and sa.effective_from <= now()
      and (sa.effective_to is null or sa.effective_to > now())
  ) into v_assigned;
  if not v_assigned then raise exception 'no active assignment for this batch (class/subject scope)'; end if;
  if jsonb_typeof(coalesce(p_marks, '[]'::jsonb)) <> 'array' then
    raise exception 'marks must be an array';
  end if;

  for v_mark in select * from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb)) loop
    select ac.max_marks into v_max
      from public.assessment_components ac
      join public.result_rosters r on r.id = (v_mark ->> 'rosterId')::uuid
      where r.batch_id = p_batch_id
        and ac.id = (v_mark ->> 'componentId')::uuid
        and ac.exam_definition_id = v_batch.exam_definition_id;
    if v_max is null then raise exception 'invalid component for the batch roster'; end if;
    if (v_mark ->> 'obtained') is not null
       and ((v_mark ->> 'obtained')::numeric < 0 or (v_mark ->> 'obtained')::numeric > v_max) then
      raise exception 'mark exceeds the component maximum (%)', v_max;
    end if;
    insert into public.mark_entries (batch_id, roster_id, component_id, obtained, absent, remark)
    values (p_batch_id, (v_mark ->> 'rosterId')::uuid, (v_mark ->> 'componentId')::uuid,
            nullif(v_mark ->> 'obtained', '')::numeric,
            coalesce((v_mark ->> 'absent')::boolean, false), v_mark ->> 'remark')
    on conflict (batch_id, roster_id, component_id)
    do update set obtained = excluded.obtained, absent = excluded.absent,
                  remark = excluded.remark, updated_at = now();
  end loop;

  v_next := v_batch.version + 1;
  insert into public.result_batch_versions (batch_id, version, status, note, created_by_account_id)
  values (p_batch_id, v_next, 'draft', 'draft saved', auth.uid());
  update public.result_batches set version = v_next, status = 'draft' where id = p_batch_id;
  return jsonb_build_object('batchId', p_batch_id, 'version', v_next, 'status', 'draft');
end
$$;

drop function if exists app.results_correction_request(uuid, text);
create function app.results_correction_request(
  p_publication_id uuid,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_request public.result_correction_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'correction reason is required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['result_publisher','exam_reviewer'])) then
    raise exception 'results reviewer or publisher role and aal2 required';
  end if;
  select * into v_request from public.result_correction_requests
   where publication_id = p_publication_id and status = 'requested'
   order by created_at desc limit 1;
  if v_request.id is not null then return v_request.id; end if;
  insert into public.result_correction_requests (publication_id, requested_by_account_id, reason)
  values (p_publication_id, auth.uid(), trim(p_reason)) returning * into v_request;
  perform app.record_audit('Result correction requested', 'result_publication',
    (select reference from public.result_publications where id = p_publication_id), 'Success', trim(p_reason));
  return v_request.id;
end
$$;

create or replace function app.results_correction_decide(
  p_request_id uuid,
  p_outcome text,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.result_correction_requests%rowtype;
  v_publication public.result_publications%rowtype;
  v_source public.result_batches%rowtype;
  v_new public.result_batches%rowtype;
  v_exam public.exam_definitions%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['exam_reviewer'])) then
    raise exception 'exam reviewer role and aal2 required';
  end if;
  if p_outcome not in ('approved','rejected') then raise exception 'invalid correction decision'; end if;
  select * into v_request from public.result_correction_requests where id = p_request_id for update;
  if v_request.id is null then raise exception 'correction request not found'; end if;
  if v_request.status <> 'requested' then
    return jsonb_build_object('requestId', v_request.id, 'status', v_request.status, 'batchId', null);
  end if;
  if v_request.requested_by_account_id = auth.uid() then raise exception 'reviewer cannot decide their own correction'; end if;
  update public.result_correction_requests
     set status = p_outcome, decided_by_account_id = auth.uid(), decided_at = now()
   where id = p_request_id;
  if p_outcome = 'rejected' then return jsonb_build_object('requestId', v_request.id, 'status', 'rejected', 'batchId', null); end if;

  select * into v_publication from public.result_publications where id = v_request.publication_id;
  select * into v_source from public.result_batches where id = v_publication.batch_id;
  select * into v_exam from public.exam_definitions where id = v_source.exam_definition_id;
  insert into public.result_batches (exam_definition_id, grade_section_id, subject_id, status, version)
  values (v_source.exam_definition_id, v_source.grade_section_id, v_source.subject_id, 'draft', 1)
  returning * into v_new;
  insert into public.result_rosters (batch_id, student_id, enrollment_id)
    select v_new.id, student_id, enrollment_id from public.result_rosters where batch_id = v_source.id;
  insert into public.mark_entries (batch_id, roster_id, component_id, obtained, absent, remark)
    select v_new.id, nr.id, me.component_id, me.obtained, me.absent, me.remark
      from public.mark_entries me
      join public.result_rosters orr on orr.id = me.roster_id and orr.batch_id = v_source.id
      join public.result_rosters nr on nr.batch_id = v_new.id and nr.student_id = orr.student_id
     where me.batch_id = v_source.id;
  insert into public.result_batch_versions (batch_id, version, status, note, created_by_account_id)
  values (v_new.id, 1, 'draft', coalesce(p_note, v_request.reason), auth.uid());
  insert into public.result_events (batch_id, event_type, visible_to_family, copy)
  values (v_new.id, 'correction_started', false, coalesce(p_note, v_request.reason));
  perform app.record_audit('Result correction started', 'result_batch', v_new.reference, 'Success');
  return jsonb_build_object('requestId', v_request.id, 'status', 'approved', 'batchId', v_new.id, 'batchReference', v_new.reference);
end
$$;

-- ---------------------------------------------------------------------------
-- Timetable drafts, conflict validation, overrides, and date sheets
-- ---------------------------------------------------------------------------
create or replace function app.timetable_save_draft(
  p_grade_section_id uuid,
  p_version_id uuid,
  p_periods jsonb,
  p_expected_revision int default 0
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.timetable_versions%rowtype;
  v_period jsonb;
  v_revision int;
  v_teacher uuid;
  v_subject uuid;
  v_day int;
  v_number int;
  v_room uuid;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['timetable_manager'])) then
    raise exception 'timetable manager role and aal2 required';
  end if;
  if jsonb_typeof(coalesce(p_periods, '[]'::jsonb)) <> 'array' then raise exception 'periods must be an array'; end if;
  if p_version_id is null then
    insert into public.timetable_versions (grade_section_id, status, version, revision)
    values (p_grade_section_id, 'draft', coalesce((select max(version)+1 from public.timetable_versions where grade_section_id = p_grade_section_id),1), 0)
    returning * into v_version;
  else
    select * into v_version from public.timetable_versions where id = p_version_id for update;
    if v_version.id is null then raise exception 'timetable version not found'; end if;
    if v_version.grade_section_id <> p_grade_section_id then raise exception 'timetable section mismatch'; end if;
    if v_version.status <> 'draft' then raise exception 'only draft timetables can be edited'; end if;
    if v_version.revision <> p_expected_revision then
      raise exception 'timetable revision mismatch (expected %, found %)', p_expected_revision, v_version.revision;
    end if;
  end if;
  delete from public.timetable_periods where timetable_version_id = v_version.id;
  for v_period in select * from jsonb_array_elements(coalesce(p_periods, '[]'::jsonb)) loop
    v_day := (v_period ->> 'dayOfWeek')::int;
    v_number := (v_period ->> 'periodNumber')::int;
    v_teacher := nullif(v_period ->> 'teacherAssignmentId','')::uuid;
    v_subject := nullif(v_period ->> 'subjectId','')::uuid;
    v_room := nullif(v_period ->> 'roomId','')::uuid;
    if v_day is null or v_number is null then raise exception 'period day and number are required'; end if;
    if v_teacher is not null and not exists (
      select 1 from public.staff_assignments sa where sa.id = v_teacher and sa.status = 'active'
        and sa.grade_section_id = p_grade_section_id and (v_subject is null or sa.subject_id = v_subject)
    ) then raise exception 'teacher assignment is outside the selected class/subject scope'; end if;
    if exists (select 1 from public.timetable_periods tp where tp.timetable_version_id = v_version.id and tp.day_of_week = v_day and tp.period_number = v_number) then
      raise exception 'duplicate timetable period slot';
    end if;
    if v_teacher is not null and exists (
      select 1 from public.timetable_periods tp join public.timetable_versions tv on tv.id = tp.timetable_version_id
       where tv.grade_section_id <> p_grade_section_id and tv.status = 'published'
         and tp.day_of_week = v_day and tp.period_number = v_number and tp.teacher_assignment_id = v_teacher
    ) then raise exception 'teacher conflict at day %, period %', v_day, v_number; end if;
    if v_room is not null and exists (
      select 1 from public.timetable_periods tp join public.timetable_versions tv on tv.id = tp.timetable_version_id
       where tv.grade_section_id <> p_grade_section_id and tv.status = 'published'
         and tp.day_of_week = v_day and tp.period_number = v_number and tp.room_id = v_room
    ) then raise exception 'room conflict at day %, period %', v_day, v_number; end if;
    insert into public.timetable_periods (timetable_version_id, day_of_week, period_number, starts_at, ends_at, subject_id, teacher_assignment_id, room_id, kind)
    values (v_version.id, v_day, v_number, (v_period ->> 'startsAt')::time, (v_period ->> 'endsAt')::time,
            v_subject, v_teacher, v_room, coalesce(v_period ->> 'kind','class'));
  end loop;
  v_revision := v_version.revision + 1;
  update public.timetable_versions set revision = v_revision where id = v_version.id;
  return jsonb_build_object('versionId', v_version.id, 'reference', v_version.reference, 'version', v_version.version, 'revision', v_revision, 'status', 'draft');
end
$$;

create or replace function app.timetable_validate_draft(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_conflicts jsonb := '[]'::jsonb; v_version public.timetable_versions%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['timetable_manager'])) then raise exception 'timetable manager role and aal2 required'; end if;
  select * into v_version from public.timetable_versions where id = p_version_id;
  if v_version.id is null then raise exception 'timetable version not found'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('kind','teacher','day',tp.day_of_week,'period',tp.period_number,'message','teacher conflict')), '[]'::jsonb)
    into v_conflicts
    from public.timetable_periods tp
    join public.timetable_versions tv on tv.id = tp.timetable_version_id
    where tv.grade_section_id <> v_version.grade_section_id and tv.status = 'published'
      and exists (select 1 from public.timetable_periods other where other.timetable_version_id = p_version_id and other.day_of_week = tp.day_of_week and other.period_number = tp.period_number and other.teacher_assignment_id = tp.teacher_assignment_id and tp.teacher_assignment_id is not null);
  return jsonb_build_object('valid', jsonb_array_length(v_conflicts) = 0, 'conflicts', v_conflicts);
end
$$;

create or replace function app.timetable_publish_version(p_version_id uuid, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_version public.timetable_versions%rowtype; v_publication public.timetable_publications%rowtype; v_conflicts jsonb; v_count int;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['timetable_manager'])) then raise exception 'timetable manager role and aal2 required'; end if;
  select * into v_version from public.timetable_versions where id = p_version_id for update;
  if v_version.id is null then raise exception 'timetable version not found'; end if;
  if v_version.status <> 'draft' then raise exception 'only draft timetables can be published (state: %)', v_version.status; end if;
  select count(*) into v_count from public.timetable_periods where timetable_version_id = p_version_id;
  if v_count = 0 then raise exception 'timetable has no periods'; end if;
  v_conflicts := app.timetable_validate_draft(p_version_id);
  if coalesce((v_conflicts ->> 'valid')::boolean, false) = false then raise exception 'timetable has hard conflicts'; end if;
  update public.timetable_versions set status = 'superseded' where grade_section_id = v_version.grade_section_id and status = 'published';
  insert into public.timetable_publications (timetable_version_id, published_by_account_id, note)
  values (p_version_id, auth.uid(), p_note) returning * into v_publication;
  update public.timetable_versions set status = 'published' where id = p_version_id;
  perform app.record_audit('Timetable published', 'timetable_publication', v_publication.reference, 'Success');
  perform app.enqueue_outbox('email.timetable_published:' || v_publication.reference, 'email.deliver', 'timetable_publication', v_publication.reference, jsonb_build_object('channel','email'));
  return v_publication.reference;
end
$$;

create or replace function app.timetable_save_override(
  p_grade_section_id uuid, p_override_date date, p_day_of_week int, p_period_number int,
  p_kind text, p_subject_id uuid default null, p_room_id uuid default null,
  p_substitute_teacher_assignment_id uuid default null, p_note text default null
) returns text
language plpgsql security definer set search_path = '' as $$
declare v_override public.timetable_overrides%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['timetable_manager'])) then raise exception 'timetable manager role and aal2 required'; end if;
  if p_kind not in ('substitute','room_change','cancellation','special') then raise exception 'invalid timetable override'; end if;
  insert into public.timetable_overrides (grade_section_id, override_date, day_of_week, period_number, kind, subject_id, room_id, substitute_teacher_assignment_id, note)
  values (p_grade_section_id, p_override_date, p_day_of_week, p_period_number, p_kind, p_subject_id, p_room_id, p_substitute_teacher_assignment_id, p_note)
  on conflict (grade_section_id, override_date, period_number) do update set kind = excluded.kind, subject_id = excluded.subject_id, room_id = excluded.room_id, substitute_teacher_assignment_id = excluded.substitute_teacher_assignment_id, note = excluded.note
  returning * into v_override;
  perform app.record_audit('Timetable override saved', 'timetable_override', v_override.reference, 'Success');
  return v_override.reference;
end $$;

create or replace function app.exam_schedule_save_draft(p_grade_section_id uuid, p_entries jsonb, p_version_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_version public.exam_schedule_versions%rowtype; v_entry jsonb;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['timetable_manager'])) then raise exception 'timetable manager role and aal2 required'; end if;
  if p_version_id is null then
    insert into public.exam_schedule_versions (grade_section_id, version) values (p_grade_section_id, coalesce((select max(version)+1 from public.exam_schedule_versions where grade_section_id = p_grade_section_id),1)) returning * into v_version;
  else
    select * into v_version from public.exam_schedule_versions where id = p_version_id for update;
    if v_version.id is null or v_version.status <> 'draft' then raise exception 'exam schedule draft not found'; end if;
    delete from public.exam_schedule_entries where schedule_version_id = v_version.id;
  end if;
  for v_entry in select * from jsonb_array_elements(coalesce(p_entries,'[]'::jsonb)) loop
    insert into public.exam_schedule_entries (schedule_version_id, exam_date, subject_id, room_id, starts_at, ends_at)
    values (v_version.id, (v_entry ->> 'examDate')::date, (v_entry ->> 'subjectId')::uuid, nullif(v_entry ->> 'roomId','')::uuid, (v_entry ->> 'startsAt')::time, (v_entry ->> 'endsAt')::time);
  end loop;
  return jsonb_build_object('versionId', v_version.id, 'reference', v_version.reference, 'version', v_version.version, 'status', 'draft');
end $$;

create or replace function app.exam_schedule_publish(p_version_id uuid, p_note text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_version public.exam_schedule_versions%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['timetable_manager'])) then raise exception 'timetable manager role and aal2 required'; end if;
  select * into v_version from public.exam_schedule_versions where id = p_version_id for update;
  if v_version.id is null or v_version.status <> 'draft' then raise exception 'exam schedule draft not found'; end if;
  if not exists (select 1 from public.exam_schedule_entries where schedule_version_id = p_version_id) then raise exception 'exam date sheet has no entries'; end if;
  update public.exam_schedule_versions set status = 'superseded' where grade_section_id = v_version.grade_section_id and status = 'published';
  update public.exam_schedule_versions set status = 'published' where id = p_version_id;
  perform app.record_audit('Exam date sheet published', 'exam_schedule_version', v_version.reference, 'Success');
  return v_version.reference;
end $$;

revoke all on function app.results_save_draft(uuid,jsonb,int) from public;
revoke all on function app.results_correction_request(uuid,text) from public;
revoke all on function app.results_correction_decide(uuid,text,text) from public;
revoke all on function app.timetable_save_draft(uuid,uuid,jsonb,int) from public;
revoke all on function app.timetable_validate_draft(uuid) from public;
revoke all on function app.timetable_publish_version(uuid,text) from public;
revoke all on function app.timetable_save_override(uuid,date,int,int,text,uuid,uuid,uuid,text) from public;
revoke all on function app.exam_schedule_save_draft(uuid,jsonb,uuid) from public;
revoke all on function app.exam_schedule_publish(uuid,text) from public;
grant execute on function app.results_save_draft(uuid,jsonb,int) to authenticated;
grant execute on function app.results_correction_request(uuid,text) to authenticated;
grant execute on function app.results_correction_decide(uuid,text,text) to authenticated;
grant execute on function app.timetable_save_draft(uuid,uuid,jsonb,int) to authenticated;
grant execute on function app.timetable_validate_draft(uuid) to authenticated;
grant execute on function app.timetable_publish_version(uuid,text) to authenticated;
grant execute on function app.timetable_save_override(uuid,date,int,int,text,uuid,uuid,uuid,text) to authenticated;
grant execute on function app.exam_schedule_save_draft(uuid,jsonb,uuid) to authenticated;
grant execute on function app.exam_schedule_publish(uuid,text) to authenticated;

commit;
