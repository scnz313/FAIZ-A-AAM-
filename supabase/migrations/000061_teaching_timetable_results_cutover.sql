-- =============================================================================
-- 000061 — Teaching timetable/results cutover and results maker/checker guard
--
-- Forward-only migration (plan.md Phase 11). Cuts timetable reads, writes,
-- conflicts, overrides, and publications from legacy staff_assignments to the
-- authoritative teaching_assignments table (created in 000043), and hardens
-- the result entry sheet state machine and report release immutability.
--
-- Legacy teacher_assignment_id / substitute_teacher_assignment_id columns are
-- retained as READ-ONLY historical compatibility for one release. New writes
-- should target teaching_assignment_id / substitute_teaching_assignment_id; a
-- BEFORE INSERT/UPDATE trigger auto-resolves the legacy column into the new
-- one so existing RPC callers keep working during the cutover.
--
-- Never edit migrations 000001–000060.
-- =============================================================================

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Add teaching_assignment_id columns
-- ---------------------------------------------------------------------------
-- timetable_periods.teaching_assignment_id was already added in 000043; this
-- is idempotent. timetable_overrides gets a new substitute_teaching_assignment
-- column that parallels the legacy substitute_teacher_assignment_id. (000043
-- also added a teaching_assignment_id column to overrides backfilled from the
-- substitute; the new substitute_teaching_assignment_id is the canonical name
-- going forward and is kept in sync with that column.)

alter table public.timetable_periods
  add column if not exists teaching_assignment_id uuid
  references public.teaching_assignments(id) on delete restrict;

alter table public.timetable_overrides
  add column if not exists substitute_teaching_assignment_id uuid
  references public.teaching_assignments(id) on delete restrict;

create index if not exists timetable_periods_teaching_assignment_idx
  on public.timetable_periods (teaching_assignment_id);
create index if not exists timetable_overrides_substitute_teaching_assignment_idx
  on public.timetable_overrides (substitute_teaching_assignment_id);

-- ---------------------------------------------------------------------------
-- 2. Mapping function: staff_assignment -> teaching_assignment
-- ---------------------------------------------------------------------------
-- Returns the teaching_assignments.id that matches the given staff_assignment
-- by staff_member_id, academic_year_id, grade_section_id, subject_id. Returns
-- NULL when no match exists (e.g. the legacy assignment had no teacher role
-- grant and was never backfilled).

create or replace function app.staff_assignment_to_teaching_assignment(
  p_staff_assignment_id uuid
) returns uuid
language sql
security definer
set search_path = ''
as $$
  select ta.id
    from public.staff_assignments sa
    join public.teaching_assignments ta
      on ta.staff_member_id = sa.staff_member_id
     and ta.academic_year_id = sa.academic_year_id
     and ta.grade_section_id = sa.grade_section_id
     and ta.subject_id = sa.subject_id
   where sa.id = p_staff_assignment_id
   limit 1
$$;
revoke all on function app.staff_assignment_to_teaching_assignment(uuid) from public;
grant execute on function app.staff_assignment_to_teaching_assignment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Backfill teaching_assignment_id from legacy staff_assignments
-- ---------------------------------------------------------------------------
-- timetable_periods: resolve academic_year through timetable_versions ->
-- grade_sections -> academic_year_id, then match teaching_assignments by
-- staff_member_id, academic_year_id, grade_section_id, subject_id. (000043
-- already backfilled via the staff_assignments row directly; this re-run is
-- idempotent and covers any rows added since.)

update public.timetable_periods tp
   set teaching_assignment_id = ta.id
  from public.staff_assignments sa,
       public.timetable_versions tv,
       public.grade_sections gs,
       public.teaching_assignments ta
 where tp.teacher_assignment_id = sa.id
   and tv.id = tp.timetable_version_id
   and gs.id = tv.grade_section_id
   and ta.staff_member_id = sa.staff_member_id
   and ta.academic_year_id = gs.academic_year_id
   and ta.grade_section_id = sa.grade_section_id
   and ta.subject_id = sa.subject_id
   and tp.teaching_assignment_id is null;

-- timetable_overrides.substitute_teaching_assignment_id: resolve academic_year
-- through grade_sections, then match. Also copy from the teaching_assignment_id
-- column that 000043 backfilled (kept in sync) where the legacy column is null.

update public.timetable_overrides to_
   set substitute_teaching_assignment_id = ta.id
  from public.staff_assignments sa,
       public.grade_sections gs,
       public.teaching_assignments ta
 where to_.substitute_teacher_assignment_id = sa.id
   and gs.id = to_.grade_section_id
   and ta.staff_member_id = sa.staff_member_id
   and ta.academic_year_id = gs.academic_year_id
   and ta.grade_section_id = sa.grade_section_id
   and ta.subject_id = sa.subject_id
   and to_.substitute_teaching_assignment_id is null;

-- Mirror the 000043 teaching_assignment_id column into the canonical
-- substitute_teaching_assignment_id where the legacy column was already null.
update public.timetable_overrides
   set substitute_teaching_assignment_id = teaching_assignment_id
 where substitute_teaching_assignment_id is null
   and teaching_assignment_id is not null;

-- Keep the 000043 teaching_assignment_id column in sync with the canonical
-- substitute column for display continuity.
update public.timetable_overrides
   set teaching_assignment_id = substitute_teaching_assignment_id
 where teaching_assignment_id is null
   and substitute_teaching_assignment_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Auto-resolve triggers: legacy column -> teaching_assignment column
-- ---------------------------------------------------------------------------
-- On INSERT/UPDATE to timetable_periods, if teaching_assignment_id is NULL but
-- teacher_assignment_id is NOT NULL, resolve via the mapping function. For NEW
-- rows (INSERT) a failed mapping raises; for existing rows (UPDATE) a failed
-- mapping is left null so historical rows are not broken.

create or replace function app.resolve_timetable_period_teaching_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resolved uuid;
begin
  if new.teaching_assignment_id is null and new.teacher_assignment_id is not null then
    v_resolved := app.staff_assignment_to_teaching_assignment(new.teacher_assignment_id);
    if v_resolved is not null then
      new.teaching_assignment_id := v_resolved;
    elsif tg_op = 'INSERT' then
      raise exception 'teacher_assignment_id % has no matching teaching_assignment and cannot be resolved for a new timetable period', new.teacher_assignment_id;
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.resolve_timetable_period_teaching_assignment() from public;

drop trigger if exists timetable_periods_resolve_teaching_assignment
  on public.timetable_periods;
create trigger timetable_periods_resolve_teaching_assignment
  before insert or update of teacher_assignment_id, teaching_assignment_id
  on public.timetable_periods
  for each row execute function app.resolve_timetable_period_teaching_assignment();

-- Mirror trigger for timetable_overrides substitute column.
create or replace function app.resolve_timetable_override_substitute_teaching()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resolved uuid;
begin
  if new.substitute_teaching_assignment_id is null
     and new.substitute_teacher_assignment_id is not null then
    v_resolved := app.staff_assignment_to_teaching_assignment(new.substitute_teacher_assignment_id);
    if v_resolved is not null then
      new.substitute_teaching_assignment_id := v_resolved;
    elsif tg_op = 'INSERT' then
      raise exception 'substitute_teacher_assignment_id % has no matching teaching_assignment and cannot be resolved for a new timetable override', new.substitute_teacher_assignment_id;
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.resolve_timetable_override_substitute_teaching() from public;

drop trigger if exists timetable_overrides_resolve_substitute_teaching
  on public.timetable_overrides;
create trigger timetable_overrides_resolve_substitute_teaching
  before insert or update of substitute_teacher_assignment_id, substitute_teaching_assignment_id
  on public.timetable_overrides
  for each row execute function app.resolve_timetable_override_substitute_teaching();

-- ---------------------------------------------------------------------------
-- 5. Update timetable conflict detection and save RPCs to use teaching_assignments
-- ---------------------------------------------------------------------------
-- timetable_save_draft: accept an optional teachingAssignmentId in the period
-- payload (new canonical), fall back to teacherAssignmentId (legacy) and
-- auto-resolve. Conflict checks now key on teaching_assignment_id with a
-- legacy teacher_assignment_id fallback for rows not yet backfilled.

create or replace function app.timetable_save_draft(
  p_grade_section_id uuid,
  p_version_id uuid,
  p_periods jsonb,
  p_expected_revision int default 0
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_version public.timetable_versions%rowtype;
  v_period jsonb;
  v_existing public.timetable_versions%rowtype;
  v_day int;
  v_number int;
  v_subject uuid;
  v_teacher uuid;
  v_teaching uuid;
  v_room uuid;
  v_starts time;
  v_ends time;
  v_academic_year uuid;
  v_revision int;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['timetable_manager'])) then raise exception 'timetable manager role and aal2 required'; end if;
  if jsonb_typeof(coalesce(p_periods,'[]'::jsonb)) <> 'array' then raise exception 'periods must be an array'; end if;
  select gs.academic_year_id into v_academic_year from public.grade_sections gs where gs.id = p_grade_section_id;
  if v_academic_year is null then raise exception 'grade section not found'; end if;
  if not app.staff_scope_allowed(array['timetable_manager'], v_academic_year, p_grade_section_id, null) then raise exception 'timetable manager scope does not include this academic section'; end if;
  if p_version_id is null then
    select * into v_existing from public.timetable_versions where grade_section_id = p_grade_section_id and status = 'draft' for update;
    if v_existing.id is null then
      insert into public.timetable_versions(grade_section_id, status, version, revision, effective_from)
      values (p_grade_section_id, 'draft', coalesce((select max(version)+1 from public.timetable_versions where grade_section_id = p_grade_section_id),1), 0, current_date)
      returning * into v_version;
    else
      v_version := v_existing;
    end if;
  else
    select * into v_version from public.timetable_versions where id = p_version_id for update;
    if v_version.id is null or v_version.grade_section_id <> p_grade_section_id or v_version.status <> 'draft' then raise exception 'timetable draft not found'; end if;
    if not app.staff_scope_allowed(array['timetable_manager'], v_academic_year, v_version.grade_section_id, null) then raise exception 'timetable manager scope does not include this academic section'; end if;
  end if;
  if v_version.revision <> p_expected_revision then raise exception 'timetable revision mismatch (expected %, found %)', p_expected_revision, v_version.revision; end if;
  delete from public.timetable_periods where timetable_version_id = v_version.id;
  for v_period in select * from jsonb_array_elements(coalesce(p_periods,'[]'::jsonb)) loop
    v_day := (v_period ->> 'dayOfWeek')::int;
    v_number := (v_period ->> 'periodNumber')::int;
    v_starts := (v_period ->> 'startsAt')::time;
    v_ends := (v_period ->> 'endsAt')::time;
    v_subject := nullif(v_period ->> 'subjectId','')::uuid;
    v_teacher := nullif(v_period ->> 'teacherAssignmentId','')::uuid;
    v_teaching := nullif(v_period ->> 'teachingAssignmentId','')::uuid;
    v_room := nullif(v_period ->> 'roomId','')::uuid;
    if v_day is null or v_number is null or v_day < 1 or v_day > 7 or v_number < 1 then raise exception 'period day and number are required'; end if;
    if v_starts is null or v_ends is null or v_ends <= v_starts then raise exception 'period start and end times are invalid'; end if;
    -- Keep the legacy validator's empty placeholder rows importable. Once a
    -- subject/teacher/room is supplied, the effective period definition is
    -- authoritative and the exact time window is enforced.
    if not (v_subject is null and v_teacher is null and v_teaching is null and v_room is null)
       and not exists (select 1 from public.period_definitions pd where pd.academic_year_id = v_academic_year and pd.day_of_week = v_day and pd.period_number = v_number and pd.starts_at = v_starts and pd.ends_at = v_ends) then
      raise exception 'period/time is outside the effective period definitions';
    end if;
    if v_subject is not null and not exists (select 1 from public.subjects where id = v_subject) then raise exception 'subject not found'; end if;
    -- Resolve the canonical teaching_assignment_id. New callers may pass
    -- teachingAssignmentId directly; legacy callers pass teacherAssignmentId
    -- and we resolve it through the mapping function.
    if v_teaching is null and v_teacher is not null then
      v_teaching := app.staff_assignment_to_teaching_assignment(v_teacher);
    end if;
    -- Validate the canonical teaching assignment against the section/subject
    -- scope when supplied.
    if v_teaching is not null and not exists (
      select 1 from public.teaching_assignments ta
       where ta.id = v_teaching and ta.status in ('scheduled','active')
         and ta.academic_year_id = v_academic_year
         and ta.grade_section_id = p_grade_section_id
         and (v_subject is null or ta.subject_id = v_subject)
         and ta.effective_from <= now()
         and (ta.effective_to is null or ta.effective_to > now())
    ) then raise exception 'teaching assignment is outside the selected class/subject scope'; end if;
    -- Legacy validation retained for callers still passing teacherAssignmentId
    -- without a resolvable teaching assignment (compatibility release).
    if v_teaching is null and v_teacher is not null and not exists (
      select 1 from public.staff_assignments sa
       where sa.id = v_teacher and sa.status = 'active'
         and sa.academic_year_id = v_academic_year
         and sa.grade_section_id = p_grade_section_id
         and (v_subject is null or sa.subject_id = v_subject)
         and sa.effective_from <= now()
         and (sa.effective_to is null or sa.effective_to > now())
    ) then raise exception 'teacher assignment is outside the selected class/subject scope'; end if;
    if v_room is not null and not exists (select 1 from public.rooms where id = v_room) then raise exception 'room not found'; end if;
    -- Teacher conflict: check the canonical teaching_assignment_id, falling
    -- back to the legacy teacher_assignment_id for rows not yet backfilled.
    if v_teaching is not null and exists (
      select 1 from public.timetable_periods tp join public.timetable_versions tv on tv.id = tp.timetable_version_id
       where tv.id <> v_version.id and tv.grade_section_id <> p_grade_section_id and tv.status in ('published','draft')
         and tp.day_of_week = v_day and tp.period_number = v_number
         and (tp.teaching_assignment_id = v_teaching
              or (tp.teaching_assignment_id is null and tp.teacher_assignment_id = v_teacher))
         and (tv.effective_to is null or v_version.effective_from is null or tv.effective_to >= v_version.effective_from)
         and (v_version.effective_to is null or tv.effective_from is null or tv.effective_from <= v_version.effective_to)
    ) then raise exception 'teacher conflict at day %, period %', v_day, v_number; end if;
    if v_room is not null and exists (
      select 1 from public.timetable_periods tp join public.timetable_versions tv on tv.id = tp.timetable_version_id
       where tv.id <> v_version.id and tv.grade_section_id <> p_grade_section_id and tv.status in ('published','draft')
         and tp.day_of_week = v_day and tp.period_number = v_number and tp.room_id = v_room
         and (tv.effective_to is null or v_version.effective_from is null or tv.effective_to >= v_version.effective_from)
         and (v_version.effective_to is null or tv.effective_from is null or tv.effective_from <= v_version.effective_to)
    ) then raise exception 'room conflict at day %, period %', v_day, v_number; end if;
    insert into public.timetable_periods(timetable_version_id, day_of_week, period_number, starts_at, ends_at, subject_id, teacher_assignment_id, teaching_assignment_id, room_id, kind)
    values (v_version.id, v_day, v_number, v_starts, v_ends, v_subject, v_teacher, v_teaching, v_room, coalesce(v_period ->> 'kind','class'));
  end loop;
  update public.timetable_versions set revision = revision + 1, updated_at = now() where id = v_version.id returning revision into v_revision;
  return jsonb_build_object('versionId', v_version.id, 'reference', v_version.reference, 'version', v_version.version, 'revision', v_revision, 'status', 'draft', 'updatedAt', now());
end
$$;

-- timetable_validate_draft: conflict detection now keys on teaching_assignment_id
-- with a legacy teacher_assignment_id fallback.

create or replace function app.timetable_validate_draft(p_version_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_version public.timetable_versions%rowtype;
  v_conflicts jsonb := '[]'::jsonb;
  v_count int;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['timetable_manager'])) then raise exception 'timetable manager role and aal2 required'; end if;
  select * into v_version from public.timetable_versions where id = p_version_id;
  if v_version.id is null or v_version.status <> 'draft' then raise exception 'timetable draft not found'; end if;
  if not app.staff_scope_allowed(array['timetable_manager'], (select academic_year_id from public.grade_sections where id = v_version.grade_section_id), v_version.grade_section_id, null) then raise exception 'timetable manager scope does not include this academic section'; end if;
  select count(*) into v_count from public.timetable_periods where timetable_version_id = p_version_id;
  if v_count = 0 then raise exception 'timetable has no periods'; end if;
  select coalesce(jsonb_agg(conflict order by kind, day_no, period_no), '[]'::jsonb) into v_conflicts
    from (
      -- Teacher conflict: match on the canonical teaching_assignment_id, with a
      -- legacy teacher_assignment_id fallback for rows not yet backfilled.
      select jsonb_build_object('kind','teacher','day',tp.day_of_week,'period',tp.period_number,'message','teacher conflict') as conflict, 'teacher' as kind, tp.day_of_week as day_no, tp.period_number as period_no
        from public.timetable_periods tp join public.timetable_versions tv on tv.id = tp.timetable_version_id
       where tv.id <> p_version_id and tv.grade_section_id <> v_version.grade_section_id and tv.status in ('published','draft')
         and exists (
           select 1 from public.timetable_periods x
            where x.timetable_version_id = p_version_id
              and x.day_of_week = tp.day_of_week
              and x.period_number = tp.period_number
              and (
                (x.teaching_assignment_id is not null and x.teaching_assignment_id = tp.teaching_assignment_id)
                or (x.teaching_assignment_id is null and x.teacher_assignment_id is not null and x.teacher_assignment_id = tp.teacher_assignment_id)
                or (tp.teaching_assignment_id is null and tp.teacher_assignment_id is not null and tp.teacher_assignment_id = x.teacher_assignment_id)
              )
         )
      union all
      select jsonb_build_object('kind','room','day',tp.day_of_week,'period',tp.period_number,'message','room conflict') as conflict, 'room' as kind, tp.day_of_week as day_no, tp.period_number as period_no
        from public.timetable_periods tp join public.timetable_versions tv on tv.id = tp.timetable_version_id
       where tv.id <> p_version_id and tv.grade_section_id <> v_version.grade_section_id and tv.status in ('published','draft')
         and exists (select 1 from public.timetable_periods x where x.timetable_version_id = p_version_id and x.day_of_week = tp.day_of_week and x.period_number = tp.period_number and x.room_id = tp.room_id and tp.room_id is not null)
    ) conflicts;
  return jsonb_build_object('valid', jsonb_array_length(v_conflicts) = 0, 'conflicts', v_conflicts, 'versionId', p_version_id, 'revision', v_version.revision);
end
$$;

-- timetable_save_override: resolve the legacy substitute_teacher_assignment_id
-- into the canonical substitute_teaching_assignment_id and write both columns.
-- The signature is unchanged so existing callers and grants remain valid.

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

  -- Resolve the canonical substitute teaching_assignment from the legacy
  -- staff_assignment. The BEFORE INSERT trigger also resolves this, but we
  -- resolve here so the validation can confirm the teaching assignment exists.
  v_teaching := app.staff_assignment_to_teaching_assignment(p_substitute_teacher_assignment_id);

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

-- ---------------------------------------------------------------------------
-- 6. Authoritative display view: app.timetable_period_teachers
-- ---------------------------------------------------------------------------
-- Joins timetable_periods to teaching_assignments (preferred) and falls back
-- to staff_assignments (legacy) for display. Guardians and staff read teacher
-- attribution through this view so the legacy column can be retired without
-- breaking portal reads.

create or replace view app.timetable_period_teachers as
  select
    tp.id as timetable_period_id,
    tp.timetable_version_id,
    tp.day_of_week,
    tp.period_number,
    tp.subject_id,
    tp.room_id,
    tp.kind,
    coalesce(ta.id, legacy_ta.id) as teaching_assignment_id,
    coalesce(ta.staff_member_id, legacy_ta.staff_member_id) as staff_member_id,
    coalesce(ta.academic_year_id, legacy_sa.academic_year_id) as academic_year_id,
    coalesce(ta.grade_section_id, legacy_sa.grade_section_id) as grade_section_id,
    coalesce(ta.subject_id, legacy_sa.subject_id) as effective_subject_id,
    p.display_name as teacher_display_name,
    sm.title as teacher_title,
    case when ta.id is not null then 'teaching_assignment'
         when legacy_sa.id is not null then 'staff_assignment'
         else null end as source
    from public.timetable_periods tp
    left join public.teaching_assignments ta on ta.id = tp.teaching_assignment_id
    left join public.staff_assignments legacy_sa on legacy_sa.id = tp.teacher_assignment_id
    left join public.teaching_assignments legacy_ta
      on legacy_ta.staff_member_id = legacy_sa.staff_member_id
     and legacy_ta.academic_year_id = legacy_sa.academic_year_id
     and legacy_ta.grade_section_id = legacy_sa.grade_section_id
     and legacy_ta.subject_id = legacy_sa.subject_id
    left join public.staff_members sm
      on sm.id = coalesce(ta.staff_member_id, legacy_ta.staff_member_id, legacy_sa.staff_member_id)
    left join public.people p
      on p.id = sm.person_id;

grant select on app.timetable_period_teachers to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Result entry sheet state-machine guard (trigger level)
-- ---------------------------------------------------------------------------
-- The RPCs already enforce forward transitions; this trigger adds a
-- defense-in-depth guard so direct table updates cannot regress a sheet. The
-- allowed order is draft -> submitted -> moderation -> returned/approved ->
-- published, with superseded/withdrawn terminal. Self-transitions and the
-- legacy batch projection path (000028) remain permitted.

create or replace function app.guard_result_entry_sheet_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.state <> old.state then
    -- The RPCs enforce the strict step-by-step order (draft -> submitted ->
    -- moderation -> returned/approved -> published). This trigger is a
    -- defense-in-depth guard that blocks regressions from late/terminal
    -- states while permitting forward skips (the legacy batch projection in
    -- app.project_legacy_result_batch_to_sheet mirrors batch status changes
    -- which can jump, e.g. draft -> approved) and resubmission from returned.
    if not (
      (old.state = 'draft'       and new.state in ('submitted','moderation','returned','approved','published','withdrawn','superseded'))
      or (old.state = 'submitted'    and new.state in ('moderation','returned','approved','published','withdrawn','superseded'))
      or (old.state = 'moderation'   and new.state in ('returned','approved','published','withdrawn','superseded'))
      or (old.state = 'returned'     and new.state in ('draft','submitted','moderation','approved','published','withdrawn','superseded'))
      or (old.state = 'approved'     and new.state in ('published','withdrawn','superseded'))
      or (old.state = 'published'    and new.state in ('superseded','withdrawn'))
    ) then
      raise exception 'invalid result entry sheet state transition: % -> %', old.state, new.state;
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.guard_result_entry_sheet_state() from public;

drop trigger if exists result_entry_sheets_state_guard on public.result_entry_sheets;
create trigger result_entry_sheets_state_guard
  before update of state on public.result_entry_sheets
  for each row execute function app.guard_result_entry_sheet_state();

-- ---------------------------------------------------------------------------
-- 8. Report release immutability
-- ---------------------------------------------------------------------------
-- result_report_releases: once published, a row may only transition to
-- 'superseded' (with superseded_at set) or 'withdrawn'. Any other update to a
-- published release is blocked. The supersede function
-- (app.results_supersede_releases_for_sheet / app.results_report_release_publish)
-- performs exactly this transition, so the trigger permits it.

create or replace function app.guard_result_report_release_no_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'published' then
    -- Allow only the supersede transition (status -> 'superseded' with
    -- superseded_at set) and the withdrawal transition.
    if not (
      (new.status = 'superseded' and new.superseded_at is not null and old.superseded_at is null)
      or (new.status = 'withdrawn')
    ) then
      raise exception 'published result report release is immutable except for supersede/withdraw';
    end if;
  end if;
  if old.status in ('superseded','withdrawn') and new.status <> old.status then
    raise exception 'terminal result report release cannot change status';
  end if;
  return new;
end
$$;
revoke all on function app.guard_result_report_release_no_update() from public;

drop trigger if exists result_report_releases_no_update on public.result_report_releases;
create trigger result_report_releases_no_update
  before update on public.result_report_releases
  for each row execute function app.guard_result_report_release_no_update();

-- result_report_release_items: fully immutable. Recreate the append-only
-- blockers explicitly (000028 created them; this is idempotent hardening).
drop trigger if exists result_report_release_items_no_update
  on public.result_report_release_items;
drop trigger if exists result_report_release_items_no_delete
  on public.result_report_release_items;
create trigger result_report_release_items_no_update
  before update on public.result_report_release_items
  for each row execute function app.block_mutation();
create trigger result_report_release_items_no_delete
  before delete on public.result_report_release_items
  for each row execute function app.block_mutation();

-- ---------------------------------------------------------------------------
-- 9. Comments and documentation
-- ---------------------------------------------------------------------------
comment on column public.timetable_periods.teacher_assignment_id is
  'Legacy reference to staff_assignments(id). Retained as READ-ONLY historical compatibility for one release; new writes should use teaching_assignment_id. Auto-resolved into teaching_assignment_id by the timetable_periods_resolve_teaching_assignment trigger.';
comment on column public.timetable_periods.teaching_assignment_id is
  'Authoritative teaching assignment for this period. New writes must target this column; the legacy teacher_assignment_id is auto-resolved into it when only the legacy column is supplied.';
comment on column public.timetable_overrides.substitute_teacher_assignment_id is
  'Legacy reference to staff_assignments(id) for the substitute teacher. Retained as READ-ONLY historical compatibility for one release; new writes should use substitute_teaching_assignment_id. Auto-resolved by the timetable_overrides_resolve_substitute_teaching trigger.';
comment on column public.timetable_overrides.substitute_teaching_assignment_id is
  'Authoritative substitute teaching assignment for this override. New writes must target this column; the legacy substitute_teacher_assignment_id is auto-resolved into it when only the legacy column is supplied.';
comment on view app.timetable_period_teachers is
  'Authoritative teacher attribution view for timetable periods. Joins teaching_assignments (preferred) and falls back to staff_assignments (legacy) for display during the compatibility release.';

commit;
