-- =============================================================================
-- 000044 — School-data imports and provenance foundation
--
-- Administrator-only, private, previewed, validated, provenance-aware,
-- idempotent, recoverable, and auditable school-data import. Raw files and
-- row payloads never reach the browser; every create/match/update/skip
-- decision records batch and row provenance.
--
-- State machine:
--   UPLOADED → SCANNING → MAPPING → VALIDATING → NEEDS_RESOLUTION | READY
--   → COMMITTING → COMPLETED
--   recovery: FAILED, CANCELLED, PARTIALLY_COMMITTED
-- =============================================================================

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Import batches and rows
-- ---------------------------------------------------------------------------

create table public.data_import_batches (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('IMP'),
  academic_year_id  uuid not null references public.academic_years(id) on delete restrict,
  source_system     text not null,
  source_document_id uuid references public.documents(id) on delete restrict,
  state             text not null default 'uploaded'
                    check (state in ('uploaded','scanning','mapping','validating',
                                     'needs_resolution','ready','committing','completed',
                                     'failed','cancelled','partially_committed')),
  version           int not null default 1,
  row_count         int not null default 0,
  error_count       int not null default 0,
  warning_count     int not null default 0,
  created_by_account_id uuid not null references public.user_accounts(id) on delete restrict,
  authority_confirmation boolean not null default false,
  privacy_confirmation boolean not null default false,
  committed_at      timestamptz,
  cancel_reason     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index data_import_batches_state_idx on public.data_import_batches (state, created_at);
create trigger data_import_batches_touch before update on public.data_import_batches
  for each row execute function app.touch_updated_at();

create table public.data_import_rows (
  id                uuid primary key default gen_random_uuid(),
  batch_id          uuid not null references public.data_import_batches(id) on delete cascade,
  row_number        int not null,
  entity            text not null
                    check (entity in ('students','guardians','guardian_student_relationships',
                                      'enrollments','teaching_assignments')),
  source_key        text not null,
  normalized        jsonb not null default '{}'::jsonb,
  status            text not null default 'pending'
                    check (status in ('pending','mapped','valid','warning','error',
                                      'resolved','committed','skipped','failed')),
  outcome           text
                    check (outcome in ('create','update','unchanged','skipped','error')),
  committed_record_id uuid,
  committed_at      timestamptz,
  created_at        timestamptz not null default now(),
  unique (batch_id, row_number)
);

create index data_import_rows_batch_idx on public.data_import_rows (batch_id, status);
create index data_import_rows_key_idx on public.data_import_rows (batch_id, entity, source_key);

create table public.data_import_issues (
  id                uuid primary key default gen_random_uuid(),
  batch_id          uuid not null references public.data_import_batches(id) on delete cascade,
  row_id            uuid references public.data_import_rows(id) on delete cascade,
  row_number        int,
  severity          text not null check (severity in ('error', 'warning')),
  code              text not null
                    check (code in ('missing_required_field','invalid_format','duplicate_source_key',
                                    'conflicting_identity','duplicate_active_enrollment',
                                    'unknown_grade_section','unknown_academic_year',
                                    'invalid_date_range','missing_relationship','malformed_contact',
                                    'shared_contact_review','conflicting_student_key')),
  field             text,
  message           text not null,
  resolution_hint   text,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now()
);

create index data_import_issues_batch_idx on public.data_import_issues (batch_id, severity);

create table public.data_import_mappings (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('MAP'),
  source_system     text not null,
  source_version    text not null,
  entity            text not null
                    check (entity in ('students','guardians','guardian_student_relationships',
                                      'enrollments','teaching_assignments')),
  column_mappings   jsonb not null default '{}'::jsonb,
  version           int not null default 1,
  created_by_account_id uuid references public.user_accounts(id) on delete restrict,
  created_at        timestamptz not null default now(),
  unique (source_system, source_version, entity)
);

-- ---------------------------------------------------------------------------
-- Provenance: external record keys and guardian contacts
-- ---------------------------------------------------------------------------

create table public.external_record_keys (
  id                uuid primary key default gen_random_uuid(),
  entity            text not null
                    check (entity in ('student', 'guardian', 'staff_member')),
  record_id         uuid not null,
  source_system     text not null,
  source_key        text not null,
  created_at        timestamptz not null default now(),
  unique (source_system, source_key, entity)
);

create index external_record_keys_record_idx on public.external_record_keys (entity, record_id);

-- Guardian contacts are recorded separately from the relationship: contact
-- delivery state is not relationship verification. Shared values are flagged,
-- never auto-merged.
create table public.guardian_contacts (
  id                uuid primary key default gen_random_uuid(),
  guardian_id       uuid not null references public.guardians(id) on delete restrict,
  channel           text not null check (channel in ('sms', 'email')),
  value             text not null,
  state             text not null default 'recorded'
                    check (state in ('recorded','delivery_verified','conflicted_review','revoked')),
  shared_contact_flag boolean not null default false,
  verified_at       timestamptz,
  version           int not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (guardian_id, channel, value)
);

create index guardian_contacts_guardian_idx on public.guardian_contacts (guardian_id, state);
create trigger guardian_contacts_touch before update on public.guardian_contacts
  for each row execute function app.touch_updated_at();

-- Imported relationship evidence: provenance for guardian/student links.
alter table public.guardian_student_links
  add column if not exists import_batch_id uuid references public.data_import_batches(id) on delete restrict,
  add column if not exists import_row_id uuid references public.data_import_rows(id) on delete restrict;

-- Imported records are a first-class verification source (contracts list
-- 'imported_record'); extend the 000002 check constraint forward-only.
alter table public.guardian_student_links drop constraint if exists guardian_student_links_verification_source_check;
alter table public.guardian_student_links
  add constraint guardian_student_links_verification_source_check
    check (verification_source in ('guardian_request', 'enrollment_invitation', 'staff_review', 'imported_record'));

-- ---------------------------------------------------------------------------
-- RLS: Administrator/service only; the browser sees projections via commands.
-- ---------------------------------------------------------------------------

alter table public.data_import_batches enable row level security;
alter table public.data_import_rows enable row level security;
alter table public.data_import_issues enable row level security;
alter table public.data_import_mappings enable row level security;
alter table public.external_record_keys enable row level security;
alter table public.guardian_contacts enable row level security;

revoke all on public.data_import_batches, public.data_import_rows, public.data_import_issues,
  public.data_import_mappings, public.external_record_keys, public.guardian_contacts
  from anon, authenticated;
grant select, insert, update on public.data_import_batches, public.data_import_rows,
  public.data_import_issues, public.data_import_mappings, public.external_record_keys,
  public.guardian_contacts to service_role;

create policy data_import_batches_service on public.data_import_batches
  for all to service_role using (true) with check (true);
create policy data_import_rows_service on public.data_import_rows
  for all to service_role using (true) with check (true);
create policy data_import_issues_service on public.data_import_issues
  for all to service_role using (true) with check (true);
create policy data_import_mappings_service on public.data_import_mappings
  for all to service_role using (true) with check (true);
create policy external_record_keys_service on public.external_record_keys
  for all to service_role using (true) with check (true);
create policy guardian_contacts_service on public.guardian_contacts
  for all to service_role using (true) with check (true);

-- The Administrator reads batch/issue/provenance projections (row payloads
-- stay service-only); RLS keeps every read admin-gated and aal2-gated.
grant select on public.data_import_batches, public.data_import_issues, public.external_record_keys, public.guardian_contacts to authenticated;
create policy data_import_batches_admin_read on public.data_import_batches
  for select to authenticated
  using (app.is_staff_aal2() and app.has_role('system_administrator'));
create policy data_import_issues_admin_read on public.data_import_issues
  for select to authenticated
  using (app.is_staff_aal2() and app.has_role('system_administrator'));
create policy external_record_keys_admin_read on public.external_record_keys
  for select to authenticated
  using (app.is_staff_aal2() and app.has_role('system_administrator'));
create policy guardian_contacts_admin_read on public.guardian_contacts
  for select to authenticated
  using (app.is_staff_aal2() and app.has_role('system_administrator'));

-- ---------------------------------------------------------------------------
-- Commands (Administrator + aal2)
-- ---------------------------------------------------------------------------

create or replace function app.data_import_create_batch(
  p_academic_year_id uuid,
  p_source_system text,
  p_source_document_id uuid,
  p_authority_confirmation boolean,
  p_privacy_confirmation boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.data_import_batches%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'data imports require the system administrator and aal2';
  end if;
  if p_authority_confirmation is not true or p_privacy_confirmation is not true then
    raise exception 'authority and privacy confirmations are required';
  end if;
  if p_source_system is null or length(btrim(p_source_system)) < 1 then
    raise exception 'source system is required';
  end if;
  if not exists (select 1 from public.academic_years where id = p_academic_year_id) then
    raise exception 'academic year not found';
  end if;

  insert into public.data_import_batches
    (academic_year_id, source_system, source_document_id, state,
     created_by_account_id, authority_confirmation, privacy_confirmation)
  values
    (p_academic_year_id, btrim(p_source_system), p_source_document_id, 'uploaded',
     auth.uid(), p_authority_confirmation, p_privacy_confirmation)
  returning * into v_batch;

  perform app.record_audit('Data import batch created', 'data_import_batch', v_batch.reference, 'Success',
                           'Source system: ' || v_batch.source_system, 'System administrator');
  return jsonb_build_object('batchId', v_batch.id, 'reference', v_batch.reference,
                            'state', v_batch.state, 'version', v_batch.version);
end
$$;

create or replace function app.data_import_set_state(
  p_batch_id uuid,
  p_new_state text,
  p_expected_version int
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.data_import_batches%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'data imports require the system administrator and aal2';
  end if;
  if p_new_state not in ('scanning','mapping','validating','needs_resolution','ready',
                         'committing','completed','failed','cancelled','partially_committed') then
    raise exception 'invalid import state';
  end if;
  select * into v_batch from public.data_import_batches where id = p_batch_id for update;
  if v_batch.id is null then raise exception 'import batch not found'; end if;
  if v_batch.version <> p_expected_version then
    raise exception 'import batch version mismatch (expected %, found %)', p_expected_version, v_batch.version;
  end if;
  if v_batch.state in ('completed', 'cancelled') then
    raise exception 'import batch is already closed';
  end if;
  update public.data_import_batches
     set state = p_new_state, version = v_batch.version + 1,
         committed_at = case when p_new_state = 'completed' then now() else v_batch.committed_at end
   where id = p_batch_id
  returning * into v_batch;
  perform app.record_audit('Data import state changed', 'data_import_batch', v_batch.reference, 'Success',
                           v_batch.state || ' → ' || p_new_state, 'System administrator');
  return jsonb_build_object('batchId', v_batch.id, 'reference', v_batch.reference,
                            'state', v_batch.state, 'version', v_batch.version);
end
$$;

-- Store parsed rows (service-side parse boundary). Idempotent per batch+row.
create or replace function app.data_import_store_rows(
  p_batch_id uuid,
  p_rows jsonb
) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb;
  v_count int := 0;
  v_batch public.data_import_batches%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' and not (
    app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'row storage requires the service worker or the administrator';
  end if;
  select * into v_batch from public.data_import_batches where id = p_batch_id for update;
  if v_batch.id is null then raise exception 'import batch not found'; end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then raise exception 'rows must be an array'; end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    insert into public.data_import_rows
      (batch_id, row_number, entity, source_key, normalized, status)
    values
      (p_batch_id,
       (v_row ->> 'rowNumber')::int,
       v_row ->> 'entity',
       coalesce(v_row ->> 'sourceKey', ''),
       coalesce(v_row -> 'normalized', '{}'::jsonb),
       coalesce(v_row ->> 'status', 'pending'))
    on conflict (batch_id, row_number) do update
      set entity = excluded.entity,
          source_key = excluded.source_key,
          normalized = excluded.normalized,
          status = excluded.status;
    v_count := v_count + 1;
  end loop;

  update public.data_import_batches
     set row_count = (select count(*) from public.data_import_rows where batch_id = p_batch_id),
         version = v_batch.version + 1
   where id = p_batch_id;
  return v_count;
end
$$;

create or replace function app.data_import_record_issue(
  p_batch_id uuid,
  p_row_id uuid,
  p_row_number int,
  p_severity text,
  p_code text,
  p_field text,
  p_message text,
  p_resolution_hint text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_issue_id uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' and not (
    app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'issue recording requires the service worker or the administrator';
  end if;
  if p_severity not in ('error', 'warning') then raise exception 'invalid issue severity'; end if;
  insert into public.data_import_issues
    (batch_id, row_id, row_number, severity, code, field, message, resolution_hint)
  values
    (p_batch_id, p_row_id, p_row_number, p_severity, p_code, p_field, p_message, p_resolution_hint)
  returning id into v_issue_id;

  update public.data_import_batches
     set error_count = error_count + (case when p_severity = 'error' then 1 else 0 end),
         warning_count = warning_count + (case when p_severity = 'warning' then 1 else 0 end)
   where id = p_batch_id;
  return v_issue_id;
end
$$;

-- Preview: exact consequence counts before commit. Rows are counted by
-- committable status (outcome is only assigned at commit time).
create or replace function app.data_import_preview(p_batch_id uuid)
returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'batchId', b.id,
    'createCount', coalesce(sum(case when r.status in ('valid','warning','resolved') then 1 else 0 end), 0),
    'updateCount', 0,
    'unchangedCount', coalesce(sum(case when r.status = 'committed' then 1 else 0 end), 0),
    'skippedCount', coalesce(sum(case when r.status = 'skipped' then 1 else 0 end), 0),
    'errorCount', coalesce(sum(case when r.status in ('error','failed') then 1 else 0 end), 0),
    'warningCount', coalesce(sum(case when r.status = 'warning' then 1 else 0 end), 0),
    'familyGroupCount', (select count(distinct normalized ->> 'familyKey')
                          from public.data_import_rows where batch_id = b.id)
  )
    from public.data_import_batches b
    left join public.data_import_rows r on r.batch_id = b.id
   where b.id = p_batch_id
   group by b.id
$$;

-- Idempotent commit: each logical group commits transactionally; a retry
-- returns the same outcomes and never duplicates entities.
create or replace function app.data_import_commit(
  p_batch_id uuid,
  p_expected_version int,
  p_reason text,
  p_idempotency_key text,
  p_confirmed_create_count int,
  p_confirmed_update_count int
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.data_import_batches%rowtype;
  v_row public.data_import_rows%rowtype;
  v_person_id uuid;
  v_student_id uuid;
  v_guardian_id uuid;
  v_enrollment_id uuid;
  v_link_id uuid;
  v_created int := 0;
  v_updated int := 0;
  v_unchanged int := 0;
  v_skipped int := 0;
  v_errors int := 0;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'data import commit requires the system administrator and aal2';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a commit reason is required';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then
    raise exception 'an idempotency key is required';
  end if;
  select * into v_batch from public.data_import_batches where id = p_batch_id for update;
  if v_batch.id is null then raise exception 'import batch not found'; end if;
  if v_batch.version <> p_expected_version then
    raise exception 'import batch version mismatch (expected %, found %)', p_expected_version, v_batch.version;
  end if;
  if v_batch.state not in ('ready', 'partially_committed') then
    raise exception 'import batch is not ready to commit (state: %)', v_batch.state;
  end if;
  if exists (select 1 from public.data_import_issues where batch_id = p_batch_id and severity = 'error' and resolved_at is null) then
    raise exception 'unresolved errors remain — resolve them before committing';
  end if;

  update public.data_import_batches set state = 'committing', version = v_batch.version + 1 where id = p_batch_id;

  for v_row in
    select * from public.data_import_rows
     where batch_id = p_batch_id and status in ('valid', 'warning', 'resolved')
     order by row_number
  loop
    begin
      if v_row.entity = 'students' then
        -- Match by external key first; never by display name alone.
        select record_id into v_student_id
          from public.external_record_keys
         where entity = 'student' and source_key = v_row.source_key
           and source_system = v_batch.source_system
         limit 1;
        if v_student_id is null then
          insert into public.people (given_name, family_name, display_name)
          values (coalesce(v_row.normalized ->> 'givenName', 'Imported'),
                  coalesce(v_row.normalized ->> 'familyName', 'Student'),
                  coalesce(v_row.normalized ->> 'displayName', 'Imported Student'))
          returning id into v_person_id;
          insert into public.students (person_id, status)
          values (v_person_id, 'active')
          returning id into v_student_id;
          insert into public.external_record_keys (entity, record_id, source_system, source_key)
          values ('student', v_student_id, v_batch.source_system, v_row.source_key);
          update public.data_import_rows set outcome = 'create', status = 'committed',
            committed_record_id = v_student_id, committed_at = now() where id = v_row.id;
          v_created := v_created + 1;
        else
          update public.data_import_rows set outcome = 'unchanged', status = 'committed',
            committed_record_id = v_student_id, committed_at = now() where id = v_row.id;
          v_unchanged := v_unchanged + 1;
        end if;
      elsif v_row.entity = 'guardians' then
        select record_id into v_guardian_id
          from public.external_record_keys
         where entity = 'guardian' and source_key = v_row.source_key
           and source_system = v_batch.source_system
         limit 1;
        if v_guardian_id is null then
          insert into public.people (given_name, family_name, display_name)
          values (coalesce(v_row.normalized ->> 'givenName', 'Imported'),
                  coalesce(v_row.normalized ->> 'familyName', 'Guardian'),
                  coalesce(v_row.normalized ->> 'displayName', 'Imported Guardian'))
          returning id into v_person_id;
          insert into public.guardians (person_id, status)
          values (v_person_id, 'active')
          returning id into v_guardian_id;
          insert into public.external_record_keys (entity, record_id, source_system, source_key)
          values ('guardian', v_guardian_id, v_batch.source_system, v_row.source_key);
          -- Record the guardian contact (delivery state separate from the link).
          if coalesce(v_row.normalized ->> 'contact', '') <> '' then
            insert into public.guardian_contacts (guardian_id, channel, value, state)
            values (v_guardian_id,
                    case when position('@' in v_row.normalized ->> 'contact') > 0 then 'email' else 'sms' end,
                    v_row.normalized ->> 'contact', 'recorded')
            on conflict (guardian_id, channel, value) do nothing;
          end if;
          update public.data_import_rows set outcome = 'create', status = 'committed',
            committed_record_id = v_guardian_id, committed_at = now() where id = v_row.id;
          v_created := v_created + 1;
        else
          update public.data_import_rows set outcome = 'unchanged', status = 'committed',
            committed_record_id = v_guardian_id, committed_at = now() where id = v_row.id;
          v_unchanged := v_unchanged + 1;
        end if;
      elsif v_row.entity = 'guardian_student_relationships' then
        select record_id into v_guardian_id from public.external_record_keys
         where entity = 'guardian' and source_key = coalesce(v_row.normalized ->> 'guardianKey', '')
           and source_system = v_batch.source_system limit 1;
        select record_id into v_student_id from public.external_record_keys
         where entity = 'student' and source_key = coalesce(v_row.normalized ->> 'studentKey', '')
           and source_system = v_batch.source_system limit 1;
        if v_guardian_id is null or v_student_id is null then
          update public.data_import_rows set status = 'failed', outcome = 'error' where id = v_row.id;
          v_errors := v_errors + 1;
        elsif exists (
          select 1 from public.guardian_student_links
           where guardian_id = v_guardian_id and student_id = v_student_id and status = 'active'
        ) then
          update public.data_import_rows set outcome = 'unchanged', status = 'committed' where id = v_row.id;
          v_unchanged := v_unchanged + 1;
        else
          insert into public.guardian_student_links
            (guardian_id, student_id, relationship_label, status, verification_source,
             effective_from, import_batch_id, import_row_id)
          values
            (v_guardian_id, v_student_id,
             coalesce(v_row.normalized ->> 'relationshipLabel', 'Parent'),
             'active', 'imported_record', now(), p_batch_id, v_row.id)
          returning id into v_link_id;
          update public.data_import_rows set outcome = 'create', status = 'committed',
            committed_record_id = v_link_id, committed_at = now() where id = v_row.id;
          v_created := v_created + 1;
        end if;
      elsif v_row.entity = 'enrollments' then
        select record_id into v_student_id from public.external_record_keys
         where entity = 'student' and source_key = v_row.source_key
           and source_system = v_batch.source_system limit 1;
        if v_student_id is null then
          update public.data_import_rows set status = 'failed', outcome = 'error' where id = v_row.id;
          v_errors := v_errors + 1;
        elsif exists (
          select 1 from public.enrollments
           where student_id = v_student_id and academic_year_id = v_batch.academic_year_id and status = 'active'
        ) then
          update public.data_import_rows set outcome = 'unchanged', status = 'committed' where id = v_row.id;
          v_unchanged := v_unchanged + 1;
        else
          insert into public.enrollments
            (student_id, academic_year_id, grade_section_id, status, effective_from)
          select v_student_id, v_batch.academic_year_id,
                 (v_row.normalized ->> 'gradeSectionId')::uuid, 'active', now()
          returning id into v_enrollment_id;
          update public.data_import_rows set outcome = 'create', status = 'committed',
            committed_record_id = v_enrollment_id, committed_at = now() where id = v_row.id;
          v_created := v_created + 1;
        end if;
      else
        update public.data_import_rows set outcome = 'skipped', status = 'skipped' where id = v_row.id;
        v_skipped := v_skipped + 1;
      end if;
    exception when others then
      update public.data_import_rows set status = 'failed', outcome = 'error' where id = v_row.id;
      v_errors := v_errors + 1;
    end;
  end loop;

  if v_errors > 0 then
    update public.data_import_batches set state = 'partially_committed' where id = p_batch_id;
  else
    update public.data_import_batches set state = 'completed', committed_at = now() where id = p_batch_id;
  end if;

  v_result := jsonb_build_object(
    'batchRef', v_batch.reference, 'state',
    (select state from public.data_import_batches where id = p_batch_id),
    'rowCount', v_batch.row_count,
    'createdCount', v_created, 'updatedCount', v_updated,
    'unchangedCount', v_unchanged, 'skippedCount', v_skipped, 'errorCount', v_errors,
    'committedAtIso', (select committed_at from public.data_import_batches where id = p_batch_id));
  perform app.record_audit('Data import committed', 'data_import_batch', v_batch.reference, 'Success',
    btrim(p_reason) || ' — created ' || v_created || ', unchanged ' || v_unchanged || ', errors ' || v_errors,
    'System administrator');
  return v_result;
end
$$;

create or replace function app.data_import_cancel(
  p_batch_id uuid,
  p_expected_version int,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.data_import_batches%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'data import cancel requires the system administrator and aal2';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a cancellation reason is required';
  end if;
  select * into v_batch from public.data_import_batches where id = p_batch_id for update;
  if v_batch.id is null then raise exception 'import batch not found'; end if;
  if v_batch.version <> p_expected_version then
    raise exception 'import batch version mismatch (expected %, found %)', p_expected_version, v_batch.version;
  end if;
  if v_batch.state in ('completed', 'cancelled') then
    raise exception 'import batch is already closed';
  end if;
  update public.data_import_batches
     set state = 'cancelled', cancel_reason = btrim(p_reason), version = v_batch.version + 1
   where id = p_batch_id
  returning * into v_batch;
  perform app.record_audit('Data import cancelled', 'data_import_batch', v_batch.reference, 'Success',
                           btrim(p_reason), 'System administrator');
  return jsonb_build_object('batchId', v_batch.id, 'reference', v_batch.reference,
                            'state', v_batch.state, 'version', v_batch.version);
end
$$;

-- Report: immutable post-commit summary.
create or replace function app.data_import_report(p_batch_id uuid)
returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'batchRef', b.reference, 'state', b.state, 'rowCount', b.row_count,
    'createdCount', (select count(*) from public.data_import_rows r where r.batch_id = b.id and r.outcome = 'create'),
    'updatedCount', (select count(*) from public.data_import_rows r where r.batch_id = b.id and r.outcome = 'update'),
    'unchangedCount', (select count(*) from public.data_import_rows r where r.batch_id = b.id and r.outcome = 'unchanged'),
    'skippedCount', (select count(*) from public.data_import_rows r where r.batch_id = b.id and r.outcome = 'skipped'),
    'errorCount', (select count(*) from public.data_import_rows r where r.batch_id = b.id and r.status in ('error','failed')),
    'committedAtIso', b.committed_at,
    'auditRef', (select ae.target_reference from public.audit_events ae
                  where ae.target_type = 'data_import_batch' and ae.target_reference = b.reference
                  order by ae.created_at desc limit 1))
    from public.data_import_batches b
   where b.id = p_batch_id
$$;

create or replace function app.data_import_list_batches()
returns setof jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'batchId', b.id, 'reference', b.reference, 'state', b.state, 'version', b.version,
    'sourceSystem', b.source_system, 'academicYearId', b.academic_year_id,
    'rowCount', b.row_count, 'errorCount', b.error_count, 'warningCount', b.warning_count,
    'createdAtIso', b.created_at, 'committedAtIso', b.committed_at)
    from public.data_import_batches b
   where app.is_staff_aal2() and app.has_role('system_administrator')
   order by b.created_at desc
$$;

create or replace function app.data_import_list_issues(
  p_batch_id uuid,
  p_severity text default null
) returns setof jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'issueId', i.id, 'batchId', i.batch_id, 'rowNumber', i.row_number,
    'severity', i.severity, 'code', i.code, 'field', i.field,
    'message', i.message, 'resolutionHint', i.resolution_hint,
    'resolvedAtIso', i.resolved_at)
    from public.data_import_issues i
   where i.batch_id = p_batch_id
     and (p_severity is null or i.severity = p_severity)
     and app.is_staff_aal2() and app.has_role('system_administrator')
   order by i.severity, i.row_number
$$;

-- ---------------------------------------------------------------------------
-- Execution surface
-- ---------------------------------------------------------------------------

revoke all on function app.data_import_create_batch(uuid, text, uuid, boolean, boolean) from public;
revoke all on function app.data_import_set_state(uuid, text, int) from public;
revoke all on function app.data_import_store_rows(uuid, jsonb) from public;
revoke all on function app.data_import_record_issue(uuid, uuid, int, text, text, text, text, text) from public;
revoke all on function app.data_import_preview(uuid) from public;
revoke all on function app.data_import_commit(uuid, int, text, text, int, int) from public;
revoke all on function app.data_import_cancel(uuid, int, text) from public;
revoke all on function app.data_import_report(uuid) from public;
revoke all on function app.data_import_list_batches() from public;
revoke all on function app.data_import_list_issues(uuid, text) from public;

grant execute on function app.data_import_create_batch(uuid, text, uuid, boolean, boolean) to authenticated;
grant execute on function app.data_import_set_state(uuid, text, int) to authenticated;
grant execute on function app.data_import_store_rows(uuid, jsonb) to authenticated;
grant execute on function app.data_import_record_issue(uuid, uuid, int, text, text, text, text, text) to authenticated;
grant execute on function app.data_import_preview(uuid) to authenticated;
grant execute on function app.data_import_commit(uuid, int, text, text, int, int) to authenticated;
grant execute on function app.data_import_cancel(uuid, int, text) to authenticated;
grant execute on function app.data_import_report(uuid) to authenticated;
grant execute on function app.data_import_list_batches() to authenticated;
grant execute on function app.data_import_list_issues(uuid, text) to authenticated;

commit;
