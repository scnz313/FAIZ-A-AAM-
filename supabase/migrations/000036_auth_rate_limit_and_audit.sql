begin;

create or replace function app.auth_rate_limit_consume(
  p_subject_hash text,
  p_action text,
  p_limit int,
  p_window_seconds int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_window_start timestamptz;
  v_count int;
  v_retry_after int;
begin
  if session_user <> 'service_role' and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'auth rate limiting requires the service role';
  end if;
  if p_subject_hash is null or length(btrim(p_subject_hash)) <> 64 or p_action is null or length(btrim(p_action)) < 3 then
    raise exception 'valid rate-limit subject and action are required';
  end if;
  if p_limit < 1 or p_window_seconds < 1 then raise exception 'invalid rate-limit policy'; end if;
  v_window_start := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limit_buckets(subject_hash, action, window_start, count)
  values (btrim(p_subject_hash), btrim(p_action), v_window_start, 1)
  on conflict (subject_hash, action, window_start)
  do update set count = public.rate_limit_buckets.count + 1
  returning count into v_count;
  v_retry_after := greatest(1, ceil(extract(epoch from (v_window_start + make_interval(secs => p_window_seconds) - v_now)))::int);
  return jsonb_build_object('allowed', v_count <= p_limit, 'count', v_count, 'limit', p_limit, 'retryAfterSeconds', v_retry_after);
end
$$;

create or replace function app.accounts_record_auth_event(p_event text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.user_accounts%rowtype;
  v_action text;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if p_event not in ('signed_in','signed_out','password_changed') then raise exception 'invalid auth event'; end if;
  select * into v_account from public.user_accounts where id = auth.uid();
  if v_account.id is null then raise exception 'account not found'; end if;
  v_action := case p_event when 'signed_in' then 'Login' when 'signed_out' then 'Logout' else 'Password changed' end;
  perform app.record_audit(v_action, 'user_account', v_account.id::text, 'Success');
  return jsonb_build_object('accountId', v_account.id, 'event', p_event);
end
$$;

create or replace function app.accounts_record_recovery_request(p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if session_user <> 'service_role' and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'recovery audit requires the service role';
  end if;
  if p_account_id is null or not exists (select 1 from public.user_accounts where id = p_account_id) then
    raise exception 'account not found';
  end if;
  insert into public.audit_events(actor_account_id, actor_label, action, target_type, target_reference, outcome, reason)
  values (null, 'Account recovery', 'Recovery requested', 'user_account', p_account_id::text, 'Success', 'Generic recovery request accepted');
  return jsonb_build_object('accountId', p_account_id, 'recorded', true);
end
$$;

revoke all on function app.auth_rate_limit_consume(text,text,int,int), app.accounts_record_auth_event(text), app.accounts_record_recovery_request(uuid) from public, anon, authenticated;
grant execute on function app.auth_rate_limit_consume(text,text,int,int), app.accounts_record_recovery_request(uuid) to service_role;
grant execute on function app.accounts_record_auth_event(text) to authenticated;

commit;
