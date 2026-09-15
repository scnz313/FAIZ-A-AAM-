-- 000097 — Import scan recording must accept the provider worker.
--
-- `app.data_import_record_scan` is called by the outbox worker (service
-- role) to store parsed headers/row counts and move `scanning → mapping`,
-- but the function required an interactive AAL2 administrator session, so
-- every Supabase-mode import failed with "authenticated actor required" and
-- stalled in `scanning` even after a successful parse. The function now
-- accepts either the authenticated administrator or the service role and
-- keeps the same audit trail and transition checks.

begin;

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
  v_service boolean := session_user = 'service_role'
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role';
begin
  if auth.uid() is null and not v_service then
    raise exception 'authenticated actor required';
  end if;
  if not v_service and not (app.is_staff_aal2() and app.has_role('system_administrator')) then
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

commit;
