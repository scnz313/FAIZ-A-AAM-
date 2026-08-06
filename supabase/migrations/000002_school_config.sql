-- =============================================================================
-- B1 — School configuration (plan.md §6 "School configuration", §11 B1)
--
-- Versioned official identity and the academic reference data every other
-- module joins on. Configuration records are archived, never hard-deleted;
-- no school-policy value becomes effective while marked `policy_pending`.
-- RLS: deny-by-default; authenticated applicants may read the reference data
-- their forms need; staff (aal2) may read the full configuration.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- school_profile_versions — versioned official school identity
-- ---------------------------------------------------------------------------
create table public.school_profile_versions (
  id                uuid primary key default gen_random_uuid(),
  version           int not null,
  status            text not null default 'policy_pending'
                    check (status in ('policy_pending', 'draft', 'approved', 'superseded')),
  school_name       text,
  school_code       text,
  affiliation       text,
  address_line1     text,
  address_city      text,
  address_state     text,
  postal_code       text,
  contact_phone     text,
  contact_email     text,
  languages         text[],
  approved_by_account_id uuid,
  approved_at       timestamptz,
  created_at        timestamptz not null default now(),
  unique (version)
);

-- ---------------------------------------------------------------------------
-- academic_years
-- ---------------------------------------------------------------------------
create table public.academic_years (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('YR'),
  label             text not null unique,          -- e.g. '2026-27'
  starts_on         date not null,
  ends_on           date not null,
  status            text not null default 'upcoming'
                    check (status in ('upcoming', 'current', 'historical', 'closed')),
  created_at        timestamptz not null default now(),
  check (ends_on > starts_on)
);

-- ---------------------------------------------------------------------------
-- grades
-- ---------------------------------------------------------------------------
create table public.grades (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,          -- '6' … '10'
  label             text not null unique,          -- 'Class 6'
  sort_order        int not null default 0,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- grade_sections — academic-year-specific grade and section
-- ---------------------------------------------------------------------------
create table public.grade_sections (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('SEC'),
  academic_year_id  uuid not null references public.academic_years(id) on delete restrict,
  grade_id          uuid not null references public.grades(id) on delete restrict,
  section_label     text not null,                  -- 'A'
  status            text not null default 'planned'
                    check (status in ('planned', 'active', 'archived')),
  created_at        timestamptz not null default now(),
  unique (academic_year_id, grade_id, section_label)
);

create index grade_sections_year_idx on public.grade_sections (academic_year_id);
create index grade_sections_grade_idx on public.grade_sections (grade_id);

-- ---------------------------------------------------------------------------
-- subjects
-- ---------------------------------------------------------------------------
create table public.subjects (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,          -- 'MAT'
  name              text not null unique,          -- 'Mathematics'
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- rooms
-- ---------------------------------------------------------------------------
create table public.rooms (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,          -- 'R21'
  label             text not null,                 -- 'Room 21 · 8-A'
  kind              text not null default 'classroom'
                    check (kind in ('classroom', 'lab', 'hall', 'courtyard', 'other')),
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- period_definitions — working-day and period grid per academic year
-- (rows exist only for working days; ISO weekday, 1 = Monday)
-- ---------------------------------------------------------------------------
create table public.period_definitions (
  id                uuid primary key default gen_random_uuid(),
  academic_year_id  uuid not null references public.academic_years(id) on delete restrict,
  day_of_week       int not null check (day_of_week between 1 and 7),
  period_number     int not null check (period_number > 0),
  starts_at         time not null,
  ends_at           time not null,
  created_at        timestamptz not null default now(),
  unique (academic_year_id, day_of_week, period_number),
  check (ends_at > starts_at)
);

create index period_definitions_year_idx on public.period_definitions (academic_year_id);

-- ---------------------------------------------------------------------------
-- settings_versions — effective, versioned policy configuration
-- ---------------------------------------------------------------------------
create table public.settings_versions (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('SET'),
  version           int not null,
  status            text not null default 'policy_pending'
                    check (status in ('policy_pending', 'draft', 'effective', 'superseded')),
  effective_from    timestamptz,
  policy            jsonb not null default '{}'::jsonb,  -- policy data only (plan.md §5)
  changed_by_account_id uuid,
  change_reason     text,
  created_at        timestamptz not null default now(),
  unique (version)
);

-- ---------------------------------------------------------------------------
-- feature_flags — controlled rollout flags, never authorization
-- ---------------------------------------------------------------------------
create table public.feature_flags (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  enabled           boolean not null default false,
  note              text,
  updated_at        timestamptz not null default now()
);

create trigger feature_flags_touch
  before update on public.feature_flags
  for each row execute function app.touch_updated_at();

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table public.school_profile_versions enable row level security;
alter table public.academic_years          enable row level security;
alter table public.grades                  enable row level security;
alter table public.grade_sections          enable row level security;
alter table public.subjects                enable row level security;
alter table public.rooms                   enable row level security;
alter table public.period_definitions      enable row level security;
alter table public.settings_versions       enable row level security;
alter table public.feature_flags           enable row level security;

revoke all on public.school_profile_versions, public.academic_years, public.grades,
           public.grade_sections, public.subjects, public.rooms, public.period_definitions,
           public.settings_versions, public.feature_flags
  from anon, authenticated;

-- Reference data applicants and families need for forms/labels. Statuses are
-- part of the row; `policy_pending` values stay visible as pending, never as
-- effective policy.
create policy reference_years_read on public.academic_years
  for select to authenticated
  using (status in ('current', 'upcoming'));
create policy reference_grades_read on public.grades
  for select to authenticated
  using (true);
create policy reference_sections_read on public.grade_sections
  for select to authenticated
  using (academic_year_id in (select id from public.academic_years where status in ('current', 'upcoming')));
create policy reference_subjects_read on public.subjects
  for select to authenticated
  using (true);
create policy reference_rooms_read on public.rooms
  for select to authenticated
  using (true);

-- Staff (aal2) read the full configuration; configuration WRITES go through
-- domain RPCs (audit + versioning), never through direct table policies.
create policy staff_read_school_profile on public.school_profile_versions
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_years on public.academic_years
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_grades on public.grades
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_sections on public.grade_sections
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_subjects on public.subjects
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_rooms on public.rooms
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_periods on public.period_definitions
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_settings on public.settings_versions
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_flags on public.feature_flags
  for select to authenticated using (app.is_staff_aal2());

commit;
