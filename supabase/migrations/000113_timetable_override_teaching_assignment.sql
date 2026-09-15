-- =============================================================================
-- 000113 — Timetable substitute overrides accept the canonical teaching
--          assignment id
--
-- Verified live defect (15 September 2026): `/principal/timetables` sends the
-- canonical `teaching_assignments.id` from the timetable configuration, but
-- `app.timetable_save_override` treated `p_substitute_teacher_assignment_id`
-- as a legacy `staff_assignments.id` and resolved it through
-- `app.staff_assignment_to_teaching_assignment`. Staging has zero
-- `staff_assignments` rows, so every substitute override failed with
-- 'substitute teacher assignment is outside the section/subject scope' and
-- the workflow could not be completed at all.
--
-- The function now accepts either identifier: when the id already exists in
-- `public.teaching_assignments` it is used as the canonical assignment and is
-- validated by the existing teaching-assignment scope checks (status, year,
-- section, subject, effective window). Any other id keeps the legacy
-- staff-assignment resolution path byte for byte. The signature, grants,
-- authorization checks, audit event, outbox event, and returned reference are
-- unchanged. Forward-only from 000112. Validated and applied by the central
-- process.
-- =============================================================================

begin;

create or replace function app.timetable_save_override(
  p_grade_section_id uuid,
  p_override_date date,
  p_day_of_week int,
  p_period_number int,
  p_kind text,
  p_subject_id uuid default null,
  p_room_id uuid default null,
  p_substitute_teacher_assignment_id uuid default null,
  p_note text default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_override public.timetable_overrides%rowtype;
  v_year uuid;
  v_teaching uuid;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['timetable_manager'])) then
    raise exception 'timetable manager role and aal2 required';
  end if;
  if p_kind not in ('substitute','room_change','cancellation','special') then
    raise exception 'invalid timetable override';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'timetable override reason must be at least 10 characters';
  end if;

  select academic_year_id into v_year
    from public.grade_sections
   where id = p_grade_section_id;
  if v_year is null then raise exception 'grade section not found'; end if;
  if not app.staff_scope_allowed(array['timetable_manager'], v_year, p_grade_section_id, null) then
    raise exception 'timetable manager scope does not include this academic section';
  end if;
  if p_override_date is null or p_day_of_week not between 1 and 7 or p_period_number < 1 then
    raise exception 'override date and slot are required';
  end if;
  if not exists (
    select 1
      from public.period_definitions pd
     where pd.academic_year_id = v_year
       and pd.day_of_week = p_day_of_week
       and pd.period_number = p_period_number
  ) then
    raise exception 'override slot is outside the effective period definitions';
  end if;
  if p_subject_id is not null and not exists (select 1 from public.subjects where id = p_subject_id) then
    raise exception 'override subject not found';
  end if;
  if p_room_id is not null and not exists (select 1 from public.rooms where id = p_room_id) then
    raise exception 'override room not found';
  end if;
  if p_kind = 'room_change' and p_room_id is null then
    raise exception 'room-change override requires a room';
  end if;
  if p_kind = 'substitute' and p_substitute_teacher_assignment_id is null then
    raise exception 'substitute override requires a teacher assignment';
  end if;

  /* Accept the canonical teaching assignment id directly (the value the
     timetable configuration and editor use); fall back to the legacy
     staff_assignment resolution for any other identifier. */
  if p_substitute_teacher_assignment_id is not null
     and exists (select 1 from public.teaching_assignments ta where ta.id = p_substitute_teacher_assignment_id) then
    v_teaching := p_substitute_teacher_assignment_id;
  else
    v_teaching := app.staff_assignment_to_teaching_assignment(p_substitute_teacher_assignment_id);
  end if;

  if p_substitute_teacher_assignment_id is not null then
    -- Prefer the canonical teaching_assignment validation when resolved.
    if v_teaching is not null then
      if not exists (
        select 1 from public.teaching_assignments ta
         where ta.id = v_teaching and ta.status in ('scheduled','active')
           and ta.academic_year_id = v_year
           and ta.grade_section_id = p_grade_section_id
           and (p_subject_id is null or ta.subject_id = p_subject_id)
           and ta.effective_from <= now()
           and (ta.effective_to is null or ta.effective_to > now())
      ) then
        raise exception 'substitute teaching assignment is outside the section/subject scope';
      end if;
    elsif not exists (
      select 1
        from public.staff_assignments sa
       where sa.id = p_substitute_teacher_assignment_id
         and sa.status = 'active'
         and sa.academic_year_id = v_year
         and sa.grade_section_id = p_grade_section_id
         and (p_subject_id is null or sa.subject_id = p_subject_id)
         and sa.effective_from <= now()
         and (sa.effective_to is null or sa.effective_to > now())
    ) then
      raise exception 'substitute teacher assignment is outside the section/subject scope';
    end if;
  end if;

  insert into public.timetable_overrides as existing (
    grade_section_id, override_date, day_of_week, period_number, kind,
    subject_id, room_id, substitute_teacher_assignment_id,
    substitute_teaching_assignment_id, teaching_assignment_id, note,
    created_by_account_id, updated_at
  ) values (
    p_grade_section_id, p_override_date, p_day_of_week, p_period_number, p_kind,
    p_subject_id, p_room_id, p_substitute_teacher_assignment_id,
    v_teaching, v_teaching, btrim(p_note),
    auth.uid(), now()
  )
  on conflict (grade_section_id, override_date, period_number) where revoked_at is null
  do update set
    kind = excluded.kind,
    subject_id = excluded.subject_id,
    room_id = excluded.room_id,
    substitute_teacher_assignment_id = excluded.substitute_teacher_assignment_id,
    substitute_teaching_assignment_id = excluded.substitute_teaching_assignment_id,
    teaching_assignment_id = excluded.teaching_assignment_id,
    note = excluded.note,
    version = existing.version + 1,
    updated_at = now()
  returning * into v_override;

  perform app.record_audit(
    'Timetable override saved',
    'timetable_override',
    v_override.reference,
    'Success',
    btrim(p_note)
  );
  perform app.enqueue_outbox(
    'email.timetable_override:' || v_override.reference || ':v' || v_override.version,
    'email.deliver',
    'timetable_override',
    v_override.reference,
    jsonb_build_object('channel', 'email', 'state', 'active', 'version', v_override.version)
  );
  return v_override.reference;
end
$$;

revoke all on function app.timetable_save_override(uuid,date,int,int,text,uuid,uuid,uuid,text) from public;
grant execute on function app.timetable_save_override(uuid,date,int,int,text,uuid,uuid,uuid,text) to authenticated;

commit;
