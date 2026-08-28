-- =============================================================================
-- 000028 — explicit result entry sheets, report releases, and durable timetable
-- drafts
--
-- This migration is deliberately forward-only. The older result_batches /
-- mark_entries and timetable_versions rows remain available for rollback and
-- historical evidence, while new writes use the explicit, scoped models below.
-- Published result subjects and report releases are immutable snapshots. A
-- correction creates a new entry sheet and a superseding report release.
-- =============================================================================

begin;

-- One exam may contain several components for the same subject. The original
-- schema's one-component-per-subject constraint made a complete entry sheet
-- impossible, so replace it with a stable component-name uniqueness rule.
alter table public.assessment_components
  drop constraint if exists assessment_components_exam_definition_id_subject_id_key;
create unique index if not exists assessment_components_exam_subject_name_uidx
  on public.assessment_components (exam_definition_id, subject_id, lower(name));

-- ---------------------------------------------------------------------------
-- ResultEntrySheet — one exam/term, class/section, and subject
-- ---------------------------------------------------------------------------
create table if not exists public.result_entry_sheets (
  id                    uuid primary key default gen_random_uuid(),
  reference             text not null unique default app.new_ref('RES'),
  exam_definition_id    uuid not null references public.exam_definitions(id) on delete restrict,
  academic_year_id     uuid not null references public.academic_years(id) on delete restrict,
  grade_section_id      uuid not null references public.grade_sections(id) on delete restrict,
  subject_id            uuid not null references public.subjects(id) on delete restrict,
  legacy_batch_id       uuid unique references public.result_batches(id) on delete restrict,
  source_sheet_id       uuid references public.result_entry_sheets(id) on delete restrict,
  correction_request_id uuid,
  state                 text not null default 'draft'
                        check (state in ('draft','submitted','moderation','returned','approved','published','superseded','withdrawn')),
  version               int not null default 1 check (version > 0),
  last_entry_by_account_id uuid references public.user_accounts(id) on delete restrict,
  moderated_by_account_id  uuid references public.user_accounts(id) on delete restrict,
  published_by_account_id  uuid references public.user_accounts(id) on delete restrict,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (exam_definition_id, grade_section_id, subject_id, source_sheet_id)
);

create index if not exists result_entry_sheets_scope_idx
  on public.result_entry_sheets (academic_year_id, grade_section_id, subject_id, state);
create unique index if not exists result_entry_sheets_one_open_uidx
  on public.result_entry_sheets (exam_definition_id, grade_section_id, subject_id)
  where state in ('draft','submitted','moderation','returned','approved');
create trigger result_entry_sheets_touch before update on public.result_entry_sheets
  for each row execute function app.touch_updated_at();

create table if not exists public.result_entry_sheet_rosters (
  id             uuid primary key default gen_random_uuid(),
  reference      text not null unique default app.new_ref('RER'),
  sheet_id       uuid not null references public.result_entry_sheets(id) on delete cascade,
  student_id     uuid not null references public.students(id) on delete restrict,
  enrollment_id  uuid not null references public.enrollments(id) on delete restrict,
  roster_order   int not null default 0,
  frozen_at      timestamptz not null default now(),
  unique (sheet_id, student_id),
  unique (sheet_id, enrollment_id)
);
create index if not exists result_entry_sheet_rosters_sheet_idx
  on public.result_entry_sheet_rosters (sheet_id, roster_order, id);

create table if not exists public.result_entry_sheet_components (
  id                    uuid primary key default gen_random_uuid(),
  reference             text not null unique default app.new_ref('REC'),
  sheet_id              uuid not null references public.result_entry_sheets(id) on delete cascade,
  assessment_component_id uuid not null references public.assessment_components(id) on delete restrict,
  name                  text not null,
  max_marks             numeric not null check (max_marks > 0),
  weight                numeric,
  component_order       int not null default 0,
  unique (sheet_id, assessment_component_id)
);
create index if not exists result_entry_sheet_components_sheet_idx
  on public.result_entry_sheet_components (sheet_id, component_order, id);

create table if not exists public.result_entry_sheet_marks (
  id             uuid primary key default gen_random_uuid(),
  sheet_id       uuid not null references public.result_entry_sheets(id) on delete cascade,
  roster_id      uuid not null references public.result_entry_sheet_rosters(id) on delete cascade,
  component_id   uuid not null references public.result_entry_sheet_components(id) on delete restrict,
  obtained       numeric,
  mark_status    text not null default 'pending'
                 check (mark_status in ('pending','present','absent','exempt','not_applicable')),
  remark         text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (sheet_id, roster_id, component_id),
  check (obtained is null or obtained >= 0)
);
create index if not exists result_entry_sheet_marks_sheet_idx
  on public.result_entry_sheet_marks (sheet_id, roster_id, component_id);
create trigger result_entry_sheet_marks_touch before update on public.result_entry_sheet_marks
  for each row execute function app.touch_updated_at();

create table if not exists public.result_entry_sheet_versions (
  id             uuid primary key default gen_random_uuid(),
  sheet_id       uuid not null references public.result_entry_sheets(id) on delete cascade,
  version        int not null,
  state          text not null,
  note           text,
  actor_account_id uuid not null references public.user_accounts(id) on delete restrict,
  created_at     timestamptz not null default now(),
  unique (sheet_id, version)
);
create index if not exists result_entry_sheet_versions_sheet_idx
  on public.result_entry_sheet_versions (sheet_id, version desc);
create trigger result_entry_sheet_versions_no_update before update on public.result_entry_sheet_versions
  for each row execute function app.block_mutation();
create trigger result_entry_sheet_versions_no_delete before delete on public.result_entry_sheet_versions
  for each row execute function app.block_mutation();

-- ---------------------------------------------------------------------------
-- ResultReportRelease — immutable per-student report manifest
-- ---------------------------------------------------------------------------
create table if not exists public.result_report_releases (
  id                   uuid primary key default gen_random_uuid(),
  reference            text not null unique default app.new_ref('RPR'),
  student_id           uuid not null references public.students(id) on delete restrict,
  enrollment_id        uuid not null references public.enrollments(id) on delete restrict,
  academic_year_id     uuid not null references public.academic_years(id) on delete restrict,
  grade_section_id      uuid not null references public.grade_sections(id) on delete restrict,
  term                 text not null,
  release_version      int not null default 1 check (release_version > 0),
  status               text not null default 'published'
                       check (status in ('published','superseded','withdrawn')),
  supersedes_release_id uuid references public.result_report_releases(id) on delete restrict,
  published_by_account_id uuid not null references public.user_accounts(id) on delete restrict,
  published_at         timestamptz not null default now(),
  superseded_at        timestamptz,
  created_at            timestamptz not null default now(),
  unique (student_id, academic_year_id, term, release_version)
);
create unique index if not exists result_report_releases_one_live_uidx
  on public.result_report_releases (student_id, academic_year_id, term)
  where status = 'published';
create index if not exists result_report_releases_student_idx
  on public.result_report_releases (student_id, academic_year_id, term, release_version desc);

create table if not exists public.result_report_release_items (
  id                   uuid primary key default gen_random_uuid(),
  release_id           uuid not null references public.result_report_releases(id) on delete cascade,
  subject_id           uuid not null references public.subjects(id) on delete restrict,
  publication_id       uuid not null references public.result_publications(id) on delete restrict,
  entry_sheet_id       uuid references public.result_entry_sheets(id) on delete restrict,
  publication_version  int not null,
  snapshot             jsonb not null,
  created_at           timestamptz not null default now(),
  unique (release_id, subject_id),
  unique (release_id, publication_id)
);
create index if not exists result_report_release_items_release_idx
  on public.result_report_release_items (release_id, subject_id);
create trigger result_report_release_items_no_update before update on public.result_report_release_items
  for each row execute function app.block_mutation();
create trigger result_report_release_items_no_delete before delete on public.result_report_release_items
  for each row execute function app.block_mutation();

create table if not exists public.result_report_release_events (
  id             uuid primary key default gen_random_uuid(),
  release_id     uuid not null references public.result_report_releases(id) on delete restrict,
  event_type     text not null,
  actor_account_id uuid not null references public.user_accounts(id) on delete restrict,
  reason         text,
  created_at     timestamptz not null default now()
);
create trigger result_report_release_events_no_update before update on public.result_report_release_events
  for each row execute function app.block_mutation();
create trigger result_report_release_events_no_delete before delete on public.result_report_release_events
  for each row execute function app.block_mutation();

alter table public.result_publications
  alter column batch_id drop not null;
alter table public.result_publications
  add column if not exists source_entry_sheet_id uuid references public.result_entry_sheets(id) on delete restrict;
alter table public.result_publications
  add column if not exists report_release_id uuid references public.result_report_releases(id) on delete restrict;
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.result_publications'::regclass
       and conname = 'result_publications_source_required'
  ) then
    alter table public.result_publications
      add constraint result_publications_source_required
      check (batch_id is not null or source_entry_sheet_id is not null);
  end if;
end
$$;
create unique index if not exists result_publications_sheet_version_uidx
  on public.result_publications (source_entry_sheet_id, version)
  where source_entry_sheet_id is not null;

alter table public.result_correction_requests
  add column if not exists release_id uuid references public.result_report_releases(id) on delete restrict;
alter table public.result_correction_requests
  add column if not exists source_entry_sheet_id uuid references public.result_entry_sheets(id) on delete restrict;
alter table public.result_correction_requests
  add column if not exists new_entry_sheet_id uuid references public.result_entry_sheets(id) on delete restrict;
alter table public.result_correction_requests
  add column if not exists version int not null default 1;
alter table public.result_correction_requests
  add column if not exists approved_at timestamptz;

-- ---------------------------------------------------------------------------
-- Backfill the explicit sheet model from the legacy one-subject batches.
-- ---------------------------------------------------------------------------
insert into public.result_entry_sheets
  (reference, exam_definition_id, academic_year_id, grade_section_id, subject_id,
   legacy_batch_id, state, version, created_at, updated_at)
select app.new_ref('RES'), rb.exam_definition_id, ed.academic_year_id,
       rb.grade_section_id, rb.subject_id, rb.id, rb.status, greatest(rb.version, 1),
       rb.created_at, rb.updated_at
  from public.result_batches rb
  join public.exam_definitions ed on ed.id = rb.exam_definition_id
 where not exists (select 1 from public.result_entry_sheets res where res.legacy_batch_id = rb.id);

insert into public.result_entry_sheet_components
  (sheet_id, assessment_component_id, name, max_marks, weight, component_order)
select res.id, ac.id, ac.name, ac.max_marks, ac.weight, ac.sort_order
  from public.result_entry_sheets res
  join public.assessment_components ac
    on ac.exam_definition_id = res.exam_definition_id and ac.subject_id = res.subject_id
 where not exists (
   select 1 from public.result_entry_sheet_components rec
    where rec.sheet_id = res.id and rec.assessment_component_id = ac.id
 );

insert into public.result_entry_sheet_rosters
  (sheet_id, student_id, enrollment_id, roster_order, frozen_at)
select res.id, rr.student_id, rr.enrollment_id,
       row_number() over (partition by res.id order by rr.id), rr.frozen_at
  from public.result_entry_sheets res
  join public.result_rosters rr on rr.batch_id = res.legacy_batch_id
 where not exists (
   select 1 from public.result_entry_sheet_rosters rer
    where rer.sheet_id = res.id and rer.student_id = rr.student_id
 );

insert into public.result_entry_sheet_marks
  (sheet_id, roster_id, component_id, obtained, mark_status, remark, created_at, updated_at)
select res.id, rer.id, rec.id, me.obtained,
       case when me.absent then 'absent' when me.obtained is null then 'pending' else 'present' end,
       me.remark, me.created_at, me.updated_at
  from public.result_entry_sheets res
  join public.mark_entries me on me.batch_id = res.legacy_batch_id
  join public.result_rosters rr on rr.id = me.roster_id
  join public.result_entry_sheet_rosters rer on rer.sheet_id = res.id and rer.student_id = rr.student_id
  join public.result_entry_sheet_components rec on rec.sheet_id = res.id and rec.assessment_component_id = me.component_id
 where not exists (
   select 1 from public.result_entry_sheet_marks rem
    where rem.sheet_id = res.id and rem.roster_id = rer.id and rem.component_id = rec.id
 );

insert into public.result_entry_sheet_versions (sheet_id, version, state, note, actor_account_id, created_at)
select res.id, res.version, res.state, 'Backfilled from legacy result batch',
       coalesce((select rbv.created_by_account_id from public.result_batch_versions rbv where rbv.batch_id = res.legacy_batch_id order by rbv.version desc limit 1),
                (select id from public.user_accounts order by id limit 1)),
       res.created_at
  from public.result_entry_sheets res
 where not exists (select 1 from public.result_entry_sheet_versions rev where rev.sheet_id = res.id);

-- Legacy writes continue to be readable while the UI moves to sheets. These
-- triggers only project forward into the new model; they never rewrite a
-- publication or release snapshot.
create or replace function app.project_legacy_result_batch_to_sheet()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sheet public.result_entry_sheets%rowtype; v_exam public.exam_definitions%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into v_exam from public.exam_definitions where id = new.exam_definition_id;
    insert into public.result_entry_sheets(exam_definition_id, academic_year_id, grade_section_id, subject_id, legacy_batch_id, state, version)
    values (new.exam_definition_id, v_exam.academic_year_id, new.grade_section_id, new.subject_id, new.id, new.status, greatest(new.version,1))
    on conflict (legacy_batch_id) do nothing
    returning * into v_sheet;
    if v_sheet.id is not null then
      insert into public.result_entry_sheet_components(sheet_id, assessment_component_id, name, max_marks, weight, component_order)
        select v_sheet.id, ac.id, ac.name, ac.max_marks, ac.weight, ac.sort_order from public.assessment_components ac where ac.exam_definition_id = new.exam_definition_id and ac.subject_id = new.subject_id;
      insert into public.result_entry_sheet_rosters(sheet_id, student_id, enrollment_id, roster_order)
        select v_sheet.id, e.student_id, e.id, row_number() over (order by e.student_id) from public.enrollments e where e.academic_year_id = v_exam.academic_year_id and e.grade_section_id = new.grade_section_id and e.status = 'active';
      insert into public.result_entry_sheet_versions(sheet_id, version, state, note, actor_account_id)
        select v_sheet.id, v_sheet.version, v_sheet.state, 'Projected from legacy batch', ua.id from public.user_accounts ua order by ua.id limit 1;
    end if;
    return new;
  end if;
  update public.result_entry_sheets
     set state = new.status,
         version = greatest(version, new.version),
         updated_at = new.updated_at
   where legacy_batch_id = new.id
     and state not in ('superseded','withdrawn');
  return new;
end
$$;
drop trigger if exists result_batches_project_entry_sheet on public.result_batches;
create trigger result_batches_project_entry_sheet after insert or update on public.result_batches
  for each row execute function app.project_legacy_result_batch_to_sheet();

create or replace function app.project_legacy_roster_to_sheet()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sheet uuid; v_order int;
begin
  select res.id into v_sheet from public.result_entry_sheets res where res.legacy_batch_id = new.batch_id;
  if v_sheet is null then return new; end if;
  select coalesce(max(roster_order), 0) + 1 into v_order from public.result_entry_sheet_rosters where sheet_id = v_sheet;
  insert into public.result_entry_sheet_rosters(sheet_id, student_id, enrollment_id, roster_order, frozen_at)
  values (v_sheet, new.student_id, new.enrollment_id, v_order, new.frozen_at)
  on conflict (sheet_id, student_id) do nothing;
  return new;
end
$$;
drop trigger if exists result_rosters_project_entry_sheet on public.result_rosters;
create trigger result_rosters_project_entry_sheet after insert on public.result_rosters
  for each row execute function app.project_legacy_roster_to_sheet();

create or replace function app.project_legacy_mark_to_sheet()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sheet uuid; v_roster uuid; v_component uuid;
begin
  select res.id into v_sheet from public.result_entry_sheets res where res.legacy_batch_id = new.batch_id;
  if v_sheet is null then return new; end if;
  select rer.id into v_roster
    from public.result_entry_sheet_rosters rer
    join public.result_rosters rr on rr.student_id = rer.student_id and rr.id = new.roster_id
   where rer.sheet_id = v_sheet;
  select rec.id into v_component from public.result_entry_sheet_components rec where rec.sheet_id = v_sheet and rec.assessment_component_id = new.component_id;
  if v_roster is null or v_component is null then return new; end if;
  insert into public.result_entry_sheet_marks(sheet_id, roster_id, component_id, obtained, mark_status, remark)
  values (v_sheet, v_roster, v_component, new.obtained, case when new.absent then 'absent' when new.obtained is null then 'pending' else 'present' end, new.remark)
  on conflict (sheet_id, roster_id, component_id) do update
    set obtained = excluded.obtained, mark_status = excluded.mark_status, remark = excluded.remark, updated_at = now();
  return new;
end
$$;
drop trigger if exists mark_entries_project_entry_sheet on public.mark_entries;
create trigger mark_entries_project_entry_sheet after insert or update on public.mark_entries
  for each row execute function app.project_legacy_mark_to_sheet();

-- ---------------------------------------------------------------------------
-- Authorization helpers and RLS
-- ---------------------------------------------------------------------------
create or replace function app.result_entry_sheet_scope(p_sheet_id uuid, p_roles text[])
returns boolean language sql security definer set search_path = '' as $$
  select exists (
    select 1
      from public.result_entry_sheets res
      where res.id = p_sheet_id
        and (
          (app.has_role('teacher') and app.teacher_assignment_allowed(res.academic_year_id, res.grade_section_id, res.subject_id))
          or (not app.has_role('teacher') and app.staff_scope_allowed(array_remove(p_roles, 'teacher'), res.academic_year_id, res.grade_section_id, res.subject_id))
        )
  )
$$;

create or replace function app.result_publication_scope(p_publication_id uuid, p_roles text[])
returns boolean language sql security definer set search_path = '' as $$
  select exists (
    select 1
      from public.result_publications rp
      left join public.result_entry_sheets direct_sheet on direct_sheet.id = rp.source_entry_sheet_id
      left join public.result_entry_sheets legacy_sheet on legacy_sheet.legacy_batch_id = rp.batch_id
     where rp.id = p_publication_id
       and app.result_entry_sheet_scope(coalesce(direct_sheet.id, legacy_sheet.id), p_roles)
  )
$$;

create or replace function app.result_report_release_scope(p_release_id uuid, p_roles text[] default array[]::text[])
returns boolean language sql security definer set search_path = '' as $$
  select exists (
    select 1 from public.result_report_releases r
     where r.id = p_release_id
       and (
         (app.is_guardian() and r.status = 'published' and app.guardian_has_capability(r.student_id, 'academics'))
         or (
           exists (select 1 from public.result_report_release_items ri where ri.release_id = r.id)
           and not exists (
             select 1 from public.result_report_release_items ri
              where ri.release_id = r.id
                and not app.result_publication_scope(ri.publication_id, p_roles)
           )
         )
       )
  )
$$;

revoke all on function app.result_entry_sheet_scope(uuid,text[]), app.result_publication_scope(uuid,text[]), app.result_report_release_scope(uuid,text[]) from public;
grant execute on function app.result_entry_sheet_scope(uuid,text[]), app.result_publication_scope(uuid,text[]), app.result_report_release_scope(uuid,text[]) to authenticated;

alter table public.result_entry_sheets enable row level security;
alter table public.result_entry_sheet_rosters enable row level security;
alter table public.result_entry_sheet_components enable row level security;
alter table public.result_entry_sheet_marks enable row level security;
alter table public.result_entry_sheet_versions enable row level security;
alter table public.result_report_releases enable row level security;
alter table public.result_report_release_items enable row level security;
alter table public.result_report_release_events enable row level security;
revoke all on public.result_entry_sheets, public.result_entry_sheet_rosters, public.result_entry_sheet_components,
  public.result_entry_sheet_marks, public.result_entry_sheet_versions, public.result_report_releases,
  public.result_report_release_items, public.result_report_release_events from anon, authenticated;

drop policy if exists result_entry_sheet_staff_read on public.result_entry_sheets;
create policy result_entry_sheet_staff_read on public.result_entry_sheets for select to authenticated
  using (app.result_entry_sheet_scope(id, array['teacher','exam_reviewer','result_publisher','auditor']));
drop policy if exists result_entry_sheet_roster_staff_read on public.result_entry_sheet_rosters;
create policy result_entry_sheet_roster_staff_read on public.result_entry_sheet_rosters for select to authenticated
  using (app.result_entry_sheet_scope(sheet_id, array['teacher','exam_reviewer','result_publisher','auditor']));
drop policy if exists result_entry_sheet_component_staff_read on public.result_entry_sheet_components;
create policy result_entry_sheet_component_staff_read on public.result_entry_sheet_components for select to authenticated
  using (app.result_entry_sheet_scope(sheet_id, array['teacher','exam_reviewer','result_publisher','auditor']));
drop policy if exists result_entry_sheet_mark_staff_read on public.result_entry_sheet_marks;
create policy result_entry_sheet_mark_staff_read on public.result_entry_sheet_marks for select to authenticated
  using (app.result_entry_sheet_scope(sheet_id, array['teacher','exam_reviewer','result_publisher','auditor']));
drop policy if exists result_entry_sheet_version_staff_read on public.result_entry_sheet_versions;
create policy result_entry_sheet_version_staff_read on public.result_entry_sheet_versions for select to authenticated
  using (app.result_entry_sheet_scope(sheet_id, array['teacher','exam_reviewer','result_publisher','auditor']));

drop policy if exists result_report_release_staff_read on public.result_report_releases;
create policy result_report_release_staff_read on public.result_report_releases for select to authenticated
  using (app.result_report_release_scope(id, array['exam_reviewer','result_publisher','auditor']));
drop policy if exists result_report_release_guardian_read on public.result_report_releases;
create policy result_report_release_guardian_read on public.result_report_releases for select to authenticated
  using (app.result_report_release_scope(id));
drop policy if exists result_report_release_item_staff_read on public.result_report_release_items;
create policy result_report_release_item_staff_read on public.result_report_release_items for select to authenticated
  using (app.result_report_release_scope(release_id, array['exam_reviewer','result_publisher','auditor']));
drop policy if exists result_report_release_item_guardian_read on public.result_report_release_items;
create policy result_report_release_item_guardian_read on public.result_report_release_items for select to authenticated
  using (app.result_report_release_scope(release_id));
drop policy if exists result_report_release_event_staff_read on public.result_report_release_events;
create policy result_report_release_event_staff_read on public.result_report_release_events for select to authenticated
  using (app.result_report_release_scope(release_id, array['exam_reviewer','result_publisher','auditor']));

-- Replace the legacy batch-only staff predicates so sheet-native publications
-- remain readable through the same scoped server projection. Guardians still
-- reach report data only through result_report_releases.
drop policy if exists scope_results_publications_read on public.result_publications;
create policy scope_results_publications_read on public.result_publications for select to authenticated
  using (
    (batch_id is not null and exists (select 1 from public.result_batches b where b.id = result_publications.batch_id and app.result_batch_scope(b.id, array['exam_reviewer','result_publisher','auditor'])))
    or (source_entry_sheet_id is not null and app.result_entry_sheet_scope(source_entry_sheet_id, array['exam_reviewer','result_publisher','auditor']))
  );
drop policy if exists scope_results_publication_items_read on public.result_publication_items;
create policy scope_results_publication_items_read on public.result_publication_items for select to authenticated
  using (app.result_publication_scope(publication_id, array['exam_reviewer','result_publisher','auditor']));
drop policy if exists scope_results_corrections_read on public.result_correction_requests;
create policy scope_results_corrections_read on public.result_correction_requests for select to authenticated
  using (
    (source_entry_sheet_id is not null and app.result_entry_sheet_scope(source_entry_sheet_id, array['exam_reviewer','result_publisher','auditor']))
    or (source_entry_sheet_id is null and app.result_publication_scope(publication_id, array['exam_reviewer','result_publisher','auditor']))
  );

-- Timetable RLS must carry the section's academic year into the manager
-- grant check; a manager scoped to another section or year cannot even read a
-- target draft, publication, override, or date-sheet row.
drop policy if exists scope_timetable_staff_versions on public.timetable_versions;
create policy scope_timetable_staff_versions on public.timetable_versions for select to authenticated using (
  (app.staff_scope_allowed(array['timetable_manager','auditor'], (select academic_year_id from public.grade_sections gs where gs.id = grade_section_id), grade_section_id, null))
  or app.teacher_section_allowed(grade_section_id)
);
drop policy if exists scope_timetable_staff_periods on public.timetable_periods;
create policy scope_timetable_staff_periods on public.timetable_periods for select to authenticated using (
  exists (select 1 from public.timetable_versions tv where tv.id = timetable_periods.timetable_version_id and (
    app.staff_scope_allowed(array['timetable_manager','auditor'], (select academic_year_id from public.grade_sections gs where gs.id = tv.grade_section_id), tv.grade_section_id, null)
    or (timetable_periods.teacher_assignment_id is not null and exists (select 1 from public.staff_assignments sa join public.staff_members sm on sm.id = sa.staff_member_id join public.user_accounts ua on ua.person_id = sm.person_id where sa.id = timetable_periods.teacher_assignment_id and ua.id = auth.uid() and sa.status = 'active'))
  ))
);
drop policy if exists scope_timetable_write_versions on public.timetable_versions;
create policy scope_timetable_write_versions on public.timetable_versions for insert to authenticated with check (app.staff_scope_allowed(array['timetable_manager'], (select academic_year_id from public.grade_sections gs where gs.id = grade_section_id), grade_section_id, null));
drop policy if exists scope_timetable_update_versions on public.timetable_versions;
create policy scope_timetable_update_versions on public.timetable_versions for update to authenticated using (app.staff_scope_allowed(array['timetable_manager'], (select academic_year_id from public.grade_sections gs where gs.id = grade_section_id), grade_section_id, null)) with check (app.staff_scope_allowed(array['timetable_manager'], (select academic_year_id from public.grade_sections gs where gs.id = grade_section_id), grade_section_id, null));
drop policy if exists scope_timetable_write_periods on public.timetable_periods;
create policy scope_timetable_write_periods on public.timetable_periods for all to authenticated using (exists (select 1 from public.timetable_versions tv where tv.id = timetable_periods.timetable_version_id and app.staff_scope_allowed(array['timetable_manager'], (select academic_year_id from public.grade_sections gs where gs.id = tv.grade_section_id), tv.grade_section_id, null))) with check (exists (select 1 from public.timetable_versions tv where tv.id = timetable_periods.timetable_version_id and app.staff_scope_allowed(array['timetable_manager'], (select academic_year_id from public.grade_sections gs where gs.id = tv.grade_section_id), tv.grade_section_id, null)));
drop policy if exists scope_timetable_publications_read on public.timetable_publications;
create policy scope_timetable_publications_read on public.timetable_publications for select to authenticated using (exists (select 1 from public.timetable_versions tv where tv.id = timetable_publications.timetable_version_id and app.staff_scope_allowed(array['timetable_manager','auditor'], (select academic_year_id from public.grade_sections gs where gs.id = tv.grade_section_id), tv.grade_section_id, null)));
drop policy if exists scope_timetable_publications_write on public.timetable_publications;
create policy scope_timetable_publications_write on public.timetable_publications for insert to authenticated with check (exists (select 1 from public.timetable_versions tv where tv.id = timetable_publications.timetable_version_id and app.staff_scope_allowed(array['timetable_manager'], (select academic_year_id from public.grade_sections gs where gs.id = tv.grade_section_id), tv.grade_section_id, null)));
drop policy if exists scope_timetable_overrides_read on public.timetable_overrides;
create policy scope_timetable_overrides_read on public.timetable_overrides for select to authenticated using (app.staff_scope_allowed(array['timetable_manager','auditor'], (select academic_year_id from public.grade_sections gs where gs.id = grade_section_id), grade_section_id, null) or app.teacher_section_allowed(grade_section_id));
drop policy if exists scope_timetable_overrides_write on public.timetable_overrides;
create policy scope_timetable_overrides_write on public.timetable_overrides for insert to authenticated with check (app.staff_scope_allowed(array['timetable_manager'], (select academic_year_id from public.grade_sections gs where gs.id = grade_section_id), grade_section_id, null));
drop policy if exists scope_exam_schedule_read on public.exam_schedule_versions;
create policy scope_exam_schedule_read on public.exam_schedule_versions for select to authenticated using (app.staff_scope_allowed(array['timetable_manager','auditor'], (select academic_year_id from public.grade_sections gs where gs.id = grade_section_id), grade_section_id, null));
drop policy if exists scope_exam_schedule_write on public.exam_schedule_versions;
create policy scope_exam_schedule_write on public.exam_schedule_versions for insert to authenticated with check (app.staff_scope_allowed(array['timetable_manager'], (select academic_year_id from public.grade_sections gs where gs.id = grade_section_id), grade_section_id, null));
drop policy if exists scope_exam_schedule_update on public.exam_schedule_versions;
create policy scope_exam_schedule_update on public.exam_schedule_versions for update to authenticated using (app.staff_scope_allowed(array['timetable_manager'], (select academic_year_id from public.grade_sections gs where gs.id = grade_section_id), grade_section_id, null)) with check (app.staff_scope_allowed(array['timetable_manager'], (select academic_year_id from public.grade_sections gs where gs.id = grade_section_id), grade_section_id, null));
drop policy if exists scope_exam_entries_read on public.exam_schedule_entries;
create policy scope_exam_entries_read on public.exam_schedule_entries for select to authenticated using (exists (select 1 from public.exam_schedule_versions ev where ev.id = exam_schedule_entries.schedule_version_id and app.staff_scope_allowed(array['timetable_manager','auditor'], (select academic_year_id from public.grade_sections gs where gs.id = ev.grade_section_id), ev.grade_section_id, null)));
drop policy if exists scope_exam_entries_write on public.exam_schedule_entries;
create policy scope_exam_entries_write on public.exam_schedule_entries for all to authenticated using (exists (select 1 from public.exam_schedule_versions ev where ev.id = exam_schedule_entries.schedule_version_id and app.staff_scope_allowed(array['timetable_manager'], (select academic_year_id from public.grade_sections gs where gs.id = ev.grade_section_id), ev.grade_section_id, null))) with check (exists (select 1 from public.exam_schedule_versions ev where ev.id = exam_schedule_entries.schedule_version_id and app.staff_scope_allowed(array['timetable_manager'], (select academic_year_id from public.grade_sections gs where gs.id = ev.grade_section_id), ev.grade_section_id, null)));

-- ---------------------------------------------------------------------------
-- Durable timetable drafts and date-sheet drafts: one ID per section
-- ---------------------------------------------------------------------------
create unique index if not exists timetable_versions_one_draft_uidx
  on public.timetable_versions (grade_section_id) where status = 'draft';
create unique index if not exists exam_schedule_versions_one_draft_uidx
  on public.exam_schedule_versions (grade_section_id) where status = 'draft';

-- ---------------------------------------------------------------------------
-- Idempotency helpers for the new result command surface
-- ---------------------------------------------------------------------------
create or replace function app.results_idempotency_begin(p_operation text, p_request_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.idempotency_records%rowtype; v_key text;
begin
  v_key := 'results:' || coalesce(auth.uid()::text, 'anonymous') || ':' || p_operation;
  select * into v_row from public.idempotency_records where operation_key = v_key for update;
  if v_row.id is null then
    insert into public.idempotency_records(operation_key, request_hash, state)
    values (v_key, p_request_hash, 'in_progress') returning * into v_row;
  elsif v_row.request_hash <> p_request_hash then
    raise exception 'idempotency key was reused with different input';
  elsif v_row.state = 'completed' then
    return v_row.result;
  elsif v_row.state = 'in_progress' then
    raise exception 'operation is already in progress';
  end if;
  return null;
end
$$;

create or replace function app.results_idempotency_finish(p_operation text, p_request_hash text, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_key text := 'results:' || coalesce(auth.uid()::text, 'anonymous') || ':' || p_operation;
begin
  update public.idempotency_records set state = 'completed', result = p_result, updated_at = now()
   where operation_key = v_key and request_hash = p_request_hash;
  return p_result;
end
$$;
revoke all on function app.results_idempotency_begin(text,text), app.results_idempotency_finish(text,text,jsonb) from public;
grant execute on function app.results_idempotency_begin(text,text), app.results_idempotency_finish(text,text,jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Result entry-sheet commands
-- ---------------------------------------------------------------------------
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
  if not (app.is_staff_aal2() and app.teacher_assignment_allowed(
      (select academic_year_id from public.exam_definitions where id = p_exam_definition_id),
      p_grade_section_id, p_subject_id)) then
    raise exception 'teacher role, aal2, and exact class/subject assignment required';
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
      select v_sheet.id, e.student_id, e.id,
             row_number() over (order by e.student_id)
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
  if not app.teacher_assignment_allowed(v_sheet.academic_year_id, v_sheet.grade_section_id, v_sheet.subject_id) then
    raise exception 'teacher role, aal2, and exact class/subject assignment required';
  end if;
  if v_sheet.state not in ('draft','returned') then raise exception 'entry sheet is not open for teacher editing'; end if;
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
  if not app.teacher_assignment_allowed(v_sheet.academic_year_id, v_sheet.grade_section_id, v_sheet.subject_id) then raise exception 'teacher role, aal2, and exact class/subject assignment required'; end if;
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

create or replace function app.results_entry_sheet_moderate(
  p_sheet_id uuid,
  p_outcome text,
  p_note text default null,
  p_expected_version int default 1,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_sheet public.result_entry_sheets%rowtype;
  v_hash text := md5(jsonb_build_object('sheet',p_sheet_id,'outcome',p_outcome,'note',p_note,'version',p_expected_version)::text);
  v_cached jsonb;
  v_version int;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['exam_reviewer'])) then raise exception 'exam reviewer role and aal2 required'; end if;
  if p_outcome not in ('approved','returned') then raise exception 'invalid moderation outcome'; end if;
  if p_outcome = 'returned' and (p_note is null or length(trim(p_note)) < 1) then raise exception 'return reason is required'; end if;
  select * into v_sheet from public.result_entry_sheets where id = p_sheet_id for update;
  if v_sheet.id is null then raise exception 'entry sheet not found'; end if;
  if not app.result_entry_sheet_scope(p_sheet_id, array['exam_reviewer']) then raise exception 'exam reviewer scope does not include this academic section/subject'; end if;
  if v_sheet.state <> 'submitted' then raise exception 'only submitted entry sheets can be moderated'; end if;
  if v_sheet.version <> p_expected_version then raise exception 'entry sheet version mismatch (expected %, found %)', p_expected_version, v_sheet.version; end if;
  if v_sheet.last_entry_by_account_id = auth.uid() then raise exception 'checker cannot moderate their own entry'; end if;
  if p_idempotency_key is not null then
    v_cached := app.results_idempotency_begin('sheet-moderate:' || p_sheet_id::text || ':' || p_idempotency_key, v_hash);
    if v_cached is not null then return v_cached; end if;
  end if;
  update public.result_entry_sheets set version = version + 1, state = p_outcome, moderated_by_account_id = auth.uid(), updated_at = now() where id = p_sheet_id returning version into v_version;
  insert into public.result_entry_sheet_versions(sheet_id, version, state, note, actor_account_id) values (p_sheet_id, v_version, p_outcome, p_note, auth.uid());
  v_result := jsonb_build_object('sheetId', p_sheet_id, 'reference', v_sheet.reference, 'version', v_version, 'state', p_outcome, 'status', p_outcome, 'note', p_note);
  if p_idempotency_key is not null then return app.results_idempotency_finish('sheet-moderate:' || p_sheet_id::text || ':' || p_idempotency_key, v_hash, v_result); end if;
  return v_result;
end
$$;

-- Copy the old manifest with one subject replaced by the corrected immutable
-- publication. Each copied item keeps its original snapshot and publication
-- version; only the new release header points at the corrected subject.
create or replace function app.results_supersede_releases_for_sheet(
  p_source_sheet_id uuid,
  p_new_publication_id uuid,
  p_new_sheet_id uuid,
  p_actor uuid
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_release public.result_report_releases%rowtype;
  v_old_item public.result_report_release_items%rowtype;
  v_new_item public.result_report_release_items%rowtype;
  v_new_release public.result_report_releases%rowtype;
  v_subject uuid;
  v_count int := 0;
begin
  select coalesce(res.subject_id, rb.subject_id) into v_subject
    from public.result_entry_sheets res
    left join public.result_batches rb on rb.id = res.legacy_batch_id
   where res.id = p_new_sheet_id;
  for v_release in
    select r.*
      from public.result_report_releases r
     where r.status = 'published'
       and exists (select 1 from public.result_report_release_items ri where ri.release_id = r.id and ri.entry_sheet_id = p_source_sheet_id)
     for update
  loop
    select ri.* into v_old_item
      from public.result_report_release_items ri
     where ri.release_id = v_release.id and ri.entry_sheet_id = p_source_sheet_id
     limit 1;
    update public.result_report_releases
       set status = 'superseded', superseded_at = now()
     where id = v_release.id;
    insert into public.result_report_releases
      (student_id, enrollment_id, academic_year_id, grade_section_id, term, release_version, status,
       supersedes_release_id, published_by_account_id)
    values (v_release.student_id, v_release.enrollment_id, v_release.academic_year_id, v_release.grade_section_id,
            v_release.term, v_release.release_version + 1, 'published', v_release.id, p_actor)
    returning * into v_new_release;
    insert into public.result_report_release_items
      (release_id, subject_id, publication_id, entry_sheet_id, publication_version, snapshot)
    select v_new_release.id, ri.subject_id, ri.publication_id, ri.entry_sheet_id, ri.publication_version, ri.snapshot
      from public.result_report_release_items ri
     where ri.release_id = v_release.id and ri.id <> v_old_item.id;
    insert into public.result_report_release_items
      (release_id, subject_id, publication_id, entry_sheet_id, publication_version, snapshot)
    select v_new_release.id, coalesce(res.subject_id, rb.subject_id), p_new_publication_id, p_new_sheet_id,
           rp.version, rpi.snapshot
      from public.result_publications rp
      join public.result_publication_items rpi on rpi.publication_id = rp.id and rpi.student_id = v_release.student_id
      left join public.result_entry_sheets res on res.id = rp.source_entry_sheet_id
      left join public.result_batches rb on rb.id = rp.batch_id
     where rp.id = p_new_publication_id;
    insert into public.result_report_release_events(release_id, event_type, actor_account_id, reason)
    values (v_new_release.id, 'superseded_correction', p_actor, 'Corrected subject publication superseded the prior report release');
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;

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

-- A report release is assembled from explicit publication IDs. The server
-- verifies every subject snapshot belongs to the requested active enrollment;
-- callers never submit or receive internal IDs in the browser adapter.
create or replace function app.results_report_release_publish(
  p_student_id uuid,
  p_enrollment_id uuid,
  p_academic_year_id uuid,
  p_term text,
  p_publication_ids jsonb,
  p_expected_version int default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_enrollment public.enrollments%rowtype;
  v_release public.result_report_releases%rowtype;
  v_hash text := md5(jsonb_build_object('student',p_student_id,'enrollment',p_enrollment_id,'year',p_academic_year_id,'term',p_term,'publications',p_publication_ids)::text);
  v_cached jsonb;
  v_count int;
  v_distinct int;
  v_previous_version int;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['result_publisher'])) then raise exception 'result publisher role and aal2 required'; end if;
  if jsonb_typeof(coalesce(p_publication_ids,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_publication_ids,'[]'::jsonb)) = 0 then raise exception 'at least one subject publication is required'; end if;
  if p_idempotency_key is not null then
    v_cached := app.results_idempotency_begin('release-publish:' || coalesce(p_idempotency_key,''), v_hash);
    if v_cached is not null then return v_cached; end if;
  end if;
  select * into v_enrollment from public.enrollments where id = p_enrollment_id and student_id = p_student_id and academic_year_id = p_academic_year_id and status = 'active';
  if v_enrollment.id is null then raise exception 'student enrollment is not active for this report release'; end if;
  select count(*), count(distinct coalesce(res.subject_id, rb.subject_id)) into v_count, v_distinct
    from jsonb_array_elements(coalesce(p_publication_ids,'[]'::jsonb)) value
    join public.result_publications rp on rp.id = coalesce(nullif(value ->> 'publicationId','')::uuid, nullif(value ->> 'id','')::uuid, trim(both '"' from value::text)::uuid) and rp.status <> 'withdrawn'
    join public.result_publication_items rpi on rpi.publication_id = rp.id and rpi.student_id = p_student_id
    left join public.result_entry_sheets res on res.id = rp.source_entry_sheet_id
    left join public.result_batches rb on rb.id = rp.batch_id
    join public.exam_definitions ed on ed.id = coalesce(res.exam_definition_id, rb.exam_definition_id)
   where ed.academic_year_id = p_academic_year_id and ed.term = p_term
     and app.result_publication_scope(rp.id, array['result_publisher']);
  if v_count <> jsonb_array_length(p_publication_ids) or v_distinct <> v_count then raise exception 'publication snapshots do not form a complete unique subject manifest'; end if;
  select coalesce(max(release_version),0) into v_previous_version from public.result_report_releases where student_id = p_student_id and academic_year_id = p_academic_year_id and term = p_term;
  if p_expected_version is not null and p_expected_version <> v_previous_version then raise exception 'report release version mismatch (expected %, found %)', p_expected_version, v_previous_version; end if;
  update public.result_report_releases set status = 'superseded', superseded_at = now() where student_id = p_student_id and academic_year_id = p_academic_year_id and term = p_term and status = 'published';
  insert into public.result_report_releases(student_id, enrollment_id, academic_year_id, grade_section_id, term, release_version, status, supersedes_release_id, published_by_account_id)
  values (p_student_id, p_enrollment_id, p_academic_year_id, v_enrollment.grade_section_id, p_term, v_previous_version + 1, 'published',
          (select id from public.result_report_releases where student_id = p_student_id and academic_year_id = p_academic_year_id and term = p_term and release_version = v_previous_version), auth.uid())
  returning * into v_release;
  insert into public.result_report_release_items(release_id, subject_id, publication_id, entry_sheet_id, publication_version, snapshot)
  select v_release.id, coalesce(res.subject_id, rb.subject_id), rp.id, rp.source_entry_sheet_id, rp.version, rpi.snapshot
    from jsonb_array_elements(coalesce(p_publication_ids,'[]'::jsonb)) value
    join public.result_publications rp on rp.id = coalesce(nullif(value ->> 'publicationId','')::uuid, nullif(value ->> 'id','')::uuid, trim(both '"' from value::text)::uuid) and rp.status <> 'withdrawn'
    join public.result_publication_items rpi on rpi.publication_id = rp.id and rpi.student_id = p_student_id
    left join public.result_entry_sheets res on res.id = rp.source_entry_sheet_id
    left join public.result_batches rb on rb.id = rp.batch_id;
  insert into public.result_report_release_events(release_id, event_type, actor_account_id) values (v_release.id, 'published', auth.uid());
  perform app.record_audit('Result report release published', 'result_report_release', v_release.reference, 'Success');
  perform app.enqueue_outbox('email.result_report_release:' || v_release.reference, 'email.deliver', 'result_report_release', v_release.reference, jsonb_build_object('channel','email'));
  v_result := jsonb_build_object('releaseId', v_release.id, 'releaseRef', v_release.reference, 'version', v_release.release_version, 'status', v_release.status, 'studentId', v_release.student_id, 'itemCount', v_count);
  if p_idempotency_key is not null then return app.results_idempotency_finish('release-publish:' || coalesce(p_idempotency_key,''), v_hash, v_result); end if;
  return v_result;
end
$$;

create or replace function app.results_request_correction(
  p_release_id uuid,
  p_publication_id uuid,
  p_reason text,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_release public.result_report_releases%rowtype;
  v_item public.result_report_release_items%rowtype;
  v_hash text := md5(jsonb_build_object('release',p_release_id,'publication',p_publication_id,'reason',trim(p_reason))::text);
  v_cached jsonb;
  v_request public.result_correction_requests%rowtype;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if p_reason is null or length(trim(p_reason)) < 1 then raise exception 'correction reason is required'; end if;
  select * into v_release from public.result_report_releases where id = p_release_id and status = 'published';
  if v_release.id is null then raise exception 'report release not found'; end if;
  if not (app.is_staff_aal2() and (app.result_report_release_scope(p_release_id, array['teacher']) or app.result_report_release_scope(p_release_id, array['result_publisher']))) then raise exception 'staff scope does not include this report release'; end if;
  select * into v_item from public.result_report_release_items where release_id = p_release_id and publication_id = p_publication_id;
  if v_item.id is null then raise exception 'publication is not part of the report release'; end if;
  if not (
    (v_item.entry_sheet_id is not null and app.teacher_assignment_allowed((select academic_year_id from public.result_entry_sheets where id = v_item.entry_sheet_id), (select grade_section_id from public.result_entry_sheets where id = v_item.entry_sheet_id), (select subject_id from public.result_entry_sheets where id = v_item.entry_sheet_id)))
    or (app.is_staff_aal2() and app.result_publication_scope(p_publication_id, array['result_publisher']))
  ) then raise exception 'correction requester is outside the entry sheet scope'; end if;
  if p_idempotency_key is not null then
    v_cached := app.results_idempotency_begin('correction-request:' || p_release_id::text || ':' || p_idempotency_key, v_hash);
    if v_cached is not null then return v_cached; end if;
  end if;
  select * into v_request from public.result_correction_requests where release_id = p_release_id and publication_id = p_publication_id and status = 'requested' order by created_at desc limit 1;
  if v_request.id is null then
    insert into public.result_correction_requests(publication_id, release_id, source_entry_sheet_id, requested_by_account_id, reason, status, version)
    values (p_publication_id, p_release_id, v_item.entry_sheet_id, auth.uid(), trim(p_reason), 'requested', 1) returning * into v_request;
    perform app.record_audit('Result correction requested', 'result_report_release', v_release.reference, 'Success', trim(p_reason));
  end if;
  v_result := jsonb_build_object('requestId', v_request.id, 'requestVersion', v_request.version, 'status', v_request.status, 'releaseRef', v_release.reference);
  if p_idempotency_key is not null then return app.results_idempotency_finish('correction-request:' || p_release_id::text || ':' || p_idempotency_key, v_hash, v_result); end if;
  return v_result;
end
$$;

create or replace function app.results_approve_correction(
  p_request_id uuid,
  p_expected_version int,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.result_correction_requests%rowtype;
  v_source public.result_entry_sheets%rowtype;
  v_new public.result_entry_sheets%rowtype;
  v_hash text := md5(p_request_id::text || ':' || p_expected_version::text);
  v_cached jsonb;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['exam_reviewer'])) then raise exception 'exam reviewer role and aal2 required'; end if;
  select * into v_request from public.result_correction_requests where id = p_request_id for update;
  if v_request.id is null then raise exception 'correction request not found'; end if;
  if v_request.version <> p_expected_version then raise exception 'correction request version mismatch (expected %, found %)', p_expected_version, v_request.version; end if;
  if v_request.status <> 'requested' then raise exception 'correction request is no longer pending'; end if;
  if v_request.requested_by_account_id = auth.uid() then raise exception 'checker cannot approve their own correction request'; end if;
  if p_idempotency_key is not null then
    v_cached := app.results_idempotency_begin('correction-approve:' || p_request_id::text || ':' || p_idempotency_key, v_hash);
    if v_cached is not null then return v_cached; end if;
  end if;
  select * into v_source from public.result_entry_sheets where id = v_request.source_entry_sheet_id;
  if v_source.id is null then raise exception 'source entry sheet not found'; end if;
  if not app.result_entry_sheet_scope(v_source.id, array['exam_reviewer']) then raise exception 'exam reviewer scope does not include this correction sheet'; end if;
  update public.result_correction_requests set status = 'approved', decided_by_account_id = auth.uid(), approved_at = now(), decided_at = now(), version = version + 1 where id = p_request_id;
  insert into public.result_entry_sheets(exam_definition_id, academic_year_id, grade_section_id, subject_id, source_sheet_id, correction_request_id, state, version, last_entry_by_account_id)
  values (v_source.exam_definition_id, v_source.academic_year_id, v_source.grade_section_id, v_source.subject_id, v_source.id, v_request.id, 'draft', 1, null)
  returning * into v_new;
  insert into public.result_entry_sheet_components(sheet_id, assessment_component_id, name, max_marks, weight, component_order)
    select v_new.id, rec.assessment_component_id, rec.name, rec.max_marks, rec.weight, rec.component_order from public.result_entry_sheet_components rec where rec.sheet_id = v_source.id;
  insert into public.result_entry_sheet_rosters(sheet_id, student_id, enrollment_id, roster_order, frozen_at)
    select v_new.id, rer.student_id, rer.enrollment_id, rer.roster_order, rer.frozen_at from public.result_entry_sheet_rosters rer where rer.sheet_id = v_source.id;
  insert into public.result_entry_sheet_marks(sheet_id, roster_id, component_id, obtained, mark_status, remark)
    select v_new.id, nrr.id, nrc.id, rem.obtained, rem.mark_status, rem.remark
      from public.result_entry_sheet_marks rem
      join public.result_entry_sheet_rosters orr on orr.id = rem.roster_id
      join public.result_entry_sheet_components orec on orec.id = rem.component_id
      join public.result_entry_sheet_rosters nrr on nrr.sheet_id = v_new.id and nrr.student_id = orr.student_id
      join public.result_entry_sheet_components nrc on nrc.sheet_id = v_new.id and nrc.assessment_component_id = orec.assessment_component_id
     where rem.sheet_id = v_source.id;
  insert into public.result_entry_sheet_versions(sheet_id, version, state, note, actor_account_id) values (v_new.id, 1, 'draft', v_request.reason, auth.uid());
  update public.result_correction_requests set new_entry_sheet_id = v_new.id where id = v_request.id;
  perform app.record_audit('Result correction approved', 'result_correction_request', v_request.id::text, 'Success');
  v_result := jsonb_build_object('requestId', v_request.id, 'requestVersion', p_expected_version + 1, 'status', 'approved', 'sheetId', v_new.id, 'sheetRef', v_new.reference, 'sheetVersion', v_new.version);
  if p_idempotency_key is not null then return app.results_idempotency_finish('correction-approve:' || p_request_id::text || ':' || p_idempotency_key, v_hash, v_result); end if;
  return v_result;
end
$$;

-- Compatibility aliases make the transition explicit to older callers while
-- keeping the new model as the authoritative command path.
create or replace function app.results_correction_request_v2(p_release_id uuid, p_publication_id uuid, p_reason text, p_idempotency_key text default null)
returns jsonb language sql security definer set search_path = '' as $$ select app.results_request_correction($1,$2,$3,$4) $$;
create or replace function app.results_correction_approve_v2(p_request_id uuid, p_expected_version int, p_idempotency_key text default null)
returns jsonb language sql security definer set search_path = '' as $$ select app.results_approve_correction($1,$2,$3) $$;

-- ---------------------------------------------------------------------------
-- Timetable durable draft and conflict rules
-- ---------------------------------------------------------------------------
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
    v_room := nullif(v_period ->> 'roomId','')::uuid;
    if v_day is null or v_number is null or v_day < 1 or v_day > 7 or v_number < 1 then raise exception 'period day and number are required'; end if;
    if v_starts is null or v_ends is null or v_ends <= v_starts then raise exception 'period start and end times are invalid'; end if;
    -- Keep the legacy validator's empty placeholder rows importable. Once a
    -- subject/teacher/room is supplied, the effective period definition is
    -- authoritative and the exact time window is enforced.
    if not (v_subject is null and v_teacher is null and v_room is null)
       and not exists (select 1 from public.period_definitions pd where pd.academic_year_id = v_academic_year and pd.day_of_week = v_day and pd.period_number = v_number and pd.starts_at = v_starts and pd.ends_at = v_ends) then
      raise exception 'period/time is outside the effective period definitions';
    end if;
    if v_subject is not null and not exists (select 1 from public.subjects where id = v_subject) then raise exception 'subject not found'; end if;
    if v_teacher is not null and not exists (select 1 from public.staff_assignments sa where sa.id = v_teacher and sa.status = 'active' and sa.academic_year_id = v_academic_year and sa.grade_section_id = p_grade_section_id and (v_subject is null or sa.subject_id = v_subject) and sa.effective_from <= now() and (sa.effective_to is null or sa.effective_to > now())) then raise exception 'teacher assignment is outside the selected class/subject scope'; end if;
    if v_room is not null and not exists (select 1 from public.rooms where id = v_room) then raise exception 'room not found'; end if;
    if v_teacher is not null and exists (
      select 1 from public.timetable_periods tp join public.timetable_versions tv on tv.id = tp.timetable_version_id
       where tv.id <> v_version.id and tv.grade_section_id <> p_grade_section_id and tv.status in ('published','draft')
         and tp.day_of_week = v_day and tp.period_number = v_number and tp.teacher_assignment_id = v_teacher
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
    insert into public.timetable_periods(timetable_version_id, day_of_week, period_number, starts_at, ends_at, subject_id, teacher_assignment_id, room_id, kind)
    values (v_version.id, v_day, v_number, v_starts, v_ends, v_subject, v_teacher, v_room, coalesce(v_period ->> 'kind','class'));
  end loop;
  update public.timetable_versions set revision = revision + 1, updated_at = now() where id = v_version.id returning revision into v_revision;
  return jsonb_build_object('versionId', v_version.id, 'reference', v_version.reference, 'version', v_version.version, 'revision', v_revision, 'status', 'draft', 'updatedAt', now());
end
$$;

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
      select jsonb_build_object('kind','teacher','day',tp.day_of_week,'period',tp.period_number,'message','teacher conflict') as conflict, 'teacher' as kind, tp.day_of_week as day_no, tp.period_number as period_no
        from public.timetable_periods tp join public.timetable_versions tv on tv.id = tp.timetable_version_id
       where tv.id <> p_version_id and tv.grade_section_id <> v_version.grade_section_id and tv.status in ('published','draft')
         and exists (select 1 from public.timetable_periods x where x.timetable_version_id = p_version_id and x.day_of_week = tp.day_of_week and x.period_number = tp.period_number and x.teacher_assignment_id = tp.teacher_assignment_id and tp.teacher_assignment_id is not null)
      union all
      select jsonb_build_object('kind','room','day',tp.day_of_week,'period',tp.period_number,'message','room conflict') as conflict, 'room' as kind, tp.day_of_week as day_no, tp.period_number as period_no
        from public.timetable_periods tp join public.timetable_versions tv on tv.id = tp.timetable_version_id
       where tv.id <> p_version_id and tv.grade_section_id <> v_version.grade_section_id and tv.status in ('published','draft')
         and exists (select 1 from public.timetable_periods x where x.timetable_version_id = p_version_id and x.day_of_week = tp.day_of_week and x.period_number = tp.period_number and x.room_id = tp.room_id and tp.room_id is not null)
    ) conflicts;
  return jsonb_build_object('valid', jsonb_array_length(v_conflicts) = 0, 'conflicts', v_conflicts, 'versionId', p_version_id, 'revision', v_version.revision);
end
$$;

create or replace function app.timetable_publish_version(p_version_id uuid, p_note text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_version public.timetable_versions%rowtype;
  v_publication public.timetable_publications%rowtype;
  v_validation jsonb;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['timetable_manager'])) then raise exception 'timetable manager role and aal2 required'; end if;
  select * into v_version from public.timetable_versions where id = p_version_id for update;
  if v_version.id is null or v_version.status <> 'draft' then raise exception 'only draft timetables can be published'; end if;
  if not app.staff_scope_allowed(array['timetable_manager'], (select academic_year_id from public.grade_sections where id = v_version.grade_section_id), v_version.grade_section_id, null) then raise exception 'timetable manager scope does not include this academic section'; end if;
  v_validation := app.timetable_validate_draft(p_version_id);
  if coalesce((v_validation ->> 'valid')::boolean,false) = false then raise exception 'timetable has hard conflicts'; end if;
  update public.timetable_versions set status = 'superseded', updated_at = now() where grade_section_id = v_version.grade_section_id and status = 'published';
  insert into public.timetable_publications(timetable_version_id, published_by_account_id, note) values (p_version_id, auth.uid(), nullif(trim(p_note),'')) returning * into v_publication;
  update public.timetable_versions set status = 'published', updated_at = now() where id = p_version_id;
  perform app.record_audit('Timetable published', 'timetable_publication', v_publication.reference, 'Success');
  perform app.enqueue_outbox('email.timetable_published:' || v_publication.reference, 'email.deliver', 'timetable_publication', v_publication.reference, jsonb_build_object('channel','email'));
  return v_publication.reference;
end
$$;

create or replace function app.exam_schedule_save_draft(
  p_grade_section_id uuid,
  p_entries jsonb,
  p_version_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_version public.exam_schedule_versions%rowtype;
  v_existing public.exam_schedule_versions%rowtype;
  v_entry jsonb;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['timetable_manager'])) then raise exception 'timetable manager role and aal2 required'; end if;
  if not app.staff_scope_allowed(array['timetable_manager'], (select academic_year_id from public.grade_sections where id = p_grade_section_id), p_grade_section_id, null) then raise exception 'timetable manager scope does not include this academic section'; end if;
  if jsonb_typeof(coalesce(p_entries,'[]'::jsonb)) <> 'array' then raise exception 'date-sheet entries must be an array'; end if;
  if p_version_id is null then
    select * into v_existing from public.exam_schedule_versions where grade_section_id = p_grade_section_id and status = 'draft' for update;
    if v_existing.id is null then
      insert into public.exam_schedule_versions(grade_section_id, version, status) values (p_grade_section_id, coalesce((select max(version)+1 from public.exam_schedule_versions where grade_section_id = p_grade_section_id),1), 'draft') returning * into v_version;
    else v_version := v_existing; end if;
  else
    select * into v_version from public.exam_schedule_versions where id = p_version_id and status = 'draft' for update;
    if v_version.id is null then raise exception 'exam schedule draft not found'; end if;
  end if;
  delete from public.exam_schedule_entries where schedule_version_id = v_version.id;
  for v_entry in select * from jsonb_array_elements(coalesce(p_entries,'[]'::jsonb)) loop
    if (v_entry ->> 'startsAt')::time >= (v_entry ->> 'endsAt')::time then raise exception 'exam date-sheet time is invalid'; end if;
    if exists (select 1 from public.exam_schedule_entries ese where ese.schedule_version_id = v_version.id and ese.exam_date = (v_entry ->> 'examDate')::date and ese.starts_at = (v_entry ->> 'startsAt')::time) then raise exception 'duplicate exam cohort slot'; end if;
    insert into public.exam_schedule_entries(schedule_version_id, exam_date, subject_id, room_id, starts_at, ends_at)
    values (v_version.id, (v_entry ->> 'examDate')::date, (v_entry ->> 'subjectId')::uuid, nullif(v_entry ->> 'roomId','')::uuid, (v_entry ->> 'startsAt')::time, (v_entry ->> 'endsAt')::time);
  end loop;
  return jsonb_build_object('versionId', v_version.id, 'reference', v_version.reference, 'version', v_version.version, 'status', 'draft');
end
$$;

create or replace function app.exam_schedule_publish(p_version_id uuid, p_note text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_version public.exam_schedule_versions%rowtype; v_count int;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['timetable_manager'])) then raise exception 'timetable manager role and aal2 required'; end if;
  select * into v_version from public.exam_schedule_versions where id = p_version_id and status = 'draft' for update;
  if v_version.id is null then raise exception 'exam schedule draft not found'; end if;
  if not app.staff_scope_allowed(array['timetable_manager'], (select academic_year_id from public.grade_sections where id = v_version.grade_section_id), v_version.grade_section_id, null) then raise exception 'timetable manager scope does not include this academic section'; end if;
  select count(*) into v_count from public.exam_schedule_entries where schedule_version_id = p_version_id;
  if v_count = 0 then raise exception 'exam date sheet has no entries'; end if;
  update public.exam_schedule_versions set status = 'superseded' where grade_section_id = v_version.grade_section_id and status = 'published';
  update public.exam_schedule_versions set status = 'published' where id = p_version_id;
  perform app.record_audit('Exam date sheet published', 'exam_schedule_version', v_version.reference, 'Success', p_note);
  perform app.enqueue_outbox('email.exam_date_sheet:' || v_version.reference, 'email.deliver', 'exam_schedule_version', v_version.reference, jsonb_build_object('channel','email'));
  return v_version.reference;
end
$$;

create or replace function app.timetable_save_override(
  p_grade_section_id uuid, p_override_date date, p_day_of_week int, p_period_number int,
  p_kind text, p_subject_id uuid default null, p_room_id uuid default null,
  p_substitute_teacher_assignment_id uuid default null, p_note text default null
) returns text
language plpgsql security definer set search_path = '' as $$
declare v_override public.timetable_overrides%rowtype; v_year uuid;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['timetable_manager'])) then raise exception 'timetable manager role and aal2 required'; end if;
  if p_kind not in ('substitute','room_change','cancellation','special') then raise exception 'invalid timetable override'; end if;
  select academic_year_id into v_year from public.grade_sections where id = p_grade_section_id;
  if v_year is null then raise exception 'grade section not found'; end if;
  if not app.staff_scope_allowed(array['timetable_manager'], v_year, p_grade_section_id, null) then raise exception 'timetable manager scope does not include this academic section'; end if;
  if p_override_date is null or p_day_of_week not between 1 and 7 or p_period_number < 1 then raise exception 'override date and slot are required'; end if;
  if not exists (select 1 from public.period_definitions pd where pd.academic_year_id = v_year and pd.day_of_week = p_day_of_week and pd.period_number = p_period_number) then raise exception 'override slot is outside the effective period definitions'; end if;
  if p_subject_id is not null and not exists (select 1 from public.subjects where id = p_subject_id) then raise exception 'override subject not found'; end if;
  if p_room_id is not null and not exists (select 1 from public.rooms where id = p_room_id) then raise exception 'override room not found'; end if;
  if p_substitute_teacher_assignment_id is not null and not exists (select 1 from public.staff_assignments sa where sa.id = p_substitute_teacher_assignment_id and sa.status = 'active' and sa.academic_year_id = v_year and sa.grade_section_id = p_grade_section_id and (p_subject_id is null or sa.subject_id = p_subject_id)) then raise exception 'substitute teacher assignment is outside the section/subject scope'; end if;
  insert into public.timetable_overrides(grade_section_id, override_date, day_of_week, period_number, kind, subject_id, room_id, substitute_teacher_assignment_id, note)
  values (p_grade_section_id, p_override_date, p_day_of_week, p_period_number, p_kind, p_subject_id, p_room_id, p_substitute_teacher_assignment_id, nullif(trim(p_note),''))
  on conflict (grade_section_id, override_date, period_number) do update
    set kind = excluded.kind, subject_id = excluded.subject_id, room_id = excluded.room_id,
        substitute_teacher_assignment_id = excluded.substitute_teacher_assignment_id, note = excluded.note
  returning * into v_override;
  perform app.record_audit('Timetable override saved', 'timetable_override', v_override.reference, 'Success', p_note);
  perform app.enqueue_outbox('email.timetable_override:' || v_override.reference, 'email.deliver', 'timetable_override', v_override.reference, jsonb_build_object('channel','email'));
  return v_override.reference;
end
$$;

-- Server-side JSON projections keep staff detail/portal reads on the same
-- authoritative model without exposing database row types to browser code.
create or replace function app.results_entry_sheet_list()
returns setof jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', res.id, 'reference', res.reference, 'examDefinitionId', res.exam_definition_id,
    'academicYearId', res.academic_year_id, 'gradeSectionId', res.grade_section_id,
    'subjectId', res.subject_id, 'state', res.state, 'version', res.version,
    'examTerm', ed.term, 'gradeLabel', g.label, 'sectionLabel', gs.section_label,
    'subjectName', s.name, 'updatedAt', res.updated_at,
    'components', coalesce((select jsonb_agg(jsonb_build_object('id', rec.id, 'reference', rec.reference, 'name', rec.name, 'maxMarks', rec.max_marks, 'weight', rec.weight, 'order', rec.component_order) order by rec.component_order, rec.id) from public.result_entry_sheet_components rec where rec.sheet_id = res.id), '[]'::jsonb),
    'roster', coalesce((select jsonb_agg(jsonb_build_object('id', rer.id, 'reference', rer.reference, 'studentId', rer.student_id, 'enrollmentId', rer.enrollment_id, 'studentName', p.display_name, 'order', rer.roster_order, 'marks', coalesce((select jsonb_agg(jsonb_build_object('id', rem.id, 'componentId', rem.component_id, 'obtained', rem.obtained, 'markStatus', rem.mark_status, 'remark', rem.remark) order by rem.component_id) from public.result_entry_sheet_marks rem where rem.sheet_id = res.id and rem.roster_id = rer.id), '[]'::jsonb)) order by rer.roster_order, rer.id) from public.result_entry_sheet_rosters rer join public.students st on st.id = rer.student_id join public.people p on p.id = st.person_id where rer.sheet_id = res.id), '[]'::jsonb)
  )
    from public.result_entry_sheets res
    join public.exam_definitions ed on ed.id = res.exam_definition_id
    join public.grade_sections gs on gs.id = res.grade_section_id
    join public.grades g on g.id = gs.grade_id
    join public.subjects s on s.id = res.subject_id
   where app.result_entry_sheet_scope(res.id, array['teacher','exam_reviewer','result_publisher','auditor'])
   order by res.updated_at desc, res.id;
$$;

create or replace function app.results_entry_sheet_get(p_sheet_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select value from app.results_entry_sheet_list() value where (value ->> 'id')::uuid = p_sheet_id limit 1
$$;

create or replace function app.results_entry_sheet_versions_list(p_sheet_id uuid)
returns setof jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('id', rev.id, 'sheetId', rev.sheet_id, 'version', rev.version, 'state', rev.state, 'note', rev.note, 'createdAt', rev.created_at, 'actorAccountId', rev.actor_account_id)
    from public.result_entry_sheet_versions rev
   where rev.sheet_id = p_sheet_id
     and app.result_entry_sheet_scope(rev.sheet_id, array['teacher','exam_reviewer','result_publisher','auditor'])
   order by rev.version desc;
$$;

create or replace function app.results_report_release_list(p_student_id uuid default null)
returns setof jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'reference', r.reference, 'studentId', r.student_id, 'enrollmentId', r.enrollment_id,
    'academicYearId', r.academic_year_id, 'gradeSectionId', r.grade_section_id, 'term', r.term,
    'version', r.release_version, 'status', r.status, 'publishedAt', r.published_at,
    'supersedesReleaseId', r.supersedes_release_id,
    'items', coalesce((select jsonb_agg(jsonb_build_object('subjectId', ri.subject_id, 'publicationId', ri.publication_id, 'entrySheetId', ri.entry_sheet_id, 'publicationVersion', ri.publication_version, 'snapshot', ri.snapshot) order by ri.subject_id) from public.result_report_release_items ri where ri.release_id = r.id), '[]'::jsonb)
  )
    from public.result_report_releases r
   where (p_student_id is null or r.student_id = p_student_id)
     and app.result_report_release_scope(r.id, array['exam_reviewer','result_publisher','auditor'])
   order by r.published_at desc, r.release_version desc;
$$;

create or replace function app.results_report_release_get(p_release_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select value from app.results_report_release_list(null) value where (value ->> 'id')::uuid = p_release_id limit 1
$$;

revoke all on function app.results_entry_sheet_list(), app.results_entry_sheet_get(uuid), app.results_entry_sheet_versions_list(uuid), app.results_report_release_list(uuid), app.results_report_release_get(uuid) from public;
grant execute on function app.results_entry_sheet_list(), app.results_entry_sheet_get(uuid), app.results_entry_sheet_versions_list(uuid), app.results_report_release_list(uuid), app.results_report_release_get(uuid) to authenticated;

revoke all on function app.results_entry_sheet_create(uuid,uuid,uuid,text), app.results_entry_sheet_save_draft(uuid,jsonb,int,text), app.results_entry_sheet_submit(uuid,int,text), app.results_entry_sheet_moderate(uuid,text,text,int,text), app.results_entry_sheet_publish(uuid,int,text), app.results_report_release_publish(uuid,uuid,uuid,text,jsonb,int,text), app.results_request_correction(uuid,uuid,text,text), app.results_approve_correction(uuid,int,text), app.results_correction_request_v2(uuid,uuid,text,text), app.results_correction_approve_v2(uuid,int,text), app.timetable_save_draft(uuid,uuid,jsonb,int), app.timetable_validate_draft(uuid), app.timetable_publish_version(uuid,text), app.exam_schedule_save_draft(uuid,jsonb,uuid), app.exam_schedule_publish(uuid,text) from public;
grant execute on function app.results_entry_sheet_create(uuid,uuid,uuid,text), app.results_entry_sheet_save_draft(uuid,jsonb,int,text), app.results_entry_sheet_submit(uuid,int,text), app.results_entry_sheet_moderate(uuid,text,text,int,text), app.results_entry_sheet_publish(uuid,int,text), app.results_report_release_publish(uuid,uuid,uuid,text,jsonb,int,text), app.results_request_correction(uuid,uuid,text,text), app.results_approve_correction(uuid,int,text), app.results_correction_request_v2(uuid,uuid,text,text), app.results_correction_approve_v2(uuid,int,text), app.timetable_save_draft(uuid,uuid,jsonb,int), app.timetable_validate_draft(uuid), app.timetable_publish_version(uuid,text), app.exam_schedule_save_draft(uuid,jsonb,uuid), app.exam_schedule_publish(uuid,text) to authenticated;


commit;
