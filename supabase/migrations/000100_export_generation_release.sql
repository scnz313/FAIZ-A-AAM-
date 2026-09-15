-- 000100 — Release a claimed export generation back to the queue.
--
-- The export worker claims a request (`requested → generating`) before it
-- builds the artifact. A transient failure after the claim left the request
-- in `generating`, and every later attempt was refused with "not
-- generatable (state: generating)", wedging the export permanently. The
-- worker now releases the claim on transient failures through this
-- service-role command; failures thrown outright still use
-- `data_export_mark_failed`.

begin;

create or replace function app.data_export_release_generation(
  p_request_reference text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.data_export_requests%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'export generation release requires the service worker';
  end if;

  select * into v_request from public.data_export_requests
   where reference = p_request_reference for update;
  if v_request.id is null then raise exception 'export request not found'; end if;
  if v_request.state <> 'generating' then
    return jsonb_build_object('reference', v_request.reference, 'state', v_request.state, 'released', false);
  end if;

  update public.data_export_requests
     set state = 'requested', version = v_request.version + 1
   where id = v_request.id
  returning * into v_request;

  insert into public.data_export_events (request_id, event_type, detail)
  values (v_request.id, 'generation_released', 'transient failure; returned to the queue');

  return jsonb_build_object('reference', v_request.reference, 'state', v_request.state, 'released', true);
end;
$$;

revoke all on function app.data_export_release_generation(text) from public, anon, authenticated;
grant execute on function app.data_export_release_generation(text) to service_role;

commit;
