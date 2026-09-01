-- =============================================================================
-- 000062 — School import provider pipeline
--
-- Forward-only migration (plan.md Phase 11). Adds the provider pipeline for
-- school-data imports: a required private source document, reusable mapping
-- templates, per-issue resolution records, an immutable preview digest, scan
-- result columns, the 'data_import_parse' outbox event type, and the
-- record-scan / record-mapping transition functions.
--
-- Never edit migrations 000001–000061.
-- =============================================================================

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Require a private source document
-- ---------------------------------------------------------------------------
-- source_document_id already exists (000044); this is idempotent. A batch may
-- only enter the 'scanning' state when a private source document is attached.
-- The constraint is enforced by a BEFORE UPDATE trigger (softer than a CHECK:
-- a batch can be created and cancelled without one).

alter table public.data_import_batches
  add column if not exists source_document_id uuid references public.documents(id) on delete restrict;

create or replace function app.data_import_batches_state_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preview jsonb;
begin
  -- (a) A batch must have a source document before it can be scanned.
  if new.state = 'scanning' and new.source_document_id is null then
    raise exception 'a private source document is required before scanning';
  end if;

  -- (b) When the batch enters 'scanning', enqueue a parse outbox event so the
  --     provider worker can read the private document and store parsed rows.
  --     Idempotent by event_key; only enqueued when an authenticated actor is
  --     present (state transitions always go through app.data_import_set_state,
  --     which already requires auth.uid()).
  if (old.state is distinct from new.state) and new.state = 'scanning'
     and auth.uid() is not null then
    perform app.enqueue_outbox(
      'data_import_parse:' || new.id::text || ':v' || new.version::text,
      'data_import_parse',
      'data_import_batch',
      new.reference,
      jsonb_build_object('batchId', new.id, 'documentId', new.source_document_id,
                         'sourceSystem', new.source_system));
  end if;

  -- (c) When the batch enters 'ready', record an immutable preview digest so a
  --     later commit can detect drift between the confirmed preview and the
  --     state at which the operator approved the commit.
  if (old.state is distinct from new.state) and new.state = 'ready' then
    select app.data_import_preview(new.id) into v_preview;
    new.preview_digest := md5(v_preview::text);
    new.preview_computed_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists data_import_batches_state_guard on public.data_import_batches;
create trigger data_import_batches_state_guard
  before update on public.data_import_batches
  for each row execute function app.data_import_batches_state_guard();

-- ---------------------------------------------------------------------------
-- 2. Mapping template versions
-- ---------------------------------------------------------------------------

create table if not exists public.data_import_mapping_templates (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('IMT'),
  name              text not null,
  entity            text not null
                    check (entity in ('students', 'guardians',
                                      'guardian_student_relationships',
                                      'enrollments', 'teaching_assignments')),
  column_mappings   jsonb not null, -- {source_column: {target_field, transform}}
  version           int not null default 1,
  is_active         boolean not null default true,
  created_by_account_id uuid not null references public.user_accounts(id) on delete restrict,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists data_import_mapping_templates_entity_active_idx
  on public.data_import_mapping_templates (entity, is_active);

drop trigger if exists data_import_mapping_templates_touch on public.data_import_mapping_templates;
create trigger data_import_mapping_templates_touch
  before update on public.data_import_mapping_templates
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Resolution records
-- ---------------------------------------------------------------------------

create table if not exists public.data_import_resolutions (
  id                uuid primary key default gen_random_uuid(),
  batch_id          uuid not null references public.data_import_batches(id) on delete cascade,
  row_id            uuid not null references public.data_import_rows(id) on delete cascade,
  issue_id          uuid not null references public.data_import_issues(id) on delete cascade,
  resolution        text not null
                    check (resolution in ('accept', 'reject', 'modify', 'skip')),
  resolved_value    jsonb, -- the modified value when resolution = 'modify'
  resolved_by_account_id uuid not null references public.user_accounts(id) on delete restrict,
  resolved_at       timestamptz not null default now(),
  note              text
);

create index if not exists data_import_resolutions_batch_idx
  on public.data_import_resolutions (batch_id);
create index if not exists data_import_resolutions_row_idx
  on public.data_import_resolutions (row_id);

-- ---------------------------------------------------------------------------
-- 4. Immutable preview digest columns
-- ---------------------------------------------------------------------------

alter table public.data_import_batches
  add column if not exists preview_digest text,
  add column if not exists preview_computed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 5. 'data_import_parse' outbox event type
-- ---------------------------------------------------------------------------
-- app.enqueue_outbox accepts any event kind as text, so no schema change is
-- required. The 'data_import_parse' kind is enqueued by the state-guard
-- trigger above when a batch enters 'scanning'; the provider worker claims it
-- via app.claim_outbox, reads the private source document, parses rows, and
-- stores them through app.data_import_store_rows before recording scan results
-- via app.data_import_record_scan.

comment on function app.enqueue_outbox(text, text, text, text, jsonb, int) is
  'Enqueue one outbox event. Kinds include email.deliver, sms.deliver, pdf.generate, webhook.relay, and data_import_parse (school-data import parse job).';

-- ---------------------------------------------------------------------------
-- 6. Scan result columns
-- ---------------------------------------------------------------------------

alter table public.data_import_batches
  add column if not exists scan_row_count int,
  add column if not exists scan_column_count int,
  add column if not exists scan_headers jsonb, -- array of detected column names
  add column if not exists scan_detected_encoding text,
  add column if not exists scan_error text;

-- ---------------------------------------------------------------------------
-- 7. RLS for new tables
-- ---------------------------------------------------------------------------
-- Staff with the users.manage scope (system_administrator) and AAL2 may read
-- and write mapping templates and resolution records. The service worker may
-- also write through the service_role.

alter table public.data_import_mapping_templates enable row level security;
alter table public.data_import_resolutions enable row level security;

revoke all on public.data_import_mapping_templates, public.data_import_resolutions
  from anon, authenticated;

grant select, insert, update on public.data_import_mapping_templates, public.data_import_resolutions
  to service_role;

create policy data_import_mapping_templates_service
  on public.data_import_mapping_templates for all to service_role
  using (true) with check (true);
create policy data_import_resolutions_service
  on public.data_import_resolutions for all to service_role
  using (true) with check (true);

grant select, insert, update on public.data_import_mapping_templates, public.data_import_resolutions
  to authenticated;

create policy data_import_mapping_templates_staff
  on public.data_import_mapping_templates for all to authenticated
  using (app.is_staff_aal2() and app.has_role('system_administrator'))
  with check (app.is_staff_aal2() and app.has_role('system_administrator'));
create policy data_import_resolutions_staff
  on public.data_import_resolutions for all to authenticated
  using (app.is_staff_aal2() and app.has_role('system_administrator'))
  with check (app.is_staff_aal2() and app.has_role('system_administrator'));

-- ---------------------------------------------------------------------------
-- 8. Record scan results (scanning → mapping)
-- ---------------------------------------------------------------------------

create or replace function app.data_import_record_scan(
  p_batch_id uuid,
  p_row_count int,
  p_column_count int,
  p_headers jsonb,
  p_encoding text,
  p_error text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.data_import_batches%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'recording scan results requires the system administrator and aal2';
  end if;

  select * into v_batch from public.data_import_batches where id = p_batch_id for update;
  if v_batch.id is null then raise exception 'import batch not found'; end if;
  if v_batch.state <> 'scanning' then
    raise exception 'scan results can only be recorded while scanning (state: %)', v_batch.state;
  end if;
  if not app.data_import_valid_transition('scanning', 'mapping') then
    raise exception 'invalid import state transition scanning → mapping';
  end if;

  update public.data_import_batches
     set scan_row_count = p_row_count,
         scan_column_count = p_column_count,
         scan_headers = p_headers,
         scan_detected_encoding = p_encoding,
         scan_error = p_error,
         row_count = coalesce(p_row_count, v_batch.row_count),
         state = 'mapping',
         version = v_batch.version + 1
   where id = p_batch_id
   returning * into v_batch;

  perform app.record_audit('Data import scan recorded', 'data_import_batch', v_batch.reference,
                           'Success',
                           'rows=' || coalesce(p_row_count::text, '?') ||
                           ' cols=' || coalesce(p_column_count::text, '?') ||
                           ' encoding=' || coalesce(p_encoding, '?'),
                           'System administrator');

  return jsonb_build_object('batchId', v_batch.id, 'reference', v_batch.reference,
                            'state', v_batch.state, 'version', v_batch.version,
                            'scanError', p_error);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Record mapping (mapping → validating)
-- ---------------------------------------------------------------------------

create or replace function app.data_import_record_mapping(
  p_batch_id uuid,
  p_mapping_template_id uuid default null,
  p_column_mappings jsonb default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.data_import_batches%rowtype;
  v_template public.data_import_mapping_templates%rowtype;
  v_mappings jsonb;
  v_mapping_id uuid;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'recording a mapping requires the system administrator and aal2';
  end if;

  select * into v_batch from public.data_import_batches where id = p_batch_id for update;
  if v_batch.id is null then raise exception 'import batch not found'; end if;
  if v_batch.state <> 'mapping' then
    raise exception 'a mapping can only be recorded while mapping (state: %)', v_batch.state;
  end if;
  if not app.data_import_valid_transition('mapping', 'validating') then
    raise exception 'invalid import state transition mapping → validating';
  end if;

  -- Resolve the column mappings: prefer an explicit template, fall back to the
  -- caller-supplied mappings. At least one must be provided.
  if p_mapping_template_id is not null then
    select * into v_template from public.data_import_mapping_templates
     where id = p_mapping_template_id and is_active = true;
    if v_template.id is null then
      raise exception 'mapping template not found or inactive';
    end if;
    v_mappings := v_template.column_mappings;
  elsif p_column_mappings is not null and jsonb_typeof(p_column_mappings) = 'object' then
    v_mappings := p_column_mappings;
  else
    raise exception 'provide either a mapping template id or column mappings';
  end if;

  -- Persist the chosen mapping for provenance (one row per batch; replace on retry).
  insert into public.data_import_mappings
    (source_system, source_version, entity, column_mappings, created_by_account_id)
  values
    (v_batch.source_system, coalesce(v_batch.scan_detected_encoding, 'scan'),
     'students', v_mappings, auth.uid())
  on conflict (source_system, source_version, entity)
  do update set column_mappings = excluded.column_mappings,
                 created_by_account_id = excluded.created_by_account_id
  returning id into v_mapping_id;

  update public.data_import_batches
     set state = 'validating',
         version = v_batch.version + 1
   where id = p_batch_id
   returning * into v_batch;

  perform app.record_audit('Data import mapping recorded', 'data_import_batch', v_batch.reference,
                           'Success',
                           'mappingId=' || coalesce(v_mapping_id::text, '?'),
                           'System administrator');

  return jsonb_build_object('batchId', v_batch.id, 'reference', v_batch.reference,
                            'state', v_batch.state, 'version', v_batch.version,
                            'mappingId', v_mapping_id);
end;
$$;

grant execute on function app.data_import_record_scan(uuid, int, int, jsonb, text, text) to authenticated;
grant execute on function app.data_import_record_mapping(uuid, uuid, jsonb) to authenticated;

commit;
