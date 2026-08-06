-- =============================================================================
-- B1 — School configuration + Identity, people, and access
-- (plan.md §6 "School configuration" + §6 "Identity, people, and access",
--  §7 RLS matrix, §11 B1)
--
-- One B1 slice because the two halves are mutually dependent: grant scope
-- tables reference school reference data, and school-config RLS policies
-- reference the identity authorization helpers. Internal order:
--   1. school configuration tables
--   2. identity/access tables
--   3. authorization helpers (SQL functions validate at CREATE time, so all
--      referenced tables must exist first)
--   4. triggers (revalidation bumpers)
--   5. RLS: enable, revoke, policies (helpers exist by now)
--
-- Relationship spine: auth.users.id → user_accounts.id → people.id. One
-- person may be a guardian, staff member, or later student account holder
-- without duplicating identities. Authorization is read from these tables on
-- every protected operation; user_metadata is never authorization.
-- =============================================================================

begin;

-- ===========================================================================
-- 1. SCHOOL CONFIGURATION
-- ===========================================================================

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
-- 2. IDENTITY AND ACCESS
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- people
-- ---------------------------------------------------------------------------
create table public.people (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('PER'),
  given_name        text not null,
  family_name       text not null,
  display_name      text not null,
  status            text not null default 'active'
                    check (status in ('active', 'inactive', 'merged')),
  merged_into_person_id uuid references public.people(id) on delete restrict,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index people_status_idx on public.people (status);
create trigger people_touch before update on public.people
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- user_accounts — auth.users.id is the primary key (1:1)
-- ---------------------------------------------------------------------------
create table public.user_accounts (
  id                uuid primary key references auth.users(id) on delete restrict,
  person_id         uuid not null references public.people(id) on delete restrict,
  status            text not null default 'invited'
                    check (status in ('invited', 'active', 'suspended', 'closed')),
  verified_contact  text,                 -- safe normalized email/phone
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One active (or pending) account per person in the first release.
create unique index user_accounts_active_person_idx
  on public.user_accounts (person_id)
  where status in ('invited', 'active');
create index user_accounts_status_idx on public.user_accounts (status);
create trigger user_accounts_touch before update on public.user_accounts
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- role_grants — lifecycle, grantor, reason, effective dates, version
-- ---------------------------------------------------------------------------
create table public.role_grants (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('ROLE'),
  account_id        uuid not null references public.user_accounts(id) on delete restrict,
  role_code         text not null references public.role_definitions(code) on delete restrict,
  status            text not null default 'requested'
                    check (status in ('requested', 'active', 'revoked')),
  granted_by_account_id uuid references public.user_accounts(id) on delete restrict,
  reason            text,
  effective_from    timestamptz not null default now(),
  effective_to      timestamptz,
  version           int not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);

-- At most one active grant per role per account; history is preserved as
-- revoked rows.
create unique index role_grants_active_unique
  on public.role_grants (account_id, role_code)
  where status = 'active';
create index role_grants_account_idx on public.role_grants (account_id, status);
create index role_grants_role_idx on public.role_grants (role_code);
create trigger role_grants_touch before update on public.role_grants
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- role grant scopes
-- ---------------------------------------------------------------------------
create table public.role_grant_academic_years (
  role_grant_id     uuid not null references public.role_grants(id) on delete cascade,
  academic_year_id  uuid not null references public.academic_years(id) on delete restrict,
  primary key (role_grant_id, academic_year_id)
);
create index role_grant_years_year_idx on public.role_grant_academic_years (academic_year_id);

create table public.role_grant_grade_sections (
  role_grant_id     uuid not null references public.role_grants(id) on delete cascade,
  grade_section_id  uuid not null references public.grade_sections(id) on delete restrict,
  primary key (role_grant_id, grade_section_id)
);
create index role_grant_sections_section_idx on public.role_grant_grade_sections (grade_section_id);

create table public.role_grant_subjects (
  role_grant_id     uuid not null references public.role_grants(id) on delete cascade,
  subject_id        uuid not null references public.subjects(id) on delete restrict,
  primary key (role_grant_id, subject_id)
);
create index role_grant_subjects_subject_idx on public.role_grant_subjects (subject_id);

-- ---------------------------------------------------------------------------
-- staff_members
-- ---------------------------------------------------------------------------
create table public.staff_members (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('STAFF'),
  person_id         uuid not null references public.people(id) on delete restrict,
  employment_status text not null default 'active'
                    check (employment_status in ('active', 'inactive', 'ended')),
  title             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (person_id)
);

create index staff_members_status_idx on public.staff_members (employment_status);
create trigger staff_members_touch before update on public.staff_members
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- staff_assignments — effective teacher/class/subject or operational scope
-- ---------------------------------------------------------------------------
create table public.staff_assignments (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('ASN'),
  staff_member_id   uuid not null references public.staff_members(id) on delete restrict,
  role_grant_id     uuid not null references public.role_grants(id) on delete restrict,
  academic_year_id  uuid not null references public.academic_years(id) on delete restrict,
  grade_section_id  uuid references public.grade_sections(id) on delete restrict,
  subject_id        uuid references public.subjects(id) on delete restrict,
  status            text not null default 'scheduled'
                    check (status in ('scheduled', 'active', 'ended')),
  effective_from    timestamptz not null default now(),
  effective_to      timestamptz,
  version           int not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);

create index staff_assignments_staff_idx on public.staff_assignments (staff_member_id, status);
create index staff_assignments_grant_idx on public.staff_assignments (role_grant_id);
create index staff_assignments_year_idx on public.staff_assignments (academic_year_id);
create index staff_assignments_section_idx on public.staff_assignments (grade_section_id);
create trigger staff_assignments_touch before update on public.staff_assignments
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- guardians
-- ---------------------------------------------------------------------------
create table public.guardians (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('GDN'),
  person_id         uuid not null references public.people(id) on delete restrict,
  status            text not null default 'active'
                    check (status in ('active', 'inactive')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (person_id)
);

create index guardians_status_idx on public.guardians (status);
create trigger guardians_touch before update on public.guardians
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- students — permanent identity only; placement lives in enrollments (B3)
-- ---------------------------------------------------------------------------
create table public.students (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('STU'),
  person_id         uuid not null references public.people(id) on delete restrict,
  status            text not null default 'active'
                    check (status in ('active', 'inactive')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index students_status_idx on public.students (status);
create trigger students_touch before update on public.students
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- guardian_student_links — verified many-to-many relationship
-- ---------------------------------------------------------------------------
create table public.guardian_student_links (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('LINK'),
  guardian_id       uuid not null references public.guardians(id) on delete restrict,
  student_id        uuid not null references public.students(id) on delete restrict,
  relationship_label text not null,
  status            text not null default 'pending_verification'
                    check (status in ('pending_verification', 'active', 'restricted', 'ended', 'rejected')),
  verification_source text not null default 'guardian_request'
                    check (verification_source in ('guardian_request', 'enrollment_invitation', 'staff_review')),
  approved_by_account_id uuid references public.user_accounts(id) on delete restrict,
  approved_at       timestamptz,
  effective_from    timestamptz,
  effective_to      timestamptz,
  restriction_reason text,
  rejection_reason  text,
  contact_priority  int not null default 1,
  is_emergency_contact boolean not null default false,
  is_billing_contact boolean not null default false,
  version           int not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index guardian_links_guardian_idx on public.guardian_student_links (guardian_id, status);
create index guardian_links_student_idx on public.guardian_student_links (student_id, status);
create trigger guardian_links_touch before update on public.guardian_student_links
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- guardian_link_capabilities — portal capabilities per active link
-- ---------------------------------------------------------------------------
create table public.guardian_link_capabilities (
  link_id           uuid not null references public.guardian_student_links(id) on delete cascade,
  capability        text not null
                    check (capability in ('academics', 'finance', 'documents', 'notices', 'profile')),
  primary key (link_id, capability)
);

-- ---------------------------------------------------------------------------
-- account_invitations — hashed one-time reference, purpose, expiry
-- ---------------------------------------------------------------------------
create table public.account_invitations (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('INV'),
  purpose           text not null
                    check (purpose in ('guardian', 'applicant', 'job_applicant', 'staff')),
  account_id        uuid references public.user_accounts(id) on delete restrict,
  contact           text not null,             -- normalized invitation target
  invitation_hash   text not null,             -- hash of the one-time reference (never plaintext)
  status            text not null default 'pending'
                    check (status in ('pending', 'accepted', 'expired', 'revoked')),
  expires_at        timestamptz not null,
  accepted_at       timestamptz,
  created_by_account_id uuid references public.user_accounts(id) on delete restrict,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index account_invitations_hash_idx on public.account_invitations (invitation_hash);
create index account_invitations_status_idx on public.account_invitations (status, expires_at);
create trigger account_invitations_touch before update on public.account_invitations
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- access_revalidation — security version invalidating stale access
-- ---------------------------------------------------------------------------
create table public.access_revalidation (
  account_id        uuid primary key references public.user_accounts(id) on delete cascade,
  security_version  bigint not null default 0,
  updated_at        timestamptz not null default now()
);

create trigger access_revalidation_touch before update on public.access_revalidation
  for each row execute function app.touch_updated_at();

-- ===========================================================================
-- 3. AUTHORIZATION HELPERS
-- (SECURITY DEFINER, search_path locked, explicit auth checks — the
--  sanctioned pattern of plan.md §7.)
-- ===========================================================================

-- The current session is staff (any canonical staff role) AND aal2.
create or replace function app.is_staff_aal2()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and (auth.jwt() ->> 'aal') = 'aal2'
     and exists (
       select 1
         from public.role_grants rg
        where rg.account_id = auth.uid()
          and rg.status = 'active'
          and rg.effective_from <= now()
          and (rg.effective_to is null or rg.effective_to > now())
          and rg.role_code in (
            'content_editor', 'content_publisher',
            'admissions_officer', 'admissions_approver',
            'finance_officer', 'finance_approver',
            'hr_reviewer', 'hr_approver',
            'teacher', 'exam_reviewer', 'result_publisher',
            'timetable_manager', 'support_officer',
            'auditor', 'system_administrator'
          )
     )
$$;

-- The current session holds an active grant for one canonical role code.
create or replace function app.has_role(p_role text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.role_grants rg
     where rg.account_id = auth.uid()
       and rg.role_code = p_role
       and rg.status = 'active'
       and rg.effective_from <= now()
       and (rg.effective_to is null or rg.effective_to > now())
  )
$$;

-- The current session is an active guardian.
create or replace function app.is_guardian()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.guardians g
      join public.user_accounts ua on ua.person_id = g.person_id
     where ua.id = auth.uid()
       and g.status = 'active'
  )
$$;

-- The current session holds an active grant for ANY of the given role codes.
create or replace function app.has_any_role(p_roles text[])
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.role_grants rg
     where rg.account_id = auth.uid()
       and rg.role_code = any(p_roles)
       and rg.status = 'active'
       and rg.effective_from <= now()
       and (rg.effective_to is null or rg.effective_to > now())
  )
$$;

-- A staff session whose ONLY staff grant is teacher. Such sessions are bound
-- to their exact assignment scope by the teacher_* policies; sessions with any
-- additional functional staff role get operational queue access.
create or replace function app.is_pure_teacher()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and exists (
       select 1 from public.role_grants rg
        where rg.account_id = auth.uid()
          and rg.role_code = 'teacher'
          and rg.status = 'active'
          and rg.effective_from <= now()
          and (rg.effective_to is null or rg.effective_to > now())
     )
     and not exists (
       select 1 from public.role_grants rg
        where rg.account_id = auth.uid()
          and rg.role_code in (
            'content_editor', 'content_publisher',
            'admissions_officer', 'admissions_approver',
            'finance_officer', 'finance_approver',
            'hr_reviewer', 'hr_approver',
            'exam_reviewer', 'result_publisher',
            'timetable_manager', 'support_officer',
            'auditor', 'system_administrator'
          )
          and rg.status = 'active'
          and rg.effective_from <= now()
          and (rg.effective_to is null or rg.effective_to > now())
     )
$$;

-- Bump an account's security version (revocation takes effect on the next
-- server request even while the JWT is still valid — plan.md §4).
create or replace function app.bump_access_revalidation(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.access_revalidation (account_id, security_version)
  values (p_account_id, 1)
  on conflict (account_id)
  do update set security_version = public.access_revalidation.security_version + 1,
                updated_at = now();
end
$$;

-- Trigger: bump the grant's account when a role grant changes.
create or replace function app.revalidate_role_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid := coalesce(new.account_id, old.account_id);
begin
  if v_account is not null then
    perform app.bump_access_revalidation(v_account);
  end if;
  return coalesce(new, old);
end
$$;

-- Trigger: bump every linked guardian account when a guardian/student link
-- changes (approval, restriction, revocation).
create or replace function app.revalidate_link_accounts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guardian uuid := coalesce(new.guardian_id, old.guardian_id);
begin
  update public.access_revalidation ar
     set security_version = ar.security_version + 1,
         updated_at = now()
    from public.guardians g
    join public.user_accounts ua on ua.person_id = g.person_id
   where g.id = v_guardian
     and ar.account_id = ua.id;
  insert into public.access_revalidation (account_id, security_version)
  select ua.id, 1
    from public.guardians g
    join public.user_accounts ua on ua.person_id = g.person_id
   where g.id = v_guardian
     and not exists (
       select 1 from public.access_revalidation ar
        where ar.account_id = ua.id
     );
  return coalesce(new, old);
end
$$;

-- Trigger: bump the staff member's account when an assignment changes.
create or replace function app.revalidate_assignment_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := coalesce(new.staff_member_id, old.staff_member_id);
begin
  update public.access_revalidation ar
     set security_version = ar.security_version + 1,
         updated_at = now()
    from public.staff_members sm
    join public.user_accounts ua on ua.person_id = sm.person_id
   where sm.id = v_staff
     and ar.account_id = ua.id;
  insert into public.access_revalidation (account_id, security_version)
  select ua.id, 1
    from public.staff_members sm
    join public.user_accounts ua on ua.person_id = sm.person_id
   where sm.id = v_staff
     and not exists (
       select 1 from public.access_revalidation ar
        where ar.account_id = ua.id
     );
  return coalesce(new, old);
end
$$;

grant usage on schema app to authenticated;
grant execute on function app.is_staff_aal2() to authenticated;
grant execute on function app.has_role(text) to authenticated;
grant execute on function app.is_guardian() to authenticated;
grant execute on function app.has_any_role(text[]) to authenticated;
grant execute on function app.is_pure_teacher() to authenticated;

-- ===========================================================================
-- 4. REVALIDATION TRIGGERS
-- ===========================================================================
create trigger role_grants_revalidate after insert or update or delete
  on public.role_grants for each row execute function app.revalidate_role_account();
create trigger staff_assignments_revalidate after insert or update or delete
  on public.staff_assignments for each row execute function app.revalidate_assignment_account();
create trigger guardian_links_revalidate after insert or update or delete
  on public.guardian_student_links for each row execute function app.revalidate_link_accounts();

-- ===========================================================================
-- 5. RLS — plan.md §7 matrix
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
alter table public.people                  enable row level security;
alter table public.user_accounts           enable row level security;
alter table public.role_grants             enable row level security;
alter table public.role_grant_academic_years enable row level security;
alter table public.role_grant_grade_sections enable row level security;
alter table public.role_grant_subjects     enable row level security;
alter table public.staff_members           enable row level security;
alter table public.staff_assignments       enable row level security;
alter table public.guardians               enable row level security;
alter table public.students                enable row level security;
alter table public.guardian_student_links  enable row level security;
alter table public.guardian_link_capabilities enable row level security;
alter table public.account_invitations     enable row level security;
alter table public.access_revalidation     enable row level security;

revoke all on public.school_profile_versions, public.academic_years, public.grades,
           public.grade_sections, public.subjects, public.rooms, public.period_definitions,
           public.settings_versions, public.feature_flags, public.people, public.user_accounts,
           public.role_grants, public.role_grant_academic_years, public.role_grant_grade_sections,
           public.role_grant_subjects, public.staff_members, public.staff_assignments,
           public.guardians, public.students, public.guardian_student_links,
           public.guardian_link_capabilities, public.account_invitations, public.access_revalidation
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

-- Account holders read their own identity records.
create policy own_people on public.people
  for select to authenticated
  using (id = (select person_id from public.user_accounts where id = auth.uid()));
create policy own_account on public.user_accounts
  for select to authenticated
  using (id = auth.uid());
create policy own_grants on public.role_grants
  for select to authenticated
  using (account_id = auth.uid());
create policy own_staff on public.staff_members
  for select to authenticated
  using (person_id = (select person_id from public.user_accounts where id = auth.uid()));
create policy own_assignments on public.staff_assignments
  for select to authenticated
  using (staff_member_id in (
    select sm.id from public.staff_members sm
    join public.user_accounts ua on ua.person_id = sm.person_id
    where ua.id = auth.uid()
  ));
create policy own_guardian on public.guardians
  for select to authenticated
  using (person_id = (select person_id from public.user_accounts where id = auth.uid()));
create policy own_guardian_links on public.guardian_student_links
  for select to authenticated
  using (guardian_id in (
    select g.id from public.guardians g
    join public.user_accounts ua on ua.person_id = g.person_id
    where ua.id = auth.uid()
  ));

-- Guardians read the students their ACTIVE links connect them to, and the
-- capabilities granted on those links (capability checks gate each module).
create policy guardian_read_linked_students on public.students
  for select to authenticated
  using (
    app.is_guardian()
    and id in (
      select l.student_id
        from public.guardian_student_links l
        join public.guardians g on g.id = l.guardian_id
        join public.user_accounts ua on ua.person_id = g.person_id
       where ua.id = auth.uid()
         and l.status = 'active'
    )
  );
create policy guardian_read_linked_people on public.people
  for select to authenticated
  using (
    app.is_guardian()
    and id in (
      select s.person_id
        from public.students s
        join public.guardian_student_links l on l.student_id = s.id
        join public.guardians g on g.id = l.guardian_id
        join public.user_accounts ua on ua.person_id = g.person_id
       where ua.id = auth.uid()
         and l.status = 'active'
    )
  );
create policy guardian_read_capabilities on public.guardian_link_capabilities
  for select to authenticated
  using (link_id in (
    select l.id
      from public.guardian_student_links l
      join public.guardians g on g.id = l.guardian_id
      join public.user_accounts ua on ua.person_id = g.person_id
     where ua.id = auth.uid()
       and l.status = 'active'
  ));

-- Staff (aal2) read identity/access records; grant/link WRITES go through
-- domain RPCs that audit and bump access revalidation.
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
create policy staff_read_people on public.people
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_accounts on public.user_accounts
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_grants on public.role_grants
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_grant_years on public.role_grant_academic_years
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_grant_sections on public.role_grant_grade_sections
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_grant_subjects on public.role_grant_subjects
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_staff on public.staff_members
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_assignments on public.staff_assignments
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_guardians on public.guardians
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_students on public.students
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_links on public.guardian_student_links
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_link_capabilities on public.guardian_link_capabilities
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_invitations on public.account_invitations
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_role_definitions on public.role_definitions
  for select to authenticated using (app.is_staff_aal2());

-- Link decisions (approve/reject/restrict/revoke) are staff aal2 writes;
-- the domain RPC records the reason, audit row, and outbox event.
create policy staff_update_links on public.guardian_student_links
  for update to authenticated
  using (app.is_staff_aal2())
  with check (app.is_staff_aal2());

-- User administration: system administrator only (users.manage), never
-- business approvals.
create policy admin_update_accounts on public.user_accounts
  for update to authenticated
  using (app.has_role('system_administrator') and app.is_staff_aal2())
  with check (app.has_role('system_administrator') and app.is_staff_aal2());
create policy admin_manage_grants on public.role_grants
  for insert to authenticated
  with check (app.has_role('system_administrator') and app.is_staff_aal2());
create policy admin_revoke_grants on public.role_grants
  for update to authenticated
  using (app.has_role('system_administrator') and app.is_staff_aal2())
  with check (app.has_role('system_administrator') and app.is_staff_aal2());
create policy admin_manage_assignments on public.staff_assignments
  for insert to authenticated
  with check (app.has_role('system_administrator') and app.is_staff_aal2());
create policy admin_update_assignments on public.staff_assignments
  for update to authenticated
  using (app.has_role('system_administrator') and app.is_staff_aal2())
  with check (app.has_role('system_administrator') and app.is_staff_aal2());
create policy admin_manage_invitations on public.account_invitations
  for insert to authenticated
  with check (app.is_staff_aal2());
create policy admin_update_invitations on public.account_invitations
  for update to authenticated
  using (app.is_staff_aal2())
  with check (app.is_staff_aal2());

-- ===========================================================================
-- Base privileges (new Supabase default: new tables are NOT auto-granted to
-- anon/authenticated — RLS policies filter rows but the role still needs the
-- underlying privilege, plan.md §7). Only tables with policies are granted;
-- audit/outbox/idempotency/webhook/rate-limit/job tables stay ungranted and
-- are reachable only through the SECURITY DEFINER helpers or the service role.
-- ===========================================================================
grant select on public.academic_years, public.grades, public.grade_sections,
  public.subjects, public.rooms to authenticated;
grant select on public.school_profile_versions, public.period_definitions,
  public.settings_versions, public.feature_flags, public.role_definitions to authenticated;
grant select on public.people, public.staff_members, public.guardians,
  public.students, public.guardian_link_capabilities, public.role_grant_academic_years,
  public.role_grant_grade_sections, public.role_grant_subjects to authenticated;
grant select on public.user_accounts to authenticated;
grant select, insert, update on public.role_grants to authenticated;
grant select, update on public.staff_assignments to authenticated;
grant select, update on public.guardian_student_links to authenticated;
grant select, insert, update on public.account_invitations to authenticated;

grant usage on schema public to authenticated;

commit;
