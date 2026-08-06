-- =============================================================================
-- B5 — Results and timetables (plan.md §6 modules, §11 B5)
--
-- Publication copies the approved batch into immutable per-student snapshots
-- transactionally (domain RPC). The portal reads only result_publication_items.
-- Corrections create a new batch/publication version and preserve the old one.
-- Timetable publication locks the draft, validates conflicts, creates the
-- immutable publication, and appends audit + outbox rows in one transaction.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Results
-- ---------------------------------------------------------------------------
create table public.exam_definitions (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('EXM'),
  academic_year_id  uuid not null references public.academic_years(id) on delete restrict,
  grade_section_id  uuid not null references public.grade_sections(id) on delete restrict,
  term              text not null,
  policy_version    int,
  status            text not null default 'planned'
                    check (status in ('planned', 'open', 'closed')),
  created_at        timestamptz not null default now(),
  unique (academic_year_id, grade_section_id, term)
);

create table public.assessment_components (
  id                uuid primary key default gen_random_uuid(),
  exam_definition_id uuid not null references public.exam_definitions(id) on delete cascade,
  subject_id        uuid not null references public.subjects(id) on delete restrict,
  name              text not null,
  max_marks         numeric not null check (max_marks > 0),
  weight            numeric,
  sort_order        int not null default 0,
  unique (exam_definition_id, subject_id)
);

create table public.grade_band_versions (
  id                uuid primary key default gen_random_uuid(),
  version           int not null,
  status            text not null default 'draft'
                    check (status in ('draft', 'approved', 'superseded')),
  bands             jsonb not null default '{}'::jsonb,   -- grading configuration (policy data)
  created_at        timestamptz not null default now(),
  unique (version)
);

create table public.result_batches (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('RB'),
  exam_definition_id uuid not null references public.exam_definitions(id) on delete restrict,
  grade_section_id  uuid not null references public.grade_sections(id) on delete restrict,
  subject_id        uuid not null references public.subjects(id) on delete restrict,
  status            text not null default 'draft'
                    check (status in ('draft', 'submitted', 'moderation', 'returned',
                                      'approved', 'published', 'withdrawn')),
  version           int not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index result_batches_scope_idx on public.result_batches (grade_section_id, subject_id, status);
create trigger result_batches_touch before update on public.result_batches
  for each row execute function app.touch_updated_at();

-- Frozen eligible enrollment/student roster per batch.
create table public.result_rosters (
  id                uuid primary key default gen_random_uuid(),
  batch_id          uuid not null references public.result_batches(id) on delete cascade,
  student_id        uuid not null references public.students(id) on delete restrict,
  enrollment_id     uuid not null references public.enrollments(id) on delete restrict,
  frozen_at         timestamptz not null default now(),
  unique (batch_id, student_id)
);

create index result_rosters_batch_idx on public.result_rosters (batch_id);

-- Immutable submitted, returned, approved, and correction versions.
create table public.result_batch_versions (
  id                uuid primary key default gen_random_uuid(),
  batch_id          uuid not null references public.result_batches(id) on delete cascade,
  version           int not null,
  status            text not null,
  note              text,
  created_by_account_id uuid not null references public.user_accounts(id) on delete restrict,
  created_at        timestamptz not null default now(),
  unique (batch_id, version)
);

create trigger result_batch_versions_no_update
  before update on public.result_batch_versions
  for each row execute function app.block_mutation();
create trigger result_batch_versions_no_delete
  before delete on public.result_batch_versions
  for each row execute function app.block_mutation();

create table public.mark_entries (
  id                uuid primary key default gen_random_uuid(),
  batch_id          uuid not null references public.result_batches(id) on delete cascade,
  roster_id         uuid not null references public.result_rosters(id) on delete cascade,
  component_id      uuid not null references public.assessment_components(id) on delete restrict,
  obtained          numeric,
  absent            boolean not null default false,
  remark            text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (batch_id, roster_id, component_id),
  check (obtained is null or obtained >= 0)
);

create index mark_entries_batch_idx on public.mark_entries (batch_id);
create trigger mark_entries_touch before update on public.mark_entries
  for each row execute function app.touch_updated_at();

create table public.result_publications (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('PUB'),
  batch_id          uuid not null references public.result_batches(id) on delete restrict,
  version           int not null,
  status            text not null default 'final'
                    check (status in ('final', 'provisional', 'withdrawn')),
  published_at      timestamptz not null default now(),
  published_by_account_id uuid not null references public.user_accounts(id) on delete restrict,
  withdrawn_at      timestamptz,
  withdrawal_reason text,
  created_at        timestamptz not null default now(),
  unique (batch_id, version)
);

create index result_publications_batch_idx on public.result_publications (batch_id, version desc);

-- Exact per-student snapshot shown in the portal (immutable).
create table public.result_publication_items (
  id                uuid primary key default gen_random_uuid(),
  publication_id    uuid not null references public.result_publications(id) on delete cascade,
  student_id        uuid not null references public.students(id) on delete restrict,
  snapshot          jsonb not null,
  created_at        timestamptz not null default now(),
  unique (publication_id, student_id)
);

create index publication_items_student_idx on public.result_publication_items (student_id);
create trigger publication_items_no_update
  before update on public.result_publication_items
  for each row execute function app.block_mutation();
create trigger publication_items_no_delete
  before delete on public.result_publication_items
  for each row execute function app.block_mutation();

create table public.result_correction_requests (
  id                uuid primary key default gen_random_uuid(),
  publication_id    uuid not null references public.result_publications(id) on delete cascade,
  requested_by_account_id uuid not null references public.user_accounts(id) on delete restrict,
  reason            text not null,
  status            text not null default 'requested'
                    check (status in ('requested', 'approved', 'rejected')),
  decided_by_account_id uuid references public.user_accounts(id) on delete restrict,
  decided_at        timestamptz,
  created_at        timestamptz not null default now()
);

create table public.result_events (
  id                uuid primary key default gen_random_uuid(),
  batch_id          uuid not null references public.result_batches(id) on delete cascade,
  event_type        text not null,
  visible_to_family boolean not null default true,
  copy              text not null,
  created_at        timestamptz not null default now()
);

create index result_events_batch_idx on public.result_events (batch_id, created_at desc);
create trigger result_events_no_update
  before update on public.result_events
  for each row execute function app.block_mutation();
create trigger result_events_no_delete
  before delete on public.result_events
  for each row execute function app.block_mutation();

-- ---------------------------------------------------------------------------
-- Timetables and exam date sheets
-- ---------------------------------------------------------------------------
create table public.timetable_versions (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('TTV'),
  grade_section_id  uuid not null references public.grade_sections(id) on delete restrict,
  status            text not null default 'draft'
                    check (status in ('draft', 'published', 'superseded')),
  version           int not null default 1,
  effective_from    date,
  effective_to      date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (grade_section_id, version)
);

create index timetable_versions_section_idx on public.timetable_versions (grade_section_id, status);
create trigger timetable_versions_touch before update on public.timetable_versions
  for each row execute function app.touch_updated_at();

create table public.timetable_periods (
  id                uuid primary key default gen_random_uuid(),
  timetable_version_id uuid not null references public.timetable_versions(id) on delete cascade,
  day_of_week       int not null check (day_of_week between 1 and 7),
  period_number     int not null check (period_number > 0),
  starts_at         time not null,
  ends_at           time not null,
  subject_id        uuid references public.subjects(id) on delete restrict,
  teacher_assignment_id uuid references public.staff_assignments(id) on delete restrict,
  room_id           uuid references public.rooms(id) on delete restrict,
  kind              text not null default 'class' check (kind in ('class', 'assembly', 'break', 'special')),
  unique (timetable_version_id, day_of_week, period_number)
);

create index timetable_periods_version_idx on public.timetable_periods (timetable_version_id);

create table public.timetable_publications (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('TTP'),
  timetable_version_id uuid not null unique references public.timetable_versions(id) on delete restrict,
  published_at      timestamptz not null default now(),
  published_by_account_id uuid not null references public.user_accounts(id) on delete restrict,
  note              text
);

create table public.timetable_overrides (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('TTO'),
  grade_section_id  uuid not null references public.grade_sections(id) on delete restrict,
  override_date     date not null,
  day_of_week       int not null check (day_of_week between 1 and 7),
  period_number     int not null check (period_number > 0),
  kind              text not null
                    check (kind in ('substitute', 'room_change', 'cancellation', 'special')),
  substitute_teacher_assignment_id uuid references public.staff_assignments(id) on delete restrict,
  room_id           uuid references public.rooms(id) on delete restrict,
  subject_id        uuid references public.subjects(id) on delete restrict,
  note              text,
  created_at        timestamptz not null default now(),
  unique (grade_section_id, override_date, period_number)
);

create index timetable_overrides_section_idx on public.timetable_overrides (grade_section_id, override_date);

create table public.exam_schedule_versions (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('ESV'),
  grade_section_id  uuid not null references public.grade_sections(id) on delete restrict,
  version           int not null default 1,
  status            text not null default 'draft'
                    check (status in ('draft', 'published', 'superseded')),
  created_at        timestamptz not null default now(),
  unique (grade_section_id, version)
);

create table public.exam_schedule_entries (
  id                uuid primary key default gen_random_uuid(),
  schedule_version_id uuid not null references public.exam_schedule_versions(id) on delete cascade,
  exam_date         date not null,
  subject_id        uuid not null references public.subjects(id) on delete restrict,
  room_id           uuid references public.rooms(id) on delete restrict,
  starts_at         time not null,
  ends_at           time not null,
  check (ends_at > starts_at)
);

create index exam_schedule_entries_version_idx on public.exam_schedule_entries (schedule_version_id);

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table public.exam_definitions          enable row level security;
alter table public.assessment_components     enable row level security;
alter table public.grade_band_versions       enable row level security;
alter table public.result_batches            enable row level security;
alter table public.result_rosters            enable row level security;
alter table public.result_batch_versions     enable row level security;
alter table public.mark_entries              enable row level security;
alter table public.result_publications       enable row level security;
alter table public.result_publication_items  enable row level security;
alter table public.result_correction_requests enable row level security;
alter table public.result_events             enable row level security;
alter table public.timetable_versions        enable row level security;
alter table public.timetable_periods         enable row level security;
alter table public.timetable_publications    enable row level security;
alter table public.timetable_overrides       enable row level security;
alter table public.exam_schedule_versions    enable row level security;
alter table public.exam_schedule_entries     enable row level security;

revoke all on public.exam_definitions, public.assessment_components, public.grade_band_versions,
           public.result_batches, public.result_rosters, public.result_batch_versions,
           public.mark_entries, public.result_publications, public.result_publication_items,
           public.result_correction_requests, public.result_events, public.timetable_versions,
           public.timetable_periods, public.timetable_publications, public.timetable_overrides,
           public.exam_schedule_versions, public.exam_schedule_entries
  from anon, authenticated;

-- Guardians read only the published per-student snapshots of their ACTIVE
-- linked children (portal rule: result_publication_items only), plus the
-- publication headers for context. Withdrawn publications are excluded.
-- The withdrawn check goes through a SECURITY DEFINER helper so the two
-- guardian policies do not reference each other (policy recursion guard).
create or replace function app.active_publication_ids()
returns uuid[]
language sql
security definer
set search_path = ''
as $$
  select array(select id from public.result_publications where status <> 'withdrawn')
$$;
revoke all on function app.active_publication_ids() from public;
grant execute on function app.active_publication_ids() to authenticated;

create policy guardian_read_publication_items on public.result_publication_items
  for select to authenticated
  using (
    app.is_guardian()
    and publication_id = any(app.active_publication_ids())
    and student_id in (
      select l.student_id
        from public.guardian_student_links l
        join public.guardians g on g.id = l.guardian_id
        join public.user_accounts ua on ua.person_id = g.person_id
       where ua.id = auth.uid() and l.status = 'active'
    )
  );
create policy guardian_read_publications on public.result_publications
  for select to authenticated
  using (
    app.is_guardian()
    and status <> 'withdrawn'
    and id in (
      select pi.publication_id from public.result_publication_items pi
       where pi.student_id in (
         select l.student_id
           from public.guardian_student_links l
           join public.guardians g on g.id = l.guardian_id
           join public.user_accounts ua on ua.person_id = g.person_id
          where ua.id = auth.uid() and l.status = 'active'
       )
    )
  );

-- Teachers: batches for their exact active assignments (year/class/subject).
create policy teacher_read_batches on public.result_batches
  for select to authenticated
  using (
    app.is_staff_aal2()
    and grade_section_id in (
      select sa.grade_section_id
        from public.staff_assignments sa
        join public.staff_members sm on sm.id = sa.staff_member_id
        join public.user_accounts ua on ua.person_id = sm.person_id
       where ua.id = auth.uid()
         and sa.status = 'active'
         and sa.effective_from <= now()
         and (sa.effective_to is null or sa.effective_to > now())
    )
    and subject_id in (
      select sa.subject_id
        from public.staff_assignments sa
        join public.staff_members sm on sm.id = sa.staff_member_id
        join public.user_accounts ua on ua.person_id = sm.person_id
       where ua.id = auth.uid()
         and sa.status = 'active'
    )
  );
create policy teacher_read_rosters on public.result_rosters
  for select to authenticated
  using (batch_id in (select id from public.result_batches
         where app.is_staff_aal2() and grade_section_id in (
           select sa.grade_section_id from public.staff_assignments sa
             join public.staff_members sm on sm.id = sa.staff_member_id
             join public.user_accounts ua on ua.person_id = sm.person_id
            where ua.id = auth.uid() and sa.status = 'active')));
create policy teacher_read_mark_entries on public.mark_entries
  for select to authenticated
  using (batch_id in (select id from public.result_batches
         where app.is_staff_aal2() and grade_section_id in (
           select sa.grade_section_id from public.staff_assignments sa
             join public.staff_members sm on sm.id = sa.staff_member_id
             join public.user_accounts ua on ua.person_id = sm.person_id
            where ua.id = auth.uid() and sa.status = 'active')));
create policy teacher_write_mark_entries on public.mark_entries
  for insert to authenticated
  with check (batch_id in (select id from public.result_batches
         where app.is_staff_aal2() and grade_section_id in (
           select sa.grade_section_id from public.staff_assignments sa
             join public.staff_members sm on sm.id = sa.staff_member_id
             join public.user_accounts ua on ua.person_id = sm.person_id
            where ua.id = auth.uid() and sa.status = 'active')));
create policy teacher_update_mark_entries on public.mark_entries
  for update to authenticated
  using (batch_id in (select id from public.result_batches
         where app.is_staff_aal2() and grade_section_id in (
           select sa.grade_section_id from public.staff_assignments sa
             join public.staff_members sm on sm.id = sa.staff_member_id
             join public.user_accounts ua on ua.person_id = sm.person_id
            where ua.id = auth.uid() and sa.status = 'active')))
  with check (batch_id in (select id from public.result_batches
         where app.is_staff_aal2() and grade_section_id in (
           select sa.grade_section_id from public.staff_assignments sa
             join public.staff_members sm on sm.id = sa.staff_member_id
             join public.user_accounts ua on ua.person_id = sm.person_id
            where ua.id = auth.uid() and sa.status = 'active')));

-- Families read ONLY the published timetable for their ACTIVE children's section.
create policy guardian_read_timetable_versions on public.timetable_versions
  for select to authenticated
  using (
    app.is_guardian()
    and status = 'published'
    and grade_section_id in (
      select e.grade_section_id
        from public.enrollments e
       where e.student_id in (
         select l.student_id
           from public.guardian_student_links l
           join public.guardians g on g.id = l.guardian_id
           join public.user_accounts ua on ua.person_id = g.person_id
          where ua.id = auth.uid() and l.status = 'active'
       )
         and e.status = 'active'
    )
  );
create policy guardian_read_timetable_periods on public.timetable_periods
  for select to authenticated
  using (timetable_version_id in (select id from public.timetable_versions
         where app.is_guardian() and grade_section_id in (
           select e.grade_section_id from public.enrollments e
            where e.student_id in (
              select l.student_id from public.guardian_student_links l
                join public.guardians g on g.id = l.guardian_id
                join public.user_accounts ua on ua.person_id = g.person_id
               where ua.id = auth.uid() and l.status = 'active')
              and e.status = 'active')));

-- Exam/management staff (aal2) read and write through domain RPCs.
create policy staff_read_exam_definitions on public.exam_definitions
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_assessment_components on public.assessment_components
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_grade_bands on public.grade_band_versions
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_batches on public.result_batches
  for select to authenticated using (app.is_staff_aal2() and not app.is_pure_teacher());
create policy staff_write_batches on public.result_batches
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['exam_reviewer','result_publisher','system_administrator']));
create policy staff_update_batches on public.result_batches
  for update to authenticated
  using (app.is_staff_aal2() and app.has_any_role(array['exam_reviewer','result_publisher','system_administrator']))
  with check (app.is_staff_aal2() and app.has_any_role(array['exam_reviewer','result_publisher','system_administrator']));
create policy staff_read_rosters on public.result_rosters
  for select to authenticated using (app.is_staff_aal2() and not app.is_pure_teacher());
create policy staff_write_rosters on public.result_rosters
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['exam_reviewer','result_publisher','system_administrator']));
create policy staff_read_batch_versions on public.result_batch_versions
  for select to authenticated using (app.is_staff_aal2() and not app.is_pure_teacher());
create policy staff_write_batch_versions on public.result_batch_versions
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['exam_reviewer','result_publisher','system_administrator']));
create policy staff_read_mark_entries on public.mark_entries
  for select to authenticated using (app.is_staff_aal2() and not app.is_pure_teacher());
create policy staff_write_mark_entries on public.mark_entries
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['exam_reviewer','result_publisher','system_administrator']));
create policy staff_update_mark_entries on public.mark_entries
  for update to authenticated
  using (app.is_staff_aal2() and app.has_any_role(array['exam_reviewer','result_publisher','system_administrator']))
  with check (app.is_staff_aal2() and app.has_any_role(array['exam_reviewer','result_publisher','system_administrator']));
create policy staff_read_publications on public.result_publications
  for select to authenticated using (app.is_staff_aal2() and not app.is_pure_teacher());
create policy staff_write_publications on public.result_publications
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['result_publisher','system_administrator']));
create policy staff_update_publications on public.result_publications
  for update to authenticated
  using (app.is_staff_aal2() and app.has_any_role(array['result_publisher','system_administrator']))
  with check (app.is_staff_aal2() and app.has_any_role(array['result_publisher','system_administrator']));
create policy staff_read_publication_items on public.result_publication_items
  for select to authenticated using (app.is_staff_aal2() and not app.is_pure_teacher());
create policy staff_write_publication_items on public.result_publication_items
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['result_publisher','system_administrator']));
create policy staff_read_correction_requests on public.result_correction_requests
  for select to authenticated using (app.is_staff_aal2() and not app.is_pure_teacher());
create policy staff_write_correction_requests on public.result_correction_requests
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['result_publisher','system_administrator']));
create policy staff_update_correction_requests on public.result_correction_requests
  for update to authenticated
  using (app.is_staff_aal2() and app.has_any_role(array['result_publisher','system_administrator']))
  with check (app.is_staff_aal2() and app.has_any_role(array['result_publisher','system_administrator']));
create policy staff_read_result_events on public.result_events
  for select to authenticated using (app.is_staff_aal2() and not app.is_pure_teacher());
create policy staff_write_result_events on public.result_events
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['exam_reviewer','result_publisher','system_administrator']));

create policy staff_read_timetable_versions on public.timetable_versions
  for select to authenticated using (app.is_staff_aal2());
create policy staff_write_timetable_versions on public.timetable_versions
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['timetable_manager','system_administrator']));
create policy staff_update_timetable_versions on public.timetable_versions
  for update to authenticated
  using (app.is_staff_aal2() and app.has_any_role(array['timetable_manager','system_administrator']))
  with check (app.is_staff_aal2() and app.has_any_role(array['timetable_manager','system_administrator']));
create policy staff_read_timetable_periods on public.timetable_periods
  for select to authenticated using (app.is_staff_aal2());
create policy staff_write_timetable_periods on public.timetable_periods
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['timetable_manager','system_administrator']));
create policy staff_update_timetable_periods on public.timetable_periods
  for update to authenticated
  using (app.is_staff_aal2() and app.has_any_role(array['timetable_manager','system_administrator']))
  with check (app.is_staff_aal2() and app.has_any_role(array['timetable_manager','system_administrator']));
create policy staff_read_timetable_publications on public.timetable_publications
  for select to authenticated using (app.is_staff_aal2());
create policy staff_write_timetable_publications on public.timetable_publications
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['timetable_manager','system_administrator']));
create policy staff_read_timetable_overrides on public.timetable_overrides
  for select to authenticated using (app.is_staff_aal2());
create policy staff_write_timetable_overrides on public.timetable_overrides
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['timetable_manager','system_administrator']));
create policy staff_read_exam_schedule_versions on public.exam_schedule_versions
  for select to authenticated using (app.is_staff_aal2());
create policy staff_write_exam_schedule_versions on public.exam_schedule_versions
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['timetable_manager','system_administrator']));
create policy staff_update_exam_schedule_versions on public.exam_schedule_versions
  for update to authenticated
  using (app.is_staff_aal2() and app.has_any_role(array['timetable_manager','system_administrator']))
  with check (app.is_staff_aal2() and app.has_any_role(array['timetable_manager','system_administrator']));
create policy staff_read_exam_schedule_entries on public.exam_schedule_entries
  for select to authenticated using (app.is_staff_aal2());
create policy staff_write_exam_schedule_entries on public.exam_schedule_entries
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['timetable_manager','system_administrator']));

-- ===========================================================================
-- Base privileges
-- ===========================================================================
grant select on public.result_publications, public.result_publication_items to authenticated;
grant select on public.timetable_versions, public.timetable_periods to authenticated;
grant select on public.exam_definitions, public.assessment_components, public.grade_band_versions,
  public.result_batches, public.result_rosters, public.result_batch_versions, public.mark_entries,
  public.result_correction_requests, public.result_events, public.timetable_publications,
  public.timetable_overrides, public.exam_schedule_versions, public.exam_schedule_entries to authenticated;
grant select, insert, update on public.result_batches, public.result_rosters, public.result_batch_versions,
  public.mark_entries, public.result_publications, public.result_publication_items,
  public.result_correction_requests, public.result_events, public.timetable_versions,
  public.timetable_periods, public.timetable_publications, public.timetable_overrides,
  public.exam_schedule_versions, public.exam_schedule_entries to authenticated;

commit;
