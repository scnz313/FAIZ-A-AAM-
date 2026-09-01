-- =============================================================================
-- 000060 — Protected export repair: per-domain allowlists, worker handler,
-- artifact requirement, request idempotency
--
-- Forward-only repair of live Phase 7 defects:
--   1. Filter keys were only regex-checked — add per-domain allowlists.
--   2. Column names were not validated at all — add per-domain catalogs.
--   3. data_export_generate jobs were never processed — the worker handler
--      is implemented in apps/web/lib/supabase/outbox-worker.ts (code side);
--      this migration adds the request idempotency and lease columns.
--   4. mark_ready accepted a null document — already repaired in 000056.
-- =============================================================================

begin;

-- Request idempotency and generation lease.
alter table public.data_export_requests
  add column if not exists idempotency_key text,
  add column if not exists generation_started_at timestamptz,
  add column if not exists generation_attempts int not null default 0,
  add column if not exists artifact_checksum text;

create unique index if not exists data_export_requests_idempotency_uidx
  on public.data_export_requests (idempotency_key)
  where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- Per-domain filter/column allowlists (code-owned; the SQL enforces them)
-- ---------------------------------------------------------------------------

create or replace function app.data_export_allowed_filters(p_domain text)
returns text[]
language sql
immutable
as $$
  select case p_domain
    when 'students' then array['status', 'academic_year_id', 'grade_section_id']
    when 'guardians' then array['status']
    when 'guardian_student_links' then array['status', 'verification_source']
    when 'enrollments' then array['status', 'academic_year_id', 'grade_section_id']
    when 'admissions' then array['current_status', 'academic_year_id']
    when 'invoices' then array['status', 'term', 'academic_year_id']
    when 'results' then array['status', 'term', 'academic_year_id']
    else array[]::text[]
  end
$$;

create or replace function app.data_export_allowed_columns(p_domain text)
returns text[]
language sql
immutable
as $$
  select case p_domain
    when 'students' then array['reference', 'display_name', 'status', 'school_student_number', 'enrollment_status', 'grade_label', 'section_label', 'academic_year_label']
    when 'guardians' then array['reference', 'display_name', 'status', 'linked_children_count']
    when 'guardian_student_links' then array['reference', 'guardian_display_name', 'student_display_name', 'relationship_label', 'status', 'verification_source', 'effective_from']
    when 'enrollments' then array['reference', 'student_display_name', 'grade_label', 'section_label', 'academic_year_label', 'status', 'effective_from']
    when 'admissions' then array['reference', 'student_name', 'parent_name', 'current_status', 'grade_label', 'academic_year_label', 'submitted_at']
    when 'invoices' then array['reference', 'student_display_name', 'term', 'status', 'amount_paise', 'paid_paise', 'due_date']
    when 'results' then array['reference', 'student_display_name', 'term', 'status', 'version', 'published_at']
    else array[]::text[]
  end
$$;

-- ---------------------------------------------------------------------------
-- Request: enforce per-domain allowlists + idempotency
-- ---------------------------------------------------------------------------

create or replace function app.data_export_request(
  p_domain text,
  p_filters jsonb,
  p_columns jsonb,
  p_format text,
  p_purpose text,
  p_reason text,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.data_export_requests%rowtype;
  v_filter_key text;
  v_column_name text;
  v_allowed_filters text[];
  v_allowed_columns text[];
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'data exports require the system administrator and aal2';
  end if;
  if p_domain not in ('students','guardians','guardian_student_links','enrollments','admissions','invoices','results') then
    raise exception 'export domain is not allowlisted';
  end if;
  if p_format not in ('csv', 'xlsx') then raise exception 'format must be csv or xlsx'; end if;
  if p_purpose is null or length(btrim(p_purpose)) < 3 then
    raise exception 'a stated purpose is required';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a recorded reason is required';
  end if;
  if jsonb_typeof(coalesce(p_filters, '{}'::jsonb)) <> 'object' then
    raise exception 'filters must be an object of allowlisted fields';
  end if;
  if jsonb_typeof(coalesce(p_columns, '[]'::jsonb)) <> 'array' then
    raise exception 'columns must be an array of allowlisted names';
  end if;

  v_allowed_filters := app.data_export_allowed_filters(p_domain);
  for v_filter_key in select key from jsonb_object_keys(coalesce(p_filters, '{}'::jsonb)) as k(key) loop
    if not (v_filter_key = any(v_allowed_filters)) then
      raise exception 'filter field % is not allowlisted for domain %', v_filter_key, p_domain;
    end if;
  end loop;

  v_allowed_columns := app.data_export_allowed_columns(p_domain);
  for v_column_name in select value::text from jsonb_array_elements_text(coalesce(p_columns, '[]'::jsonb)) as v(value) loop
    if not (v_column_name = any(v_allowed_columns)) then
      raise exception 'column % is not allowlisted for domain %', v_column_name, p_domain;
    end if;
  end loop;

  -- Idempotency: a retry with the same key returns the existing request.
  if p_idempotency_key is not null then
    select * into v_request from public.data_export_requests where idempotency_key = btrim(p_idempotency_key);
    if v_request.id is not null then
      return jsonb_build_object('requestId', v_request.id, 'reference', v_request.reference,
                                'state', v_request.state, 'version', v_request.version);
    end if;
  end if;

  insert into public.data_export_requests
    (domain, state, format, filters, columns, purpose, reason, requested_by_account_id, idempotency_key)
  values
    (p_domain, 'requested', p_format, coalesce(p_filters, '{}'::jsonb), coalesce(p_columns, '[]'::jsonb),
     btrim(p_purpose), btrim(p_reason), auth.uid(), case when p_idempotency_key is not null then btrim(p_idempotency_key) end)
  returning * into v_request;

  insert into public.data_export_events (request_id, event_type, actor_account_id, detail)
  values (v_request.id, 'requested', auth.uid(), btrim(p_purpose));
  perform app.record_audit('Data export requested', 'data_export_request', v_request.reference, 'Success',
                           btrim(p_purpose), 'System administrator');
  insert into public.provider_jobs (job_kind, target_type, target_reference, idempotency_key)
  values ('data_export_generate', 'data_export_request', v_request.reference,
          'data-export:' || v_request.reference || ':v1')
  on conflict (idempotency_key) do nothing;
  return jsonb_build_object('requestId', v_request.id, 'reference', v_request.reference,
                            'state', v_request.state, 'version', v_request.version);
end
$$;

-- ---------------------------------------------------------------------------
-- Worker lease: claimed/generating transition for the provider worker
-- ---------------------------------------------------------------------------

create or replace function app.data_export_claim_generation(
  p_request_reference text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.data_export_requests%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'export generation requires the service worker';
  end if;
  select * into v_request from public.data_export_requests where reference = p_request_reference for update;
  if v_request.id is null then raise exception 'export request not found'; end if;
  if v_request.state not in ('requested', 'failed') then
    raise exception 'export request is not generatable (state: %)', v_request.state;
  end if;
  update public.data_export_requests
     set state = 'generating',
         generation_started_at = now(),
         generation_attempts = v_request.generation_attempts + 1,
         version = v_request.version + 1
   where id = v_request.id;
  insert into public.data_export_events (request_id, event_type, detail)
  values (v_request.id, 'generation_started', 'attempt ' || (v_request.generation_attempts + 1));
  return jsonb_build_object('reference', v_request.reference, 'state', 'generating',
                            'attempt', v_request.generation_attempts + 1);
end
$$;

revoke all on function app.data_export_claim_generation(text) from public, anon, authenticated;
grant execute on function app.data_export_claim_generation(text) to service_role;

revoke all on function app.data_export_request(text, jsonb, jsonb, text, text, text, text) from public, anon;
grant execute on function app.data_export_request(text, jsonb, jsonb, text, text, text, text) to authenticated;

commit;
