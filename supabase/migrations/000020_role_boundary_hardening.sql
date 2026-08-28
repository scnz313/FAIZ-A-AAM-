-- =============================================================================
-- 000020 — role-boundary hardening and atomic account lifecycle
--
-- The first backend migrations included system_administrator in functional
-- role arrays.  The product contract keeps configuration/access administration
-- separate from admissions, finance, HR, content, academic, and support work.
-- This forward migration hardens every existing policy/RPC that delegates to
-- app.has_any_role without rewriting the already-applied function bodies.
-- A system administrator is still accepted when the requested role set is
-- exactly [system_administrator] (access/configuration commands), but is not
-- accepted as a substitute for a functional role in a mixed role set.
-- =============================================================================

begin;

alter table public.account_invitations
  add column if not exists intended_role_code text,
  add column if not exists intended_display_name text,
  add column if not exists intended_reason text,
  add column if not exists intended_academic_year_ids uuid[] not null default '{}',
  add column if not exists intended_grade_section_ids uuid[] not null default '{}',
  add column if not exists intended_subject_ids uuid[] not null default '{}';

create or replace function app.has_any_role(p_roles text[])
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.role_grants rg
     where rg.account_id = auth.uid()
       and rg.role_code = any(
         case
           when coalesce(array_length(p_roles, 1), 0) > 1
             and 'system_administrator' = any(p_roles)
             then array_remove(p_roles, 'system_administrator')
           else p_roles
         end
       )
       and rg.status = 'active'
       and rg.effective_from <= now()
       and (rg.effective_to is null or rg.effective_to > now())
  )
$$;

-- Suspend/re-activate is one transaction.  Revoking grants one request at a
-- time can leave an account partially suspended if the second request fails.
create or replace function app.accounts_suspend(
  p_account_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_target_ref text;
begin
  if not (app.is_staff_aal2() and app.has_any_role(array['system_administrator'])) then
    raise exception 'account suspension requires system_administrator and aal2';
  end if;
  if p_account_id is null or p_account_id = auth.uid() then
    raise exception 'administrator cannot suspend the current account';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'suspension reason is required';
  end if;

  select ua.status, p.reference
    into v_status, v_target_ref
    from public.user_accounts ua
    join public.people p on p.id = ua.person_id
   where ua.id = p_account_id
   for update;
  if v_status is null then
    raise exception 'account not found';
  end if;
  if v_status = 'closed' then
    raise exception 'closed account cannot be suspended';
  end if;
  if v_status = 'suspended' then
    return;
  end if;

  update public.user_accounts
     set status = 'suspended'
   where id = p_account_id;
  update public.role_grants
     set status = 'revoked',
         effective_to = coalesce(effective_to, now()),
         version = version + 1
   where account_id = p_account_id
     and status = 'active';
  update public.staff_members sm
     set employment_status = 'inactive'
    from public.user_accounts ua
    join public.people p on p.id = ua.person_id
   where sm.person_id = p.id
     and ua.id = p_account_id
     and sm.employment_status = 'active';
  perform app.bump_access_revalidation(p_account_id);
  perform app.record_audit('Account suspended', 'user_account', v_target_ref, 'Success', btrim(p_reason), 'System administrator');
  perform app.enqueue_outbox(
    'security.account_suspended:' || p_account_id::text,
    'security.account_suspended',
    'user_account',
    v_target_ref,
    jsonb_build_object('accountId', p_account_id, 'reason', btrim(p_reason))
  );
end;
$$;

create or replace function app.accounts_reactivate(
  p_account_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_target_ref text;
begin
  if not (app.is_staff_aal2() and app.has_any_role(array['system_administrator'])) then
    raise exception 'account reactivation requires system_administrator and aal2';
  end if;
  if p_account_id is null then
    raise exception 'account id is required';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'reactivation reason is required';
  end if;

  select ua.status, p.reference
    into v_status, v_target_ref
    from public.user_accounts ua
    join public.people p on p.id = ua.person_id
   where ua.id = p_account_id
   for update;
  if v_status is null then
    raise exception 'account not found';
  end if;
  if v_status = 'closed' then
    raise exception 'closed account cannot be reactivated';
  end if;
  if v_status <> 'suspended' then
    return;
  end if;

  update public.user_accounts set status = 'active' where id = p_account_id;
  update public.staff_members sm
     set employment_status = 'active'
    from public.user_accounts ua
    join public.people p on p.id = ua.person_id
   where sm.person_id = p.id
     and ua.id = p_account_id
     and sm.employment_status = 'inactive';
  perform app.bump_access_revalidation(p_account_id);
  perform app.record_audit('Account reactivated', 'user_account', v_target_ref, 'Success', btrim(p_reason), 'System administrator');
  perform app.enqueue_outbox(
    'security.account_reactivated:' || p_account_id::text,
    'security.account_reactivated',
    'user_account',
    v_target_ref,
    jsonb_build_object('accountId', p_account_id, 'reason', btrim(p_reason))
  );
end;
$$;

-- Supabase may install pgcrypto in `extensions`, while the scratch validator
-- installs it in `public`. Resolve the strongest available digest function
-- without relying on search_path inside SECURITY DEFINER functions.
create or replace function app.hash_invitation_secret(p_secret text)
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  begin
    execute 'select encode(extensions.digest($1::bytea, ''sha256''), ''hex'')'
      into v_hash using p_secret;
    return v_hash;
  exception when undefined_function or invalid_schema_name then
    null;
  end;
  begin
    execute 'select encode(public.digest($1::bytea, ''sha256''), ''hex'')'
      into v_hash using p_secret;
    return v_hash;
  exception when undefined_function or invalid_schema_name then
    raise exception 'pgcrypto digest is unavailable';
  end;
end;
$$;

-- Generic invitations remain available for guardian/applicant recovery. Staff
-- invitations use the command below so the intended role and scope cannot be
-- lost between invitation creation and acceptance.
create or replace function app.invites_create(
  p_contact text,
  p_expires_at timestamptz,
  p_purpose text default 'staff'
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_one_time_ref text;
  v_reference text;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if p_purpose = 'staff' then
    raise exception 'use staff_invites_create for staff invitations';
  end if;
  if not (
    (app.is_staff_aal2() and app.has_any_role(array['system_administrator']))
    or (app.is_staff_aal2() and app.has_any_role(array['support_officer']))
  ) then
    raise exception 'invitation role and aal2 required';
  end if;
  if p_contact is null or btrim(p_contact) = '' then
    raise exception 'invalid invitation contact';
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'invalid invitation expiry';
  end if;
  if p_purpose not in ('guardian', 'applicant', 'job_applicant') then
    raise exception 'invalid invitation purpose';
  end if;

  v_one_time_ref := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.account_invitations (
    purpose, contact, invitation_hash, status, expires_at, created_by_account_id
  ) values (
    p_purpose, btrim(p_contact), app.hash_invitation_secret(v_one_time_ref),
    'pending', p_expires_at, auth.uid()
  ) returning reference into v_reference;

  perform app.record_audit('Account invitation created', 'account_invitation', v_reference, 'Success', null, 'Support or system administration');
  return v_one_time_ref;
end;
$$;

create or replace function app.invites_revoke(
  p_invitation_reference text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_purpose text;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  select status, purpose into v_status, v_purpose
    from public.account_invitations
   where reference = p_invitation_reference
   for update;
  if v_status is null then
    raise exception 'invitation not found';
  end if;
  if v_purpose = 'staff' then
    if not (app.is_staff_aal2() and app.has_any_role(array['system_administrator'])) then
      raise exception 'staff invitation administration requires system_administrator and aal2';
    end if;
  elsif not (
    (app.is_staff_aal2() and app.has_any_role(array['system_administrator']))
    or (app.is_staff_aal2() and app.has_any_role(array['support_officer']))
  ) then
    raise exception 'invitation role and aal2 required';
  end if;
  if v_status <> 'pending' then
    raise exception 'invitation cannot be revoked in state (%)', v_status;
  end if;
  update public.account_invitations set status = 'revoked' where reference = p_invitation_reference;
  perform app.record_audit('Account invitation revoked', 'account_invitation', p_invitation_reference, 'Success', null, 'Support or system administration');
end;
$$;

create or replace function app.staff_invites_create(
  p_contact text,
  p_expires_at timestamptz,
  p_display_name text,
  p_role_code text,
  p_reason text,
  p_academic_year_ids uuid[] default '{}',
  p_grade_section_ids uuid[] default '{}',
  p_subject_ids uuid[] default '{}'
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_one_time_ref text;
  v_reference text;
begin
  if not (app.is_staff_aal2() and app.has_any_role(array['system_administrator'])) then
    raise exception 'staff invitation requires system_administrator and aal2';
  end if;
  if p_contact is null or btrim(p_contact) = '' or p_display_name is null or length(btrim(p_display_name)) < 2 then
    raise exception 'staff invitation contact and display name are required';
  end if;
  if p_role_code is null or not exists (
    select 1 from public.role_definitions
     where code = p_role_code and is_active = true
       and code not in ('guardian', 'student')
  ) then
    raise exception 'invalid staff role';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'staff invitation reason is required';
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'invalid invitation expiry';
  end if;

  v_one_time_ref := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.account_invitations (
    purpose, contact, invitation_hash, status, expires_at, created_by_account_id,
    intended_role_code, intended_display_name, intended_reason,
    intended_academic_year_ids, intended_grade_section_ids, intended_subject_ids
  ) values (
    'staff', btrim(p_contact), app.hash_invitation_secret(v_one_time_ref),
    'pending', p_expires_at, auth.uid(), p_role_code, btrim(p_display_name),
    btrim(p_reason), coalesce(p_academic_year_ids, '{}'), coalesce(p_grade_section_ids, '{}'), coalesce(p_subject_ids, '{}')
  ) returning reference into v_reference;
  perform app.record_audit('Staff invitation created', 'account_invitation', v_reference, 'Success', btrim(p_reason), 'System administrator');
  perform app.enqueue_outbox(
    'email.staff_invitation:' || v_reference,
    'email.deliver',
    'account_invitation',
    v_reference,
    jsonb_build_object('contact', btrim(p_contact), 'roleCode', p_role_code)
  );
  return v_one_time_ref;
end;
$$;

create or replace function app.staff_invites_accept(
  p_invitation_reference text,
  p_one_time_ref text,
  p_given_name text,
  p_family_name text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.account_invitations;
  v_person_id uuid;
  v_staff_id uuid;
  v_grant_id uuid;
  v_grant_ref text;
  v_account_status text;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if p_one_time_ref is null or length(p_one_time_ref) < 16 then
    raise exception 'invalid invitation reference';
  end if;
  if p_given_name is null or btrim(p_given_name) = '' or p_family_name is null or btrim(p_family_name) = '' then
    raise exception 'name is required';
  end if;

  select * into v_inv
    from public.account_invitations
   where reference = p_invitation_reference
   for update;
  if v_inv.id is null or v_inv.purpose <> 'staff' then
    raise exception 'staff invitation not found';
  end if;
  if v_inv.status <> 'pending' or v_inv.expires_at <= now() then
    raise exception 'staff invitation is no longer valid';
  end if;
  if v_inv.invitation_hash <> app.hash_invitation_secret(p_one_time_ref) then
    raise exception 'staff invitation reference is invalid';
  end if;
  if v_inv.intended_role_code is null then
    raise exception 'staff invitation has no intended role';
  end if;

  select person_id, status into v_person_id, v_account_status
    from public.user_accounts where id = auth.uid() for update;
  if v_account_status in ('suspended', 'closed') then
    raise exception 'account cannot accept a staff invitation';
  end if;
  if v_person_id is null then
    insert into public.people (given_name, family_name, display_name)
    values (btrim(p_given_name), btrim(p_family_name), btrim(p_given_name) || ' ' || btrim(p_family_name))
    returning id into v_person_id;
    insert into public.user_accounts (id, person_id, status, verified_contact)
    values (auth.uid(), v_person_id, 'active', v_inv.contact);
  else
    update public.user_accounts set status = 'active' where id = auth.uid();
  end if;

  insert into public.staff_members (person_id, employment_status, title)
  values (v_person_id, 'active', v_inv.intended_role_code)
  on conflict (person_id) do update set employment_status = 'active'
  returning id into v_staff_id;
  if v_staff_id is null then
    select id into v_staff_id from public.staff_members where person_id = v_person_id;
  end if;

  select id, reference into v_grant_id, v_grant_ref
    from public.role_grants
   where account_id = auth.uid() and role_code = v_inv.intended_role_code and status = 'active';
  if v_grant_id is null then
    insert into public.role_grants (
      account_id, role_code, status, granted_by_account_id, reason
    ) values (
      auth.uid(), v_inv.intended_role_code, 'active', v_inv.created_by_account_id, v_inv.intended_reason
    ) returning id, reference into v_grant_id, v_grant_ref;
    insert into public.role_grant_academic_years (role_grant_id, academic_year_id)
    select v_grant_id, value from unnest(v_inv.intended_academic_year_ids) value;
    insert into public.role_grant_grade_sections (role_grant_id, grade_section_id)
    select v_grant_id, value from unnest(v_inv.intended_grade_section_ids) value;
    insert into public.role_grant_subjects (role_grant_id, subject_id)
    select v_grant_id, value from unnest(v_inv.intended_subject_ids) value;
  end if;

  update public.account_invitations
     set account_id = auth.uid(), status = 'accepted', accepted_at = now()
   where id = v_inv.id;
  perform app.bump_access_revalidation(auth.uid());
  perform app.record_audit('Staff invitation accepted', 'account_invitation', v_inv.reference, 'Success', null, 'Invited staff member');
  perform app.enqueue_outbox(
    'security.staff_invitation_accepted:' || v_inv.reference,
    'security.staff_invitation_accepted',
    'account_invitation',
    v_inv.reference,
    jsonb_build_object('accountId', auth.uid(), 'grantRef', v_grant_ref)
  );
  return jsonb_build_object('accountId', auth.uid(), 'staffMemberId', v_staff_id, 'grantId', v_grant_id, 'grantRef', v_grant_ref);
end;
$$;

revoke all on function app.accounts_suspend(uuid, text), app.accounts_reactivate(uuid, text),
  app.staff_invites_create(text, timestamptz, text, text, text, uuid[], uuid[], uuid[]),
  app.staff_invites_accept(text, text, text, text)
from public;
grant execute on function app.accounts_suspend(uuid, text), app.accounts_reactivate(uuid, text) to authenticated;
grant execute on function app.staff_invites_create(text, timestamptz, text, text, text, uuid[], uuid[], uuid[]) to authenticated;
grant execute on function app.staff_invites_accept(text, text, text, text) to authenticated;

commit;
