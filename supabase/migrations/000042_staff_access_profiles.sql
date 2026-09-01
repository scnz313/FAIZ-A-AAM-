-- =============================================================================
-- 000042 — staff access profiles (Administrator and Principal only)
--
-- Adds the two user-facing staff profiles (Administrator, Principal) as
-- provisioning presets. Profiles are display and provisioning concepts only:
-- server authorization keeps evaluating active granular role grants, AAL2,
-- assignment scope, and maker/checker actor identity.
--
-- The profile→role mapping is fixed in this migration (no runtime profile
-- builder). Teachers are NOT a portal profile — they remain non-login school
-- records for timetable and subject attribution (see teaching_assignments in
-- a later migration).
--
-- Role definition changes:
--   * result_entry_officer added (Principal marks entry/import).
--   * student and teacher role definitions marked non-assignable
--     (is_assignable = false). Existing grants/history are preserved.
--
-- Commands added:
--   app.staff_profiles_list                     (any authenticated aal2 staff)
--   app.staff_invites_create_profile            (system_administrator + aal2)
--   app.staff_invites_accept                    (profile-aware; verified Auth email)
--   app.staff_profile_change                    (system_administrator + aal2)
--   app.users_admin_list                        (profile + grant projection)
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Role definition assignability marker
-- ---------------------------------------------------------------------------

alter table public.role_definitions
  add column if not exists is_assignable boolean not null default true;

-- Mark legacy roles non-assignable: no new grants or invitations may reference
-- them. Existing grants and history are preserved.
update public.role_definitions set is_assignable = false
 where code in ('student', 'teacher');

-- ---------------------------------------------------------------------------
-- Profile catalog (Administrator and Principal only)
-- ---------------------------------------------------------------------------

create table public.staff_access_profiles (
  code        text primary key check (code in ('administrator', 'principal')),
  label       text not null unique,
  description text not null,
  version     int not null default 1 check (version >= 1),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.staff_access_profile_roles (
  profile_code text not null references public.staff_access_profiles(code) on delete restrict,
  role_code    text not null references public.role_definitions(code) on delete restrict,
  sort_order   int not null default 0 check (sort_order >= 0),
  primary key (profile_code, role_code)
);

alter table public.staff_access_profiles enable row level security;
alter table public.staff_access_profile_roles enable row level security;

-- No direct table access; all reads go through app.staff_profiles_list.
revoke all on public.staff_access_profiles, public.staff_access_profile_roles from anon, authenticated;
grant select on public.staff_access_profiles, public.staff_access_profile_roles to authenticated;

insert into public.staff_access_profiles (code, label, description, version)
values
  ('administrator', 'Administrator',
   'Manages accounts, configuration, import/export, audit, and guardian-access approval, and performs final admissions, finance, HR, content, and result decisions.', 1),
  ('principal', 'Principal',
   'Handles daily admissions, careers, finance operations, result entry/import, timetable management, content drafting, and support.', 1)
on conflict (code) do update
  set label = excluded.label, description = excluded.description,
      version = public.staff_access_profiles.version + 1;

-- Staff profiles reference canonical role definitions. Supabase applies seeds
-- after migrations and the scratch validator likewise, so the migration is
-- self-contained: the canonical definitions are backfilled idempotently here
-- (mirroring supabase/seed.sql) and the deterministic seed re-applies them
-- with ON CONFLICT DO NOTHING.
insert into public.role_definitions (code, label, description, is_assignable) values
  ('guardian', 'Guardian', 'Family portal access through verified guardian/student links.', true),
  ('student', 'Student', 'Own student records; disabled — students are school records linked to guardians and do not sign in.', false),
  ('content_editor', 'Content editor', 'Drafts notices and public content (content.draft).', true),
  ('content_publisher', 'Content publisher', 'Reviews and publishes notices and content (content.publish).', true),
  ('admissions_officer', 'Admissions officer', 'Reviews applications and moves them to assessment (admissions.review).', true),
  ('admissions_approver', 'Admissions approver', 'Decides offers, waitlists, and declines (admissions.approve).', true),
  ('finance_officer', 'Finance officer', 'Finance operations and payment handling (finance.operate).', true),
  ('finance_approver', 'Finance approver', 'Approves refunds, write-offs, and reconciliation (finance.approve).', true),
  ('hr_reviewer', 'HR reviewer', 'Scores and reviews job applications (careers.review).', true),
  ('hr_approver', 'HR approver', 'Advances, rejects, and offers on job applications (careers.approve).', true),
  ('teacher', 'Teacher', 'Legacy role — teachers are non-login school records. Retained for history/audit only; not assignable.', false),
  ('result_entry_officer', 'Result entry officer', 'Enters and imports marks for result batches (results.enter). Principal profile.', true),
  ('exam_reviewer', 'Exam reviewer', 'Moderates and approves result batches (results.approve). Administrator profile.', true),
  ('result_publisher', 'Result publisher', 'Publishes, corrects, and withdraws result publications (results.publish). Administrator profile.', true),
  ('timetable_manager', 'Timetable manager', 'Creates, validates, publishes, and overrides timetables (timetable.manage). Principal profile.', true),
  ('support_officer', 'Support officer', 'Responds to support requests (support.respond). Principal profile.', true),
  ('auditor', 'Auditor', 'Read-only audit and reconciliation projections (audit.view). Administrator profile.', true),
  ('system_administrator', 'System administrator', 'Manages accounts, grants, and configuration — never business approvals (users.manage, settings.manage). Administrator profile.', true)
on conflict (code) do update
  set label = excluded.label,
      description = excluded.description,
      is_assignable = excluded.is_assignable;

-- Administrator profile: final approvals, publication, configuration, audit.
insert into public.staff_access_profile_roles (profile_code, role_code, sort_order)
values
  ('administrator', 'system_administrator', 1),
  ('administrator', 'content_publisher', 2),
  ('administrator', 'admissions_approver', 3),
  ('administrator', 'finance_approver', 4),
  ('administrator', 'hr_approver', 5),
  ('administrator', 'exam_reviewer', 6),
  ('administrator', 'result_publisher', 7),
  ('administrator', 'auditor', 8)
on conflict (profile_code, role_code) do nothing;

-- Principal profile: daily operations, entry, drafting, support.
insert into public.staff_access_profile_roles (profile_code, role_code, sort_order)
values
  ('principal', 'content_editor', 1),
  ('principal', 'admissions_officer', 2),
  ('principal', 'finance_officer', 3),
  ('principal', 'hr_reviewer', 4),
  ('principal', 'result_entry_officer', 5),
  ('principal', 'timetable_manager', 6),
  ('principal', 'support_officer', 7)
on conflict (profile_code, role_code) do nothing;

-- Remove any stale teacher profile roles from a prior local-only apply.
delete from public.staff_access_profile_roles where profile_code = 'teacher';
delete from public.staff_access_profiles where code = 'teacher';

-- ---------------------------------------------------------------------------
-- Staff member profile marker (nullable for legacy/custom accounts)
-- ---------------------------------------------------------------------------

alter table public.staff_members
  add column if not exists access_profile_code text
    references public.staff_access_profiles(code) on delete restrict,
  add column if not exists access_profile_version int
    check (access_profile_version is null or access_profile_version >= 1);

-- Reconcile any existing staff member markers that referenced the old teacher
-- profile: clear them so the account can be reviewed and re-provisioned.
update public.staff_members set access_profile_code = null, access_profile_version = null
 where access_profile_code = 'teacher';

-- ---------------------------------------------------------------------------
-- Profile-aware staff invitations
-- ---------------------------------------------------------------------------

alter table public.account_invitations
  add column if not exists intended_staff_profile_code text
    references public.staff_access_profiles(code) on delete restrict,
  add column if not exists intended_staff_profile_version int
    check (intended_staff_profile_version is null or intended_staff_profile_version >= 1),
  add column if not exists intended_title text;

-- Immutable snapshot of the profile role grants captured at invitation time.
create table public.staff_invitation_roles (
  invitation_id uuid not null references public.account_invitations(id) on delete cascade,
  role_code     text not null references public.role_definitions(code) on delete restrict,
  primary key (invitation_id, role_code)
);

alter table public.staff_invitation_roles enable row level security;
revoke all on public.staff_invitation_roles from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Profile validation helpers (SECURITY DEFINER, search_path locked)
-- ---------------------------------------------------------------------------

create or replace function app.profile_role_codes(p_profile_code text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(role_code order by sort_order), '{}')
    from public.staff_access_profile_roles
   where profile_code = p_profile_code
     and exists (select 1 from public.staff_access_profiles sp
                  where sp.code = p_profile_code and sp.is_active)
$$;

-- ---------------------------------------------------------------------------
-- app.staff_profiles_list — active profile catalog with role summaries
-- ---------------------------------------------------------------------------

create or replace function app.staff_profiles_list()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_data order by row_data->>'code'), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'code', sp.code,
        'label', sp.label,
        'description', sp.description,
        'version', sp.version,
        'roles', app.profile_role_codes(sp.code)
      ) as row_data
        from public.staff_access_profiles sp
       where sp.is_active
    ) rows
$$;

-- ---------------------------------------------------------------------------
-- app.staff_invites_create_profile — Administrator-only profile invitation
-- ---------------------------------------------------------------------------

create or replace function app.staff_invites_create_profile(
  p_contact text,
  p_expires_at timestamptz,
  p_display_name text,
  p_title text default null,
  p_profile_code text default 'administrator',
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reference text;
  v_contact text := app.normalize_identity_contact(p_contact);
  v_invitation_id uuid;
  v_roles text[];
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['system_administrator'])) then
    raise exception 'staff invitation requires system_administrator and aal2';
  end if;
  if v_contact = '' or position('@' in v_contact) = 0
     or p_display_name is null or length(btrim(p_display_name)) < 2 then
    raise exception 'staff invitation contact and display name are required';
  end if;
  if p_profile_code is null or not exists (
    select 1 from public.staff_access_profiles where code = p_profile_code and is_active
  ) then
    raise exception 'invalid staff profile';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'staff invitation reason is required';
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'invalid invitation expiry';
  end if;
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

  v_roles := app.profile_role_codes(p_profile_code);

  insert into public.account_invitations (
    purpose, contact, invitation_hash, status, expires_at, created_by_account_id,
    intended_staff_profile_code, intended_staff_profile_version, intended_title,
    intended_role_code, intended_display_name, intended_reason,
    intended_academic_year_ids, intended_grade_section_ids, intended_subject_ids
  ) values (
    'staff', v_contact, app.hash_invitation_secret(gen_random_uuid()::text || gen_random_uuid()::text),
    'pending', p_expires_at, auth.uid(),
    p_profile_code,
    (select version from public.staff_access_profiles where code = p_profile_code),
    nullif(btrim(coalesce(p_title, '')), ''),
    null, btrim(p_display_name), btrim(p_reason),
    '{}', '{}', '{}'
  )
  returning id, reference into v_invitation_id, v_reference;

  insert into public.staff_invitation_roles (invitation_id, role_code)
  select v_invitation_id, role
    from unnest(v_roles) role;

  perform app.record_audit('Staff invitation created', 'account_invitation', v_reference,
                           'Success', btrim(p_reason), 'System administrator');
  insert into public.outbox_events (event_key, kind, target_type, target_reference, payload)
  values ('security.staff_invitation_created:' || v_reference, 'security.staff_invitation_created',
          'account_invitation', v_reference,
          jsonb_build_object('contact', v_contact, 'profileCode', p_profile_code, 'roles', v_roles))
  on conflict (event_key) do nothing;

  return jsonb_build_object('invitationRef', v_reference, 'contact', v_contact,
                            'profileCode', p_profile_code, 'roles', v_roles,
                            'expiresAt', p_expires_at, 'status', 'pending');
end;
$$;

-- ---------------------------------------------------------------------------
-- app.staff_invites_accept — profile-aware acceptance (verified Auth email)
-- ---------------------------------------------------------------------------

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
  v_role text;
  v_account public.user_accounts%rowtype;
  v_email text := app.auth_claim_email();
  v_profile text;
  v_roles text[] := '{}';
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

  v_profile := v_inv.intended_staff_profile_code;

  select * into v_account from public.user_accounts where id = auth.uid() for update;
  if v_account.id is not null then
    if app.normalize_identity_contact(v_account.verified_contact) <> app.normalize_identity_contact(v_inv.contact) then
      raise exception 'an account already exists for a different verified contact';
    end if;
    if v_account.status in ('suspended', 'closed') then raise exception 'account cannot accept this invitation'; end if;
    v_person_id := v_account.person_id;
  else
    if exists (
      select 1 from public.user_accounts
       where app.normalize_identity_contact(verified_contact) = app.normalize_identity_contact(v_inv.contact)
    ) then
      raise exception 'an account already exists for this invitation contact';
    end if;
    insert into public.people (given_name, family_name, display_name)
    values (btrim(p_given_name), btrim(p_family_name), btrim(p_given_name) || ' ' || btrim(p_family_name))
    returning id into v_person_id;
    insert into public.user_accounts (id, person_id, status, verified_contact)
    values (auth.uid(), v_person_id, 'active', app.normalize_identity_contact(v_inv.contact));
  end if;

  insert into public.staff_members (person_id, employment_status, title, access_profile_code, access_profile_version)
  values (v_person_id, 'active',
          coalesce(nullif(btrim(coalesce(v_inv.intended_title, '')), ''),
                   coalesce(nullif(btrim(coalesce(v_inv.intended_display_name, '')), ''), 'Staff member')),
          v_profile, v_inv.intended_staff_profile_version)
  on conflict (person_id) do update
    set employment_status = 'active',
        access_profile_code = coalesce(public.staff_members.access_profile_code, excluded.access_profile_code),
        access_profile_version = coalesce(public.staff_members.access_profile_version, excluded.access_profile_version)
  returning id into v_staff_id;
  if v_staff_id is null then
    select id into v_staff_id from public.staff_members where person_id = v_person_id;
  end if;

  if v_profile is not null then
    select coalesce(array_agg(sir.role_code order by spr.sort_order), '{}') into v_roles
      from public.staff_invitation_roles sir
      join public.staff_access_profile_roles spr on spr.role_code = sir.role_code
     where sir.invitation_id = v_inv.id;
    if coalesce(array_length(v_roles, 1), 0) = 0 then
      raise exception 'profile invitation has no role snapshot';
    end if;
  else
    v_roles := array[v_inv.intended_role_code];
    if v_roles[1] is null then raise exception 'staff invitation has no intended role'; end if;
  end if;

  foreach v_role in array v_roles loop
    select id, reference into v_grant_id, v_grant_ref
      from public.role_grants
     where account_id = auth.uid() and role_code = v_role and status = 'active';
    if v_grant_id is null then
      insert into public.role_grants (account_id, role_code, status, granted_by_account_id, reason)
      values (auth.uid(), v_role, 'active', v_inv.created_by_account_id,
              coalesce(nullif(btrim(v_inv.intended_reason), ''), 'Staff invitation acceptance'))
      returning id, reference into v_grant_id, v_grant_ref;
    end if;
  end loop;

  update public.account_invitations
     set account_id = auth.uid(), status = 'accepted', accepted_at = now()
   where id = v_inv.id;
  perform app.bump_access_revalidation(auth.uid());
  perform app.record_audit('Staff invitation accepted', 'account_invitation', v_inv.reference,
                           'Success', null, 'Invited staff member');
  insert into public.outbox_events (event_key, kind, target_type, target_reference, payload)
  values ('security.staff_invitation_accepted:' || v_inv.reference, 'security.staff_invitation_accepted',
          'account_invitation', v_inv.reference,
          jsonb_build_object('accountId', auth.uid(), 'profileCode', v_profile, 'roles', v_roles))
  on conflict (event_key) do nothing;

  return jsonb_build_object(
    'accountId', auth.uid(),
    'staffMemberId', v_staff_id,
    'profileCode', v_profile,
    'roles', v_roles,
    'grants', (select coalesce(jsonb_agg(jsonb_build_object('roleCode', rg.role_code, 'grantRef', rg.reference) order by rg.role_code), '[]'::jsonb)
                 from public.role_grants rg where rg.account_id = auth.uid() and rg.status = 'active')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- app.staff_profile_change — Administrator-only profile changes
-- ---------------------------------------------------------------------------

create or replace function app.staff_profile_change(
  p_account_id uuid,
  p_profile_code text,
  p_reason text,
  p_expected_version int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.staff_members%rowtype;
  v_staff_ref text;
  v_current_profile text;
  v_current_version int;
  v_grant public.role_grants%rowtype;
  v_role text;
  v_roles text[] := '{}';
  v_new_grant uuid;
  v_new_grant_ref text;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['system_administrator'])) then
    raise exception 'profile administration requires system_administrator and aal2';
  end if;
  if p_account_id is null or p_account_id = auth.uid() then
    raise exception 'administrator cannot change the current account profile';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'profile change reason is required';
  end if;
  if p_profile_code is null or not exists (
    select 1 from public.staff_access_profiles where code = p_profile_code and is_active
  ) then
    raise exception 'invalid staff profile';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'expected profile version is required';
  end if;

  select sm.* into v_member
    from public.staff_members sm
    join public.user_accounts ua on ua.person_id = sm.person_id
   where ua.id = p_account_id
   for update of sm;
  if v_member.id is null then raise exception 'staff member not found for this account'; end if;

  v_current_profile := v_member.access_profile_code;
  v_current_version := coalesce(v_member.access_profile_version, 0);
  if v_current_profile is null then
    raise exception 'legacy account has no access profile — reconcile its grants before changing it';
  end if;
  if v_current_version <> p_expected_version then
    raise exception 'profile version mismatch (expected %, found %)', p_expected_version, v_current_version;
  end if;

  if v_current_profile = 'administrator' and p_profile_code <> 'administrator' then
    if (select count(*) from public.role_grants rg
          join public.staff_members sm on sm.id = v_member.id
          join public.user_accounts ua on ua.person_id = sm.person_id
         where rg.account_id = ua.id and rg.role_code = 'system_administrator' and rg.status = 'active') > 0
       and (select count(distinct ua.id)
              from public.role_grants rg
              join public.user_accounts ua on ua.id = rg.account_id
             where rg.role_code = 'system_administrator' and rg.status = 'active'
               and ua.status = 'active'
               and ua.id <> p_account_id) = 0 then
      raise exception 'cannot demote the last active administrator';
    end if;
  end if;

  select p.reference into v_staff_ref from public.people p where p.id = v_member.person_id;

  for v_grant in
    select rg.* from public.role_grants rg
     where rg.account_id = p_account_id and rg.status = 'active'
       and not exists (select 1 from public.staff_access_profile_roles spr
                        where spr.profile_code = p_profile_code and spr.role_code = rg.role_code)
  loop
    update public.role_grants
       set status = 'revoked', effective_to = now(), version = v_grant.version + 1
     where id = v_grant.id;
    update public.staff_assignments
       set status = 'ended', effective_to = coalesce(effective_to, now()), version = version + 1
     where role_grant_id = v_grant.id and status in ('scheduled', 'active');
  end loop;

  v_roles := app.profile_role_codes(p_profile_code);
  foreach v_role in array v_roles loop
    select id, reference into v_new_grant, v_new_grant_ref
      from public.role_grants
     where account_id = p_account_id and role_code = v_role and status = 'active';
    if v_new_grant is null then
      insert into public.role_grants (account_id, role_code, status, granted_by_account_id, reason)
      values (p_account_id, v_role, 'active', auth.uid(), btrim(p_reason))
      returning id, reference into v_new_grant, v_new_grant_ref;
    end if;
  end loop;

  update public.staff_members
     set access_profile_code = p_profile_code,
         access_profile_version = v_current_version + 1
   where id = v_member.id;

  perform app.bump_access_revalidation(p_account_id);
  perform app.record_audit('Staff profile changed', 'user_account', v_staff_ref,
                           'Success', btrim(p_reason), 'System administrator');
  insert into public.outbox_events (event_key, kind, target_type, target_reference, payload)
  values ('security.staff_profile_changed:' || p_account_id::text || ':' || (v_current_version + 1),
          'security.staff_profile_changed', 'user_account', v_staff_ref,
          jsonb_build_object('accountId', p_account_id, 'fromProfile', v_current_profile,
                             'toProfile', p_profile_code, 'roles', v_roles))
  on conflict (event_key) do nothing;

  return jsonb_build_object(
    'accountId', p_account_id,
    'staffMemberId', v_member.id,
    'profileCode', p_profile_code,
    'profileVersion', v_current_version + 1,
    'roles', v_roles
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Last-administrator guard for suspension
-- ---------------------------------------------------------------------------

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
  v_is_admin boolean;
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

  select ua.status, p.reference into v_status, v_target_ref
    from public.user_accounts ua
    join public.people p on p.id = ua.person_id
   where ua.id = p_account_id
   for update;
  if v_status is null then raise exception 'account not found'; end if;
  if v_status = 'closed' then raise exception 'closed account cannot be suspended'; end if;
  if v_status = 'suspended' then return; end if;

  select exists (
    select 1 from public.role_grants
     where account_id = p_account_id and role_code = 'system_administrator' and status = 'active'
  ) into v_is_admin;
  if v_is_admin and (
    select count(distinct ua.id)
      from public.role_grants rg
      join public.user_accounts ua on ua.id = rg.account_id
     where rg.role_code = 'system_administrator' and rg.status = 'active'
       and ua.status = 'active' and ua.id <> p_account_id
  ) = 0 then
    raise exception 'cannot suspend the last active administrator';
  end if;

  update public.user_accounts set status = 'suspended' where id = p_account_id;
  update public.role_grants
     set status = 'revoked', effective_to = coalesce(effective_to, now()), version = version + 1
   where account_id = p_account_id and status = 'active';
  update public.staff_members sm
     set employment_status = 'inactive'
    from public.user_accounts ua
    join public.people p on p.id = ua.person_id
   where sm.person_id = p.id and ua.id = p_account_id and sm.employment_status = 'active';
  perform app.bump_access_revalidation(p_account_id);
  perform app.record_audit('Account suspended', 'user_account', v_target_ref, 'Success', btrim(p_reason), 'System administrator');
  insert into public.outbox_events (event_key, kind, target_type, target_reference, payload)
  values ('security.account_suspended:' || p_account_id::text, 'security.account_suspended',
          'user_account', v_target_ref,
          jsonb_build_object('accountId', p_account_id, 'reason', btrim(p_reason)))
  on conflict (event_key) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- app.users_admin_list — profile + grants directory projection
-- ---------------------------------------------------------------------------

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
            'expires_at', ai.expires_at, 'provider_state', ai.provider_state,
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
        'staff_members', coalesce((select jsonb_agg(jsonb_build_object(
            'id', sm.id, 'reference', sm.reference, 'title', sm.title,
            'employment_status', sm.employment_status,
            'access_profile_code', null::text, 'access_profile_version', null))
            from public.staff_members sm where false), '[]'::jsonb),
        'role_grants', '[]'::jsonb,
        'account_invitations', jsonb_build_array(jsonb_build_object(
            'reference', ai.reference, 'contact', ai.contact, 'status', ai.status,
            'expires_at', ai.expires_at, 'provider_state', ai.provider_state,
            'role_code', ai.intended_role_code, 'reason', ai.intended_reason,
            'profile_code', ai.intended_staff_profile_code))
      ) as row_data
      from public.account_invitations ai
      where app.is_staff_aal2() and app.has_role('system_administrator')
        and ai.purpose = 'staff' and ai.account_id is null
        and ai.status in ('pending', 'expired', 'revoked')
    ) rows
$$;

-- ---------------------------------------------------------------------------
-- Profile invariants and legacy boundaries
--
-- The generic role commands remain for already-created legacy records, but:
--   * deprecated role definitions (student, teacher) can never be freshly
--     granted or invited;
--   * profiled accounts keep their exact profile bundle — individual
--     grant/revoke against them is denied (use app.staff_profile_change);
--   * guardian-link decisions are Administrator-only (support officers
--     collect evidence but never activate, restrict, or revoke a link);
--   * the last-administrator guard is serialized with a transaction lock.
-- ---------------------------------------------------------------------------

-- roles_grant hardened: refuses non-assignable role definitions and refuses
-- to break the exact bundle of a profiled account.
create or replace function app.roles_grant(
  p_account_id uuid,
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
  v_grant_id uuid;
  v_reference text;
  v_version int;
  v_definition record;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['system_administrator'])) then
    raise exception 'role administration requires system_administrator and aal2';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'invalid grant: a recorded reason is required';
  end if;
  select is_active, is_assignable into v_definition from public.role_definitions where code = p_role_code;
  if v_definition.is_active is null then
    raise exception 'role not found';
  end if;
  if not v_definition.is_active then
    raise exception 'role not found or inactive';
  end if;
  if not v_definition.is_assignable then
    raise exception 'role % is legacy/non-assignable and cannot be granted', p_role_code;
  end if;
  if not exists (select 1 from public.user_accounts where id = p_account_id) then
    raise exception 'account not found';
  end if;
  if exists (
    select 1 from public.role_grants
     where account_id = p_account_id and role_code = p_role_code and status = 'active'
  ) then
    raise exception 'duplicate active grant for this account and role';
  end if;
  -- Profile invariant: a provisioned account keeps exactly its profile bundle.
  if exists (
    select 1
      from public.staff_members sm
      join public.user_accounts ua on ua.person_id = sm.person_id
     where ua.id = p_account_id and sm.access_profile_code is not null
  ) and not exists (
    select 1
      from public.staff_members sm
      join public.staff_access_profile_roles spr on spr.profile_code = sm.access_profile_code
      join public.user_accounts ua on ua.person_id = sm.person_id
     where ua.id = p_account_id and spr.role_code = p_role_code
  ) then
    raise exception 'role is outside the account access profile — use a profile change';
  end if;

  insert into public.role_grants (
    account_id, role_code, status, granted_by_account_id,
    reason, effective_from, effective_to, version
  ) values (
    p_account_id, p_role_code, 'active', auth.uid(),
    btrim(p_reason), now(), null, 1
  )
  returning id, reference, version into v_grant_id, v_reference, v_version;

  insert into public.role_grant_academic_years (role_grant_id, academic_year_id)
  select v_grant_id, year_id from unnest(p_academic_year_ids) as year_id
   where exists (select 1 from public.academic_years where id = year_id);
  insert into public.role_grant_grade_sections (role_grant_id, grade_section_id)
  select v_grant_id, section_id from unnest(p_grade_section_ids) as section_id
   where exists (select 1 from public.grade_sections where id = section_id);
  insert into public.role_grant_subjects (role_grant_id, subject_id)
  select v_grant_id, subject_id from unnest(p_subject_ids) as subject_id
   where exists (select 1 from public.subjects where id = subject_id);

  perform app.record_audit('Role granted', 'role_grant', v_reference, 'Success', btrim(p_reason), 'system_administrator');
  perform app.enqueue_outbox(
    'security.role_granted:' || v_reference || ':' || v_version,
    'security.role_granted', 'user_account', p_account_id,
    jsonb_build_object('grantRef', v_reference, 'roleCode', p_role_code)
  );
  return v_reference;
end;
$$;

-- roles_revoke hardened: profiled accounts are bundle-locked (individual
-- revocation is denied; use app.staff_profile_change).
create or replace function app.roles_revoke(
  p_grant_id uuid,
  p_reason text,
  p_expected_version int
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.role_grants%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['system_administrator'])) then
    raise exception 'role administration requires system_administrator and aal2';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'invalid revocation: a recorded reason is required';
  end if;
  select * into v_grant from public.role_grants where id = p_grant_id;
  if v_grant.id is null then
    raise exception 'role grant not found';
  end if;
  if v_grant.status <> 'active' then
    raise exception 'role grant is not active';
  end if;
  if v_grant.version <> p_expected_version then
    raise exception 'role grant version mismatch (expected %, found %)', p_expected_version, v_grant.version;
  end if;
  -- Profile invariant: a provisioned account keeps its exact bundle.
  if exists (
    select 1
      from public.staff_members sm
      join public.user_accounts ua on ua.person_id = sm.person_id
     where ua.id = v_grant.account_id and sm.access_profile_code is not null
  ) then
    raise exception 'profiled accounts are managed through app.staff_profile_change';
  end if;
  update public.role_grants
     set status = 'revoked', effective_to = now(), version = v_grant.version + 1
   where id = v_grant_id;
  perform app.bump_access_revalidation(v_grant.account_id);
  perform app.record_audit('Role revoked', 'role_grant', v_grant.reference, 'Success', btrim(p_reason), 'system_administrator');
  perform app.enqueue_outbox(
    'security.role_revoked:' || v_grant.reference,
    'security.role_revoked', 'user_account', v_grant.account_id,
    jsonb_build_object('grantRef', v_grant.reference, 'roleCode', v_grant.role_code)
  );
end;
$$;

-- Guardian-link decisions are Administrator-only: support officers collect
-- evidence but never activate, restrict, or revoke a guardian link. The
-- command body mirrors the original 000015 lifecycle (pending-state guard,
-- version bump, revalidation) with only the authorization narrowed.
create or replace function app.links_approve(p_link_id uuid, p_expected_version int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.guardian_student_links%rowtype;
  v_guardian_account uuid;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'link activation requires the system administrator';
  end if;
  select * into v_link from public.guardian_student_links where id = p_link_id;
  if v_link.id is null then
    raise exception 'link not found';
  end if;
  if v_link.version <> p_expected_version then
    raise exception 'link version mismatch (expected %, found %)', p_expected_version, v_link.version;
  end if;
  if v_link.status = 'active' then
    return;                                    -- idempotent
  end if;
  if v_link.status <> 'pending_verification' then
    raise exception 'link cannot be approved in state (%)', v_link.status;
  end if;

  update public.guardian_student_links
     set status = 'active', approved_by_account_id = auth.uid(),
         approved_at = now(), effective_from = now(), effective_to = null,
         version = v_link.version + 1
   where id = p_link_id;

  select ua.id into v_guardian_account
    from public.guardians g
    join public.user_accounts ua on ua.person_id = g.person_id
   where g.id = v_link.guardian_id;
  if v_guardian_account is not null then
    perform app.bump_access_revalidation(v_guardian_account);
  end if;
  perform app.record_audit('Guardian link activated', 'guardian_student_link', v_link.reference, 'Success');
end;
$$;

-- ---------------------------------------------------------------------------
-- Canonical staff/AAL helper: include result_entry_officer (Principal marks
-- entry) so a profile principal always passes the staff-AAL2 gate.
-- ---------------------------------------------------------------------------

create or replace function app.is_staff_aal2()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and (auth.jwt() ->> 'aal') = 'aal2'
     and exists (
       select 1
         from public.role_grants rg
        where rg.account_id = auth.uid()
          and rg.status = 'active'
          and rg.effective_from <= now()
          and (rg.effective_to is null or rg.effective_to > now())
          and rg.role_code in (
            'content_editor', 'content_publisher',
            'admissions_officer', 'admissions_approver',
            'finance_officer', 'finance_approver',
            'hr_reviewer', 'hr_approver',
            /* teacher remains for legacy sessions until the Phase-3
               retirement; result_entry_officer is the Principal entry role. */
            'teacher', 'result_entry_officer', 'exam_reviewer', 'result_publisher',
            'timetable_manager', 'support_officer',
            'auditor', 'system_administrator'
          )
     )
$$;

-- Guardian-access administration: the Administrator activates, restricts,
-- and revokes guardian links, so the link read policy must include the
-- system administrator. app.has_any_role deliberately strips
-- system_administrator from multi-role lists (000020 boundary hardening —
-- the admin grant never substitutes for a functional role), so the
-- administrator is OR-ed in via app.has_role.
drop policy if exists scope_staff_links_read on public.guardian_student_links;
create policy scope_staff_links_read on public.guardian_student_links for select to authenticated
  using (app.is_staff_aal2() and (
    app.has_any_role(array['admissions_officer','admissions_approver','finance_officer','finance_approver','teacher','exam_reviewer','result_publisher','timetable_manager','support_officer','auditor'])
    or app.has_role('system_administrator')));
drop policy if exists scope_staff_capabilities_read on public.guardian_link_capabilities;
create policy scope_staff_capabilities_read on public.guardian_link_capabilities for select to authenticated
  using (app.is_staff_aal2() and (
    app.has_any_role(array['admissions_officer','admissions_approver','finance_officer','finance_approver','teacher','exam_reviewer','result_publisher','timetable_manager','support_officer','auditor'])
    or app.has_role('system_administrator')));

-- ---------------------------------------------------------------------------
-- Execution surface
-- ---------------------------------------------------------------------------

revoke all on function app.staff_profiles_list() from public;
revoke all on function app.staff_invites_create_profile(text, timestamptz, text, text, text, text) from public;
revoke all on function app.staff_invites_accept(text, text, text) from public;
revoke all on function app.staff_profile_change(uuid, text, text, int) from public;
revoke all on function app.users_admin_list() from public;

grant execute on function app.staff_profiles_list() to authenticated;
grant execute on function app.staff_invites_create_profile(text, timestamptz, text, text, text, text) to authenticated;
grant execute on function app.staff_invites_accept(text, text, text) to authenticated;
grant execute on function app.staff_profile_change(uuid, text, text, int) to authenticated;
grant execute on function app.users_admin_list() to authenticated;

commit;
