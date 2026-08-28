-- =============================================================================
-- 000017 — Staff identity lifecycle commands (plan.md §4, §8; blueprint §5.2)
--
-- Completes the staff chain: invite → account → role grant (+ scopes) →
-- assignment. Same contract as 000009/000015: SECURITY DEFINER,
-- search_path = '', auth.uid() verified, system_administrator + aal2 for
-- every write, optimistic version guards, audit + outbox rows in the same
-- transaction. Revocation safety comes from the existing revalidation
-- triggers (role_grants / staff_assignments bump access_revalidation), so a
-- revoked grant or ended assignment takes effect on the next request.
--
-- Reads (accounts with grants/assignments) stay plain RLS reads in the
-- domain layer — RPCs exist only for writes.
-- =============================================================================
begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- roles_grant — grant a canonical role to an account, with optional academic
-- year / grade section / subject scope rows.
-- Idempotency: a duplicate ACTIVE grant for the same account+role raises
-- 'duplicate active grant' (the partial unique index also guards races).
-- Returns the new grant reference.
-- ---------------------------------------------------------------------------
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
  if not exists (
    select 1 from public.role_definitions
     where code = p_role_code and is_active
  ) then
    raise exception 'role not found or inactive';
  end if;
  if not exists (
    select 1 from public.user_accounts where id = p_account_id
  ) then
    raise exception 'account not found';
  end if;
  if exists (
    select 1 from public.role_grants
     where account_id = p_account_id and role_code = p_role_code and status = 'active'
  ) then
    raise exception 'duplicate active grant for this account and role';
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
  select v_grant_id, year_id
    from unnest(p_academic_year_ids) as year_id
   where exists (select 1 from public.academic_years where id = year_id);

  insert into public.role_grant_grade_sections (role_grant_id, grade_section_id)
  select v_grant_id, section_id
    from unnest(p_grade_section_ids) as section_id
   where exists (select 1 from public.grade_sections where id = section_id);

  insert into public.role_grant_subjects (role_grant_id, subject_id)
  select v_grant_id, subject_id
    from unnest(p_subject_ids) as subject_id
   where exists (select 1 from public.subjects where id = subject_id);

  perform app.record_audit(
    'Role granted',
    'role_grant',
    v_reference,
    'Success',
    btrim(p_reason),
    'system_administrator'
  );
  perform app.enqueue_outbox(
    'security.role_granted:' || v_reference || ':' || v_version,
    'security.role_granted',
    'user_account',
    p_account_id,
    jsonb_build_object('grantRef', v_reference, 'roleCode', p_role_code)
  );

  return v_reference;
end;
$$;

-- ---------------------------------------------------------------------------
-- roles_revoke — revoke an active grant (version-checked). The revalidation
-- trigger bumps the account's security version, ending access on next use.
-- ---------------------------------------------------------------------------
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
    raise exception 'grant not found';
  end if;
  if v_grant.version <> p_expected_version then
    raise exception 'grant version mismatch (expected %, found %)', p_expected_version, v_grant.version;
  end if;
  if v_grant.status = 'revoked' then
    return;                                    -- idempotent
  end if;
  if v_grant.status <> 'active' then
    raise exception 'grant cannot be revoked in state (%)', v_grant.status;
  end if;

  update public.role_grants
     set status = 'revoked', effective_to = now(), version = v_grant.version + 1
   where id = p_grant_id;

  perform app.record_audit(
    'Role revoked',
    'role_grant',
    v_grant.reference,
    'Success',
    btrim(p_reason),
    'system_administrator'
  );
  perform app.enqueue_outbox(
    'security.role_revoked:' || v_grant.reference || ':' || (v_grant.version + 1),
    'security.role_revoked',
    'user_account',
    v_grant.account_id,
    jsonb_build_object('grantRef', v_grant.reference, 'reason', btrim(p_reason))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- assignments_create — attach an effective assignment (year + optional class/
-- subject) to an active teacher/operational grant of the staff member's own
-- account. Teacher scope downstream (marks entry, timetables) derives from
-- this row, so the grant linkage is validated strictly.
-- Returns the new assignment reference.
-- ---------------------------------------------------------------------------
create or replace function app.assignments_create(
  p_staff_member_id uuid,
  p_role_grant_id uuid,
  p_academic_year_id uuid,
  p_grade_section_id uuid default null,
  p_subject_id uuid default null,
  p_effective_from date default current_date
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment_id uuid;
  v_reference text;
  v_account_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['system_administrator'])) then
    raise exception 'assignment administration requires system_administrator and aal2';
  end if;
  select ua.id into v_account_id
    from public.staff_members sm
    join public.user_accounts ua on ua.person_id = sm.person_id
   where sm.id = p_staff_member_id;
  if v_account_id is null then
    raise exception 'staff member not found';
  end if;

  if not exists (
    select 1 from public.role_grants
     where id = p_role_grant_id
       and account_id = v_account_id
       and status = 'active'
       and (effective_to is null or effective_to > now())
  ) then
    raise exception 'invalid assignment: grant must be an active grant of this staff member';
  end if;
  if not exists (
    select 1 from public.academic_years where id = p_academic_year_id
  ) then
    raise exception 'academic year not found';
  end if;
  if p_grade_section_id is not null and not exists (
    select 1 from public.grade_sections
     where id = p_grade_section_id and academic_year_id = p_academic_year_id
  ) then
    raise exception 'invalid grade section for this academic year';
  end if;
  if exists (
    select 1 from public.staff_assignments
     where staff_member_id = p_staff_member_id
       and role_grant_id = p_role_grant_id
       and academic_year_id = p_academic_year_id
       and coalesce(grade_section_id::text, '') = coalesce(p_grade_section_id::text, '')
       and coalesce(subject_id::text, '') = coalesce(p_subject_id::text, '')
       and status = 'active'
  ) then
    raise exception 'duplicate active assignment for this scope';
  end if;

  insert into public.staff_assignments (
    staff_member_id, role_grant_id, academic_year_id,
    grade_section_id, subject_id, status, effective_from, version
  ) values (
    p_staff_member_id, p_role_grant_id, p_academic_year_id,
    p_grade_section_id, p_subject_id, 'active', p_effective_from, 1
  )
  returning id, reference into v_assignment_id, v_reference;

  perform app.record_audit(
    'Staff assignment created',
    'staff_assignment',
    v_reference,
    'Success',
    null,
    'system_administrator'
  );
  perform app.enqueue_outbox(
    'security.assignment_created:' || v_reference,
    'security.assignment_created',
    'staff_assignment',
    v_assignment_id,
    jsonb_build_object('assignmentRef', v_reference, 'accountId', v_account_id)
  );

  return v_reference;
end;
$$;

-- ---------------------------------------------------------------------------
-- assignments_end — version-checked end of an effective assignment.
-- ---------------------------------------------------------------------------
create or replace function app.assignments_end(
  p_assignment_id uuid,
  p_reason text,
  p_expected_version int
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.staff_assignments%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['system_administrator'])) then
    raise exception 'assignment administration requires system_administrator and aal2';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'invalid end: a recorded reason is required';
  end if;
  select * into v_assignment from public.staff_assignments where id = p_assignment_id;
  if v_assignment.id is null then
    raise exception 'assignment not found';
  end if;
  if v_assignment.version <> p_expected_version then
    raise exception 'assignment version mismatch (expected %, found %)', p_expected_version, v_assignment.version;
  end if;
  if v_assignment.status = 'ended' then
    return;                                    -- idempotent
  end if;
  if v_assignment.status <> 'active' then
    raise exception 'assignment cannot be ended in state (%)', v_assignment.status;
  end if;

  update public.staff_assignments
     set status = 'ended', effective_to = least(current_date, effective_to), version = v_assignment.version + 1
   where id = p_assignment_id;

  perform app.record_audit(
    'Staff assignment ended',
    'staff_assignment',
    v_assignment.reference,
    'Success',
    btrim(p_reason),
    'system_administrator'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- invites_create — create a one-time staff invitation. Only the sha256 hash
-- of the one-time reference is stored; the plaintext reference is returned
-- ONCE to the inviting administrator and delivered out-of-band.
-- Returns the plaintext one-time reference.
-- ---------------------------------------------------------------------------
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
  v_invitation_id uuid;
  v_reference text;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not (app.is_staff_aal2() and app.has_any_role(
      array['system_administrator', 'support_officer'])) then
    raise exception 'invitation role and aal2 required';
  end if;
  if p_contact is null or btrim(p_contact) = '' then
    raise exception 'invalid invitation contact';
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'invalid invitation expiry';
  end if;
  if p_purpose not in ('guardian', 'applicant', 'job_applicant', 'staff') then
    raise exception 'invalid invitation purpose';
  end if;

  v_one_time_ref := encode(gen_random_bytes(24), 'hex');

  insert into public.account_invitations (
    purpose, contact, invitation_hash, status, expires_at, created_by_account_id
  ) values (
    p_purpose, btrim(p_contact), encode(digest(v_one_time_ref, 'sha256'), 'hex'),
    'pending', p_expires_at, auth.uid()
  )
  returning id, reference into v_invitation_id, v_reference;

  perform app.record_audit(
    'Account invitation created',
    'account_invitation',
    v_reference,
    'Success',
    null,
    'system_administrator'
  );

  -- The one-time secret travels to the caller only; never stored, never logged.
  return v_one_time_ref;
end;
$$;

-- ---------------------------------------------------------------------------
-- invites_revoke — cancel a pending invitation (version-free; status-only).
-- ---------------------------------------------------------------------------
create or replace function app.invites_revoke(
  p_invitation_reference text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not (app.is_staff_aal2() and app.has_any_role(
      array['system_administrator', 'support_officer'])) then
    raise exception 'invitation role and aal2 required';
  end if;
  select status into v_status
    from public.account_invitations
   where reference = p_invitation_reference;
  if v_status is null then
    raise exception 'invitation not found';
  end if;
  if v_status <> 'pending' then
    raise exception 'invitation cannot be revoked in state (%)', v_status;
  end if;

  update public.account_invitations
     set status = 'revoked'
   where reference = p_invitation_reference;

  perform app.record_audit(
    'Account invitation revoked',
    'account_invitation',
    p_invitation_reference,
    'Success',
    null,
    'system_administrator'
  );
end;
$$;

revoke all on function
  app.roles_grant(uuid, text, text, uuid[], uuid[], uuid[]),
  app.roles_revoke(uuid, text, int),
  app.assignments_create(uuid, uuid, uuid, uuid, uuid, date),
  app.assignments_end(uuid, text, int),
  app.invites_create(text, timestamptz, text),
  app.invites_revoke(text)
from public;

grant execute on function
  app.roles_grant(uuid, text, text, uuid[], uuid[], uuid[]),
  app.roles_revoke(uuid, text, int),
  app.assignments_create(uuid, uuid, uuid, uuid, uuid, date),
  app.assignments_end(uuid, text, int),
  app.invites_create(text, timestamptz, text),
  app.invites_revoke(text)
to authenticated;

commit;
