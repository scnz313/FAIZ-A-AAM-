-- =============================================================================
-- B3 — Students, guardians, and enrollment (plan.md §6 module, §11 B3)
--
-- `enrollments` is the central operational join: finance, result rosters,
-- timetable lookup, enrollment-targeted notices, and report cards all derive
-- from it. A student's grade/section is never a permanent field on the
-- student identity row. Conversion is idempotent and auditable.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- enrollments — placement in an academic year and grade/section
-- ---------------------------------------------------------------------------
create table public.enrollments (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('ENR'),
  student_id        uuid not null references public.students(id) on delete restrict,
  academic_year_id  uuid not null references public.academic_years(id) on delete restrict,
  grade_section_id  uuid not null references public.grade_sections(id) on delete restrict,
  status            text not null default 'pending'
                    check (status in ('pending', 'active', 'completed', 'transferred', 'withdrawn')),
  effective_from    timestamptz not null default now(),
  effective_to      timestamptz,
  version           int not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);

-- At most one active enrollment per student per academic year.
create unique index enrollments_active_unique
  on public.enrollments (student_id, academic_year_id)
  where status = 'active';
create index enrollments_year_idx on public.enrollments (academic_year_id, status);
create index enrollments_section_idx on public.enrollments (grade_section_id);
create trigger enrollments_touch before update on public.enrollments
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- enrollment_conversions — idempotent application → student/enrollment/link
-- ---------------------------------------------------------------------------
create table public.enrollment_conversions (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('ECV'),
  application_id    uuid not null unique references public.admission_applications(id) on delete restrict,
  student_id        uuid not null references public.students(id) on delete restrict,
  enrollment_id     uuid not null references public.enrollments(id) on delete restrict,
  guardian_link_id  uuid references public.guardian_student_links(id) on delete restrict,
  matched_existing  boolean not null default false,
  result            jsonb,
  created_at        timestamptz not null default now()
);

create index enrollment_conversions_student_idx on public.enrollment_conversions (student_id);
create trigger enrollment_conversions_no_update
  before update on public.enrollment_conversions
  for each row execute function app.block_mutation();
create trigger enrollment_conversions_no_delete
  before delete on public.enrollment_conversions
  for each row execute function app.block_mutation();

-- ---------------------------------------------------------------------------
-- student_support_records — optional restricted data, isolated from normal
-- finance/teacher access (plan.md §6.6)
-- ---------------------------------------------------------------------------
create table public.student_support_records (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references public.students(id) on delete restrict,
  category          text not null,
  note              text not null,
  version           int not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index student_support_student_idx on public.student_support_records (student_id);
create trigger student_support_touch before update on public.student_support_records
  for each row execute function app.touch_updated_at();

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table public.enrollments                enable row level security;
alter table public.enrollment_conversions     enable row level security;
alter table public.student_support_records   enable row level security;

revoke all on public.enrollments, public.enrollment_conversions, public.student_support_records
  from anon, authenticated;

-- Guardians read enrollments only for students their ACTIVE links connect
-- them to (placement is visible; medical/support records are not).
create policy guardian_read_enrollments on public.enrollments
  for select to authenticated
  using (
    app.is_guardian()
    and student_id in (
      select l.student_id
        from public.guardian_student_links l
        join public.guardians g on g.id = l.guardian_id
        join public.user_accounts ua on ua.person_id = g.person_id
       where ua.id = auth.uid()
         and l.status = 'active'
    )
  );

-- Staff (aal2) read and manage enrollment records.
create policy staff_read_enrollments on public.enrollments
  for select to authenticated using (app.is_staff_aal2());
create policy staff_write_enrollments on public.enrollments
  for insert to authenticated with check (app.is_staff_aal2());
create policy staff_update_enrollments on public.enrollments
  for update to authenticated
  using (app.is_staff_aal2()) with check (app.is_staff_aal2());
create policy staff_read_conversions on public.enrollment_conversions
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_support_records on public.student_support_records
  for select to authenticated using (app.is_staff_aal2());
create policy support_write_records on public.student_support_records
  for insert to authenticated with check (app.is_staff_aal2());
create policy support_update_records on public.student_support_records
  for update to authenticated
  using (app.is_staff_aal2()) with check (app.is_staff_aal2());

-- ===========================================================================
-- Base privileges
-- ===========================================================================
grant select on public.enrollments to authenticated;
grant select, insert, update on public.enrollments to authenticated;
grant select on public.enrollment_conversions to authenticated;
grant select, insert, update on public.student_support_records to authenticated;

commit;
