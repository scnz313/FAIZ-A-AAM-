-- =============================================================================
-- B2 — Student admissions and careers (plan.md §6 modules, §11 B2)
--
-- Submitted applications and versions are immutable (append-only triggers).
-- Requested changes create a new version; they never overwrite an earlier
-- submission. Accepting an offer requests exactly one admission invoice
-- (admission_invoice_ref on the offer; the invoice itself lives in finance).
-- An accepted job offer does NOT create staff records or grants here.
-- =============================================================================

begin;

-- Role-scope authorization helpers (also defined in B1 for fresh builds;
-- `create or replace` keeps the live project and local reset identical).
-- `app.has_any_role(text[])` — active grant for any of the given roles.
-- `app.is_pure_teacher()`   — a staff session whose ONLY staff grant is
--                             teacher (bound to exact assignment scope by the
--                             teacher_* policies instead of the operational
--                             staff queue).
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

grant execute on function app.has_any_role(text[]) to authenticated;

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

grant execute on function app.is_pure_teacher() to authenticated;

-- ---------------------------------------------------------------------------
-- Admission windows
-- ---------------------------------------------------------------------------
create table public.admission_windows (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('ADMW'),
  academic_year_id  uuid not null references public.academic_years(id) on delete restrict,
  grade_id          uuid not null references public.grades(id) on delete restrict,
  opens_at          timestamptz not null,
  closes_at         timestamptz not null,
  capacity          int check (capacity is null or capacity > 0),
  policy            jsonb not null default '{}'::jsonb,
  status            text not null default 'planned'
                    check (status in ('planned', 'open', 'closed', 'cancelled')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (closes_at > opens_at),
  unique (academic_year_id, grade_id)
);

create index admission_windows_year_idx on public.admission_windows (academic_year_id, status);
create trigger admission_windows_touch before update on public.admission_windows
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Admission applications
-- ---------------------------------------------------------------------------
create table public.admission_applications (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('APP'),
  owner_account_id  uuid not null references public.user_accounts(id) on delete restrict,
  academic_year_id  uuid not null references public.academic_years(id) on delete restrict,
  grade_id          uuid not null references public.grades(id) on delete restrict,
  current_status    text not null default 'draft'
                    check (current_status in ('draft', 'submitted', 'under_review', 'changes_requested',
                                              'assessment', 'offered', 'waitlisted', 'declined',
                                              'enrolled', 'withdrawn')),
  student_name      text not null,
  parent_name       text not null,
  parent_contact    text,
  version           int not null default 0,
  submitted_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index admission_applications_owner_idx on public.admission_applications (owner_account_id, current_status);
create index admission_applications_year_idx on public.admission_applications (academic_year_id, grade_id);
create trigger admission_applications_touch before update on public.admission_applications
  for each row execute function app.touch_updated_at();

-- Mutable authenticated draft with expiry (draft snapshot lives here).
create table public.admission_drafts (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null unique references public.admission_applications(id) on delete cascade,
  draft             jsonb not null default '{}'::jsonb,
  schema_version    int not null default 1,
  expires_at        timestamptz not null,
  updated_at        timestamptz not null default now()
);

create trigger admission_drafts_touch before update on public.admission_drafts
  for each row execute function app.touch_updated_at();

-- Immutable submitted/corrected form snapshots.
create table public.admission_application_versions (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null references public.admission_applications(id) on delete cascade,
  version           int not null,
  snapshot          jsonb not null,
  schema_version    int not null default 1,
  submitted_by_account_id uuid not null references public.user_accounts(id) on delete restrict,
  created_at        timestamptz not null default now(),
  unique (application_id, version)
);

create trigger admission_versions_no_update
  before update on public.admission_application_versions
  for each row execute function app.block_mutation();
create trigger admission_versions_no_delete
  before delete on public.admission_application_versions
  for each row execute function app.block_mutation();

-- Officer reviews: visible reason and private note are separate fields.
create table public.admission_reviews (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null references public.admission_applications(id) on delete cascade,
  officer_account_id uuid not null references public.user_accounts(id) on delete restrict,
  action            text not null
                    check (action in ('reviewed', 'requested_changes', 'moved_to_assessment')),
  visible_reason    text,
  private_note      text,
  created_at        timestamptz not null default now()
);

create index admission_reviews_app_idx on public.admission_reviews (application_id, created_at desc);

create table public.admission_assessments (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null unique references public.admission_applications(id) on delete cascade,
  approved_by_account_id uuid not null references public.user_accounts(id) on delete restrict,
  notes             text,
  created_at        timestamptz not null default now()
);

create table public.admission_offers (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null unique references public.admission_applications(id) on delete cascade,
  grade_id          uuid not null references public.grades(id) on delete restrict,
  academic_year_id  uuid not null references public.academic_years(id) on delete restrict,
  conditions        jsonb not null default '{}'::jsonb,
  expires_at        timestamptz not null,
  fee_required      boolean not null default true,
  admission_invoice_ref text,          -- set once the finance module issues the invoice
  response          text not null default 'pending'
                    check (response in ('pending', 'accepted', 'declined')),
  responded_at      timestamptz,
  decided_by_account_id uuid references public.user_accounts(id) on delete restrict,
  version           int not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger admission_offers_touch before update on public.admission_offers
  for each row execute function app.touch_updated_at();

-- Applicant-safe and staff-private timeline events.
create table public.admission_events (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null references public.admission_applications(id) on delete cascade,
  event_type        text not null,
  visible_to_applicant boolean not null default true,
  copy              text not null,
  created_at        timestamptz not null default now()
);

create index admission_events_app_idx on public.admission_events (application_id, created_at desc);
create trigger admission_events_no_update
  before update on public.admission_events
  for each row execute function app.block_mutation();
create trigger admission_events_no_delete
  before delete on public.admission_events
  for each row execute function app.block_mutation();

-- ---------------------------------------------------------------------------
-- Careers
-- ---------------------------------------------------------------------------
create table public.job_vacancies (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('VAC'),
  title             text not null,
  department        text,
  current_status    text not null default 'draft'
                    check (current_status in ('draft', 'published', 'closed')),
  version           int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger job_vacancies_touch before update on public.job_vacancies
  for each row execute function app.touch_updated_at();

create table public.job_vacancy_versions (
  id                uuid primary key default gen_random_uuid(),
  vacancy_id        uuid not null references public.job_vacancies(id) on delete cascade,
  version           int not null,
  terms             jsonb not null,            -- immutable published vacancy terms
  published_by_account_id uuid references public.user_accounts(id) on delete restrict,
  created_at        timestamptz not null default now(),
  unique (vacancy_id, version)
);

create trigger job_vacancy_versions_no_update
  before update on public.job_vacancy_versions
  for each row execute function app.block_mutation();
create trigger job_vacancy_versions_no_delete
  before delete on public.job_vacancy_versions
  for each row execute function app.block_mutation();

create table public.job_applications (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('JOB'),
  vacancy_id        uuid not null references public.job_vacancies(id) on delete restrict,
  vacancy_version   int not null,
  owner_account_id  uuid not null references public.user_accounts(id) on delete restrict,
  current_status    text not null default 'draft'
                    check (current_status in ('draft', 'submitted', 'eligibility_review', 'shortlisted',
                                              'interview', 'offered', 'not_selected', 'withdrawn')),
  applicant_name    text not null,
  version           int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (vacancy_id, vacancy_version) references public.job_vacancy_versions(vacancy_id, version)
);

create index job_applications_owner_idx on public.job_applications (owner_account_id, current_status);
create trigger job_applications_touch before update on public.job_applications
  for each row execute function app.touch_updated_at();

create table public.job_application_versions (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null references public.job_applications(id) on delete cascade,
  version           int not null,
  snapshot          jsonb not null,
  submitted_by_account_id uuid not null references public.user_accounts(id) on delete restrict,
  created_at        timestamptz not null default now(),
  unique (application_id, version)
);

create trigger job_application_versions_no_update
  before update on public.job_application_versions
  for each row execute function app.block_mutation();
create trigger job_application_versions_no_delete
  before delete on public.job_application_versions
  for each row execute function app.block_mutation();

create table public.job_review_assignments (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null references public.job_applications(id) on delete cascade,
  reviewer_account_id uuid not null references public.user_accounts(id) on delete restrict,
  status            text not null default 'assigned'
                    check (status in ('assigned', 'accepted', 'completed')),
  created_at        timestamptz not null default now(),
  unique (application_id, reviewer_account_id)
);

create table public.job_scorecards (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null references public.job_applications(id) on delete cascade,
  reviewer_account_id uuid not null references public.user_accounts(id) on delete restrict,
  score             numeric not null check (score >= 0),
  notes             text,
  created_at        timestamptz not null default now()
);

create table public.job_interviews (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null references public.job_applications(id) on delete cascade,
  scheduled_at      timestamptz not null,
  outcome           text check (outcome in ('passed', 'failed', 'pending')),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger job_interviews_touch before update on public.job_interviews
  for each row execute function app.touch_updated_at();

create table public.job_events (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null references public.job_applications(id) on delete cascade,
  event_type        text not null,
  visible_to_applicant boolean not null default true,
  copy              text not null,
  created_at        timestamptz not null default now()
);

create index job_events_app_idx on public.job_events (application_id, created_at desc);
create trigger job_events_no_update
  before update on public.job_events
  for each row execute function app.block_mutation();
create trigger job_events_no_delete
  before delete on public.job_events
  for each row execute function app.block_mutation();

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table public.admission_windows          enable row level security;
alter table public.admission_applications     enable row level security;
alter table public.admission_drafts           enable row level security;
alter table public.admission_application_versions enable row level security;
alter table public.admission_reviews          enable row level security;
alter table public.admission_assessments      enable row level security;
alter table public.admission_offers           enable row level security;
alter table public.admission_events           enable row level security;
alter table public.job_vacancies              enable row level security;
alter table public.job_vacancy_versions       enable row level security;
alter table public.job_applications           enable row level security;
alter table public.job_application_versions   enable row level security;
alter table public.job_review_assignments     enable row level security;
alter table public.job_scorecards             enable row level security;
alter table public.job_interviews             enable row level security;
alter table public.job_events                 enable row level security;

revoke all on public.admission_windows, public.admission_applications, public.admission_drafts,
           public.admission_application_versions, public.admission_reviews, public.admission_assessments,
           public.admission_offers, public.admission_events, public.job_vacancies,
           public.job_vacancy_versions, public.job_applications, public.job_application_versions,
           public.job_review_assignments, public.job_scorecards, public.job_interviews, public.job_events
  from anon, authenticated;

-- Applicants own their applications, drafts, versions, and safe events.
create policy applicant_own_applications on public.admission_applications
  for select to authenticated using (owner_account_id = auth.uid());
create policy applicant_insert_applications on public.admission_applications
  for insert to authenticated with check (owner_account_id = auth.uid());
create policy applicant_update_drafts_only on public.admission_applications
  for update to authenticated
  using (owner_account_id = auth.uid() and current_status = 'draft')
  with check (owner_account_id = auth.uid() and current_status = 'draft');
create policy applicant_own_drafts on public.admission_drafts
  for all to authenticated
  using (application_id in (select id from public.admission_applications where owner_account_id = auth.uid()))
  with check (application_id in (select id from public.admission_applications where owner_account_id = auth.uid()));
create policy applicant_own_versions on public.admission_application_versions
  for select to authenticated
  using (application_id in (select id from public.admission_applications where owner_account_id = auth.uid()));
create policy applicant_safe_events on public.admission_events
  for select to authenticated
  using (application_id in (select id from public.admission_applications where owner_account_id = auth.uid())
         and visible_to_applicant = true);
create policy applicant_own_offers on public.admission_offers
  for select to authenticated
  using (application_id in (select id from public.admission_applications where owner_account_id = auth.uid()));

-- Job applicants: same pattern.
create policy job_own_applications on public.job_applications
  for select to authenticated using (owner_account_id = auth.uid());
create policy job_insert_applications on public.job_applications
  for insert to authenticated with check (owner_account_id = auth.uid());
create policy job_update_drafts_only on public.job_applications
  for update to authenticated
  using (owner_account_id = auth.uid() and current_status = 'draft')
  with check (owner_account_id = auth.uid() and current_status = 'draft');
create policy job_own_versions on public.job_application_versions
  for select to authenticated
  using (application_id in (select id from public.job_applications where owner_account_id = auth.uid()));
create policy job_safe_events on public.job_events
  for select to authenticated
  using (application_id in (select id from public.job_applications where owner_account_id = auth.uid())
         and visible_to_applicant = true);

-- Staff (aal2) read and decide.
create policy staff_read_admission_windows on public.admission_windows
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_applications on public.admission_applications
  for select to authenticated using (app.is_staff_aal2());
create policy staff_update_applications on public.admission_applications
  for update to authenticated
  using (app.is_staff_aal2()) with check (app.is_staff_aal2());
create policy staff_read_drafts on public.admission_drafts
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_versions on public.admission_application_versions
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_reviews on public.admission_reviews
  for select to authenticated using (app.is_staff_aal2());
create policy staff_insert_reviews on public.admission_reviews
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['admissions_officer','admissions_approver','system_administrator']));
create policy staff_read_assessments on public.admission_assessments
  for select to authenticated using (app.is_staff_aal2());
create policy staff_insert_assessments on public.admission_assessments
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['admissions_officer','admissions_approver','system_administrator']));
create policy staff_read_offers on public.admission_offers
  for select to authenticated using (app.is_staff_aal2());
create policy staff_update_offers on public.admission_offers
  for update to authenticated
  using (app.is_staff_aal2() and app.has_any_role(array['admissions_approver','system_administrator']))
  with check (app.is_staff_aal2() and app.has_any_role(array['admissions_approver','system_administrator']));
create policy staff_read_admission_events on public.admission_events
  for select to authenticated using (app.is_staff_aal2());
create policy staff_insert_admission_events on public.admission_events
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['admissions_officer','admissions_approver','system_administrator']));

create policy staff_read_vacancies on public.job_vacancies
  for select to authenticated using (app.is_staff_aal2());
create policy staff_write_vacancies on public.job_vacancies
  for all to authenticated using (app.is_staff_aal2() and app.has_any_role(array['hr_reviewer','hr_approver','system_administrator'])) with check (app.is_staff_aal2() and app.has_any_role(array['hr_reviewer','hr_approver','system_administrator']));
create policy staff_read_vacancy_versions on public.job_vacancy_versions
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_job_applications on public.job_applications
  for select to authenticated using (app.is_staff_aal2());
create policy staff_update_job_applications on public.job_applications
  for update to authenticated
  using (app.is_staff_aal2() and app.has_any_role(array['hr_reviewer','hr_approver','system_administrator']))
  with check (app.is_staff_aal2() and app.has_any_role(array['hr_reviewer','hr_approver','system_administrator']));
create policy staff_read_job_versions on public.job_application_versions
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_review_assignments on public.job_review_assignments
  for select to authenticated using (app.is_staff_aal2());
create policy staff_write_review_assignments on public.job_review_assignments
  for all to authenticated using (app.is_staff_aal2() and app.has_any_role(array['hr_reviewer','hr_approver','system_administrator'])) with check (app.is_staff_aal2() and app.has_any_role(array['hr_reviewer','hr_approver','system_administrator']));
create policy staff_read_scorecards on public.job_scorecards
  for select to authenticated using (app.is_staff_aal2());
create policy staff_write_scorecards on public.job_scorecards
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['hr_reviewer','hr_approver','system_administrator']));
create policy staff_read_interviews on public.job_interviews
  for select to authenticated using (app.is_staff_aal2());
create policy staff_write_interviews on public.job_interviews
  for all to authenticated using (app.is_staff_aal2() and app.has_any_role(array['hr_reviewer','hr_approver','system_administrator'])) with check (app.is_staff_aal2() and app.has_any_role(array['hr_reviewer','hr_approver','system_administrator']));
create policy staff_read_job_events on public.job_events
  for select to authenticated using (app.is_staff_aal2());
create policy staff_insert_job_events on public.job_events
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['hr_reviewer','hr_approver','system_administrator']));

-- Public can read published vacancies (terms are immutable versions).
create policy public_read_vacancies on public.job_vacancies
  for select to anon using (current_status = 'published');
create policy public_read_vacancy_versions on public.job_vacancy_versions
  for select to anon using (vacancy_id in (select id from public.job_vacancies where current_status = 'published'));

-- ===========================================================================
-- Base privileges
-- ===========================================================================
grant select, insert, update on public.admission_applications, public.job_applications to authenticated;
grant select, insert, update, delete on public.admission_drafts to authenticated;
grant select on public.admission_application_versions, public.job_application_versions to authenticated;
grant select on public.admission_events, public.job_events to authenticated;
grant select, update on public.admission_offers to authenticated;
grant select on public.admission_windows, public.admission_reviews, public.admission_assessments to authenticated;
grant select, insert, update on public.job_review_assignments, public.job_scorecards, public.job_interviews to authenticated;
grant select, insert, update, delete on public.job_vacancies to authenticated;
grant select, insert on public.job_vacancy_versions to authenticated;
grant select on public.job_vacancies to anon;
grant select on public.job_vacancy_versions to anon;

commit;
