-- =============================================================================
-- 000043 — Non-login teaching records and Principal result entry
--
-- Teachers are school records, not portal accounts. This migration:
--   1. Creates teaching_assignments independent of role_grants, backfilled
--      from legacy teacher-linked staff_assignments (source rows preserved).
--   2. Adds teaching-assignment references to timetable periods and overrides
--      (backfilled from legacy columns; old columns retained for history).
--   3. Moves result entry authorization from teacher_assignment_allowed to
--      result_entry_officer + staff_scope_allowed (Principal profile).
--   4. Allows one independent Administrator to moderate AND publish a
--      Principal-originated sheet (actor-level no-self-approval enforced).
--   5. Adds a masked legacy teacher-access inventory and a version-checked
--      retirement command (NOT invoked automatically).
--
-- Legacy staff_assignments rows, role grants, and old timetable columns are
-- preserved for historical attribution during the compatibility release.
-- =============================================================================

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. teaching_assignments — non-login teaching records
-- ---------------------------------------------------------------------------

-- Teachers are non-login school records: a staff member may exist without a
-- person/account linkage. Forward-only relaxation of the 000002 constraint.
alter table public.staff_members alter column person_id drop not null;

create table public.teaching_assignments (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('TAS'),
  staff_member_id   uuid not null references public.staff_members(id) on delete restrict,
  academic_year_id  uuid not null references public.academic_years(id) on delete restrict,
  grade_section_id  uuid not null references public.grade_sections(id) on delete restrict,
  subject_id        uuid not null references public.subjects(id) on delete restrict,
  status            text not null default 'scheduled'
                    check (status in ('scheduled', 'active', 'ended')),
  effective_from    timestamptz not null default now(),
  effective_to      timestamptz,
  version           int not null default 1,
  provenance        text not null default 'manual'
                    check (provenance in ('manual', 'import', 'legacy_backfill')),
  source_ref        text,
  created_reason    text not null default 'Teaching assignment',
  created_by_account_id uuid references public.user_accounts(id) on delete restrict,
  updated_by_account_id uuid references public.user_accounts(id) on delete restrict,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);

create index teaching_assignments_staff_idx on public.teaching_assignments (staff_member_id, status);
create index teaching_assignments_year_idx on public.teaching_assignments (academic_year_id);
create index teaching_assignments_section_idx on public.teaching_assignments (grade_section_id);
create index teaching_assignments_subject_idx on public.teaching_assignments (subject_id);
create unique index teaching_assignments_one_active_uidx
  on public.teaching_assignments (staff_member_id, academic_year_id, grade_section_id, subject_id)
  where status in ('scheduled', 'active');
create trigger teaching_assignments_touch before update on public.teaching_assignments
  for each row execute function app.touch_updated_at();

alter table public.teaching_assignments enable row level security;
revoke all on public.teaching_assignments from anon, authenticated;
grant select on public.teaching_assignments to authenticated;

-- RLS: timetable managers and auditors read; writes go through commands only.
create policy scope_teaching_assignments_staff_read on public.teaching_assignments
  for select to authenticated
  using (app.is_staff_aal2() and (
    app.has_any_role(array['timetable_manager', 'auditor', 'exam_reviewer', 'result_publisher'])
    or app.has_role('system_administrator')));

-- Backfill from legacy teacher-linked staff_assignments without deleting the
-- source rows. The legacy assignment reference is recorded as provenance.
insert into public.teaching_assignments
  (staff_member_id, academic_year_id, grade_section_id, subject_id, status,
   effective_from, effective_to, version, provenance, source_ref, created_reason)
select sa.staff_member_id, sa.academic_year_id, sa.grade_section_id, sa.subject_id,
       sa.status, sa.effective_from, sa.effective_to, 1, 'legacy_backfill',
       sa.reference, 'Backfilled from legacy staff assignment'
  from public.staff_assignments sa
  join public.role_grants rg on rg.id = sa.role_grant_id and rg.role_code = 'teacher'
 where not exists (
   select 1 from public.teaching_assignments ta
    where ta.staff_member_id = sa.staff_member_id
      and ta.academic_year_id = sa.academic_year_id
      and ta.grade_section_id = sa.grade_section_id
      and ta.subject_id = sa.subject_id);

-- ---------------------------------------------------------------------------
-- 2. Timetable references — new columns backfilled from legacy
-- ---------------------------------------------------------------------------

alter table public.timetable_periods
  add column if not exists teaching_assignment_id uuid references public.teaching_assignments(id) on delete restrict;
alter table public.timetable_overrides
  add column if not exists teaching_assignment_id uuid references public.teaching_assignments(id) on delete restrict;

create index if not exists timetable_periods_teaching_assignment_idx
  on public.timetable_periods (teaching_assignment_id);
create index if not exists timetable_overrides_teaching_assignment_idx
  on public.timetable_overrides (teaching_assignment_id);

-- Backfill period references from the legacy teacher_assignment_id column.
update public.timetable_periods tp
   set teaching_assignment_id = ta.id
  from public.staff_assignments sa
  join public.teaching_assignments ta
    on ta.staff_member_id = sa.staff_member_id
   and ta.academic_year_id = sa.academic_year_id
   and ta.grade_section_id = sa.grade_section_id
   and ta.subject_id = sa.subject_id
 where tp.teacher_assignment_id = sa.id
   and tp.teaching_assignment_id is null;

-- Backfill override substitute references from the legacy column.
update public.timetable_overrides to_
   set teaching_assignment_id = ta.id
  from public.staff_assignments sa
  join public.teaching_assignments ta
    on ta.staff_member_id = sa.staff_member_id
   and ta.academic_year_id = sa.academic_year_id
   and ta.grade_section_id = sa.grade_section_id
   and ta.subject_id = sa.subject_id
 where to_.substitute_teacher_assignment_id = sa.id
   and to_.teaching_assignment_id is null;

-- ---------------------------------------------------------------------------
-- 3. Result entry authorization — result_entry_officer replaces teacher scope
-- ---------------------------------------------------------------------------

-- The entry-sheet scope helper: result_entry_officer + approved academic
-- scope replaces the legacy teacher-assignment check. The legacy teacher
-- path remains ONLY for already-created sheets during the compatibility
-- release; new sheets always use result_entry_officer.
create or replace function app.result_entry_sheet_scope(p_sheet_id uuid, p_roles text[])
returns boolean language sql security definer set search_path = '' as $$
  select exists (
    select 1
      from public.result_entry_sheets res
      where res.id = p_sheet_id
        and (
          (app.has_role('result_entry_officer') and app.staff_scope_allowed(array['result_entry_officer'], res.academic_year_id, res.grade_section_id, res.subject_id))
          or (app.has_role('teacher') and app.teacher_assignment_allowed(res.academic_year_id, res.grade_section_id, res.subject_id))
          or (not app.has_role('teacher') and not app.has_role('result_entry_officer') and app.staff_scope_allowed(array_remove(p_roles, 'teacher'), res.academic_year_id, res.grade_section_id, res.subject_id))
        )
  )
$$;

-- Sheet creation: result_entry_officer OR legacy teacher (compatibility).
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
  if not (
    (app.is_staff_aal2() and app.has_role('result_entry_officer') and app.staff_scope_allowed(array['result_entry_officer'],
      (select academic_year_id from public.exam_definitions where id = p_exam_definition_id), p_grade_section_id, p_subject_id))
    or (app.is_staff_aal2() and app.has_role('teacher') and app.teacher_assignment_allowed(
      (select academic_year_id from public.exam_definitions where id = p_exam_definition_id),
      p_grade_section_id, p_subject_id))
  ) then
    raise exception 'result entry officer (or legacy teacher) role, aal2, and exact class/subject scope required';
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

-- Save draft: result_entry_officer OR legacy teacher (compatibility).
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
  if not (
    (app.has_role('result_entry_officer') and app.staff_scope_allowed(array['result_entry_officer'], v_sheet.academic_year_id, v_sheet.grade_section_id, v_sheet.subject_id))
    or app.teacher_assignment_allowed(v_sheet.academic_year_id, v_sheet.grade_section_id, v_sheet.subject_id)
  ) then
    raise exception 'result entry officer (or legacy teacher) role, aal2, and exact class/subject scope required';
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

-- Submit: result_entry_officer OR legacy teacher (compatibility).
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
  if not (
    (app.has_role('result_entry_officer') and app.staff_scope_allowed(array['result_entry_officer'], v_sheet.academic_year_id, v_sheet.grade_section_id, v_sheet.subject_id))
    or app.teacher_assignment_allowed(v_sheet.academic_year_id, v_sheet.grade_section_id, v_sheet.subject_id)
  ) then raise exception 'result entry officer (or legacy teacher) role, aal2, and exact class/subject scope required'; end if;
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

-- Publish: one independent Administrator (exam_reviewer moderation already
-- recorded) may also publish a Principal-originated sheet. The actor-level
-- no-self-approval rule is preserved: the publisher must differ from the
-- entry actor AND from the moderator.
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
  -- Actor-level separation: the publisher differs from the entry actor and
  -- from the moderator. One independent Administrator may moderate AND
  -- publish a Principal-originated sheet; nobody approves their own entry.
  if v_sheet.last_entry_by_account_id = auth.uid() then raise exception 'publisher must be independent from the entry actor'; end if;
  if v_sheet.moderated_by_account_id is null or v_sheet.moderated_by_account_id = auth.uid() then raise exception 'publisher must be independent from the checker'; end if;
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
-- 4. Teaching-assignment commands (Principal workspace)
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

  insert into public.staff_members (person_id, employment_status, title)
  values (null, 'active', btrim(p_title))
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
  if not exists (select 1 from public.staff_members where id = p_staff_member_id) then
    raise exception 'teaching staff record not found';
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

create or replace function app.teaching_assignment_end(
  p_assignment_id uuid,
  p_reason text,
  p_expected_version int
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_assignment public.teaching_assignments%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['timetable_manager'])) then
    raise exception 'teaching assignments require the timetable manager and aal2';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'reason is required';
  end if;
  select * into v_assignment from public.teaching_assignments where id = p_assignment_id for update;
  if v_assignment.id is null then raise exception 'teaching assignment not found'; end if;
  if v_assignment.status = 'ended' then raise exception 'teaching assignment is already ended'; end if;
  if v_assignment.version <> p_expected_version then
    raise exception 'teaching assignment version mismatch (expected %, found %)', p_expected_version, v_assignment.version;
  end if;
  update public.teaching_assignments
     set status = 'ended',
         effective_to = greatest(now(), v_assignment.effective_from + interval '1 microsecond'),
         version = v_assignment.version + 1,
         updated_by_account_id = auth.uid()
   where id = p_assignment_id
  returning * into v_assignment;
  perform app.record_audit('Teaching assignment ended', 'teaching_assignment', v_assignment.reference, 'Success', btrim(p_reason), 'Timetable manager');
  return jsonb_build_object('assignmentId', v_assignment.id, 'reference', v_assignment.reference,
                            'status', v_assignment.status, 'version', v_assignment.version);
end
$$;

-- Principal workspace read: non-login teaching staff with assignments.
create or replace function app.teaching_staff_list()
returns setof jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'staffMemberId', sm.id, 'staffRef', sm.reference, 'title', sm.title,
    'employmentStatus', sm.employment_status,
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ta.id, 'reference', ta.reference, 'academicYearId', ta.academic_year_id,
        'gradeSectionId', ta.grade_section_id, 'subjectId', ta.subject_id,
        'status', ta.status, 'effectiveFromIso', ta.effective_from, 'effectiveToIso', ta.effective_to,
        'version', ta.version, 'provenance', ta.provenance,
        'gradeLabel', g.label, 'sectionLabel', gs.section_label, 'subjectName', s.name)
        order by ta.created_at)
      from public.teaching_assignments ta
      left join public.grade_sections gs on gs.id = ta.grade_section_id
      left join public.grades g on g.id = gs.grade_id
      left join public.subjects s on s.id = ta.subject_id
     where ta.staff_member_id = sm.id), '[]'::jsonb)
  )
    from public.staff_members sm
   where sm.person_id is null
      or not exists (
        select 1 from public.user_accounts ua
         where ua.person_id = sm.person_id
           and exists (select 1 from public.role_grants rg
                        where rg.account_id = ua.id and rg.status = 'active'
                          and rg.role_code not in ('guardian', 'student')))
$$;

-- ---------------------------------------------------------------------------
-- 5. Legacy teacher-access inventory and retirement (NOT invoked)
-- ---------------------------------------------------------------------------

-- Masked inventory: account/grant/assignment/timetable dependency counts per
-- legacy teacher grant. No names, emails, or contact values are returned.
create or replace function app.legacy_teacher_access_report()
returns setof jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'grantRef', rg.reference,
    'accountId', rg.account_id,
    'grantVersion', rg.version,
    'hasGuardianGrant', exists (
      select 1 from public.role_grants g2
       where g2.account_id = rg.account_id and g2.role_code = 'guardian' and g2.status = 'active'),
    'otherActiveStaffGrants', (select count(*) from public.role_grants g3
       where g3.account_id = rg.account_id and g3.status = 'active'
         and g3.role_code not in ('teacher', 'guardian', 'student')),
    'legacyAssignments', (select count(*) from public.staff_assignments sa
       where sa.role_grant_id = rg.id),
    'timetablePeriodReferences', (select count(*) from public.timetable_periods tp
       where tp.teacher_assignment_id in (select sa.id from public.staff_assignments sa where sa.role_grant_id = rg.id)),
    'overrideReferences', (select count(*) from public.timetable_overrides to_
       where to_.substitute_teacher_assignment_id in (select sa.id from public.staff_assignments sa where sa.role_grant_id = rg.id)),
    'activeTeachingAssignments', (select count(*) from public.teaching_assignments ta
       join public.staff_members sm on sm.id = ta.staff_member_id
       join public.user_accounts ua on ua.person_id = sm.person_id
      where ua.id = rg.account_id and ta.status in ('scheduled', 'active'))
  )
    from public.role_grants rg
   where rg.role_code = 'teacher' and rg.status = 'active'
   order by rg.reference
$$;

-- Version-checked retirement: revokes ONLY the teacher grant (mixed
-- guardian/staff people keep their other access), ends legacy assignment
-- linkage, bumps revalidation, and audits. Never invoked automatically.
create or replace function app.legacy_teacher_access_retire(
  p_account_id uuid,
  p_expected_grant_version int,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.role_grants%rowtype;
  v_guardian_account uuid;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'legacy retirement requires the system administrator and aal2';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'a retirement reason of at least 10 characters is required';
  end if;
  select * into v_grant
    from public.role_grants
   where account_id = p_account_id and role_code = 'teacher' and status = 'active'
   for update;
  if v_grant.id is null then raise exception 'no active teacher grant for this account'; end if;
  if v_grant.version <> p_expected_grant_version then
    raise exception 'teacher grant version mismatch (expected %, found %)', p_expected_grant_version, v_grant.version;
  end if;

  update public.role_grants
     set status = 'revoked', effective_to = now(), version = v_grant.version + 1
   where id = v_grant.id;
  update public.staff_assignments
     set status = 'ended', effective_to = coalesce(effective_to, now()), version = version + 1
   where role_grant_id = v_grant.id and status in ('scheduled', 'active');

  select ua.id into v_guardian_account
    from public.user_accounts ua
   where ua.id = p_account_id;
  if v_guardian_account is not null then
    perform app.bump_access_revalidation(v_guardian_account);
  end if;
  perform app.record_audit('Legacy teacher access retired', 'role_grant', v_grant.reference, 'Success', btrim(p_reason), 'System administrator');
  perform app.enqueue_outbox(
    'security.legacy_teacher_retired:' || v_grant.reference,
    'security.legacy_teacher_retired', 'user_account', p_account_id,
    jsonb_build_object('grantRef', v_grant.reference, 'reason', btrim(p_reason)));
  return jsonb_build_object('grantRef', v_grant.reference, 'status', 'revoked', 'version', v_grant.version + 1);
end
$$;

-- ---------------------------------------------------------------------------
-- Execution surface
-- ---------------------------------------------------------------------------

revoke all on function app.results_entry_sheet_create(uuid, uuid, uuid, text) from public;
revoke all on function app.results_entry_sheet_save_draft(uuid, jsonb, int, text) from public;
revoke all on function app.results_entry_sheet_submit(uuid, int, text) from public;
revoke all on function app.results_entry_sheet_publish(uuid, int, text) from public;
revoke all on function app.teaching_staff_create(text, text, text) from public;
revoke all on function app.teaching_assignment_create(uuid, uuid, uuid, uuid, timestamptz, text) from public;
revoke all on function app.teaching_assignment_end(uuid, text, int) from public;
revoke all on function app.teaching_staff_list() from public;
revoke all on function app.legacy_teacher_access_report() from public;
revoke all on function app.legacy_teacher_access_retire(uuid, int, text) from public;

grant execute on function app.results_entry_sheet_create(uuid, uuid, uuid, text) to authenticated;
grant execute on function app.results_entry_sheet_save_draft(uuid, jsonb, int, text) to authenticated;
grant execute on function app.results_entry_sheet_submit(uuid, int, text) to authenticated;
grant execute on function app.results_entry_sheet_publish(uuid, int, text) to authenticated;
grant execute on function app.teaching_staff_create(text, text, text) to authenticated;
grant execute on function app.teaching_assignment_create(uuid, uuid, uuid, uuid, timestamptz, text) to authenticated;
grant execute on function app.teaching_assignment_end(uuid, text, int) to authenticated;
grant execute on function app.teaching_staff_list() to authenticated;
grant execute on function app.legacy_teacher_access_report() to authenticated;
grant execute on function app.legacy_teacher_access_retire(uuid, int, text) to authenticated;

commit;
