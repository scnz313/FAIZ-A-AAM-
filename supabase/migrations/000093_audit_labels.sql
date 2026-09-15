-- 000093 — Audit actor and target labels.
--
-- Staff-home and auth audit rows stored the raw account UUID as the target
-- and the literal "authenticated" as the actor label, which the audit table
-- then showed to users. This migration resolves the acting person's display
-- name and stores a readable account reference for auth events. Existing
-- rows are intentionally not rewritten: audit_events is append-only.

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
    (v_actor,
     coalesce(
       p_actor_label,
       (select p.display_name
          from public.user_accounts ua
          join public.people p on p.id = ua.person_id
         where ua.id = v_actor),
       case when v_actor is null then 'service_worker' end,
       'authenticated'
     ),
     p_action, p_target_type, p_target_reference, p_outcome, p_reason)
  returning id into v_id;
  return v_id;
end;
$$;

-- Readable account reference for staff auth events (never the raw UUID).
create or replace function app.audit_account_reference(p_account_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.display_name, ua.verified_contact, 'Staff account')
    from public.user_accounts ua
    left join public.people p on p.id = ua.person_id
   where ua.id = p_account_id
$$;

revoke all on function app.audit_account_reference(uuid) from public, anon;
grant execute on function app.audit_account_reference(uuid) to authenticated, service_role;

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
  perform app.record_audit(v_action, 'user_account', app.audit_account_reference(v_account.id), 'Success');
  return jsonb_build_object('accountId', v_account.id, 'event', p_event);
end
$$;

create or replace function app.accounts_mark_mfa_verified()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_account public.user_accounts%rowtype;
begin
  if auth.uid() is null or (auth.jwt() ->> 'aal') <> 'aal2' then raise exception 'aal2 verification is required'; end if;
  if not app.account_has_staff_grant() then raise exception 'staff MFA verification is required'; end if;
  select * into v_account from public.user_accounts where id=auth.uid() for update;
  if v_account.id is null or v_account.status<>'active' then raise exception 'active account not found'; end if;
  update public.user_accounts set mfa_status='verified',mfa_verified_at=now() where id=v_account.id returning * into v_account;
  perform app.record_audit('MFA verified','user_account', app.audit_account_reference(v_account.id),'Success');
  return jsonb_build_object('accountId',v_account.id,'status',v_account.mfa_status,'verifiedAt',v_account.mfa_verified_at);
end;
$$;

commit;
