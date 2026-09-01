-- =============================================================================
-- 000054 — Service-worker audit/outbox allowance
--
-- record_audit and enqueue_outbox hard-required auth.uid(), so provider
-- workers (service role, no user context) could not record audit evidence
-- or enqueue events — guardian_claim_mark_dispatched failed with
-- 'authenticated actor required'. Service sessions may now record audit
-- with an explicit 'service_worker' actor label; human-session behavior is
-- unchanged.
-- =============================================================================

begin;

create or replace function app.record_audit(
  p_action text,
  p_target_type text,
  p_target_reference text,
  p_outcome text default 'Success',
  p_reason text default null,
  p_actor_label text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  if v_actor is null then
    if not (session_user = 'service_role' or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
      raise exception 'authenticated actor required';
    end if;
  end if;
  insert into public.audit_events
    (actor_account_id, actor_label, action, target_type, target_reference, outcome, reason)
  values
    (v_actor, coalesce(p_actor_label, case when v_actor is null then 'service_worker' end, 'authenticated'),
     p_action, p_target_type, p_target_reference, p_outcome, p_reason)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function app.enqueue_outbox(
  p_event_key text,
  p_kind text,
  p_target_type text,
  p_target_reference text,
  p_payload jsonb default '{}'::jsonb,
  p_max_attempts int default 10
) returns public.outbox_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.outbox_events;
begin
  if auth.uid() is null
     and not (session_user = 'service_role' or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'authenticated actor required';
  end if;
  insert into public.outbox_events
    (event_key, kind, target_type, target_reference, payload, max_attempts)
  values
    (p_event_key, p_kind, p_target_type, p_target_reference, coalesce(p_payload, '{}'::jsonb), p_max_attempts)
  on conflict (event_key) do nothing
  returning * into v_row;
  if v_row is null then
    select * into v_row from public.outbox_events where event_key = p_event_key;
  end if;
  return v_row;
end;
$$;

commit;
