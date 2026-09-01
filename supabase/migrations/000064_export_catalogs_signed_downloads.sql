-- =============================================================================
-- 000064 — Export catalogs, opaque artifact keys, and signed downloads
--
-- Forward-only migration (plan.md Phase 11.5). Adds:
--   1. data_export_catalogs — self-describing export domain catalogs so the
--      UI can render available columns/filters without hardcoding them.
--   2. Opaque artifact_key on data_export_requests — a random download key
--      that is never the request reference, used to build signed download URLs.
--   3. Signed-download helper that returns the artifact key + document storage
--      coordinates so the application layer can mint a Supabase Storage signed URL.
--   4. Keyset-paginated export list for the administrator workspace.
--   5. Seed catalog entries for the seven allowlisted export domains.
--
-- Never edit migrations 000001–000063.
-- =============================================================================

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Export catalog table
-- ---------------------------------------------------------------------------
-- A catalog row describes one export domain: its display name, the columns
-- available for selection (with labels and types), the required and optional
-- filter fields, and a row ceiling. The catalog is the single source of truth
-- for the export builder UI; the per-domain allowlist functions in 000060
-- remain the enforcement layer.

create table if not exists public.data_export_catalogs (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('XCAT'),
  domain            text not null,
  display_name      text not null,
  description       text not null default '',
  available_columns jsonb not null,           -- array of {column, label, type}
  required_filters  jsonb not null default '[]'::jsonb,
  optional_filters  jsonb not null default '[]'::jsonb,
  max_rows          int not null default 50000,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Only one active catalog per domain.
create unique index if not exists data_export_catalogs_domain_active_uidx
  on public.data_export_catalogs (domain)
  where is_active = true;

create index if not exists data_export_catalogs_domain_idx
  on public.data_export_catalogs (domain);

alter table public.data_export_catalogs enable row level security;

revoke all on public.data_export_catalogs from anon, authenticated;
grant select, insert, update on public.data_export_catalogs to service_role;
grant select on public.data_export_catalogs to authenticated;

create policy data_export_catalogs_service
  on public.data_export_catalogs for all to service_role
  using (true) with check (true);

-- Authenticated staff (AAL2 + system_administrator) may read the catalogs.
create policy data_export_catalogs_staff_read
  on public.data_export_catalogs for select to authenticated
  using (app.is_staff_aal2() and app.has_role('system_administrator'));

-- ---------------------------------------------------------------------------
-- 2. Opaque artifact keys
-- ---------------------------------------------------------------------------
-- The artifact_key is a random 32-byte hex string used to build download URLs.
-- It is deliberately NOT the request reference, so a leaked URL cannot be
-- guessed from a visible reference and the reference alone never grants a
-- download. The key is set when an export becomes ready (by the worker or an
-- administrator) and is required to mint a signed download.

alter table public.data_export_requests
  add column if not exists artifact_key text;

create index if not exists data_export_requests_artifact_key_idx
  on public.data_export_requests (artifact_key)
  where artifact_key is not null;

-- Staff-only (AAL2 + system_administrator): generate and persist a fresh
-- opaque artifact key for a ready export. Returns { artifactKey }.
create or replace function app.data_export_set_artifact_key(
  p_request_reference text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.data_export_requests%rowtype;
  v_key text;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'artifact key issuance requires the system administrator and aal2';
  end if;

  select * into v_request from public.data_export_requests
   where reference = p_request_reference for update;
  if v_request.id is null then raise exception 'export request not found'; end if;
  if v_request.state <> 'ready' then
    raise exception 'an artifact key can only be set for a ready export (state: %)', v_request.state;
  end if;

  -- 32 random bytes encoded as 64 lowercase hex characters.
  v_key := encode(gen_random_bytes(32), 'hex');

  update public.data_export_requests
     set artifact_key = v_key, version = v_request.version + 1
   where id = v_request.id;

  perform app.record_audit('Export artifact key issued', 'data_export_request',
                           v_request.reference, 'Success', null, 'System administrator');

  return jsonb_build_object('artifactKey', v_key);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Signed download helper
-- ---------------------------------------------------------------------------
-- Verifies the caller is staff (users.manage / system_administrator + AAL2),
-- verifies the export is ready and not expired, ensures an artifact key
-- exists (issuing one if missing), and returns the storage coordinates so the
-- application layer can create a Supabase Storage signed URL. The database
-- never mints the URL itself — that requires the Storage admin client.

create or replace function app.data_export_create_signed_download(
  p_request_reference text,
  p_account_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.data_export_requests%rowtype;
  v_doc public.documents%rowtype;
  v_key text;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'signed downloads require the system administrator and aal2';
  end if;

  select * into v_request from public.data_export_requests
   where reference = p_request_reference for update;
  if v_request.id is null then raise exception 'export request not found'; end if;
  if v_request.state <> 'ready' then
    raise exception 'export is not ready for download (state: %)', v_request.state;
  end if;
  if v_request.expires_at is not null and v_request.expires_at <= now() then
    raise exception 'export artifact has expired';
  end if;
  if v_request.document_id is null then
    raise exception 'export has no stored artifact document';
  end if;

  select * into v_doc from public.documents where id = v_request.document_id;
  if v_doc.id is null then raise exception 'artifact document not found'; end if;

  -- Issue an artifact key if one was never set (e.g. older ready exports).
  if v_request.artifact_key is null then
    v_key := encode(gen_random_bytes(32), 'hex');
    update public.data_export_requests
       set artifact_key = v_key, version = v_request.version + 1
     where id = v_request.id;
  else
    v_key := v_request.artifact_key;
  end if;

  perform app.record_audit('Export signed download issued', 'data_export_request',
                           v_request.reference, 'Success', null, 'System administrator');

  return jsonb_build_object(
    'artifactKey', v_key,
    'documentRef', v_doc.reference,
    'bucket', v_doc.storage_bucket,
    'objectKey', v_doc.object_key,
    'expiresAt', v_request.expires_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Cursor-paginated export list
-- ---------------------------------------------------------------------------
-- Keyset pagination on (created_at desc, reference desc) for stable ordering
-- across concurrent inserts. The cursor is the ISO timestamp + '|' + reference
-- of the last row on the previous page. Staff-only (AAL2 + system_administrator).

create or replace function app.data_export_list_paginated(
  p_cursor text default null,
  p_limit int default 20
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_limit int := least(greatest(p_limit, 1), 100);
  v_cursor_ts timestamptz;
  v_cursor_ref text;
  v_rows jsonb;
  v_next text;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'the export list requires the system administrator and aal2';
  end if;

  if p_cursor is not null or btrim(coalesce(p_cursor, '')) <> '' then
    -- Cursor format: <iso8601 created_at>|<reference>
    v_cursor_ts := split_part(p_cursor, '|', 1)::timestamptz;
    v_cursor_ref := split_part(p_cursor, '|', 2);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'requestId', r.id, 'reference', r.reference, 'domain', r.domain, 'state', r.state,
    'format', r.format, 'rowCount', r.row_count, 'purpose', r.purpose,
    'expiresAt', r.expires_at, 'createdAt', r.created_at
  ) order by r.created_at desc, r.reference desc), '[]'::jsonb) into v_rows
    from public.data_export_requests r
   where (v_cursor_ts is null
          or (r.created_at, r.reference) < (v_cursor_ts, v_cursor_ref))
   limit v_limit + 1;

  -- If we fetched more than the page size, a next page exists.
  if jsonb_array_length(v_rows) > v_limit then
    v_rows := v_rows - (v_rows -> v_limit);
    select to_char((v_rows -> (v_limit - 1)) ->> 'createdAt', 'YYYY-MM-DD"T"HH24:MI:SS.USOF')
           || '|' || ((v_rows -> (v_limit - 1)) ->> 'reference') into v_next;
  else
    v_next := null;
  end if;

  return jsonb_build_object('rows', v_rows, 'nextCursor', v_next);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Seed export catalog entries
-- ---------------------------------------------------------------------------
-- Idempotent: re-running updates the catalog to match the canonical definition.
-- The available_columns mirror the per-domain allowlists enforced by
-- app.data_export_allowed_columns (000060), enriched with human labels and
-- types for the export builder UI.

insert into public.data_export_catalogs
  (domain, display_name, description, available_columns, required_filters, optional_filters, max_rows, is_active)
values
  ('students',
   'Students',
   'Student identity records with current enrollment placement.',
   '[{"column":"reference","label":"Reference","type":"text"},
     {"column":"display_name","label":"Display name","type":"text"},
     {"column":"status","label":"Status","type":"text"},
     {"column":"school_student_number","label":"School student number","type":"text"},
     {"column":"enrollment_status","label":"Enrollment status","type":"text"},
     {"column":"grade_label","label":"Grade","type":"text"},
     {"column":"section_label","label":"Section","type":"text"},
     {"column":"academic_year_label","label":"Academic year","type":"text"}]'::jsonb,
   '[]'::jsonb,
   '[{"filter":"status","label":"Status","type":"text"},
     {"filter":"academic_year_id","label":"Academic year","type":"uuid"},
     {"filter":"grade_section_id","label":"Grade section","type":"uuid"}]'::jsonb,
   50000, true),
  ('guardians',
   'Guardians',
   'Guardian identity records with linked children count.',
   '[{"column":"reference","label":"Reference","type":"text"},
     {"column":"display_name","label":"Display name","type":"text"},
     {"column":"status","label":"Status","type":"text"},
     {"column":"linked_children_count","label":"Linked children","type":"number"}]'::jsonb,
   '[]'::jsonb,
   '[{"filter":"status","label":"Status","type":"text"}]'::jsonb,
   50000, true),
  ('guardian_student_links',
   'Guardian–student links',
   'Verified guardian–student relationships.',
   '[{"column":"reference","label":"Reference","type":"text"},
     {"column":"guardian_display_name","label":"Guardian","type":"text"},
     {"column":"student_display_name","label":"Student","type":"text"},
     {"column":"relationship_label","label":"Relationship","type":"text"},
     {"column":"status","label":"Status","type":"text"},
     {"column":"verification_source","label":"Verification source","type":"text"},
     {"column":"effective_from","label":"Effective from","type":"datetime"}]'::jsonb,
   '[]'::jsonb,
   '[{"filter":"status","label":"Status","type":"text"},
     {"filter":"verification_source","label":"Verification source","type":"text"}]'::jsonb,
   50000, true),
  ('enrollments',
   'Enrollments',
   'Student placement in an academic year and grade/section.',
   '[{"column":"reference","label":"Reference","type":"text"},
     {"column":"student_display_name","label":"Student","type":"text"},
     {"column":"grade_label","label":"Grade","type":"text"},
     {"column":"section_label","label":"Section","type":"text"},
     {"column":"academic_year_label","label":"Academic year","type":"text"},
     {"column":"status","label":"Status","type":"text"},
     {"column":"effective_from","label":"Effective from","type":"datetime"}]'::jsonb,
   '[]'::jsonb,
   '[{"filter":"status","label":"Status","type":"text"},
     {"filter":"academic_year_id","label":"Academic year","type":"uuid"},
     {"filter":"grade_section_id","label":"Grade section","type":"uuid"}]'::jsonb,
   50000, true),
  ('admissions',
   'Admissions',
   'Admission applications and their current status.',
   '[{"column":"reference","label":"Reference","type":"text"},
     {"column":"student_name","label":"Student name","type":"text"},
     {"column":"parent_name","label":"Parent name","type":"text"},
     {"column":"current_status","label":"Current status","type":"text"},
     {"column":"grade_label","label":"Grade","type":"text"},
     {"column":"academic_year_label","label":"Academic year","type":"text"},
     {"column":"submitted_at","label":"Submitted at","type":"datetime"}]'::jsonb,
   '[]'::jsonb,
   '[{"filter":"current_status","label":"Current status","type":"text"},
     {"filter":"academic_year_id","label":"Academic year","type":"uuid"}]'::jsonb,
   50000, true),
  ('invoices',
   'Invoices',
   'Fee invoices with status and paid/outstanding amounts.',
   '[{"column":"reference","label":"Reference","type":"text"},
     {"column":"student_display_name","label":"Student","type":"text"},
     {"column":"term","label":"Term","type":"text"},
     {"column":"status","label":"Status","type":"text"},
     {"column":"amount_paise","label":"Amount (paise)","type":"number"},
     {"column":"paid_paise","label":"Paid (paise)","type":"number"},
     {"column":"due_date","label":"Due date","type":"date"}]'::jsonb,
   '[]'::jsonb,
   '[{"filter":"status","label":"Status","type":"text"},
     {"filter":"term","label":"Term","type":"text"},
     {"filter":"academic_year_id","label":"Academic year","type":"uuid"}]'::jsonb,
   50000, true),
  ('results',
   'Results',
   'Published assessment results with version and publication time.',
   '[{"column":"reference","label":"Reference","type":"text"},
     {"column":"student_display_name","label":"Student","type":"text"},
     {"column":"term","label":"Term","type":"text"},
     {"column":"status","label":"Status","type":"text"},
     {"column":"version","label":"Version","type":"number"},
     {"column":"published_at","label":"Published at","type":"datetime"}]'::jsonb,
   '[]'::jsonb,
   '[{"filter":"status","label":"Status","type":"text"},
     {"filter":"term","label":"Term","type":"text"},
     {"filter":"academic_year_id","label":"Academic year","type":"uuid"}]'::jsonb,
   50000, true)
on conflict (domain) where is_active = true
  do update set
    display_name      = excluded.display_name,
    description       = excluded.description,
    available_columns = excluded.available_columns,
    required_filters  = excluded.required_filters,
    optional_filters  = excluded.optional_filters,
    max_rows          = excluded.max_rows,
    is_active         = true,
    updated_at        = now();

-- ---------------------------------------------------------------------------
-- Execution surface
-- ---------------------------------------------------------------------------

revoke all on function app.data_export_set_artifact_key(text) from public, anon;
revoke all on function app.data_export_create_signed_download(text, uuid) from public, anon;
revoke all on function app.data_export_list_paginated(text, int) from public, anon;

grant execute on function app.data_export_set_artifact_key(text) to authenticated;
grant execute on function app.data_export_create_signed_download(text, uuid) to authenticated;
grant execute on function app.data_export_list_paginated(text, int) to authenticated;

commit;
