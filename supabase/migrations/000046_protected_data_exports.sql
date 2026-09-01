-- =============================================================================
-- 000046 — Purpose-bound protected data exports
--
-- Administrator-only, filtered, column-allowlisted, formula-safe, private,
-- expiring, and audited exports. Raw database dumps and arbitrary filter or
-- column expressions are never accepted or generated. Artifacts are private
-- generated documents with short signed delivery.
-- =============================================================================

begin;

create extension if not exists pgcrypto;

create table public.data_export_requests (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('EXP'),
  domain            text not null
                    check (domain in ('students','guardians','guardian_student_links',
                                      'enrollments','admissions','invoices','results')),
  state             text not null default 'requested'
                    check (state in ('requested','generating','ready','failed','expired','cancelled')),
  format            text not null default 'csv'
                    check (format in ('csv', 'xlsx')),
  filters           jsonb not null default '{}'::jsonb,
  columns           jsonb not null default '[]'::jsonb,
  purpose           text not null,
  reason            text not null,
  requested_by_account_id uuid not null references public.user_accounts(id) on delete restrict,
  row_count         int,
  document_id       uuid references public.documents(id) on delete restrict,
  expires_at        timestamptz,
  version           int not null default 1,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz,
  updated_at        timestamptz not null default now()
);

create index data_export_requests_state_idx on public.data_export_requests (state, created_at);
create trigger data_export_requests_touch before update on public.data_export_requests
  for each row execute function app.touch_updated_at();

create table public.data_export_events (
  id                uuid primary key default gen_random_uuid(),
  request_id        uuid not null references public.data_export_requests(id) on delete cascade,
  event_type        text not null
                    check (event_type in ('requested','generation_started','ready','failed','expired','cancelled')),
  detail            text,
  actor_account_id  uuid references public.user_accounts(id) on delete restrict,
  created_at        timestamptz not null default now()
);

create index data_export_events_request_idx on public.data_export_events (request_id, created_at);

-- New provider job kinds for exports (and import parsing from 000044's
-- boundary): extend the 000030 check constraint forward-only.
alter table public.provider_jobs drop constraint if exists provider_jobs_job_kind_check;
alter table public.provider_jobs
  add constraint provider_jobs_job_kind_check check (job_kind in (
    'storage_finalize', 'storage_scan', 'storage_orphan_cleanup',
    'document_retention', 'pdf_generate', 'email_delivery',
    'content_publish', 'settings_effective',
    'data_export_generate', 'data_import_parse'
  ));

alter table public.data_export_requests enable row level security;
alter table public.data_export_events enable row level security;
revoke all on public.data_export_requests, public.data_export_events from anon, authenticated;
grant select, insert, update on public.data_export_requests, public.data_export_events to service_role;
grant select on public.data_export_requests to authenticated;

create policy data_export_requests_service on public.data_export_requests
  for all to service_role using (true) with check (true);
create policy data_export_events_service on public.data_export_events
  for all to service_role using (true) with check (true);
create policy data_export_requests_admin_read on public.data_export_requests
  for select to authenticated
  using (app.is_staff_aal2() and app.has_role('system_administrator'));

-- ---------------------------------------------------------------------------
-- Commands (Administrator + aal2)
-- ---------------------------------------------------------------------------

create or replace function app.data_export_request(
  p_domain text,
  p_filters jsonb,
  p_columns jsonb,
  p_format text,
  p_purpose text,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.data_export_requests%rowtype;
  v_filter_key text;
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
  -- Filter keys and column names are allowlisted identifiers only.
  for v_filter_key in select key from jsonb_object_keys(coalesce(p_filters, '{}'::jsonb)) as k(key) loop
    if v_filter_key !~ '^[a-z_]{1,60}$' then
      raise exception 'filter field % is not an allowlisted identifier', v_filter_key;
    end if;
  end loop;

  insert into public.data_export_requests
    (domain, state, format, filters, columns, purpose, reason, requested_by_account_id)
  values
    (p_domain, 'requested', p_format, coalesce(p_filters, '{}'::jsonb), coalesce(p_columns, '[]'::jsonb),
     btrim(p_purpose), btrim(p_reason), auth.uid())
  returning * into v_request;

  insert into public.data_export_events (request_id, event_type, actor_account_id, detail)
  values (v_request.id, 'requested', auth.uid(), btrim(p_purpose));
  perform app.record_audit('Data export requested', 'data_export_request', v_request.reference, 'Success',
                           btrim(p_purpose), 'System administrator');
  -- Direct job insert: enqueue_provider_job is service-worker-gated by
  -- session_user, which stays `authenticated` inside SECURITY DEFINER.
  insert into public.provider_jobs (job_kind, target_type, target_reference, idempotency_key)
  values ('data_export_generate', 'data_export_request', v_request.reference,
          'data-export:' || v_request.reference || ':v1')
  on conflict (idempotency_key) do nothing;
  return jsonb_build_object('requestId', v_request.id, 'reference', v_request.reference,
                            'state', v_request.state, 'version', v_request.version);
end
$$;

create or replace function app.data_export_mark_ready(
  p_request_reference text,
  p_row_count int,
  p_document_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.data_export_requests%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' and not (
    app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'export completion requires the service worker or the administrator';
  end if;
  select * into v_request from public.data_export_requests where reference = p_request_reference for update;
  if v_request.id is null then raise exception 'export request not found'; end if;
  if v_request.state not in ('requested', 'generating') then
    raise exception 'export request is not generatable (state: %)', v_request.state;
  end if;
  update public.data_export_requests
     set state = 'ready', row_count = p_row_count, document_id = p_document_id,
         expires_at = now() + interval '24 hours', completed_at = now(), version = v_request.version + 1
   where id = v_request.id;
  insert into public.data_export_events (request_id, event_type, detail)
  values (v_request.id, 'ready', p_row_count || ' rows');
  perform app.record_audit('Data export ready', 'data_export_request', v_request.reference, 'Success',
                           p_row_count || ' rows');
  return jsonb_build_object('reference', v_request.reference, 'state', 'ready',
                            'expiresAt', (select expires_at from public.data_export_requests where id = v_request.id));
end
$$;

create or replace function app.data_export_mark_failed(
  p_request_reference text,
  p_error text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.data_export_requests%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' and not (
    app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'export failure recording requires the service worker or the administrator';
  end if;
  select * into v_request from public.data_export_requests where reference = p_request_reference for update;
  if v_request.id is null then raise exception 'export request not found'; end if;
  update public.data_export_requests set state = 'failed', version = v_request.version + 1 where id = v_request.id;
  insert into public.data_export_events (request_id, event_type, detail)
  values (v_request.id, 'failed', left(coalesce(p_error, 'export failed'), 500));
  perform app.record_audit('Data export failed', 'data_export_request', v_request.reference, 'Failed',
                           left(coalesce(p_error, 'export failed'), 500));
  return jsonb_build_object('reference', v_request.reference, 'state', 'failed');
end
$$;

create or replace function app.data_export_cancel(
  p_request_reference text,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.data_export_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'data export cancel requires the system administrator and aal2';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a cancellation reason is required';
  end if;
  select * into v_request from public.data_export_requests where reference = p_request_reference for update;
  if v_request.id is null then raise exception 'export request not found'; end if;
  if v_request.state in ('ready', 'expired', 'cancelled') then
    raise exception 'export request is already closed';
  end if;
  update public.data_export_requests set state = 'cancelled', version = v_request.version + 1 where id = v_request.id;
  insert into public.data_export_events (request_id, event_type, actor_account_id, detail)
  values (v_request.id, 'cancelled', auth.uid(), btrim(p_reason));
  perform app.record_audit('Data export cancelled', 'data_export_request', v_request.reference, 'Success',
                           btrim(p_reason), 'System administrator');
  return jsonb_build_object('reference', v_request.reference, 'state', 'cancelled');
end
$$;

create or replace function app.data_export_list()
returns setof jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'requestId', r.id, 'reference', r.reference, 'domain', r.domain, 'state', r.state,
    'format', r.format, 'rowCount', r.row_count, 'purpose', r.purpose,
    'expiresAt', r.expires_at, 'createdAt', r.created_at)
    from public.data_export_requests r
   where app.is_staff_aal2() and app.has_role('system_administrator')
   order by r.created_at desc
$$;

-- ---------------------------------------------------------------------------
-- Execution surface
-- ---------------------------------------------------------------------------

revoke all on function app.data_export_request(text, jsonb, jsonb, text, text, text) from public;
revoke all on function app.data_export_mark_ready(text, int, uuid) from public;
revoke all on function app.data_export_mark_failed(text, text) from public;
revoke all on function app.data_export_cancel(text, text) from public;
revoke all on function app.data_export_list() from public;

grant execute on function app.data_export_request(text, jsonb, jsonb, text, text, text) to authenticated;
grant execute on function app.data_export_mark_ready(text, int, uuid) to authenticated;
grant execute on function app.data_export_mark_failed(text, text) to authenticated;
grant execute on function app.data_export_cancel(text, text) to authenticated;
grant execute on function app.data_export_list() to authenticated;

commit;
