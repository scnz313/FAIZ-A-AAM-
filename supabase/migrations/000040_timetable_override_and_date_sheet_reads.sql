-- =============================================================================
-- 000040 — Timetable override history and published date-sheet reads
--
-- Portal reads remain ordinary RLS-filtered SELECTs. Override revocation is a
-- narrow, version-checked command that preserves the row and commits its audit
-- and notification outbox evidence in the same transaction.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Durable override lifecycle
-- ---------------------------------------------------------------------------
alter table public.timetable_overrides
  add column version int not null default 1,
  add column created_by_account_id uuid references public.user_accounts(id) on delete restrict,
  add column updated_at timestamptz not null default now(),
  add column revoked_at timestamptz,
  add column revoked_by_account_id uuid references public.user_accounts(id) on delete restrict,
  add column revocation_reason text;

alter table public.timetable_overrides
  add constraint timetable_overrides_version_positive check (version > 0),
  add constraint timetable_overrides_revocation_complete check (
    (revoked_at is null and revoked_by_account_id is null and revocation_reason is null)
    or
    (revoked_at is not null and revoked_by_account_id is not null and length(btrim(revocation_reason)) >= 10)
  );

-- The original whole-table unique constraint prevented a replacement override
-- after an earlier row was revoked. Replace it with one-active-row uniqueness so
-- revoked rows remain queryable history.
do $$
declare
  v_constraint name;
begin
  select c.conname
    into v_constraint
    from pg_constraint c
   where c.conrelid = 'public.timetable_overrides'::regclass
     and c.contype = 'u'
     and pg_get_constraintdef(c.oid) = 'UNIQUE (grade_section_id, override_date, period_number)'
   limit 1;
  if v_constraint is not null then
    execute format('alter table public.timetable_overrides drop constraint %I', v_constraint);
  end if;
end
$$;

create unique index timetable_overrides_one_active_slot_uidx
  on public.timetable_overrides (grade_section_id, override_date, period_number)
  where revoked_at is null;
create index timetable_overrides_section_history_idx
  on public.timetable_overrides (grade_section_id, override_date, revoked_at, created_at desc);

-- Save keeps an active slot versioned. Once that row is revoked, the partial
-- unique index permits a fresh row while preserving the revoked row forever.
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
  if p_substitute_teacher_assignment_id is not null and not exists (
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

  insert into public.timetable_overrides as existing (
    grade_section_id, override_date, day_of_week, period_number, kind,
    subject_id, room_id, substitute_teacher_assignment_id, note,
    created_by_account_id, updated_at
  ) values (
    p_grade_section_id, p_override_date, p_day_of_week, p_period_number, p_kind,
    p_subject_id, p_room_id, p_substitute_teacher_assignment_id, btrim(p_note),
    auth.uid(), now()
  )
  on conflict (grade_section_id, override_date, period_number) where revoked_at is null
  do update set
    kind = excluded.kind,
    subject_id = excluded.subject_id,
    room_id = excluded.room_id,
    substitute_teacher_assignment_id = excluded.substitute_teacher_assignment_id,
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

create or replace function app.timetable_revoke_override(
  p_override_id uuid,
  p_expected_version int,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_override public.timetable_overrides%rowtype;
  v_year uuid;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['timetable_manager'])) then
    raise exception 'timetable manager role and aal2 required';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'invalid timetable override version';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'timetable override revocation reason must be at least 10 characters';
  end if;

  select * into v_override
    from public.timetable_overrides
   where id = p_override_id
   for update;
  if v_override.id is null then raise exception 'timetable override not found'; end if;

  select academic_year_id into v_year
    from public.grade_sections
   where id = v_override.grade_section_id;
  if not app.staff_scope_allowed(array['timetable_manager'], v_year, v_override.grade_section_id, null) then
    raise exception 'timetable manager scope does not include this academic section';
  end if;
  if v_override.version <> p_expected_version then
    raise exception 'timetable override version mismatch (expected %, found %)', p_expected_version, v_override.version;
  end if;
  if v_override.revoked_at is not null then
    raise exception 'timetable override is already revoked';
  end if;

  update public.timetable_overrides
     set version = version + 1,
         updated_at = now(),
         revoked_at = now(),
         revoked_by_account_id = auth.uid(),
         revocation_reason = btrim(p_reason)
   where id = v_override.id
  returning * into v_override;

  perform app.record_audit(
    'Timetable override revoked',
    'timetable_override',
    v_override.reference,
    'Success',
    v_override.revocation_reason
  );
  perform app.enqueue_outbox(
    'email.timetable_override:' || v_override.reference || ':revoked:v' || v_override.version,
    'email.deliver',
    'timetable_override',
    v_override.reference,
    jsonb_build_object('channel', 'email', 'state', 'revoked', 'version', v_override.version)
  );

  return jsonb_build_object(
    'id', v_override.id,
    'reference', v_override.reference,
    'grade_section_id', v_override.grade_section_id,
    'override_date', v_override.override_date,
    'day_of_week', v_override.day_of_week,
    'period_number', v_override.period_number,
    'kind', v_override.kind,
    'subject_id', v_override.subject_id,
    'room_id', v_override.room_id,
    'substitute_teacher_assignment_id', v_override.substitute_teacher_assignment_id,
    'note', v_override.note,
    'created_at', v_override.created_at,
    'created_by_account_id', v_override.created_by_account_id,
    'updated_at', v_override.updated_at,
    'version', v_override.version,
    'revoked_at', v_override.revoked_at,
    'revoked_by_account_id', v_override.revoked_by_account_id,
    'revocation_reason', v_override.revocation_reason
  );
end
$$;

revoke all on function app.timetable_revoke_override(uuid,int,text) from public;
grant execute on function app.timetable_revoke_override(uuid,int,text) to authenticated;

-- ---------------------------------------------------------------------------
-- Authoritative date-sheet publication metadata
-- ---------------------------------------------------------------------------
alter table public.exam_schedule_versions
  add column published_at timestamptz,
  add column published_by_account_id uuid references public.user_accounts(id) on delete restrict,
  add column publication_note text;

update public.exam_schedule_versions
   set published_at = created_at
 where status in ('published', 'superseded')
   and published_at is null;

create index exam_schedule_versions_published_section_idx
  on public.exam_schedule_versions (grade_section_id, version desc)
  where status = 'published';

create or replace function app.exam_schedule_publish(
  p_version_id uuid,
  p_note text default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.exam_schedule_versions%rowtype;
  v_count int;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['timetable_manager'])) then
    raise exception 'timetable manager role and aal2 required';
  end if;
  select * into v_version
    from public.exam_schedule_versions
   where id = p_version_id
     and status = 'draft'
   for update;
  if v_version.id is null then raise exception 'exam schedule draft not found'; end if;
  if not app.staff_scope_allowed(
    array['timetable_manager'],
    (select academic_year_id from public.grade_sections where id = v_version.grade_section_id),
    v_version.grade_section_id,
    null
  ) then
    raise exception 'timetable manager scope does not include this academic section';
  end if;
  select count(*) into v_count
    from public.exam_schedule_entries
   where schedule_version_id = p_version_id;
  if v_count = 0 then raise exception 'exam date sheet has no entries'; end if;

  update public.exam_schedule_versions
     set status = 'superseded'
   where grade_section_id = v_version.grade_section_id
     and status = 'published';
  update public.exam_schedule_versions
     set status = 'published',
         published_at = now(),
         published_by_account_id = auth.uid(),
         publication_note = nullif(btrim(p_note), '')
   where id = p_version_id
  returning * into v_version;

  perform app.record_audit(
    'Exam date sheet published',
    'exam_schedule_version',
    v_version.reference,
    'Success',
    v_version.publication_note
  );
  perform app.enqueue_outbox(
    'email.exam_date_sheet:' || v_version.reference,
    'email.deliver',
    'exam_schedule_version',
    v_version.reference,
    jsonb_build_object('channel', 'email', 'version', v_version.version)
  );
  return v_version.reference;
end
$$;

-- ---------------------------------------------------------------------------
-- Family reads: only the active linked section, only academics-capable links,
-- only published date sheets, and only non-revoked override rows.
-- ---------------------------------------------------------------------------
drop policy if exists scope_guardian_timetable_publications on public.timetable_publications;
create policy scope_guardian_timetable_publications
  on public.timetable_publications
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.timetable_versions tv
        join public.enrollments e on e.grade_section_id = tv.grade_section_id
       where tv.id = timetable_publications.timetable_version_id
         and tv.status = 'published'
         and e.status = 'active'
         and app.guardian_has_capability(e.student_id, 'academics')
    )
  );

drop policy if exists scope_guardian_active_timetable_overrides on public.timetable_overrides;
create policy scope_guardian_active_timetable_overrides
  on public.timetable_overrides
  for select
  to authenticated
  using (
    revoked_at is null
    and exists (
      select 1
        from public.enrollments e
       where e.grade_section_id = timetable_overrides.grade_section_id
         and e.status = 'active'
         and app.guardian_has_capability(e.student_id, 'academics')
    )
  );

drop policy if exists scope_guardian_published_exam_schedules on public.exam_schedule_versions;
create policy scope_guardian_published_exam_schedules
  on public.exam_schedule_versions
  for select
  to authenticated
  using (
    status = 'published'
    and exists (
      select 1
        from public.enrollments e
       where e.grade_section_id = exam_schedule_versions.grade_section_id
         and e.status = 'active'
         and app.guardian_has_capability(e.student_id, 'academics')
    )
  );

drop policy if exists scope_guardian_published_exam_entries on public.exam_schedule_entries;
create policy scope_guardian_published_exam_entries
  on public.exam_schedule_entries
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.exam_schedule_versions esv
        join public.enrollments e on e.grade_section_id = esv.grade_section_id
       where esv.id = exam_schedule_entries.schedule_version_id
         and esv.status = 'published'
         and e.status = 'active'
         and app.guardian_has_capability(e.student_id, 'academics')
    )
  );

commit;
