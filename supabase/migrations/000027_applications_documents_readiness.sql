-- =============================================================================
-- 000027 — Slice 3 application, enrollment-readiness, and upload lifecycle
--
-- Local-first, forward-only migration.  It is intentionally not a staging or
-- production claim.  This migration closes the application/document boundary
-- left by 000022–000026:
--   * admission configuration and document requirements are data;
--   * submit and conversion are owner/version/readiness guarded transactions;
--   * duplicate students require verified evidence or human review;
--   * career drafts, decisions, scorecards, and retention are durable;
--   * private uploads move through intent -> pending_scan -> ready/quarantined.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Normative configuration and application evidence
-- ---------------------------------------------------------------------------

alter table public.admission_windows
  add column if not exists version int not null default 1,
  add column if not exists eligibility_policy jsonb not null default '{}'::jsonb;

alter table public.admission_drafts
  add column if not exists version int not null default 1;

alter table public.admission_applications
  drop constraint if exists admission_applications_current_status_check;
alter table public.admission_applications
  add constraint admission_applications_current_status_check
  check (current_status in ('draft', 'submitted', 'under_review', 'changes_requested',
                            'assessment', 'offered', 'waitlisted', 'declined',
                            'duplicate_review', 'enrolled', 'withdrawn'));

create table if not exists public.admission_document_requirements (
  id                  uuid primary key default gen_random_uuid(),
  reference           text not null unique default app.new_ref('ADREQ'),
  admission_window_id uuid not null references public.admission_windows(id) on delete restrict,
  code                text not null,
  label               text not null,
  required            boolean not null default true,
  allowed_mime_types  text[] not null default array['application/pdf','image/jpeg','image/png'],
  max_bytes           bigint not null default 5242880 check (max_bytes > 0),
  status              text not null default 'active' check (status in ('active','archived')),
  version             int not null default 1 check (version > 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (admission_window_id, code, version)
);
create index if not exists admission_document_requirements_window_idx
  on public.admission_document_requirements (admission_window_id, status, required);
drop trigger if exists admission_document_requirements_touch on public.admission_document_requirements;
create trigger admission_document_requirements_touch before update
  on public.admission_document_requirements for each row execute function app.touch_updated_at();

create table if not exists public.admission_identity_evidence (
  id                    uuid primary key default gen_random_uuid(),
  reference             text not null unique default app.new_ref('AIE'),
  application_id        uuid not null references public.admission_applications(id) on delete restrict,
  candidate_student_id  uuid not null references public.students(id) on delete restrict,
  evidence_type         text not null check (evidence_type in ('birth_certificate','school_reference','verified_document','guardian_reference','other')),
  evidence_reference    text,
  document_id           uuid references public.documents(id) on delete restrict,
  status                text not null default 'pending' check (status in ('pending','verified','rejected')),
  verified_by_account_id uuid references public.user_accounts(id) on delete restrict,
  verified_at           timestamptz,
  reason                text,
  created_at            timestamptz not null default now()
);
create index if not exists admission_identity_evidence_lookup_idx
  on public.admission_identity_evidence (application_id, candidate_student_id, status);

create table if not exists public.admission_duplicate_reviews (
  id                    uuid primary key default gen_random_uuid(),
  reference             text not null unique default app.new_ref('DUP'),
  application_id        uuid not null unique references public.admission_applications(id) on delete restrict,
  candidate_student_id  uuid not null references public.students(id) on delete restrict,
  status                text not null default 'pending' check (status in ('pending','approved','rejected')),
  reason                text not null,
  reviewed_by_account_id uuid references public.user_accounts(id) on delete restrict,
  reviewed_at           timestamptz,
  version               int not null default 1 check (version > 0),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
drop trigger if exists admission_duplicate_reviews_touch on public.admission_duplicate_reviews;
create trigger admission_duplicate_reviews_touch before update
  on public.admission_duplicate_reviews for each row execute function app.touch_updated_at();

-- Offers now carry an explicit checker approval marker.  The existing
-- decided_by_account_id remains for compatibility with the earlier schema.
alter table public.admission_offers
  add column if not exists final_approved_by_account_id uuid references public.user_accounts(id) on delete restrict,
  add column if not exists final_approved_at timestamptz;

-- An admission invoice may be settled by a captured payment or an explicitly
-- approved waiver.  A waiver is never inferred from a zero amount.
alter table public.invoices
  drop constraint if exists invoices_status_check;
alter table public.invoices
  add constraint invoices_status_check
  check (status in ('unpaid', 'partial', 'paid', 'waived', 'overdue', 'cancelled'));
alter table public.invoices
  add column if not exists waived_at timestamptz,
  add column if not exists waived_by_account_id uuid references public.user_accounts(id) on delete restrict,
  add column if not exists waiver_reason text;

-- ---------------------------------------------------------------------------
-- Durable careers workflow projections
-- ---------------------------------------------------------------------------

alter table public.job_application_drafts
  add column if not exists version int not null default 1;

create table if not exists public.job_application_decisions (
  id                    uuid primary key default gen_random_uuid(),
  reference             text not null unique default app.new_ref('JDEC'),
  application_id        uuid not null references public.job_applications(id) on delete restrict,
  actor_account_id      uuid not null references public.user_accounts(id) on delete restrict,
  action                text not null check (action in ('shortlist','interview','offer','not_selected')),
  from_status           text not null,
  to_status             text not null,
  reason                text,
  private_note          text,
  version               int not null check (version > 0),
  created_at            timestamptz not null default now(),
  unique (application_id, version)
);
create index if not exists job_application_decisions_scope_idx
  on public.job_application_decisions (application_id, created_at desc);

create table if not exists public.job_scorecard_versions (
  id                    uuid primary key default gen_random_uuid(),
  scorecard_id          uuid not null references public.job_scorecards(id) on delete restrict,
  application_id        uuid not null references public.job_applications(id) on delete restrict,
  reviewer_account_id   uuid not null references public.user_accounts(id) on delete restrict,
  version               int not null check (version > 0),
  score                 numeric not null check (score >= 0),
  notes                 text,
  created_at            timestamptz not null default now(),
  unique (scorecard_id, version)
);
create index if not exists job_scorecard_versions_application_idx
  on public.job_scorecard_versions (application_id, created_at desc);

create table if not exists public.job_retention_records (
  id                    uuid primary key default gen_random_uuid(),
  reference             text not null unique default app.new_ref('JRET'),
  application_id        uuid not null unique references public.job_applications(id) on delete restrict,
  eligible_at           timestamptz not null,
  legal_hold_until      timestamptz,
  status                text not null default 'retained' check (status in ('retained','eligible','held','anonymised','deleted')),
  reason                text,
  updated_at            timestamptz not null default now(),
  created_at            timestamptz not null default now()
);
drop trigger if exists job_retention_records_touch on public.job_retention_records;
create trigger job_retention_records_touch before update
  on public.job_retention_records for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Private upload lifecycle metadata
-- ---------------------------------------------------------------------------

alter table public.documents
  drop constraint if exists documents_scan_status_check;
alter table public.documents
  add constraint documents_scan_status_check
  check (scan_status in ('pending_scan', 'ready', 'clean', 'quarantined', 'failed'));
alter table public.documents
  add column if not exists declared_mime_type text,
  add column if not exists actual_mime_type text,
  add column if not exists actual_size_bytes bigint check (actual_size_bytes is null or actual_size_bytes >= 0),
  add column if not exists allowed_mime_types text[] not null default array['application/pdf','image/jpeg','image/png'],
  add column if not exists max_bytes bigint not null default 5242880 check (max_bytes > 0),
  add column if not exists checksum_algorithm text not null default 'sha256',
  add column if not exists checksum_verified boolean not null default false,
  add column if not exists finalized_at timestamptz,
  add column if not exists attachment_code text;

alter table public.admission_documents add column if not exists requirement_code text;
alter table public.job_documents add column if not exists requirement_code text;

create index if not exists documents_reference_owner_idx
  on public.documents (reference, owner_domain, owner_record_id, scan_status);

-- ---------------------------------------------------------------------------
-- Configuration projection RPCs
-- ---------------------------------------------------------------------------

create or replace function app.admission_public_configuration(
  p_academic_year_id uuid default null
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'academicYears', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ay.id, 'ref', ay.reference, 'label', ay.label,
        'startsOn', ay.starts_on, 'endsOn', ay.ends_on, 'status', ay.status
      ) order by ay.starts_on desc)
      from public.academic_years ay
      where p_academic_year_id is null or ay.id = p_academic_year_id
    ), '[]'::jsonb),
    'grades', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'ref', g.code, 'code', g.code, 'label', g.label, 'sortOrder', g.sort_order
      ) order by g.sort_order, g.code)
      from public.grades g
    ), '[]'::jsonb),
    'windows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', aw.id, 'ref', aw.reference, 'academicYearId', aw.academic_year_id,
        'gradeId', aw.grade_id, 'opensAt', aw.opens_at, 'closesAt', aw.closes_at,
        'capacity', aw.capacity, 'status', aw.status, 'version', aw.version,
        'policy', aw.policy, 'eligibilityPolicy', aw.eligibility_policy
      ) order by aw.opens_at, aw.id)
      from public.admission_windows aw
      where p_academic_year_id is null or aw.academic_year_id = p_academic_year_id
    ), '[]'::jsonb),
    'documentRequirements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', dr.id, 'ref', dr.reference, 'windowId', dr.admission_window_id,
        'code', dr.code, 'label', dr.label, 'required', dr.required,
        'allowedMimeTypes', dr.allowed_mime_types, 'maxBytes', dr.max_bytes,
        'status', dr.status, 'version', dr.version
      ) order by dr.admission_window_id, dr.version, dr.code)
      from public.admission_document_requirements dr
      join public.admission_windows aw on aw.id = dr.admission_window_id
      where dr.status = 'active'
        and (p_academic_year_id is null or aw.academic_year_id = p_academic_year_id)
    ), '[]'::jsonb),
    'policy', coalesce((
      select jsonb_build_object('version', sv.version, 'status', sv.status, 'values', sv.policy)
      from public.settings_versions sv order by sv.version desc limit 1
    ), 'null'::jsonb)
  )
$$;

revoke all on function app.admission_public_configuration(uuid) from public;
grant execute on function app.admission_public_configuration(uuid) to anon, authenticated;

create or replace function app.admission_configuration()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app.admission_public_configuration(null)
$$;
revoke all on function app.admission_configuration() from public;
grant execute on function app.admission_configuration() to authenticated;

-- ---------------------------------------------------------------------------
-- Admission draft and submission commands
-- ---------------------------------------------------------------------------

create or replace function app.admissions_save_draft_v2(
  p_application_id uuid default null,
  p_academic_year_id uuid default null,
  p_grade_id uuid default null,
  p_student_name text default null,
  p_parent_name text default null,
  p_parent_contact text default null,
  p_draft jsonb default '{}'::jsonb,
  p_schema_version int default 1,
  p_expected_version int default null,
  p_expected_draft_version int default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.admission_applications%rowtype;
  v_window public.admission_windows%rowtype;
  v_draft public.admission_drafts%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if p_draft is null or jsonb_typeof(p_draft) <> 'object' then raise exception 'draft must be an object'; end if;
  if p_schema_version is null or p_schema_version < 1 then raise exception 'invalid draft schema version'; end if;

  if p_application_id is null then
    if p_academic_year_id is null or p_grade_id is null then raise exception 'academic year and grade are required for a new draft'; end if;
    if p_student_name is null or length(btrim(p_student_name)) = 0 or p_parent_name is null or length(btrim(p_parent_name)) = 0 then
      raise exception 'student and guardian names are required for a new draft';
    end if;
    select * into v_window from public.admission_windows
     where academic_year_id = p_academic_year_id and grade_id = p_grade_id
     order by version desc, created_at desc limit 1;
    if v_window.id is null then raise exception 'admission window is not configured'; end if;
    insert into public.admission_applications
      (owner_account_id, academic_year_id, grade_id, current_status, student_name, parent_name, parent_contact)
    values (auth.uid(), p_academic_year_id, p_grade_id, 'draft', btrim(p_student_name), btrim(p_parent_name), nullif(btrim(p_parent_contact), ''))
    returning * into v_app;
  else
    select * into v_app from public.admission_applications where id = p_application_id for update;
    if v_app.id is null then raise exception 'application not found'; end if;
    if v_app.owner_account_id <> auth.uid() then raise exception 'not the application owner'; end if;
    if v_app.current_status not in ('draft','changes_requested') then raise exception 'application is not in an editable state (%)', v_app.current_status; end if;
    if p_expected_version is not null and v_app.version <> p_expected_version then raise exception 'application version mismatch (expected %, found %)', p_expected_version, v_app.version; end if;
    if p_academic_year_id is not null or p_grade_id is not null then
      select * into v_window from public.admission_windows
       where academic_year_id = coalesce(p_academic_year_id, v_app.academic_year_id)
         and grade_id = coalesce(p_grade_id, v_app.grade_id)
       order by version desc, created_at desc limit 1;
      if v_window.id is null then raise exception 'admission window is not configured'; end if;
    end if;
    update public.admission_applications
       set academic_year_id = coalesce(p_academic_year_id, academic_year_id),
           grade_id = coalesce(p_grade_id, grade_id),
           student_name = coalesce(nullif(btrim(p_student_name), ''), student_name),
           parent_name = coalesce(nullif(btrim(p_parent_name), ''), parent_name),
           parent_contact = coalesce(nullif(btrim(p_parent_contact), ''), parent_contact)
     where id = v_app.id
     returning * into v_app;
  end if;

  select * into v_draft from public.admission_drafts where application_id = v_app.id for update;
  if v_draft.id is not null and p_expected_draft_version is not null and v_draft.version <> p_expected_draft_version then
    raise exception 'draft version mismatch (expected %, found %)', p_expected_draft_version, v_draft.version;
  end if;
  insert into public.admission_drafts (application_id, draft, schema_version, expires_at, version)
  values (v_app.id, p_draft, p_schema_version, now() + interval '90 days', coalesce(v_draft.version, 0) + 1)
  on conflict (application_id) do update set draft = excluded.draft,
    schema_version = excluded.schema_version, expires_at = excluded.expires_at,
    version = public.admission_drafts.version + 1, updated_at = now()
  returning * into v_draft;

  return jsonb_build_object('id', v_app.id, 'reference', v_app.reference,
    'version', v_app.version, 'draftVersion', v_draft.version, 'status', v_app.current_status,
    'updatedAt', v_draft.updated_at);
end
$$;

create or replace function app.admissions_save_draft(
  p_application_id uuid default null,
  p_academic_year_id uuid default null,
  p_grade_id uuid default null,
  p_student_name text default null,
  p_parent_name text default null,
  p_parent_contact text default null,
  p_draft jsonb default '{}'::jsonb,
  p_schema_version int default 1,
  p_expected_version int default null
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app.admissions_save_draft_v2(p_application_id, p_academic_year_id, p_grade_id,
    p_student_name, p_parent_name, p_parent_contact, p_draft, p_schema_version, p_expected_version, null)
$$;

create or replace function app.admission_eligibility_valid(
  p_app public.admission_applications,
  p_window public.admission_windows,
  p_snapshot jsonb
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_value jsonb;
  v_required jsonb := coalesce(p_window.eligibility_policy -> 'required_fields', p_window.policy -> 'required_fields', '[]'::jsonb);
  v_dob date;
  v_age int;
begin
  if jsonb_typeof(p_snapshot) <> 'object' then return false; end if;
  if length(btrim(coalesce(p_app.student_name, ''))) = 0 or length(btrim(coalesce(p_app.parent_name, ''))) = 0 then return false; end if;
  if jsonb_typeof(v_required) = 'array' then
    for v_key in select jsonb_array_elements_text(v_required) loop
      v_value := p_snapshot -> v_key;
      if v_value is null or v_value = 'null'::jsonb or (jsonb_typeof(v_value) = 'string' and length(btrim(v_value #>> '{}')) = 0) then return false; end if;
    end loop;
  end if;
  if coalesce(p_window.eligibility_policy ->> 'min_age', p_window.policy ->> 'min_age') is not null
     or coalesce(p_window.eligibility_policy ->> 'max_age', p_window.policy ->> 'max_age') is not null then
    begin v_dob := nullif(p_snapshot ->> 'dob', '')::date; exception when others then return false; end;
    if v_dob is null then return false; end if;
    v_age := extract(year from age(coalesce((p_window.eligibility_policy ->> 'cutoff_date')::date, (p_window.policy ->> 'cutoff_date')::date, current_date), v_dob));
    if coalesce((p_window.eligibility_policy ->> 'min_age')::int, (p_window.policy ->> 'min_age')::int, 0) > v_age then return false; end if;
    if coalesce((p_window.eligibility_policy ->> 'max_age')::int, (p_window.policy ->> 'max_age')::int, 200) < v_age then return false; end if;
  end if;
  return true;
end
$$;

create or replace function app.admissions_submit(
  p_application_id uuid,
  p_snapshot jsonb,
  p_expected_version int default 0,
  p_schema_version int default 1
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.admission_applications%rowtype;
  v_window public.admission_windows%rowtype;
  v_next int;
  v_version_id uuid;
  v_policy_status text;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  select * into v_app from public.admission_applications where id = p_application_id for update;
  if v_app.id is null then raise exception 'application not found'; end if;
  if v_app.owner_account_id <> auth.uid() then raise exception 'not the application owner'; end if;
  v_next := p_expected_version + 1;
  select id into v_version_id from public.admission_application_versions where application_id = p_application_id and version = v_next;
  if v_version_id is not null then return v_version_id; end if;
  if v_app.version <> p_expected_version then raise exception 'application version mismatch (expected %, found %)', p_expected_version, v_app.version; end if;
  if v_app.current_status not in ('draft','changes_requested') then raise exception 'application is not in an editable state (%)', v_app.current_status; end if;
  select * into v_window from public.admission_windows
   where academic_year_id = v_app.academic_year_id and grade_id = v_app.grade_id
   order by version desc, created_at desc limit 1;
  if v_window.id is null then raise exception 'admission window is not configured'; end if;
  if v_window.status <> 'open' or now() < v_window.opens_at or now() > v_window.closes_at then raise exception 'admission window is closed'; end if;
  select status into v_policy_status from public.settings_versions order by version desc limit 1;
  if coalesce(v_policy_status, 'policy_pending') <> 'effective'
     or coalesce(v_window.policy ->> 'policy_status', '') = 'policy_pending'
     or coalesce(v_window.policy ->> 'school_decision', '') = 'pending' then
    raise exception 'admission policy is pending school confirmation';
  end if;
  if not app.admission_eligibility_valid(v_app, v_window, p_snapshot) then raise exception 'application does not meet the configured eligibility policy'; end if;
  if exists (
    select 1 from public.admission_document_requirements dr
     where dr.admission_window_id = v_window.id and dr.status = 'active' and dr.required
       and not exists (
         select 1 from public.admission_documents ad join public.documents d on d.id = ad.document_id
          where ad.application_id = p_application_id and ad.requirement_code = dr.code
            and d.scan_status in ('ready','clean') and d.finalized_at is not null
       )
  ) then raise exception 'required admission documents are not ready'; end if;

  insert into public.admission_application_versions (application_id, version, snapshot, schema_version, submitted_by_account_id)
  values (p_application_id, v_next, p_snapshot, p_schema_version, auth.uid()) returning id into v_version_id;
  update public.admission_applications set version = v_next, current_status = 'submitted', submitted_at = now() where id = p_application_id;
  delete from public.admission_drafts where application_id = p_application_id;
  insert into public.admission_events (application_id, event_type, visible_to_applicant, copy)
  values (p_application_id, 'submitted', true, 'Application submitted');
  perform app.record_audit('Admission application submitted', 'admission_application', v_app.reference, 'Success');
  perform app.enqueue_outbox('email.application_submitted:' || v_app.reference || ':v' || v_next,
    'email.deliver', 'admission_application', v_app.reference, jsonb_build_object('channel','email'));
  return v_version_id;
end
$$;

-- Reassert the checker command after 000025 so every newly issued offer has
-- an explicit final-approval marker consumed by readiness/conversion.
create or replace function app.admissions_decide_v2(
  p_application_id uuid, p_action text, p_visible_reason text default null,
  p_private_note text default null, p_conditions jsonb default '{}'::jsonb,
  p_expires_at timestamptz default null, p_expected_version int default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_app public.admission_applications%rowtype; v_next int; v_offer public.admission_offers%rowtype;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('admissions_approver')) then raise exception 'admissions approver role and aal2 required'; end if;
  if p_action not in ('offer','waitlist','decline') then raise exception 'invalid decision action'; end if;
  select * into v_app from public.admission_applications where id = p_application_id for update;
  if v_app.id is null then raise exception 'application not found'; end if;
  if p_expected_version is not null and v_app.version <> p_expected_version then raise exception 'application version mismatch (expected %, found %)', p_expected_version, v_app.version; end if;
  if not app.admission_staff_scope(p_application_id, array['admissions_approver']) then raise exception 'application is outside the approver scope'; end if;
  if v_app.owner_account_id = auth.uid() then raise exception 'an approver cannot decide their own application'; end if;
  if not exists (select 1 from public.admission_reviews ar where ar.application_id = p_application_id and ar.officer_account_id <> auth.uid() and ar.action in ('reviewed','moved_to_assessment','requested_changes')) then raise exception 'a separate admissions reviewer step is required'; end if;
  if v_app.current_status not in ('under_review','assessment') then raise exception 'application cannot be decided in state (%)', v_app.current_status; end if;
  v_next := v_app.version + 1;
  if p_action = 'offer' then
    insert into public.admission_offers (application_id, grade_id, academic_year_id, conditions, expires_at, decided_by_account_id, final_approved_by_account_id, final_approved_at)
    values (p_application_id, v_app.grade_id, v_app.academic_year_id, coalesce(p_conditions,'{}'::jsonb), coalesce(p_expires_at, now() + interval '14 days'), auth.uid(), auth.uid(), now())
    returning * into v_offer;
    update public.admission_applications set current_status = 'offered', version = v_next where id = p_application_id;
    insert into public.admission_events (application_id, event_type, visible_to_applicant, copy) values (p_application_id, 'offered', true, 'Offer extended');
    perform app.enqueue_outbox('email.offer:' || v_app.reference, 'email.deliver', 'admission_application', v_app.reference, jsonb_build_object('channel','email'));
  elsif p_action = 'waitlist' then
    update public.admission_applications set current_status = 'waitlisted', version = v_next where id = p_application_id;
    insert into public.admission_events (application_id, event_type, visible_to_applicant, copy) values (p_application_id, 'waitlisted', true, 'Placed on the waitlist');
  else
    update public.admission_applications set current_status = 'declined', version = v_next where id = p_application_id;
    insert into public.admission_events (application_id, event_type, visible_to_applicant, copy) values (p_application_id, 'declined', true, 'Application declined: ' || coalesce(p_visible_reason, 'no reason given'));
  end if;
  insert into public.admission_reviews (application_id, officer_account_id, action, visible_reason, private_note) values (p_application_id, auth.uid(), 'reviewed', p_visible_reason, p_private_note);
  perform app.record_audit('Admission decision: ' || p_action, 'admission_application', v_app.reference, 'Success');
  return jsonb_build_object('applicationId', v_app.id, 'reference', v_app.reference, 'status', case p_action when 'offer' then 'offered' when 'waitlist' then 'waitlisted' else 'declined' end, 'version', v_next);
end
$$;

-- ---------------------------------------------------------------------------
-- Authoritative readiness and duplicate-safe enrollment conversion
-- ---------------------------------------------------------------------------

create or replace function app.enrollment_readiness(p_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.admission_applications%rowtype;
  v_offer public.admission_offers%rowtype;
  v_invoice public.invoices%rowtype;
  v_window public.admission_windows%rowtype;
  v_section public.grade_sections%rowtype;
  v_capacity int;
  v_enrolled int;
  v_policy_pending boolean := false;
  v_documents_complete boolean := true;
  v_fee_settled boolean := false;
  v_placement boolean := false;
  v_capacity_available boolean := false;
  v_final_approved boolean := false;
  v_pending jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  select * into v_app from public.admission_applications where id = p_application_id;
  if v_app.id is null then raise exception 'application not found'; end if;
  if not (v_app.owner_account_id = auth.uid() or (app.is_staff_aal2() and app.has_any_role(array['admissions_officer','admissions_approver']))) then raise exception 'not authorized to read enrollment readiness'; end if;
  select * into v_offer from public.admission_offers where application_id = p_application_id;
  select * into v_invoice from public.invoices where applicant_ref = v_app.reference;
  select * into v_window from public.admission_windows where academic_year_id = coalesce(v_offer.academic_year_id, v_app.academic_year_id) and grade_id = coalesce(v_offer.grade_id, v_app.grade_id) order by version desc limit 1;
  select * into v_section from public.grade_sections where academic_year_id = coalesce(v_offer.academic_year_id, v_app.academic_year_id) and grade_id = coalesce(v_offer.grade_id, v_app.grade_id) and status = 'active' order by section_label limit 1;
  -- decided_by_account_id is the legacy approval marker; new offers also set
  -- the explicit final_* columns.  Either is an auditable approver decision.
  v_final_approved := v_offer.decided_by_account_id is not null
    or (v_offer.final_approved_at is not null and v_offer.final_approved_by_account_id is not null);
  v_fee_settled := v_invoice.id is not null and (app.invoice_balance(v_invoice.id) <= 0) and (v_invoice.status in ('paid','waived') or v_invoice.waived_at is not null);
  v_placement := v_section.id is not null;
  if v_window.id is null or v_window.status <> 'open' then v_policy_pending := true; v_pending := v_pending || jsonb_build_array('admission-window'); end if;
  if not exists (select 1 from public.settings_versions where status = 'effective') then v_policy_pending := true; v_pending := v_pending || jsonb_build_array('school-policy'); end if;
  if v_window.id is not null and exists (select 1 from public.admission_document_requirements dr where dr.admission_window_id = v_window.id and dr.status = 'active' and dr.required and not exists (select 1 from public.admission_documents ad join public.documents d on d.id = ad.document_id where ad.application_id = p_application_id and ad.requirement_code = dr.code and d.scan_status in ('ready','clean') and d.finalized_at is not null)) then v_documents_complete := false; end if;
  if v_window.capacity is null then v_capacity_available := false; v_policy_pending := true; v_pending := v_pending || jsonb_build_array('admission-capacity');
  else
    select count(*) into v_enrolled from public.enrollments e join public.grade_sections gs on gs.id = e.grade_section_id where e.academic_year_id = coalesce(v_offer.academic_year_id, v_app.academic_year_id) and gs.grade_id = coalesce(v_offer.grade_id, v_app.grade_id) and e.status = 'active';
    v_capacity_available := v_enrolled < v_window.capacity;
  end if;
  return jsonb_build_object(
    'applicationRef', v_app.reference,
    'offered', v_offer.id is not null,
    'accepted', v_offer.response = 'accepted',
    'admissionInvoiceRef', case when v_invoice.id is null then null else v_invoice.reference end,
    'feePaid', v_fee_settled,
    'feeWaived', v_invoice.waived_at is not null or (v_invoice.id is not null and v_invoice.status = 'waived'),
    'documentsComplete', v_documents_complete,
    'placementAvailable', v_placement,
    'capacityAvailable', v_capacity_available,
    'finalApproved', v_final_approved,
    'policyPending', v_policy_pending,
    'policyPendingKeys', v_pending,
    'ready', (v_offer.response = 'accepted' and v_fee_settled and v_documents_complete and v_placement and v_capacity_available and v_final_approved and not v_policy_pending)
  );
end
$$;

create or replace function app.admissions_duplicate_review_resolve(
  p_application_id uuid,
  p_candidate_student_id uuid,
  p_outcome text,
  p_evidence_type text,
  p_evidence_reference text,
  p_reason text,
  p_expected_version int default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.admission_applications%rowtype;
  v_review public.admission_duplicate_reviews%rowtype;
  v_evidence public.admission_identity_evidence%rowtype;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('admissions_approver')) then raise exception 'admissions approver role and aal2 required'; end if;
  if p_outcome not in ('approved','rejected') then raise exception 'invalid duplicate review outcome'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'duplicate review reason is required'; end if;
  select * into v_app from public.admission_applications where id = p_application_id for update;
  if v_app.id is null then raise exception 'application not found'; end if;
  if p_expected_version is not null and v_app.version <> p_expected_version then raise exception 'application version mismatch (expected %, found %)', p_expected_version, v_app.version; end if;
  select * into v_review from public.admission_duplicate_reviews where application_id = p_application_id for update;
  if v_review.id is null then raise exception 'duplicate review not found'; end if;
  if v_review.candidate_student_id <> p_candidate_student_id then raise exception 'duplicate candidate does not match review'; end if;
  insert into public.admission_identity_evidence (application_id, candidate_student_id, evidence_type, evidence_reference, status, verified_by_account_id, verified_at, reason)
  values (p_application_id, p_candidate_student_id, p_evidence_type, nullif(btrim(p_evidence_reference),''), case when p_outcome = 'approved' then 'verified' else 'rejected' end, auth.uid(), now(), btrim(p_reason)) returning * into v_evidence;
  update public.admission_duplicate_reviews set status = p_outcome, reviewed_by_account_id = auth.uid(), reviewed_at = now(), reason = btrim(p_reason), version = v_review.version + 1 where id = v_review.id;
  update public.admission_applications set current_status = case when p_outcome = 'approved' then 'submitted' else 'declined' end, version = version + 1 where id = v_app.id;
  insert into public.admission_events (application_id, event_type, visible_to_applicant, copy) values (p_application_id, 'duplicate_review_' || p_outcome, false, 'Duplicate identity review recorded');
  perform app.record_audit('Admission duplicate review: ' || p_outcome, 'admission_application', v_app.reference, 'Success', btrim(p_reason));
  return jsonb_build_object('applicationRef', v_app.reference, 'status', p_outcome, 'evidenceRef', v_evidence.reference);
end
$$;

create or replace function app.enrollment_convert(p_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.admission_applications%rowtype;
  v_offer public.admission_offers%rowtype;
  v_invoice public.invoices%rowtype;
  v_window public.admission_windows%rowtype;
  v_section public.grade_sections%rowtype;
  v_existing public.enrollment_conversions%rowtype;
  v_candidate_student uuid;
  v_candidate_enrollment uuid;
  v_candidate_link uuid;
  v_review public.admission_duplicate_reviews%rowtype;
  v_person_id uuid;
  v_student_id uuid;
  v_enrollment_id uuid;
  v_guardian_id uuid;
  v_link_id uuid;
  v_enrolled int;
  v_result jsonb;
  v_readiness jsonb;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  select * into v_existing from public.enrollment_conversions where application_id = p_application_id;
  if v_existing.id is not null then return v_existing.result; end if;
  select * into v_app from public.admission_applications where id = p_application_id for update;
  if v_app.id is null then raise exception 'application not found'; end if;
  if not (v_app.owner_account_id = auth.uid() or (app.is_staff_aal2() and app.has_role('admissions_approver'))) then raise exception 'not authorized to convert this application'; end if;
  select * into v_offer from public.admission_offers where application_id = p_application_id for update;
  if v_offer.id is null or v_offer.response <> 'accepted' then raise exception 'offer must be accepted before conversion'; end if;
  select * into v_invoice from public.invoices where applicant_ref = v_app.reference for update;
  select * into v_window from public.admission_windows where academic_year_id = v_offer.academic_year_id and grade_id = v_offer.grade_id order by version desc, created_at desc limit 1 for update;
  if v_window.id is null then raise exception 'admission placement window is not configured'; end if;
  -- The window row is the capacity root.  Lock it before consuming the
  -- authoritative readiness projection and before the final capacity check.
  select * into v_review from public.admission_duplicate_reviews where application_id = p_application_id for update;
  if v_review.id is not null and v_review.status = 'pending' then
    return jsonb_build_object('application', v_app.reference, 'status', 'manual_review_required', 'manualReviewRequired', true, 'duplicateReviewRef', v_review.reference, 'candidateStudent', v_review.candidate_student_id, 'matched_existing', false);
  elsif v_review.id is not null and v_review.status = 'rejected' then
    return jsonb_build_object('application', v_app.reference, 'status', 'manual_review_rejected', 'manualReviewRequired', true, 'duplicateReviewRef', v_review.reference, 'candidateStudent', v_review.candidate_student_id, 'matched_existing', false);
  end if;
  v_readiness := app.enrollment_readiness(p_application_id);
  if coalesce((v_readiness ->> 'ready')::boolean, false) is not true then
    raise exception 'enrollment readiness failed: %', coalesce(v_readiness ->> 'policyPendingKeys', v_readiness::text);
  end if;
  select * into v_section from public.grade_sections where academic_year_id = v_offer.academic_year_id and grade_id = v_offer.grade_id and status = 'active' order by section_label limit 1;
  if v_section.id is null then raise exception 'no grade section configured for the offer placement'; end if;
  -- Recheck the capacity predicate while the configuration root is locked;
  -- readiness is authoritative for the other gates, this closes the race
  -- between the projection read and the conversion insert.
  select count(*) into v_enrolled from public.enrollments e join public.grade_sections gs on gs.id = e.grade_section_id where e.academic_year_id = v_offer.academic_year_id and gs.grade_id = v_offer.grade_id and e.status = 'active';
  if v_window.capacity is null or v_enrolled >= v_window.capacity then raise exception 'admission capacity is unavailable'; end if;

  -- A same-name candidate is only a duplicate signal.  It is never merged on
  -- name/guardian/placement alone.  A verified evidence row is required.
  select s.id, e.id, l.id into v_candidate_student, v_candidate_enrollment, v_candidate_link
    from public.students s join public.people p on p.id = s.person_id
    join public.enrollments e on e.student_id = s.id and e.status = 'active' and e.academic_year_id = v_offer.academic_year_id
    join public.grade_sections gs on gs.id = e.grade_section_id and gs.grade_id = v_offer.grade_id
    join public.guardian_student_links l on l.student_id = s.id and l.status = 'active'
    join public.guardians g on g.id = l.guardian_id
    join public.user_accounts ua on ua.person_id = g.person_id and ua.id = v_app.owner_account_id
   where lower(regexp_replace(btrim(p.display_name), '\\s+', ' ', 'g')) = lower(regexp_replace(btrim(v_app.student_name), '\\s+', ' ', 'g'))
   order by e.created_at limit 1;
  if v_candidate_student is not null then
    if not exists (select 1 from public.admission_identity_evidence ie where ie.application_id = p_application_id and ie.candidate_student_id = v_candidate_student and ie.status = 'verified' and ie.evidence_type in ('birth_certificate','school_reference','verified_document','guardian_reference','other')) then
      insert into public.admission_duplicate_reviews (application_id, candidate_student_id, reason)
      values (p_application_id, v_candidate_student, 'A same-name enrolled student requires verified identity evidence before matching.')
      on conflict (application_id) do update set updated_at = now(), version = public.admission_duplicate_reviews.version + 1
      returning * into v_review;
      update public.admission_applications set current_status = 'duplicate_review', version = version + 1 where id = p_application_id;
      insert into public.admission_events (application_id, event_type, visible_to_applicant, copy) values (p_application_id, 'duplicate_review', false, 'Manual duplicate review required');
      perform app.record_audit('Admission duplicate review required', 'admission_application', v_app.reference, 'Failed', 'Verified identity evidence is required before an existing student can be matched.');
      return jsonb_build_object('application', v_app.reference, 'status', 'manual_review_required', 'manualReviewRequired', true, 'duplicateReviewRef', v_review.reference, 'candidateStudent', v_candidate_student, 'matched_existing', false);
    end if;
    update public.invoices set student_id = v_candidate_student, enrollment_id = v_candidate_enrollment where id = v_invoice.id;
    update public.admission_applications set current_status = 'enrolled' where id = v_app.id;
    v_result := jsonb_build_object('application', v_app.reference, 'student', v_candidate_student, 'enrollment', v_candidate_enrollment, 'invoice', v_invoice.reference, 'guardian_link', v_candidate_link, 'matched_existing', true);
    insert into public.enrollment_conversions (application_id, student_id, enrollment_id, guardian_link_id, matched_existing, result) values (v_app.id, v_candidate_student, v_candidate_enrollment, v_candidate_link, true, v_result);
    insert into public.admission_events (application_id, event_type, visible_to_applicant, copy) values (v_app.id, 'enrolled', true, 'Enrollment complete — verified existing student match');
    perform app.record_audit('Enrollment conversion matched verified student', 'enrollment', v_candidate_enrollment::text, 'Success');
    return v_result;
  end if;

  insert into public.people (given_name, family_name, display_name) values (v_app.student_name, '', v_app.student_name) returning id into v_person_id;
  insert into public.students (person_id, status) values (v_person_id, 'active') returning id into v_student_id;
  insert into public.enrollments (student_id, academic_year_id, grade_section_id, status) values (v_student_id, v_offer.academic_year_id, v_section.id, 'active') returning id into v_enrollment_id;
  insert into public.guardians (person_id, status) select ua.person_id, 'active' from public.user_accounts ua where ua.id = v_app.owner_account_id on conflict (person_id) do nothing;
  select g.id into v_guardian_id from public.guardians g join public.user_accounts ua on ua.person_id = g.person_id where ua.id = v_app.owner_account_id;
  insert into public.guardian_student_links (guardian_id, student_id, relationship_label, status, verification_source, approved_by_account_id, approved_at, effective_from) values (v_guardian_id, v_student_id, 'Parent', 'active', 'enrollment_invitation', auth.uid(), now(), now()) returning id into v_link_id;
  update public.invoices set student_id = v_student_id, enrollment_id = v_enrollment_id where id = v_invoice.id;
  update public.admission_applications set current_status = 'enrolled' where id = v_app.id;
  v_result := jsonb_build_object('application', v_app.reference, 'student', v_student_id, 'enrollment', v_enrollment_id, 'invoice', v_invoice.reference, 'guardian_link', v_link_id, 'matched_existing', false);
  insert into public.enrollment_conversions (application_id, student_id, enrollment_id, guardian_link_id, matched_existing, result) values (v_app.id, v_student_id, v_enrollment_id, v_link_id, false, v_result);
  insert into public.admission_events (application_id, event_type, visible_to_applicant, copy) values (v_app.id, 'enrolled', true, 'Enrollment complete');
  perform app.record_audit('Enrollment conversion', 'enrollment', v_enrollment_id::text, 'Success');
  perform app.enqueue_outbox('email.enrollment_complete:' || v_app.reference, 'email.deliver', 'enrollment', v_enrollment_id::text, jsonb_build_object('channel','email'));
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------
-- Careers durable draft/decision/retention commands
-- ---------------------------------------------------------------------------

create or replace function app.jobs_create_draft(
  p_vacancy_version_id uuid,
  p_applicant_name text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.job_vacancy_versions%rowtype;
  v_app public.job_applications%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if p_applicant_name is null or length(btrim(p_applicant_name)) < 2 then raise exception 'applicant name is required'; end if;
  select * into v_version from public.job_vacancy_versions where id = p_vacancy_version_id;
  if v_version.id is null then raise exception 'vacancy version not found'; end if;
  if not exists (select 1 from public.job_vacancies v where v.id = v_version.vacancy_id and v.current_status = 'published') then raise exception 'vacancy is not open'; end if;
  select * into v_app from public.job_applications where owner_account_id = auth.uid() and vacancy_id = v_version.vacancy_id and vacancy_version = v_version.version and current_status = 'draft' order by created_at limit 1 for update;
  if v_app.id is not null then return jsonb_build_object('id', v_app.id, 'reference', v_app.reference, 'version', v_app.version, 'status', v_app.current_status, 'created', false); end if;
  insert into public.job_applications (vacancy_id, vacancy_version, owner_account_id, current_status, applicant_name) values (v_version.vacancy_id, v_version.version, auth.uid(), 'draft', btrim(p_applicant_name)) returning * into v_app;
  insert into public.job_application_drafts (application_id, draft, schema_version, expires_at, version) values (v_app.id, '{}'::jsonb, 1, now() + interval '90 days', 1);
  return jsonb_build_object('id', v_app.id, 'reference', v_app.reference, 'version', v_app.version, 'status', v_app.current_status, 'created', true);
end
$$;

create or replace function app.jobs_save_draft_v2(
  p_application_id uuid,
  p_draft jsonb,
  p_schema_version int default 1,
  p_expected_version int default null,
  p_expected_draft_version int default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_app public.job_applications%rowtype; v_draft public.job_application_drafts%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  select * into v_app from public.job_applications where id = p_application_id for update;
  if v_app.id is null or v_app.owner_account_id <> auth.uid() then raise exception 'not the application owner'; end if;
  if v_app.current_status not in ('draft','eligibility_review') then raise exception 'application is not in an editable state (%)', v_app.current_status; end if;
  if p_expected_version is not null and v_app.version <> p_expected_version then raise exception 'application version mismatch (expected %, found %)', p_expected_version, v_app.version; end if;
  select * into v_draft from public.job_application_drafts where application_id = p_application_id for update;
  if v_draft.id is null then
    if p_expected_draft_version is not null and p_expected_draft_version <> 0 then raise exception 'draft version mismatch (expected %, found 0)', p_expected_draft_version; end if;
    insert into public.job_application_drafts (application_id, draft, schema_version, expires_at, version)
    values (p_application_id, coalesce(p_draft,'{}'::jsonb), p_schema_version, now() + interval '90 days', 1)
    returning * into v_draft;
  else
    if p_expected_draft_version is not null and v_draft.version <> p_expected_draft_version then raise exception 'draft version mismatch (expected %, found %)', p_expected_draft_version, v_draft.version; end if;
    update public.job_application_drafts set draft = coalesce(p_draft,'{}'::jsonb), schema_version = p_schema_version, expires_at = now() + interval '90 days', version = version + 1, updated_at = now() where id = v_draft.id returning * into v_draft;
  end if;
  return jsonb_build_object('id', v_app.id, 'applicationId', v_app.id, 'reference', v_app.reference, 'applicationVersion', v_app.version, 'draftVersion', v_draft.version, 'updatedAt', v_draft.updated_at);
end
$$;

create or replace function app.jobs_save_draft(
  p_application_id uuid,
  p_draft jsonb,
  p_schema_version int default 1,
  p_expected_version int default null
)
returns jsonb language sql security definer set search_path = '' as $$
  select app.jobs_save_draft_v2(p_application_id, p_draft, p_schema_version, p_expected_version, null)
$$;

create or replace function app.jobs_submit(
  p_application_id uuid,
  p_snapshot jsonb,
  p_expected_version int default 0
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.job_applications%rowtype;
  v_version public.job_vacancy_versions%rowtype;
  v_next int;
  v_version_id uuid;
  v_retention_days int;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  select * into v_app from public.job_applications where id = p_application_id for update;
  if v_app.id is null then raise exception 'application not found'; end if;
  if v_app.owner_account_id <> auth.uid() then raise exception 'not the application owner'; end if;
  v_next := p_expected_version + 1;
  select id into v_version_id from public.job_application_versions where application_id = p_application_id and version = v_next;
  if v_version_id is not null then return v_version_id; end if;
  if v_app.version <> p_expected_version then raise exception 'application version mismatch (expected %, found %)', p_expected_version, v_app.version; end if;
  if v_app.current_status not in ('draft','eligibility_review') then raise exception 'application is not in an editable state (%)', v_app.current_status; end if;
  select * into v_version from public.job_vacancy_versions where vacancy_id = v_app.vacancy_id and version = v_app.vacancy_version;
  if v_version.id is null then raise exception 'vacancy version not found'; end if;
  if exists (select 1 from public.job_vacancies v where v.id = v_app.vacancy_id and v.current_status <> 'published') then raise exception 'vacancy is closed'; end if;
  if (v_version.terms ->> 'deadlineIso') is not null and now() > (v_version.terms ->> 'deadlineIso')::timestamptz then raise exception 'vacancy application deadline has passed'; end if;
  if jsonb_typeof(v_version.terms -> 'documents') = 'array' and exists (select 1 from jsonb_array_elements_text(v_version.terms -> 'documents') required_doc where not exists (select 1 from public.job_documents jd join public.documents d on d.id = jd.document_id where jd.application_id = p_application_id and jd.requirement_code = required_doc and d.scan_status in ('ready','clean') and d.finalized_at is not null)) then raise exception 'required job documents are not ready'; end if;
  insert into public.job_application_versions (application_id, version, snapshot, submitted_by_account_id) values (p_application_id, v_next, p_snapshot, auth.uid()) returning id into v_version_id;
  update public.job_applications set version = v_next, current_status = 'submitted' where id = p_application_id;
  v_retention_days := greatest(1, coalesce((v_version.terms ->> 'retentionDays')::int, 365));
  insert into public.job_retention_records (application_id, eligible_at, status, reason) values (p_application_id, now() + make_interval(days => v_retention_days), 'retained', 'Vacancy retention policy') on conflict (application_id) do update set eligible_at = excluded.eligible_at, status = 'retained', reason = excluded.reason, updated_at = now();
  insert into public.job_events (application_id, event_type, visible_to_applicant, copy) values (p_application_id, 'submitted', true, 'Application submitted');
  perform app.record_audit('Job application submitted', 'job_application', v_app.reference, 'Success');
  perform app.enqueue_outbox('email.job_submitted:' || v_app.reference, 'email.deliver', 'job_application', v_app.reference, jsonb_build_object('channel','email'));
  return v_version_id;
end
$$;

create or replace function app.jobs_withdraw(p_application_id uuid, p_expected_version int default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_app public.job_applications%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  select * into v_app from public.job_applications where id = p_application_id for update;
  if v_app.id is null or v_app.owner_account_id <> auth.uid() then raise exception 'not the application owner'; end if;
  if p_expected_version is not null and v_app.version <> p_expected_version then raise exception 'application version mismatch (expected %, found %)', p_expected_version, v_app.version; end if;
  if v_app.current_status = 'withdrawn' then return; end if;
  if v_app.current_status in ('offered','not_selected') then raise exception 'application cannot be withdrawn after a terminal decision'; end if;
  update public.job_applications set current_status = 'withdrawn', version = version + 1 where id = p_application_id;
  insert into public.job_events (application_id, event_type, visible_to_applicant, copy) values (p_application_id, 'withdrawn', true, 'Application withdrawn');
  perform app.record_audit('Job application withdrawn', 'job_application', v_app.reference, 'Success');
end
$$;

create or replace function app.jobs_save_scorecard(p_application_id uuid, p_score numeric, p_notes text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_row public.job_scorecards%rowtype; v_version int;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('hr_reviewer')) then raise exception 'HR reviewer role and aal2 required'; end if;
  if p_score is null or p_score < 0 then raise exception 'score must be non-negative'; end if;
  if not exists (select 1 from public.job_review_assignments where application_id = p_application_id and reviewer_account_id = auth.uid() and status in ('assigned','accepted')) then raise exception 'reviewer assignment required'; end if;
  select * into v_row from public.job_scorecards where application_id = p_application_id and reviewer_account_id = auth.uid() order by created_at desc limit 1;
  if v_row.id is null then insert into public.job_scorecards (application_id, reviewer_account_id, score, notes) values (p_application_id, auth.uid(), p_score, p_notes) returning * into v_row; v_version := 1; else select coalesce(max(version),0)+1 into v_version from public.job_scorecard_versions where scorecard_id = v_row.id; update public.job_scorecards set score = p_score, notes = p_notes where id = v_row.id; end if;
  insert into public.job_scorecard_versions (scorecard_id, application_id, reviewer_account_id, version, score, notes) values (v_row.id, p_application_id, auth.uid(), v_version, p_score, p_notes);
  update public.job_review_assignments set status = 'completed' where application_id = p_application_id and reviewer_account_id = auth.uid();
  return v_row.id::text;
end
$$;

create or replace function app.jobs_retention_status(p_application_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('applicationRef', ja.reference, 'eligibleAt', jr.eligible_at, 'status', jr.status, 'legalHoldUntil', jr.legal_hold_until)
    from public.job_applications ja join public.job_retention_records jr on jr.application_id = ja.id
   where ja.id = p_application_id and (ja.owner_account_id = auth.uid() or app.is_staff_aal2())
$$;

-- Record maker/checker decisions and require reviewer evidence before an HR
-- approver can offer/reject a candidate.
create or replace function app.jobs_decide_v2(
  p_application_id uuid, p_action text, p_reason text default null,
  p_private_note text default null, p_scheduled_at timestamptz default null,
  p_expected_version int default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_app public.job_applications%rowtype; v_next int; v_status text; v_role text;
begin
  if auth.uid() is null or not app.is_staff_aal2() then raise exception 'HR role and aal2 required'; end if;
  if p_action not in ('shortlist','interview','offer','not_selected') then raise exception 'invalid decision action'; end if;
  if p_action in ('shortlist','interview') then v_role := 'hr_reviewer'; else v_role := 'hr_approver'; end if;
  if not app.has_role(v_role) then raise exception 'required HR role and aal2 required'; end if;
  select * into v_app from public.job_applications where id = p_application_id for update;
  if v_app.id is null then raise exception 'application not found'; end if;
  if p_expected_version is not null and v_app.version <> p_expected_version then raise exception 'application version mismatch (expected %, found %)', p_expected_version, v_app.version; end if;
  if v_app.owner_account_id = auth.uid() then raise exception 'HR reviewer cannot decide their own application'; end if;
  if p_action in ('shortlist','interview') and not exists (select 1 from public.job_review_assignments where application_id = p_application_id and reviewer_account_id = auth.uid() and status in ('assigned','accepted','completed')) then raise exception 'reviewer assignment required'; end if;
  if p_action in ('offer','not_selected') and not exists (select 1 from public.job_application_decisions where application_id = p_application_id and action in ('shortlist','interview') and actor_account_id <> auth.uid()) then raise exception 'separate HR reviewer decision is required'; end if;
  if p_action in ('offer','not_selected') and length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'HR decision reason is required'; end if;
  if p_action = 'interview' and p_scheduled_at is null then raise exception 'interview requires a scheduled time'; end if;
  v_status := case p_action when 'shortlist' then 'shortlisted' when 'interview' then 'interview' when 'offer' then 'offered' else 'not_selected' end;
  v_next := v_app.version + 1;
  update public.job_applications set current_status = v_status, version = v_next where id = p_application_id;
  if p_action = 'interview' then insert into public.job_interviews (application_id, scheduled_at, outcome, notes) values (p_application_id, p_scheduled_at, 'pending', p_private_note); end if;
  insert into public.job_application_decisions (application_id, actor_account_id, action, from_status, to_status, reason, private_note, version) values (p_application_id, auth.uid(), p_action, v_app.current_status, v_status, p_reason, p_private_note, v_next);
  insert into public.job_events (application_id, event_type, visible_to_applicant, copy) values (p_application_id, p_action, true, coalesce(nullif(btrim(p_reason),''), initcap(replace(p_action,'_',' '))));
  perform app.record_audit('Job decision: ' || p_action, 'job_application', v_app.reference, 'Success');
  return jsonb_build_object('applicationId', v_app.id, 'reference', v_app.reference, 'status', v_status, 'version', v_next);
end
$$;

-- ---------------------------------------------------------------------------
-- Upload intent/finalisation/link/scan commands
-- ---------------------------------------------------------------------------

create or replace function app.documents_create_upload_intent(
  p_owner_domain text,
  p_owner_record_id uuid,
  p_attachment_code text,
  p_safe_filename text,
  p_declared_mime_type text,
  p_declared_size bigint,
  p_allowed_mime_types text[] default array['application/pdf','image/jpeg','image/png'],
  p_max_bytes bigint default 5242880,
  p_object_key text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_ref text; v_key text := coalesce(p_object_key, 'uploads/' || gen_random_uuid()::text || case p_declared_mime_type when 'application/pdf' then '.pdf' when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.bin' end);
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if p_owner_domain not in ('admission_application','job_application','student') then raise exception 'invalid document owner domain'; end if;
  if p_declared_size <= 0 or p_declared_size > p_max_bytes then raise exception 'declared file size is not allowed'; end if;
  if v_key !~ '^uploads/[0-9a-fA-F-]{36}\.(pdf|jpg|png)$' then raise exception 'opaque upload key is required'; end if;
  if p_declared_mime_type is null or not (p_declared_mime_type = any(coalesce(p_allowed_mime_types, array['application/pdf','image/jpeg','image/png']))) then raise exception 'declared file type is not allowed'; end if;
  if p_owner_domain = 'admission_application' and not exists (select 1 from public.admission_applications where id = p_owner_record_id and owner_account_id = auth.uid()) then raise exception 'document owner is not accessible to this account'; end if;
  if p_owner_domain = 'job_application' and not exists (select 1 from public.job_applications where id = p_owner_record_id and owner_account_id = auth.uid()) then raise exception 'document owner is not accessible to this account'; end if;
  if p_owner_domain = 'student' and not app.guardian_has_capability(p_owner_record_id, 'documents') then raise exception 'document owner is not accessible to this account'; end if;
  insert into public.documents (owner_domain, owner_record_id, category, object_key, safe_filename, mime_type, size_bytes, scan_status, visibility, uploaded_by_account_id, declared_mime_type, allowed_mime_types, max_bytes, attachment_code)
  values (p_owner_domain, p_owner_record_id, p_attachment_code, v_key, left(regexp_replace(coalesce(p_safe_filename,'upload'), '[^a-zA-Z0-9._-]+', '-', 'g'), 120), p_declared_mime_type, p_declared_size, 'pending_scan', 'private', auth.uid(), p_declared_mime_type, coalesce(p_allowed_mime_types, array['application/pdf','image/jpeg','image/png']), p_max_bytes, p_attachment_code)
  returning id, reference into v_id, v_ref;
  insert into public.document_processing_events (document_id, event_type, detail) values (v_id, 'upload_intent_created', p_owner_domain || ':' || coalesce(p_attachment_code,'document'));
  return jsonb_build_object('id', v_id, 'reference', v_ref, 'objectKey', v_key, 'status', 'pending_scan');
end
$$;

create or replace function app.documents_finalize_upload(
  p_document_id uuid,
  p_actual_mime_type text,
  p_actual_size bigint,
  p_checksum text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_doc public.documents%rowtype;
begin
  -- Finalisation is a server-side operation after the StorageProvider has
  -- read/stat'ed the object.  Browser clients cannot call this trust boundary.
  if session_user <> 'service_role' and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'document finalisation requires the storage service'; end if;
  select * into v_doc from public.documents where id = p_document_id for update;
  if v_doc.id is null then raise exception 'document not found'; end if;
  if v_doc.scan_status not in ('pending_scan','failed') then raise exception 'document is not awaiting finalisation'; end if;
  if p_actual_size <= 0 or p_actual_size > v_doc.max_bytes or p_actual_size <> v_doc.size_bytes then raise exception 'uploaded file size does not match the authorized size'; end if;
  if p_actual_mime_type is null or not (p_actual_mime_type = any(v_doc.allowed_mime_types)) or p_actual_mime_type <> v_doc.declared_mime_type then raise exception 'uploaded file type is not allowed'; end if;
  if p_checksum is null or p_checksum !~ '^[0-9a-fA-F]{64}$' then raise exception 'sha256 checksum is required'; end if;
  update public.documents set actual_mime_type = p_actual_mime_type, actual_size_bytes = p_actual_size, checksum = lower(p_checksum), checksum_verified = true, finalized_at = now(), scan_status = 'pending_scan' where id = v_doc.id;
  if v_doc.owner_domain = 'admission_application' then insert into public.admission_documents (application_id, document_id, requirement_code) values (v_doc.owner_record_id, v_doc.id, v_doc.attachment_code) on conflict (document_id) do nothing;
  elsif v_doc.owner_domain = 'job_application' then insert into public.job_documents (application_id, document_id, requirement_code) values (v_doc.owner_record_id, v_doc.id, v_doc.attachment_code) on conflict (document_id) do nothing;
  elsif v_doc.owner_domain = 'student' then insert into public.student_documents (student_id, document_id) values (v_doc.owner_record_id, v_doc.id) on conflict (document_id) do nothing; end if;
  insert into public.document_processing_events (document_id, event_type, detail) values (v_doc.id, 'upload_finalized', 'checksum and metadata verified');
  return jsonb_build_object('reference', v_doc.reference, 'status', 'pending_scan', 'checksumVerified', true);
end
$$;

create or replace function app.documents_link_attachment(
  p_document_id uuid,
  p_owner_domain text,
  p_owner_record_id uuid,
  p_attachment_code text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_doc public.documents%rowtype;
begin
  if session_user <> 'service_role' and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'document linking requires the storage service'; end if;
  select * into v_doc from public.documents where id = p_document_id;
  if v_doc.id is null or v_doc.owner_domain <> p_owner_domain or v_doc.owner_record_id <> p_owner_record_id then raise exception 'document ownership mismatch'; end if;
  if v_doc.scan_status not in ('pending_scan','ready','clean') or not v_doc.checksum_verified then raise exception 'document is not finalized'; end if;
  update public.documents set attachment_code = p_attachment_code where id = p_document_id;
  if p_owner_domain = 'admission_application' then insert into public.admission_documents (application_id, document_id, requirement_code) values (p_owner_record_id, p_document_id, p_attachment_code) on conflict (document_id) do nothing;
  elsif p_owner_domain = 'job_application' then insert into public.job_documents (application_id, document_id, requirement_code) values (p_owner_record_id, p_document_id, p_attachment_code) on conflict (document_id) do nothing;
  elsif p_owner_domain = 'student' then insert into public.student_documents (student_id, document_id) values (p_owner_record_id, p_document_id) on conflict (document_id) do nothing; end if;
  return jsonb_build_object('reference', v_doc.reference, 'status', v_doc.scan_status);
end
$$;

create or replace function app.documents_apply_scan(
  p_document_id uuid,
  p_status text,
  p_detail text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_doc public.documents%rowtype;
begin
  if session_user <> 'service_role' and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'document scanner authority required'; end if;
  if p_status not in ('ready','quarantined','failed') then raise exception 'invalid document scan state'; end if;
  select * into v_doc from public.documents where id = p_document_id for update;
  if v_doc.id is null or v_doc.finalized_at is null then raise exception 'document has not been finalized'; end if;
  update public.documents set scan_status = p_status where id = p_document_id;
  insert into public.document_processing_events (document_id, event_type, detail) values (p_document_id, 'scan_' || p_status, p_detail);
  return jsonb_build_object('reference', v_doc.reference, 'status', p_status);
end
$$;

revoke all on function app.admissions_save_draft_v2(uuid,uuid,uuid,text,text,text,jsonb,int,int,int), app.admissions_save_draft(uuid,uuid,uuid,text,text,text,jsonb,int,int), app.admission_public_configuration(uuid), app.admission_configuration(), app.admissions_submit(uuid,jsonb,int,int), app.enrollment_readiness(uuid), app.admissions_duplicate_review_resolve(uuid,uuid,text,text,text,text,int), app.enrollment_convert(uuid), app.jobs_create_draft(uuid,text), app.jobs_save_draft_v2(uuid,jsonb,int,int,int), app.jobs_save_draft(uuid,jsonb,int,int), app.jobs_submit(uuid,jsonb,int), app.jobs_withdraw(uuid,int), app.jobs_save_scorecard(uuid,numeric,text), app.jobs_retention_status(uuid), app.jobs_decide_v2(uuid,text,text,text,timestamptz,int), app.documents_create_upload_intent(text,uuid,text,text,text,bigint,text[],bigint,text), app.documents_finalize_upload(uuid,text,bigint,text), app.documents_link_attachment(uuid,text,uuid,text), app.documents_apply_scan(uuid,text,text) from public;
grant execute on function app.admissions_save_draft_v2(uuid,uuid,uuid,text,text,text,jsonb,int,int,int), app.admissions_save_draft(uuid,uuid,uuid,text,text,text,jsonb,int,int), app.admissions_submit(uuid,jsonb,int,int), app.enrollment_readiness(uuid), app.admissions_duplicate_review_resolve(uuid,uuid,text,text,text,text,int), app.enrollment_convert(uuid), app.jobs_create_draft(uuid,text), app.jobs_save_draft_v2(uuid,jsonb,int,int,int), app.jobs_save_draft(uuid,jsonb,int,int), app.jobs_submit(uuid,jsonb,int), app.jobs_withdraw(uuid,int), app.jobs_save_scorecard(uuid,numeric,text), app.jobs_retention_status(uuid), app.jobs_decide_v2(uuid,text,text,text,timestamptz,int), app.documents_create_upload_intent(text,uuid,text,text,text,bigint,text[],bigint,text) to authenticated;
grant execute on function app.documents_finalize_upload(uuid,text,bigint,text), app.documents_link_attachment(uuid,text,uuid,text), app.documents_apply_scan(uuid,text,text) to service_role;
grant execute on function app.admission_public_configuration(uuid) to anon, authenticated;
grant execute on function app.admission_configuration() to authenticated;
grant execute on function app.documents_apply_scan(uuid,text,text) to service_role;

-- ---------------------------------------------------------------------------
-- RLS for new projections and ready-state private document reads
-- ---------------------------------------------------------------------------

alter table public.admission_document_requirements enable row level security;
alter table public.admission_identity_evidence enable row level security;
alter table public.admission_duplicate_reviews enable row level security;
alter table public.job_application_decisions enable row level security;
alter table public.job_scorecard_versions enable row level security;
alter table public.job_retention_records enable row level security;

revoke all on public.admission_document_requirements, public.admission_identity_evidence, public.admission_duplicate_reviews, public.job_application_decisions, public.job_scorecard_versions, public.job_retention_records from anon, authenticated;
grant select on public.admission_document_requirements to authenticated;
grant select on public.admission_identity_evidence, public.admission_duplicate_reviews to authenticated;
grant select on public.job_application_decisions, public.job_scorecard_versions, public.job_retention_records to authenticated;

create policy admission_requirements_staff_read on public.admission_document_requirements for select to authenticated
  using (app.staff_grade_scope_allowed(array['admissions_officer','admissions_approver','auditor'], (select academic_year_id from public.admission_windows where id = admission_window_id), (select grade_id from public.admission_windows where id = admission_window_id)));
create policy admission_evidence_staff_read on public.admission_identity_evidence for select to authenticated
  using (app.admission_staff_scope(application_id, array['admissions_officer','admissions_approver','auditor']));
create policy admission_duplicate_staff_read on public.admission_duplicate_reviews for select to authenticated
  using (app.admission_staff_scope(application_id, array['admissions_officer','admissions_approver','auditor']));
create policy job_decisions_staff_read on public.job_application_decisions for select to authenticated
  using (app.hr_application_scope(application_id, array['hr_reviewer','hr_approver','auditor']));
create policy job_scorecard_versions_staff_read on public.job_scorecard_versions for select to authenticated
  using (app.hr_application_scope(application_id, array['hr_reviewer','hr_approver','auditor']));
create policy job_retention_owner_or_staff_read on public.job_retention_records for select to authenticated
  using (exists (select 1 from public.job_applications ja where ja.id = application_id and ja.owner_account_id = auth.uid()) or app.hr_application_scope(application_id, array['hr_reviewer','hr_approver','auditor']));

drop policy if exists scope_documents_read on public.documents;
create policy scope_documents_read on public.documents for select to authenticated using (
  (scan_status in ('ready','clean') and ((owner_domain = 'admission_application' and exists (select 1 from public.admission_applications a where a.id = owner_record_id and a.owner_account_id = auth.uid())) or (owner_domain = 'job_application' and exists (select 1 from public.job_applications j where j.id = owner_record_id and j.owner_account_id = auth.uid()))))
  or app.document_staff_allowed(owner_domain, owner_record_id)
  or (owner_domain = 'student' and exists (select 1 from public.students s where s.id = owner_record_id and app.guardian_has_capability(s.id, 'documents')))
  or (owner_domain = 'invoice' and exists (select 1 from public.invoices i where i.id = owner_record_id and i.student_id is not null and app.guardian_has_capability(i.student_id, 'documents')))
);

commit;
