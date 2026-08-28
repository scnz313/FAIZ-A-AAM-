-- =============================================================================
-- 000026 — identity, context, invitation, recovery, and guardian-link lifecycle
--
-- This migration completes the identity/context boundary left by 000025. It
-- keeps Auth provider calls outside PostgreSQL, but makes every application
-- identity, invitation acceptance, context selection, and guardian-link
-- mutation transactional and auditable. Provider subject/contact values are
-- persisted only after the server-side provider adapter has succeeded.
-- =============================================================================

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Applicant identity and request-persisted workspace context
-- ---------------------------------------------------------------------------

create table if not exists public.applicant_identities (
  id                   uuid primary key default gen_random_uuid(),
  reference            text not null unique default app.new_ref('APID'),
  account_id           uuid not null references public.user_accounts(id) on delete restrict,
  purpose              text not null check (purpose in ('student_admission', 'job_application')),
  verified_contact     text not null,
  status               text not null default 'active'
                       check (status in ('active', 'suspended', 'closed')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (account_id, purpose)
);

create index if not exists applicant_identities_contact_idx
  on public.applicant_identities (verified_contact);
create index if not exists applicant_identities_account_idx
  on public.applicant_identities (account_id, status);

drop trigger if exists applicant_identities_touch on public.applicant_identities;
create trigger applicant_identities_touch
  before update on public.applicant_identities
  for each row execute function app.touch_updated_at();

create table if not exists public.account_context_preferences (
  account_id             uuid primary key references public.user_accounts(id) on delete cascade,
  active_student_id      uuid references public.students(id) on delete restrict,
  active_role_grant_id   uuid references public.role_grants(id) on delete restrict,
  version                int not null default 1,
  updated_at             timestamptz not null default now()
);

create index if not exists account_context_student_idx
  on public.account_context_preferences (active_student_id);
create index if not exists account_context_role_idx
  on public.account_context_preferences (active_role_grant_id);

drop trigger if exists account_context_preferences_touch on public.account_context_preferences;
create trigger account_context_preferences_touch
  before update on public.account_context_preferences
  for each row execute function app.touch_updated_at();

-- Auth invite providers create the Auth row before the invitee accepts it. The
-- application account remains absent until the authenticated accept command.
alter table public.account_invitations
  add column if not exists provider_subject uuid references auth.users(id) on delete restrict,
  add column if not exists provider_invitation_ref text,
  add column if not exists provider_dispatched_at timestamptz,
  add column if not exists provider_state text not null default 'not_dispatched'
    check (provider_state in ('not_dispatched', 'dispatched', 'failed'));

create unique index if not exists account_invitations_provider_subject_idx
  on public.account_invitations (provider_subject)
  where provider_subject is not null;
create index if not exists account_invitations_contact_pending_idx
  on public.account_invitations (lower(contact), purpose, status);

-- ---------------------------------------------------------------------------
-- Shared safe identity helpers
-- ---------------------------------------------------------------------------

create or replace function app.normalize_identity_contact(p_contact text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when position('@' in coalesce(p_contact, '')) > 0
      then lower(btrim(p_contact))
    else regexp_replace(coalesce(p_contact, ''), '[^0-9+]', '', 'g')
  end
$$;

create or replace function app.auth_claim_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(lower(btrim(coalesce(auth.jwt() ->> 'email', ''))), '')
$$;

-- A first-factor session must be able to discover that it needs TOTP without
-- receiving staff records or grants. This boolean helper intentionally exposes
-- no role name, scope, or account data at AAL1.
create or replace function app.account_has_staff_grant()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.role_grants rg
     where rg.account_id = auth.uid()
       and rg.status = 'active'
       and rg.effective_from <= now()
       and (rg.effective_to is null or rg.effective_to > now())
       and rg.role_code not in ('guardian', 'student')
  )
$$;

revoke all on function app.normalize_identity_contact(text), app.auth_claim_email(), app.account_has_staff_grant() from public;
grant execute on function app.normalize_identity_contact(text), app.auth_claim_email(), app.account_has_staff_grant() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Applicant registration: called only by the server-side Auth provider
-- boundary (service_role). The provider-created Auth user is deliberately
-- confirmed before this transaction; no service key is ever shipped to the
-- browser. Repeating the same request is idempotent for the same purpose and
-- contact, while an existing unrelated account is a duplicate conflict.
-- ---------------------------------------------------------------------------

create or replace function app.applicant_register(
  p_auth_user_id uuid,
  p_contact text,
  p_given_name text,
  p_family_name text,
  p_purpose text default 'student_admission'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact text := app.normalize_identity_contact(p_contact);
  v_account public.user_accounts%rowtype;
  v_person public.people%rowtype;
  v_identity public.applicant_identities%rowtype;
begin
  if p_auth_user_id is null or not exists (select 1 from auth.users where id = p_auth_user_id) then
    raise exception 'auth user not found';
  end if;
  if v_contact = '' or p_given_name is null or length(btrim(p_given_name)) < 1
     or p_family_name is null or length(btrim(p_family_name)) < 1 then
    raise exception 'applicant identity fields are required';
  end if;
  if p_purpose not in ('student_admission', 'job_application') then
    raise exception 'invalid applicant identity purpose';
  end if;

  select * into v_account
    from public.user_accounts
   where id = p_auth_user_id
   for update;

  if v_account.id is not null then
    if app.normalize_identity_contact(v_account.verified_contact) <> v_contact then
      raise exception 'an account already exists for a different verified contact';
    end if;
    select * into v_identity
      from public.applicant_identities
     where account_id = p_auth_user_id and purpose = p_purpose
     for update;
    if v_identity.id is not null then
      return jsonb_build_object('accountId', p_auth_user_id, 'personId', v_account.person_id,
                                'applicantIdentityId', v_identity.id, 'applicantIdentityRef', v_identity.reference,
                                'created', false);
    end if;
    if v_account.status in ('suspended', 'closed') then
      raise exception 'account is not available for applicant registration';
    end if;
    raise exception 'an application identity already exists for this account';
  end if;

  insert into public.people (given_name, family_name, display_name)
  values (btrim(p_given_name), btrim(p_family_name), btrim(p_given_name) || ' ' || btrim(p_family_name))
  returning * into v_person;

  insert into public.user_accounts (id, person_id, status, verified_contact)
  values (p_auth_user_id, v_person.id, 'active', v_contact)
  returning * into v_account;

  insert into public.applicant_identities (account_id, purpose, verified_contact)
  values (p_auth_user_id, p_purpose, v_contact)
  returning * into v_identity;

  insert into public.access_revalidation (account_id, security_version)
  values (p_auth_user_id, 1)
  on conflict (account_id) do nothing;

  insert into public.audit_events
    (actor_account_id, actor_label, action, target_type, target_reference, outcome, reason)
  values
    (p_auth_user_id, 'Applicant registration', 'Applicant account provisioned', 'applicant_identity',
     v_identity.reference, 'Success', 'Server-controlled verified Auth registration');

  insert into public.outbox_events
    (event_key, kind, target_type, target_reference, payload)
  values
    ('security.applicant_registered:' || v_identity.reference,
     'security.applicant_registered', 'applicant_identity', v_identity.reference,
     jsonb_build_object('accountId', p_auth_user_id, 'purpose', p_purpose, 'contact', v_contact))
  on conflict (event_key) do nothing;

  return jsonb_build_object('accountId', p_auth_user_id, 'personId', v_person.id,
                            'applicantIdentityId', v_identity.id, 'applicantIdentityRef', v_identity.reference,
                            'created', true);
end;
$$;

revoke all on function app.applicant_register(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function app.applicant_register(uuid, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Provider-backed staff invitation records
-- ---------------------------------------------------------------------------

create or replace function app.expire_identity_invitations()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_count int;
begin
  update public.account_invitations
     set status = 'expired'
   where status = 'pending' and expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function app.expire_identity_invitations() from public, authenticated;
grant execute on function app.expire_identity_invitations() to service_role;

create or replace function app.staff_invites_create_record(
  p_contact text,
  p_expires_at timestamptz,
  p_display_name text,
  p_role_code text,
  p_reason text,
  p_academic_year_ids uuid[] default '{}',
  p_grade_section_ids uuid[] default '{}',
  p_subject_ids uuid[] default '{}'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reference text;
  v_contact text := app.normalize_identity_contact(p_contact);
begin
  update public.account_invitations set status = 'expired'
   where status = 'pending' and expires_at <= now();
  if not (app.is_staff_aal2() and app.has_any_role(array['system_administrator'])) then
    raise exception 'staff invitation requires system_administrator and aal2';
  end if;
  if v_contact = '' or position('@' in v_contact) = 0
     or p_display_name is null or length(btrim(p_display_name)) < 2 then
    raise exception 'staff invitation contact and display name are required';
  end if;
  if p_role_code is null or not exists (
    select 1 from public.role_definitions where code = p_role_code and is_active = true
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
  if exists (
    select 1 from unnest(coalesce(p_academic_year_ids, '{}')) value
    where not exists (select 1 from public.academic_years where id = value)
  ) then raise exception 'invalid invitation academic-year scope'; end if;
  if exists (
    select 1 from unnest(coalesce(p_grade_section_ids, '{}')) value
    where not exists (select 1 from public.grade_sections where id = value)
  ) then raise exception 'invalid invitation grade-section scope'; end if;
  if exists (
    select 1 from unnest(coalesce(p_subject_ids, '{}')) value
    where not exists (select 1 from public.subjects where id = value)
  ) then raise exception 'invalid invitation subject scope'; end if;
  if exists (
    select 1
      from unnest(coalesce(p_grade_section_ids, '{}')) scoped(section_id)
      join public.grade_sections gs on gs.id = scoped.section_id
     where coalesce(array_length(p_academic_year_ids, 1), 0) > 0
       and not (gs.academic_year_id = any(p_academic_year_ids))
  ) then raise exception 'invitation class scope does not match its academic-year scope'; end if;
  if exists (
    select 1 from public.account_invitations
     where lower(contact) = v_contact and purpose = 'staff' and status = 'pending'
       and expires_at > now()
  ) then
    raise exception 'a pending staff invitation already exists for this contact';
  end if;
  if exists (
    select 1 from public.user_accounts
     where app.normalize_identity_contact(verified_contact) = v_contact
       and status in ('invited', 'active')
  ) then
    raise exception 'an account already exists for this invitation contact';
  end if;

  -- Store only a hash. The provider invite link, not a manually copied token,
  -- is the acceptance credential in the new flow.
  insert into public.account_invitations (
    purpose, contact, invitation_hash, status, expires_at, created_by_account_id,
    intended_role_code, intended_display_name, intended_reason,
    intended_academic_year_ids, intended_grade_section_ids, intended_subject_ids
  ) values (
    'staff', v_contact, app.hash_invitation_secret(gen_random_uuid()::text || gen_random_uuid()::text),
    'pending', p_expires_at, auth.uid(), p_role_code, btrim(p_display_name), btrim(p_reason),
    coalesce(p_academic_year_ids, '{}'), coalesce(p_grade_section_ids, '{}'), coalesce(p_subject_ids, '{}')
  ) returning reference into v_reference;

  perform app.record_audit('Staff invitation created', 'account_invitation', v_reference,
                           'Success', btrim(p_reason), 'System administrator');
  insert into public.outbox_events (event_key, kind, target_type, target_reference, payload)
  values ('security.staff_invitation_created:' || v_reference, 'security.staff_invitation_created',
          'account_invitation', v_reference,
          jsonb_build_object('contact', v_contact, 'roleCode', p_role_code))
  on conflict (event_key) do nothing;

  return jsonb_build_object('invitationRef', v_reference, 'contact', v_contact,
                            'roleCode', p_role_code, 'expiresAt', p_expires_at,
                            'status', 'pending');
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
         provider_dispatched_at = now(), provider_state = 'dispatched'
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
     set provider_state = 'failed', status = 'revoked'
   where id = v_inv.id;
  perform app.record_audit('Staff invitation provider failed', 'account_invitation', v_inv.reference,
                           'Failed', left(coalesce(p_reason, 'provider failed'), 500), 'System administrator');
end;
$$;

-- Auth invite acceptance. The authenticated email is read from verified Auth
-- claims, never from a form field. The old four-argument token command remains
-- for the local migration regression suite; the application uses this command.
create or replace function app.staff_invites_accept(
  p_invitation_reference text,
  p_given_name text,
  p_family_name text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.account_invitations%rowtype;
  v_person_id uuid;
  v_staff_id uuid;
  v_grant_id uuid;
  v_grant_ref text;
  v_account public.user_accounts%rowtype;
  v_email text := app.auth_claim_email();
  v_assignment_ids uuid[] := '{}';
  v_assignment_id uuid;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if v_email is null then raise exception 'verified invitation email is required'; end if;
  if p_given_name is null or btrim(p_given_name) = '' or p_family_name is null or btrim(p_family_name) = '' then
    raise exception 'name is required';
  end if;

  select * into v_inv from public.account_invitations where reference = p_invitation_reference for update;
  if v_inv.id is null or v_inv.purpose <> 'staff' then raise exception 'staff invitation not found'; end if;
  if v_inv.status = 'accepted' then raise exception 'staff invitation has already been used'; end if;
  if v_inv.status = 'revoked' then raise exception 'staff invitation has been revoked'; end if;
  if v_inv.status <> 'pending' or v_inv.expires_at <= now() then raise exception 'staff invitation has expired'; end if;
  if v_inv.provider_subject is null or v_inv.provider_subject <> auth.uid() then
    raise exception 'staff invitation is not bound to this Auth account';
  end if;
  if app.normalize_identity_contact(v_inv.contact) <> app.normalize_identity_contact(v_email) then
    raise exception 'verified invitation email does not match the invited contact';
  end if;

  select * into v_account from public.user_accounts where id = auth.uid() for update;
  if v_account.id is not null then
    if app.normalize_identity_contact(v_account.verified_contact) <> app.normalize_identity_contact(v_inv.contact) then
      raise exception 'an account already exists for a different verified contact';
    end if;
    if v_account.status in ('suspended', 'closed') then raise exception 'account cannot accept this invitation'; end if;
    v_person_id := v_account.person_id;
  else
    if exists (
      select 1 from public.user_accounts where app.normalize_identity_contact(verified_contact) = app.normalize_identity_contact(v_inv.contact)
    ) then
      raise exception 'an account already exists for this invitation contact';
    end if;
    insert into public.people (given_name, family_name, display_name)
    values (btrim(p_given_name), btrim(p_family_name), btrim(p_given_name) || ' ' || btrim(p_family_name))
    returning id into v_person_id;
    insert into public.user_accounts (id, person_id, status, verified_contact)
    values (auth.uid(), v_person_id, 'active', app.normalize_identity_contact(v_inv.contact));
  end if;

  insert into public.staff_members (person_id, employment_status, title)
  values (v_person_id, 'active', v_inv.intended_role_code)
  on conflict (person_id) do update set employment_status = 'active'
  returning id into v_staff_id;
  if v_staff_id is null then select id into v_staff_id from public.staff_members where person_id = v_person_id; end if;

  select id, reference into v_grant_id, v_grant_ref
    from public.role_grants where account_id = auth.uid() and role_code = v_inv.intended_role_code and status = 'active';
  if v_grant_id is not null then raise exception 'an active role grant already exists for this account'; end if;
  insert into public.role_grants (account_id, role_code, status, granted_by_account_id, reason)
  values (auth.uid(), v_inv.intended_role_code, 'active', v_inv.created_by_account_id, v_inv.intended_reason)
  returning id, reference into v_grant_id, v_grant_ref;

  insert into public.role_grant_academic_years (role_grant_id, academic_year_id)
  select v_grant_id, value from unnest(v_inv.intended_academic_year_ids) value
  where exists (select 1 from public.academic_years where id = value)
  on conflict do nothing;
  insert into public.role_grant_grade_sections (role_grant_id, grade_section_id)
  select v_grant_id, value from unnest(v_inv.intended_grade_section_ids) value
  where exists (select 1 from public.grade_sections where id = value)
  on conflict do nothing;
  insert into public.role_grant_subjects (role_grant_id, subject_id)
  select v_grant_id, value from unnest(v_inv.intended_subject_ids) value
  where exists (select 1 from public.subjects where id = value)
  on conflict do nothing;

  -- Materialize assignments for supplied scopes. Functional roles that do not
  -- need a record assignment simply have an empty assignment set.
  insert into public.staff_assignments (
    staff_member_id, role_grant_id, academic_year_id, grade_section_id, subject_id,
    status, effective_from, version
  )
  select v_staff_id, v_grant_id, years.id, sections.id, subjects.id,
         'active', current_date, 1
    from unnest(v_inv.intended_academic_year_ids) years(id)
    left join lateral (
      select gs.id from unnest(v_inv.intended_grade_section_ids) scoped(id)
      join public.grade_sections gs on gs.id = scoped.id and gs.academic_year_id = years.id
      union all select null::uuid where coalesce(array_length(v_inv.intended_grade_section_ids, 1), 0) = 0
    ) sections on true
    left join lateral (
      select s.id from unnest(v_inv.intended_subject_ids) scoped(id)
      join public.subjects s on s.id = scoped.id
      union all select null::uuid where coalesce(array_length(v_inv.intended_subject_ids, 1), 0) = 0
    ) subjects on true;

  update public.account_invitations
     set account_id = auth.uid(), status = 'accepted', accepted_at = now()
   where id = v_inv.id;
  perform app.bump_access_revalidation(auth.uid());
  perform app.record_audit('Staff invitation accepted', 'account_invitation', v_inv.reference,
                           'Success', null, 'Invited staff member');
  perform app.enqueue_outbox(
    'security.staff_invitation_accepted:' || v_inv.reference, 'security.staff_invitation_accepted',
    'account_invitations', v_inv.reference,
    jsonb_build_object('accountId', auth.uid(), 'grantRef', v_grant_ref));

  return jsonb_build_object('accountId', auth.uid(), 'staffMemberId', v_staff_id,
                            'grantId', v_grant_id, 'grantRef', v_grant_ref,
                            'roleCode', v_inv.intended_role_code,
                            'assignmentCount', (select count(*) from public.staff_assignments where role_grant_id = v_grant_id));
end;
$$;

revoke all on function app.staff_invites_create_record(text, timestamptz, text, text, text, uuid[], uuid[], uuid[]) from public;
revoke all on function app.staff_invites_attach_provider(text, uuid, text), app.staff_invites_mark_provider_failed(text, text) from public;
revoke all on function app.staff_invites_accept(text, text, text) from public;
grant execute on function app.staff_invites_create_record(text, timestamptz, text, text, text, uuid[], uuid[], uuid[]) to authenticated;
grant execute on function app.staff_invites_attach_provider(text, uuid, text), app.staff_invites_mark_provider_failed(text, text) to authenticated;
grant execute on function app.staff_invites_accept(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Persisted active child/workspace selections. The caller's active link/grant
-- is checked before writing; the resolver still rechecks it on every request.
-- ---------------------------------------------------------------------------

create or replace function app.context_family_select(
  p_student_id uuid,
  p_expected_version int default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid := auth.uid();
  v_guardian_id uuid;
  v_pref public.account_context_preferences%rowtype;
  v_link public.guardian_student_links%rowtype;
begin
  if v_account is null then raise exception 'authenticated actor required'; end if;
  select g.id into v_guardian_id
    from public.guardians g join public.user_accounts ua on ua.person_id = g.person_id
   where ua.id = v_account and ua.status = 'active' and g.status = 'active';
  if v_guardian_id is null then raise exception 'family context is not available to this account'; end if;
  select * into v_link from public.guardian_student_links
   where guardian_id = v_guardian_id and student_id = p_student_id and status = 'active'
     and (effective_from is null or effective_from <= now()) and (effective_to is null or effective_to > now());
  if v_link.id is null then raise exception 'that student is not linked to this family account'; end if;
  select * into v_pref from public.account_context_preferences where account_id = v_account for update;
  if p_expected_version is not null and v_pref.version is not null and v_pref.version <> p_expected_version then
    raise exception 'family context version mismatch (expected %, found %)', p_expected_version, v_pref.version;
  end if;
  insert into public.account_context_preferences (account_id, active_student_id, version)
  values (v_account, p_student_id, 1)
  on conflict (account_id) do update set active_student_id = excluded.active_student_id,
                                        version = public.account_context_preferences.version + 1;
  select * into v_pref from public.account_context_preferences where account_id = v_account;
  return jsonb_build_object('accountId', v_account, 'activeStudentId', v_pref.active_student_id,
                            'activeRoleGrantId', v_pref.active_role_grant_id, 'version', v_pref.version);
end;
$$;

create or replace function app.context_staff_select(
  p_role_grant_id uuid,
  p_expected_version int default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid := auth.uid();
  v_pref public.account_context_preferences%rowtype;
begin
  if v_account is null or (auth.jwt() ->> 'aal') <> 'aal2' then raise exception 'staff aal2 required'; end if;
  if not exists (
    select 1 from public.role_grants where id = p_role_grant_id and account_id = v_account and status = 'active'
      and effective_from <= now() and (effective_to is null or effective_to > now())
  ) then raise exception 'that staff workspace is not granted to this account'; end if;
  select * into v_pref from public.account_context_preferences where account_id = v_account for update;
  if p_expected_version is not null and v_pref.version is not null and v_pref.version <> p_expected_version then
    raise exception 'staff context version mismatch (expected %, found %)', p_expected_version, v_pref.version;
  end if;
  insert into public.account_context_preferences (account_id, active_role_grant_id, version)
  values (v_account, p_role_grant_id, 1)
  on conflict (account_id) do update set active_role_grant_id = excluded.active_role_grant_id,
                                        version = public.account_context_preferences.version + 1;
  select * into v_pref from public.account_context_preferences where account_id = v_account;
  return jsonb_build_object('accountId', v_account, 'activeStudentId', v_pref.active_student_id,
                            'activeRoleGrantId', v_pref.active_role_grant_id, 'version', v_pref.version);
end;
$$;

revoke all on function app.context_family_select(uuid, int), app.context_staff_select(uuid, int) from public;
grant execute on function app.context_family_select(uuid, int), app.context_staff_select(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Guardian link lifecycle
-- ---------------------------------------------------------------------------

create or replace function app.guardian_links_request(
  p_student_id uuid,
  p_relationship_label text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guardian_id uuid;
  v_link public.guardian_student_links%rowtype;
begin
  if auth.uid() is null or not app.is_guardian() then raise exception 'active guardian account required'; end if;
  if p_relationship_label is null or length(btrim(p_relationship_label)) < 2 then raise exception 'relationship is required'; end if;
  if not exists (select 1 from public.students where id = p_student_id and status = 'active') then raise exception 'student not found'; end if;
  select g.id into v_guardian_id from public.guardians g join public.user_accounts ua on ua.person_id = g.person_id where ua.id = auth.uid();
  select * into v_link from public.guardian_student_links where guardian_id = v_guardian_id and student_id = p_student_id order by created_at desc limit 1;
  if v_link.status = 'active' then raise exception 'student is already linked to this family account'; end if;
  if v_link.status = 'pending_verification' then
    return jsonb_build_object('id', v_link.id, 'reference', v_link.reference, 'status', v_link.status, 'version', v_link.version);
  end if;
  insert into public.guardian_student_links (guardian_id, student_id, relationship_label, status, verification_source, version)
  values (v_guardian_id, p_student_id, btrim(p_relationship_label), 'pending_verification', 'guardian_request', 1)
  returning * into v_link;
  perform app.record_audit('Guardian link requested', 'guardian_student_link', v_link.reference, 'Success');
  perform app.enqueue_outbox('email.link_requested:' || v_link.reference, 'email.link_requested',
                             'guardian_student_link', v_link.reference, jsonb_build_object('channel', 'email'));
  return jsonb_build_object('id', v_link.id, 'reference', v_link.reference, 'status', v_link.status, 'version', v_link.version);
end;
$$;

-- The original 000015 commands are replaced here to give system administrators
-- the explicit links.verify capability while preserving support-officer scope.
create or replace function app.links_approve(p_link_id uuid, p_expected_version int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_link public.guardian_student_links%rowtype;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and (app.has_any_role(array['support_officer']) or app.has_any_role(array['system_administrator']))) then raise exception 'link verification role and aal2 required'; end if;
  select * into v_link from public.guardian_student_links where id = p_link_id for update;
  if v_link.id is null then raise exception 'link not found'; end if;
  if v_link.version <> p_expected_version then raise exception 'link version mismatch (expected %, found %)', p_expected_version, v_link.version; end if;
  if v_link.status = 'active' then return; end if;
  if v_link.status <> 'pending_verification' then raise exception 'link cannot be approved in state (%)', v_link.status; end if;
  update public.guardian_student_links set status = 'active', approved_by_account_id = auth.uid(), approved_at = now(), effective_from = now(), effective_to = null, rejection_reason = null, version = v_link.version + 1 where id = p_link_id;
  perform app.record_audit('Guardian link approved', 'guardian_student_link', v_link.reference, 'Success');
  perform app.enqueue_outbox('email.link_approved:' || v_link.reference, 'email.link_approved', 'guardian_student_link', v_link.reference, jsonb_build_object('channel','email'));
end; $$;

create or replace function app.links_reject(p_link_id uuid, p_reason text, p_expected_version int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_link public.guardian_student_links%rowtype;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and (app.has_any_role(array['support_officer']) or app.has_any_role(array['system_administrator']))) then raise exception 'link verification role and aal2 required'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'rejection reason is required'; end if;
  select * into v_link from public.guardian_student_links where id = p_link_id for update;
  if v_link.id is null then raise exception 'link not found'; end if;
  if v_link.version <> p_expected_version then raise exception 'link version mismatch (expected %, found %)', p_expected_version, v_link.version; end if;
  if v_link.status <> 'pending_verification' then raise exception 'link cannot be rejected in state (%)', v_link.status; end if;
  update public.guardian_student_links set status = 'rejected', rejection_reason = btrim(p_reason), effective_to = now(), version = v_link.version + 1 where id = p_link_id;
  perform app.record_audit('Guardian link rejected', 'guardian_student_link', v_link.reference, 'Success', btrim(p_reason));
  perform app.enqueue_outbox('email.link_rejected:' || v_link.reference, 'email.link_rejected', 'guardian_student_link', v_link.reference, jsonb_build_object('channel','email'));
end; $$;

create or replace function app.links_restrict(p_link_id uuid, p_reason text, p_expected_version int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_link public.guardian_student_links%rowtype;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and (app.has_any_role(array['support_officer']) or app.has_any_role(array['system_administrator']))) then raise exception 'link verification role and aal2 required'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'restriction reason is required'; end if;
  select * into v_link from public.guardian_student_links where id = p_link_id for update;
  if v_link.id is null then raise exception 'link not found'; end if;
  if v_link.version <> p_expected_version then raise exception 'link version mismatch (expected %, found %)', p_expected_version, v_link.version; end if;
  if v_link.status = 'restricted' then return; end if;
  if v_link.status <> 'active' then raise exception 'link cannot be restricted in state (%)', v_link.status; end if;
  update public.guardian_student_links set status = 'restricted', restriction_reason = btrim(p_reason), version = v_link.version + 1 where id = p_link_id;
  perform app.record_audit('Guardian link restricted', 'guardian_student_link', v_link.reference, 'Success', btrim(p_reason));
  perform app.enqueue_outbox('security.link_restricted:' || v_link.reference || ':' || (v_link.version + 1), 'security.link_restricted', 'guardian_student_link', v_link.reference, jsonb_build_object('reason',btrim(p_reason)));
end; $$;

create or replace function app.links_revoke(p_link_id uuid, p_reason text, p_expected_version int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_link public.guardian_student_links%rowtype;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and (app.has_any_role(array['support_officer']) or app.has_any_role(array['system_administrator']))) then raise exception 'link verification role and aal2 required'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'revocation reason is required'; end if;
  select * into v_link from public.guardian_student_links where id = p_link_id for update;
  if v_link.id is null then raise exception 'link not found'; end if;
  if v_link.version <> p_expected_version then raise exception 'link version mismatch (expected %, found %)', p_expected_version, v_link.version; end if;
  if v_link.status = 'ended' then return; end if;
  if v_link.status not in ('active','restricted') then raise exception 'link cannot be revoked in state (%)', v_link.status; end if;
  update public.guardian_student_links set status = 'ended', effective_to = now(), restriction_reason = coalesce(restriction_reason, btrim(p_reason)), version = v_link.version + 1 where id = p_link_id;
  perform app.record_audit('Guardian link revoked', 'guardian_student_link', v_link.reference, 'Success', btrim(p_reason));
  perform app.enqueue_outbox('security.link_revoked:' || v_link.reference || ':' || (v_link.version + 1), 'security.link_revoked', 'guardian_student_link', v_link.reference, jsonb_build_object('reason',btrim(p_reason)));
end; $$;

create or replace function app.links_capabilities_set(p_link_id uuid, p_capabilities text[], p_expected_version int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_link public.guardian_student_links%rowtype; v_cap text;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and (app.has_any_role(array['support_officer']) or app.has_any_role(array['system_administrator']))) then raise exception 'link verification role and aal2 required'; end if;
  select * into v_link from public.guardian_student_links where id = p_link_id for update;
  if v_link.id is null then raise exception 'link not found'; end if;
  if v_link.version <> p_expected_version then raise exception 'link version mismatch (expected %, found %)', p_expected_version, v_link.version; end if;
  if v_link.status not in ('active','restricted') then raise exception 'link capabilities require an active or restricted link'; end if;
  foreach v_cap in array coalesce(p_capabilities, '{}') loop
    if v_cap not in ('academics','finance','documents','notices','profile') then raise exception 'invalid guardian capability'; end if;
  end loop;
  delete from public.guardian_link_capabilities where link_id = p_link_id;
  insert into public.guardian_link_capabilities (link_id, capability)
  select p_link_id, value from unnest(coalesce(p_capabilities, '{}')) value on conflict do nothing;
  update public.guardian_student_links set version = v_link.version + 1 where id = p_link_id;
  perform app.record_audit('Guardian link capabilities changed', 'guardian_student_link', v_link.reference, 'Success');
  perform app.enqueue_outbox('security.link_capabilities:' || v_link.reference || ':' || (v_link.version + 1), 'security.link_capabilities_changed', 'guardian_student_link', v_link.reference, jsonb_build_object('capabilities',coalesce(p_capabilities,'{}')));
end; $$;

revoke all on function app.guardian_links_request(uuid, text), app.links_restrict(uuid, text, int), app.links_revoke(uuid, text, int), app.links_capabilities_set(uuid, text[], int) from public;
grant execute on function app.guardian_links_request(uuid, text), app.links_restrict(uuid, text, int), app.links_revoke(uuid, text, int), app.links_capabilities_set(uuid, text[], int) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS for the two new tables and request-persisted context
-- ---------------------------------------------------------------------------

alter table public.applicant_identities enable row level security;
alter table public.account_context_preferences enable row level security;
revoke all on public.applicant_identities, public.account_context_preferences from anon, authenticated;
grant select on public.applicant_identities, public.account_context_preferences to authenticated;

drop policy if exists applicant_identity_own_read on public.applicant_identities;
create policy applicant_identity_own_read on public.applicant_identities
  for select to authenticated using (account_id = auth.uid());
drop policy if exists account_context_own_read on public.account_context_preferences;
create policy account_context_own_read on public.account_context_preferences
  for select to authenticated using (account_id = auth.uid());

-- Context writes are RPC-only; no browser can update the preference row
-- directly. The server resolver treats stale/revoked foreign keys as neutral
-- no-context rather than exposing the old protected selection.

commit;
