begin;

alter table public.account_invitations
  add column if not exists resend_count int not null default 0,
  add column if not exists last_sent_at timestamptz;

alter table public.account_invitations
  drop constraint if exists account_invitations_provider_state_check,
  add constraint account_invitations_provider_state_check
    check (provider_state in ('not_dispatched', 'dispatched', 'failed', 'revoked'));

create or replace function app.staff_invites_revoke(
  p_invitation_reference text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.account_invitations%rowtype;
  v_provider_subject uuid;
begin
  if not (app.is_staff_aal2() and app.has_any_role(array['system_administrator'])) then
    raise exception 'staff invitation revocation requires system_administrator and aal2';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'staff invitation revocation reason is required';
  end if;

  select * into v_inv
    from public.account_invitations
   where reference = p_invitation_reference
   for update;

  if v_inv.id is null or v_inv.purpose <> 'staff' then
    raise exception 'staff invitation not found';
  end if;
  if v_inv.account_id is not null then
    raise exception 'staff invitation already has an account';
  end if;
  if v_inv.status not in ('pending', 'expired') then
    raise exception 'staff invitation cannot be revoked';
  end if;

  v_provider_subject := v_inv.provider_subject;
  if v_inv.account_id is not null or exists (
    select 1
      from public.user_accounts ua
     where ua.id = v_inv.provider_subject
       and ua.status = 'active'
  ) then
    v_provider_subject := null;
  end if;

  update public.account_invitations
     set status = 'revoked',
         provider_state = 'revoked',
         provider_subject = case when v_provider_subject is null then provider_subject else null end,
         provider_invitation_ref = case when v_provider_subject is null then provider_invitation_ref else null end
   where id = v_inv.id;

  perform app.record_audit('Staff invitation revoked', 'account_invitation', v_inv.reference,
                           'Success', btrim(p_reason), 'System administrator');

  return jsonb_build_object(
    'invitationRef', v_inv.reference,
    'providerSubject', v_provider_subject,
    'status', 'revoked'
  );
end;
$$;

create or replace function app.staff_invites_mark_resent(
  p_invitation_reference text,
  p_provider_subject uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.account_invitations%rowtype;
  v_resend_count int;
  v_expires_at timestamptz;
begin
  if not (app.is_staff_aal2() and app.has_any_role(array['system_administrator'])) then
    raise exception 'staff invitation resend requires system_administrator and aal2';
  end if;
  if p_provider_subject is null then
    raise exception 'provider invitation user is required';
  end if;

  select * into v_inv
    from public.account_invitations
   where reference = p_invitation_reference
   for update;

  if v_inv.id is null or v_inv.purpose <> 'staff' then
    raise exception 'staff invitation not found';
  end if;
  if v_inv.account_id is not null then
    raise exception 'staff invitation already has an account';
  end if;
  if v_inv.status not in ('pending', 'expired') then
    raise exception 'staff invitation cannot be resent';
  end if;
  if v_inv.provider_subject is not null and v_inv.provider_subject <> p_provider_subject then
    raise exception 'staff invitation provider subject does not match';
  end if;

  update public.account_invitations
     set provider_subject = coalesce(provider_subject, p_provider_subject),
         status = 'pending',
         expires_at = greatest(expires_at, now() + interval '7 days'),
         resend_count = resend_count + 1,
         last_sent_at = now(),
         provider_state = 'dispatched',
         provider_dispatched_at = now()
   where id = v_inv.id
   returning resend_count, expires_at into v_resend_count, v_expires_at;

  perform app.record_audit('Staff invitation resent', 'account_invitation', v_inv.reference,
                           'Success', null, 'System administrator');

  return jsonb_build_object(
    'invitationRef', v_inv.reference,
    'resendCount', v_resend_count,
    'expiresAt', v_expires_at
  );
end;
$$;

create or replace function app.staff_invites_attach_provider(
  p_invitation_reference text,
  p_provider_subject uuid,
  p_provider_invitation_ref text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.account_invitations%rowtype;
begin
  if not (app.is_staff_aal2() and app.has_any_role(array['system_administrator'])) then
    raise exception 'staff invitation dispatch requires system_administrator and aal2';
  end if;
  if p_provider_subject is null or not exists (select 1 from auth.users where id = p_provider_subject) then
    raise exception 'provider invitation user was not found';
  end if;
  select * into v_inv from public.account_invitations
   where reference = p_invitation_reference for update;
  if v_inv.id is null or v_inv.purpose <> 'staff' then raise exception 'staff invitation not found'; end if;
  if v_inv.status <> 'pending' or v_inv.expires_at <= now() then raise exception 'staff invitation is no longer valid'; end if;
  if v_inv.provider_subject is not null and v_inv.provider_subject <> p_provider_subject then
    raise exception 'staff invitation provider subject is already bound';
  end if;
  update public.account_invitations
     set provider_subject = p_provider_subject,
         provider_invitation_ref = nullif(btrim(p_provider_invitation_ref), ''),
         provider_dispatched_at = now(), provider_state = 'dispatched',
         last_sent_at = now()
   where id = v_inv.id;
  perform app.record_audit('Staff invitation dispatched', 'account_invitation', v_inv.reference,
                           'Success', null, 'System administrator');
  insert into public.outbox_events (event_key, kind, target_type, target_reference, payload)
  values ('security.staff_invitation_dispatched:' || v_inv.reference, 'security.staff_invitation_dispatched',
          'account_invitation', v_inv.reference,
          jsonb_build_object('providerSubject', p_provider_subject))
  on conflict (event_key) do nothing;
  return jsonb_build_object('invitationRef', v_inv.reference, 'providerSubject', p_provider_subject,
                            'status', 'dispatched');
end;
$$;

create or replace function app.staff_invites_mark_provider_failed(
  p_invitation_reference text,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.account_invitations%rowtype;
begin
  if not (app.is_staff_aal2() and app.has_any_role(array['system_administrator'])) then
    raise exception 'staff invitation dispatch requires system_administrator and aal2';
  end if;
  select * into v_inv from public.account_invitations where reference = p_invitation_reference for update;
  if v_inv.id is null then raise exception 'staff invitation not found'; end if;
  update public.account_invitations
     set provider_state = 'failed'
   where id = v_inv.id;
  perform app.record_audit('Staff invitation provider failed', 'account_invitation', v_inv.reference,
                           'Failed', left(coalesce(p_reason, 'provider failed'), 500), 'System administrator');
end;
$$;

create or replace function app.users_admin_list()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_data order by row_data->>'name'), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', ua.id, 'status', ua.status, 'verified_contact', ua.verified_contact,
        'mfa_status', ua.mfa_status, 'mfa_verified_at', ua.mfa_verified_at,
        'name', p.display_name,
        'staff_members', coalesce((select jsonb_agg(jsonb_build_object(
            'id', sm.id, 'reference', sm.reference, 'title', sm.title,
            'employment_status', sm.employment_status,
            'access_profile_code', sm.access_profile_code,
            'access_profile_version', sm.access_profile_version))
            from public.staff_members sm where sm.person_id = ua.person_id), '[]'::jsonb),
        'role_grants', coalesce((select jsonb_agg(jsonb_build_object(
            'id', rg.id, 'reference', rg.reference, 'role_code', rg.role_code,
            'status', rg.status, 'version', rg.version,
            'effective_from', rg.effective_from, 'effective_to', rg.effective_to,
            'reason', rg.reason))
            from public.role_grants rg where rg.account_id = ua.id), '[]'::jsonb),
        'account_invitations', coalesce((select jsonb_agg(jsonb_build_object(
            'reference', ai.reference, 'contact', ai.contact, 'status', ai.status,
            'expires_at', ai.expires_at, 'last_sent_at', ai.last_sent_at,
            'resend_count', ai.resend_count, 'provider_state', ai.provider_state,
            'role_code', ai.intended_role_code, 'reason', ai.intended_reason,
            'profile_code', ai.intended_staff_profile_code))
            from public.account_invitations ai where ai.account_id = ua.id), '[]'::jsonb)
      ) as row_data
      from public.user_accounts ua join public.people p on p.id = ua.person_id
      where app.is_staff_aal2() and app.has_role('system_administrator')
      union all
      select jsonb_build_object(
        'id', null, 'status', ai.status, 'verified_contact', null,
        'mfa_status', 'not_applicable', 'mfa_verified_at', null,
        'name', ai.intended_display_name,
        'staff_members', '[]'::jsonb,
        'role_grants', '[]'::jsonb,
        'account_invitations', jsonb_build_array(jsonb_build_object(
            'reference', ai.reference, 'contact', ai.contact, 'status', ai.status,
            'expires_at', ai.expires_at, 'last_sent_at', ai.last_sent_at,
            'resend_count', ai.resend_count, 'provider_state', ai.provider_state,
            'role_code', ai.intended_role_code, 'reason', ai.intended_reason,
            'profile_code', ai.intended_staff_profile_code))
      ) as row_data
      from public.account_invitations ai
      where app.is_staff_aal2() and app.has_role('system_administrator')
        and ai.purpose = 'staff' and ai.account_id is null
        and ai.status in ('pending', 'expired')
    ) rows
$$;

revoke all on function app.staff_invites_revoke(text, text) from public, anon;
revoke all on function app.staff_invites_mark_resent(text, uuid) from public, anon;
revoke all on function app.staff_invites_attach_provider(text, uuid, text) from public, anon;
grant execute on function app.staff_invites_revoke(text, text) to authenticated;
grant execute on function app.staff_invites_mark_resent(text, uuid) to authenticated;
grant execute on function app.staff_invites_attach_provider(text, uuid, text) to authenticated;

commit;
