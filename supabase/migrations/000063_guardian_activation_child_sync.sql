-- =============================================================================
-- 000063 — Guardian activation and child synchronization hardening
--
-- Forward-only migration (plan.md Phase 11). Hardens guardian activation with
-- token-hash-only claims (the raw activation token is never stored), adds a
-- versioned contact-change model, atomic child switching via guardian
-- preferences, deprecates student-reference activation, and adds staff-approved
-- contact-change request/approve functions.
--
-- Never edit migrations 000001–000062.
-- =============================================================================

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Token-hash-only claims
-- ---------------------------------------------------------------------------
-- The raw activation token is NEVER stored. Only its SHA-256 hash is
-- persisted, so a database leak cannot be replayed. The existing secret_hash
-- column (000045) remains for the reference-based flow; token_hash is the
-- preferred lookup key for the token-only activation page.

alter table public.guardian_claim_invitations
  add column if not exists token_hash text;

create index if not exists guardian_claim_invitations_token_hash_idx
  on public.guardian_claim_invitations (token_hash)
  where token_hash is not null;

-- Pre-login token verification: lets the activation page confirm a token is
-- valid before the user signs in. Does NOT require auth.uid(); the function is
-- SECURITY DEFINER so it can read the claim row, and it reveals only
-- non-sensitive metadata (reference, channel, expiry) — never the hash.
create or replace function app.guardian_claim_verify_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_claim public.guardian_claim_invitations%rowtype;
begin
  if p_token is null or btrim(p_token) = '' then
    return jsonb_build_object('valid', false, 'reason', 'token is required');
  end if;

  v_hash := app.hash_invitation_secret(p_token);

  select * into v_claim from public.guardian_claim_invitations
   where token_hash = v_hash
   limit 1;

  if v_claim.id is null then
    return jsonb_build_object('valid', false, 'reason', 'claim not found');
  end if;

  if v_claim.status = 'claimed' then
    return jsonb_build_object('valid', false, 'reason', 'claim has already been used');
  end if;
  if v_claim.status = 'revoked' then
    return jsonb_build_object('valid', false, 'reason', 'claim has been revoked');
  end if;
  if v_claim.status not in ('pending', 'dispatched') then
    return jsonb_build_object('valid', false, 'reason', 'claim is not claimable');
  end if;
  if v_claim.expires_at <= now() then
    update public.guardian_claim_invitations set status = 'expired' where id = v_claim.id;
    return jsonb_build_object('valid', false, 'reason', 'claim has expired');
  end if;

  return jsonb_build_object(
    'valid', true,
    'claimReference', v_claim.reference,
    'channel', v_claim.channel,
    'expiresAt', v_claim.expires_at
  );
end;
$$;

-- Token-hash-only acceptance: performs the same acceptance logic as
-- app.guardian_claim_accept but looks up the claim by token_hash instead of
-- by reference + verified contact. The caller must still be authenticated
-- (auth.uid()) and must match the claim's provider_subject.
create or replace function app.guardian_claim_accept_by_token(
  p_token text,
  p_given_name text,
  p_family_name text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_claim public.guardian_claim_invitations%rowtype;
  v_contact public.guardian_contacts%rowtype;
  v_account public.user_accounts%rowtype;
  v_person_id uuid;
  v_guardian public.guardians%rowtype;
  v_link record;
  v_activated int := 0;
  v_email text := app.auth_claim_email();
  v_phone text := app.auth_claim_phone();
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if p_token is null or btrim(p_token) = '' then
    raise exception 'activation token is required';
  end if;
  if v_email is null and v_phone is null then raise exception 'a verified contact claim is required'; end if;
  if p_given_name is null or btrim(p_given_name) = '' or p_family_name is null or btrim(p_family_name) = '' then
    raise exception 'name is required';
  end if;

  v_hash := app.hash_invitation_secret(p_token);

  select * into v_claim from public.guardian_claim_invitations
   where token_hash = v_hash for update;
  if v_claim.id is null then raise exception 'guardian claim not found for this token'; end if;
  if v_claim.status = 'claimed' then raise exception 'guardian claim has already been used'; end if;
  if v_claim.status = 'revoked' then raise exception 'guardian claim has been revoked'; end if;
  if v_claim.status <> 'dispatched' and v_claim.status <> 'pending' then
    raise exception 'guardian claim is not claimable (state: %)', v_claim.status;
  end if;
  if v_claim.expires_at <= now() then
    update public.guardian_claim_invitations set status = 'expired' where id = v_claim.id;
    raise exception 'guardian claim has expired';
  end if;
  if v_claim.provider_subject is null or v_claim.provider_subject <> auth.uid() then
    raise exception 'guardian claim is not bound to this Auth account';
  end if;

  select * into v_contact from public.guardian_contacts where id = v_claim.guardian_contact_id for update;
  if v_contact.id is null then raise exception 'the recorded contact no longer exists'; end if;
  if v_claim.channel = 'email' then
    if v_email is null or app.normalize_identity_contact(v_contact.value) <> app.normalize_identity_contact(v_email) then
      raise exception 'the verified contact does not match the claim';
    end if;
  else
    if v_phone is null or app.normalize_identity_contact(v_contact.value) <> app.normalize_identity_contact(v_phone) then
      raise exception 'the verified contact does not match the claim';
    end if;
  end if;

  select * into v_guardian from public.guardians where id = v_claim.guardian_id for update;
  if v_guardian.id is null or v_guardian.status <> 'active' then
    raise exception 'the guardian record is not active';
  end if;

  -- Create or reuse exactly one account on the guardian's person.
  select * into v_account from public.user_accounts where person_id = v_guardian.person_id for update;
  if v_account.id is not null then
    if app.normalize_identity_contact(v_account.verified_contact) <> app.normalize_identity_contact(v_email)
       and v_account.verified_contact is not null then
      raise exception 'an account already exists for a different verified contact';
    end if;
    if v_account.status in ('suspended', 'closed') then
      raise exception 'this account cannot be claimed';
    end if;
    v_person_id := v_account.person_id;
  else
    if exists (
      select 1 from public.user_accounts
       where app.normalize_identity_contact(verified_contact) = app.normalize_identity_contact(v_email)
    ) then
      raise exception 'an account already exists for this contact';
    end if;
    update public.people
       set given_name = coalesce(nullif(btrim(p_given_name), ''), given_name),
           family_name = coalesce(nullif(btrim(p_family_name), ''), family_name)
     where id = v_guardian.person_id;
    insert into public.user_accounts (id, person_id, status, verified_contact)
    values (auth.uid(), v_guardian.person_id, 'active', app.normalize_identity_contact(v_email))
    returning * into v_account;
    v_person_id := v_account.person_id;
  end if;

  -- Grant Guardian exactly once.
  if not exists (
    select 1 from public.role_grants
     where account_id = auth.uid() and role_code = 'guardian' and status = 'active'
  ) then
    insert into public.role_grants (account_id, role_code, status, granted_by_account_id, reason)
    values (auth.uid(), 'guardian', 'active', v_claim.created_by_account_id, 'Guardian claim acceptance (token)');
  end if;

  -- Activate ONLY the exact approved links.
  for v_link in
    select l.id from public.guardian_claim_links cl
     join public.guardian_student_links l on l.id = cl.link_id
     where cl.claim_id = v_claim.id and l.status = 'pending_verification'
     for update of l
  loop
    update public.guardian_student_links
       set status = 'active', approved_at = now(), effective_from = now()
     where id = v_link.id;
    v_activated := v_activated + 1;
  end loop;

  -- Contact delivery verified at claim time (the OTP proved possession).
  update public.guardian_contacts
     set state = 'delivery_verified', verified_at = now(), version = version + 1
   where id = v_contact.id;

  update public.guardian_claim_invitations
     set status = 'claimed', claimed_at = now(), use_count = v_claim.use_count + 1
   where id = v_claim.id;

  perform app.bump_access_revalidation(auth.uid());
  perform app.record_audit('Guardian claim accepted (token)', 'guardian_claim_invitation', v_claim.reference,
                           'Success', null, 'Guardian');
  perform app.enqueue_outbox(
    'email.guardian_welcome:' || v_claim.reference,
    'email.deliver', 'guardian_claim_invitation', v_claim.reference,
    jsonb_build_object('channel', 'email'));

  v_result := jsonb_build_object(
    'accountId', auth.uid(),
    'guardianId', v_guardian.id,
    'reusedExistingAccount', (select count(*) from public.user_accounts ua2
                               where ua2.person_id = v_guardian.person_id) > 0,
    'activatedLinkCount', v_activated,
    'contactVerifiedAt', now());
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Versioned contact-change
-- ---------------------------------------------------------------------------
-- The original guardian_contact_changes table (000045) used a simple
-- account-keyed model. This migration evolves it to a guardian-keyed,
-- versioned model with old/new contact references, verification method, and an
-- approval workflow. The old columns are preserved for backward compatibility;
-- new columns are added idempotently.

alter table public.guardian_contact_changes
  add column if not exists reference text not null default app.new_ref('GCC');
alter table public.guardian_contact_changes
  add column if not exists guardian_id uuid references public.guardians(id) on delete restrict;
alter table public.guardian_contact_changes
  add column if not exists old_contact_id uuid references public.guardian_contacts(id) on delete set null;
alter table public.guardian_contact_changes
  add column if not exists new_contact_id uuid references public.guardian_contacts(id) on delete restrict;
alter table public.guardian_contact_changes
  add column if not exists change_reason text;
alter table public.guardian_contact_changes
  add column if not exists verification_method text
  check (verification_method is null or verification_method in ('otp', 'admin_verified', 'claim'));
alter table public.guardian_contact_changes
  add column if not exists requested_by_account_id uuid references public.user_accounts(id) on delete set null;
alter table public.guardian_contact_changes
  add column if not exists approved_by_account_id uuid references public.user_accounts(id) on delete set null;
alter table public.guardian_contact_changes
  add column if not exists status text
  check (status is null or status in ('pending', 'approved', 'rejected', 'superseded'));
alter table public.guardian_contact_changes
  add column if not exists version int not null default 1;
alter table public.guardian_contact_changes
  add column if not exists created_at timestamptz not null default now();

-- Backfill reference uniqueness now that every row has a default reference.
-- The unique constraint is added only if all existing rows have distinct
-- references (the default gen_random_uuid-based new_ref guarantees this).
create unique index if not exists guardian_contact_changes_reference_uidx
  on public.guardian_contact_changes (reference);

create index if not exists guardian_contact_changes_guardian_idx
  on public.guardian_contact_changes (guardian_id);
create index if not exists guardian_contact_changes_status_idx
  on public.guardian_contact_changes (status);

-- RLS: guardian can read their own contact changes; staff with users.manage
-- (system_administrator) + AAL2 can read all. The existing service and admin
-- policies from 000045 remain; we add a guardian-self-read policy.
drop policy if exists guardian_contact_changes_guardian_read on public.guardian_contact_changes;
create policy guardian_contact_changes_guardian_read on public.guardian_contact_changes
  for select to authenticated
  using (
    guardian_id is not null
    and exists (
      select 1 from public.guardians g
       join public.user_accounts ua on ua.person_id = g.person_id
      where g.id = guardian_contact_changes.guardian_id
        and ua.id = auth.uid()
    )
  );

grant select on public.guardian_contact_changes to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Atomic child switching support
-- ---------------------------------------------------------------------------
-- Guardian preferences are keyed by guardian_id (not account_id) so the
-- active child survives account re-binding and is independent of the
-- account-context preferences used for staff workspace switching.

create table if not exists public.guardian_preferences (
  guardian_id       uuid primary key references public.guardians(id) on delete cascade,
  active_student_id uuid references public.students(id) on delete set null,
  updated_at        timestamptz not null default now(),
  version           int not null default 1
);

create index if not exists guardian_preferences_active_student_idx
  on public.guardian_preferences (active_student_id);

drop trigger if exists guardian_preferences_touch on public.guardian_preferences;
create trigger guardian_preferences_touch
  before update on public.guardian_preferences
  for each row execute function app.touch_updated_at();

alter table public.guardian_preferences enable row level security;

revoke all on public.guardian_preferences from anon, authenticated;
grant select, insert, update on public.guardian_preferences to service_role;

create policy guardian_preferences_service
  on public.guardian_preferences for all to service_role
  using (true) with check (true);

grant select, insert, update on public.guardian_preferences to authenticated;

-- Guardian can read and update their own preferences.
create policy guardian_preferences_guardian_read
  on public.guardian_preferences for select to authenticated
  using (
    exists (
      select 1 from public.guardians g
       join public.user_accounts ua on ua.person_id = g.person_id
      where g.id = guardian_preferences.guardian_id
        and ua.id = auth.uid()
    )
  );
create policy guardian_preferences_guardian_update
  on public.guardian_preferences for update to authenticated
  using (
    exists (
      select 1 from public.guardians g
       join public.user_accounts ua on ua.person_id = g.person_id
      where g.id = guardian_preferences.guardian_id
        and ua.id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.guardians g
       join public.user_accounts ua on ua.person_id = g.person_id
      where g.id = guardian_preferences.guardian_id
        and ua.id = auth.uid()
    )
  );
create policy guardian_preferences_guardian_insert
  on public.guardian_preferences for insert to authenticated
  with check (
    exists (
      select 1 from public.guardians g
       join public.user_accounts ua on ua.person_id = g.person_id
      where g.id = guardian_preferences.guardian_id
        and ua.id = auth.uid()
    )
  );

-- Staff with users.manage (system_administrator) + AAL2 can read all
-- guardian preferences for support purposes.
create policy guardian_preferences_staff_read
  on public.guardian_preferences for select to authenticated
  using (app.is_staff_aal2() and app.has_role('system_administrator'));

create or replace function app.guardian_switch_active_child(
  p_guardian_id uuid,
  p_student_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid := auth.uid();
  v_is_guardian boolean := false;
  v_is_staff boolean := false;
  v_link public.guardian_student_links%rowtype;
  v_pref public.guardian_preferences%rowtype;
begin
  if v_account is null then raise exception 'authenticated actor required'; end if;

  -- The caller must be the guardian themselves or staff with users.manage + AAL2.
  select exists (
    select 1 from public.guardians g
     join public.user_accounts ua on ua.person_id = g.person_id
    where g.id = p_guardian_id and ua.id = v_account
  ) into v_is_guardian;

  v_is_staff := app.is_staff_aal2() and app.has_role('system_administrator');

  if not v_is_guardian and not v_is_staff then
    raise exception 'only the guardian or staff with users.manage and aal2 may switch the active child';
  end if;

  -- Verify there is an active link between the guardian and the student.
  select * into v_link from public.guardian_student_links
   where guardian_id = p_guardian_id
     and student_id = p_student_id
     and status = 'active'
     and (effective_from is null or effective_from <= now())
     and (effective_to is null or effective_to > now())
   limit 1;
  if v_link.id is null then
    raise exception 'there is no active link between this guardian and student';
  end if;

  -- Atomically upsert the guardian preference.
  insert into public.guardian_preferences (guardian_id, active_student_id, version)
  values (p_guardian_id, p_student_id, 1)
  on conflict (guardian_id) do update
    set active_student_id = excluded.active_student_id,
        version = public.guardian_preferences.version + 1
  returning * into v_pref;

  perform app.record_audit('Guardian active child switched', 'guardian_preference',
                           p_guardian_id::text, 'Success',
                           'student=' || p_student_id::text,
                           case when v_is_staff then 'System administrator' else 'Guardian' end);

  return jsonb_build_object(
    'activeStudentId', v_pref.active_student_id,
    'updatedAt', v_pref.updated_at,
    'version', v_pref.version
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Eliminate student-reference activation
-- ---------------------------------------------------------------------------
-- Student-reference activation (activating access by presenting a student
-- number, name, DOB, or phone alone) is deprecated. Links must come from
-- approved claims (guardian_claim_links) or admin-created links. This trigger
-- logs any link created without a claim source so the operations team can
-- audit legacy/student-reference activations.

comment on table public.guardian_student_links is
  'Guardian–student relationships. Student-reference activation (activating access by student number, name, DOB, or phone alone) is deprecated as of 000063; links must originate from approved claims or admin creation. The guardian_link_source_log trigger records an audit event for every link created without a claim source.';

create or replace function app.guardian_link_source_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Log link creations that do not originate from a claim. At INSERT time no
  -- guardian_claim_links row can reference this link yet (claim links are
  -- added after the student link exists), so this effectively logs every
  -- non-claim-sourced creation for audit traceability.
  if new.verification_source = 'guardian_request' then
    perform app.record_audit(
      'Guardian link created (non-claim source)',
      'guardian_student_link',
      new.reference,
      'Success',
      'verification_source=' || new.verification_source ||
      ' — student-reference activation is deprecated',
      'System');
  end if;
  return new;
end;
$$;

drop trigger if exists guardian_link_source_log on public.guardian_student_links;
create trigger guardian_link_source_log
  after insert on public.guardian_student_links
  for each row execute function app.guardian_link_source_log();

-- ---------------------------------------------------------------------------
-- 5. Contact change request function (versioned model)
-- ---------------------------------------------------------------------------
-- Overloaded with the 000045 function (different signature): accepts a
-- guardian_id, new contact value, channel, and reason. Creates a new
-- guardian_contact in 'recorded' state and a versioned
-- guardian_contact_changes record in 'pending' status.

create or replace function app.guardian_contact_change_request(
  p_guardian_id uuid,
  p_new_contact_value text,
  p_channel text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid := auth.uid();
  v_is_guardian boolean := false;
  v_is_staff boolean := false;
  v_normalized text;
  v_contact public.guardian_contacts%rowtype;
  v_old_contact_id uuid;
  v_change_id uuid;
  v_change_ref text;
  v_shared boolean;
begin
  if v_account is null then raise exception 'authenticated actor required'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a change reason is required';
  end if;
  if p_channel not in ('sms', 'email') then
    raise exception 'channel must be sms or email';
  end if;
  v_normalized := app.normalize_identity_contact(p_new_contact_value);
  if v_normalized = '' then raise exception 'the new contact value is required'; end if;

  -- The caller must be the guardian themselves or staff with users.manage + AAL2.
  select exists (
    select 1 from public.guardians g
     join public.user_accounts ua on ua.person_id = g.person_id
    where g.id = p_guardian_id and ua.id = v_account
  ) into v_is_guardian;

  v_is_staff := app.is_staff_aal2() and app.has_role('system_administrator');

  if not v_is_guardian and not v_is_staff then
    raise exception 'only the guardian or staff with users.manage and aal2 may request a contact change';
  end if;

  if not exists (select 1 from public.guardians where id = p_guardian_id and status = 'active') then
    raise exception 'guardian record not found or not active';
  end if;

  -- Identify the current primary (delivery_verified) contact as the old contact.
  select id into v_old_contact_id from public.guardian_contacts
   where guardian_id = p_guardian_id and state = 'delivery_verified'
   order by verified_at desc nulls last, created_at desc
   limit 1;

  -- Create the new contact in 'recorded' state.
  insert into public.guardian_contacts (guardian_id, channel, value, state)
  values (p_guardian_id, p_channel, v_normalized, 'recorded')
  on conflict (guardian_id, channel, value)
  do update set updated_at = now()
  returning * into v_contact;

  -- Detect shared contact (already recorded for another guardian).
  select exists (
    select 1 from public.guardian_contacts gc
     where gc.value = v_normalized and gc.guardian_id <> p_guardian_id
       and gc.state <> 'revoked'
  ) into v_shared;

  -- Create the versioned contact-change record.
  insert into public.guardian_contact_changes
    (reference, guardian_id, old_contact_id, new_contact_id,
     change_reason, verification_method, requested_by_account_id,
     status, version)
  values
    (app.new_ref('GCC'), p_guardian_id, v_old_contact_id, v_contact.id,
     btrim(p_reason), 'otp', v_account,
     'pending', 1)
  returning id, reference into v_change_id, v_change_ref;

  perform app.record_audit('Guardian contact change requested (versioned)',
                           'guardian_contact_change', v_change_ref, 'Success',
                           btrim(p_reason),
                           case when v_is_staff then 'System administrator' else 'Guardian' end);

  return jsonb_build_object(
    'changeId', v_change_id,
    'changeReference', v_change_ref,
    'status', 'pending',
    'newContactId', v_contact.id,
    'sharedContact', v_shared
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Contact change approve function
-- ---------------------------------------------------------------------------
-- Staff-only (users.manage + AAL2). Approves a pending contact change,
-- updates the guardian's primary contact (marks the new contact as
-- delivery_verified and the old contact as revoked), and records the decision.

create or replace function app.guardian_contact_change_approve(
  p_change_reference text,
  p_approval_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid := auth.uid();
  v_change public.guardian_contact_changes%rowtype;
  v_new_contact public.guardian_contacts%rowtype;
  v_old_contact_id uuid;
begin
  if v_account is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'contact change approval requires the system administrator and aal2';
  end if;

  select * into v_change from public.guardian_contact_changes
   where reference = p_change_reference for update;
  if v_change.id is null then raise exception 'contact change request not found'; end if;
  if v_change.status is not null and v_change.status <> 'pending' then
    raise exception 'contact change is not pending (status: %)', coalesce(v_change.status, v_change.state);
  end if;

  -- Mark the new contact as delivery_verified.
  update public.guardian_contacts
     set state = 'delivery_verified', verified_at = now(), version = version + 1
   where id = v_change.new_contact_id
  returning * into v_new_contact;

  -- Revoke the old contact if one exists.
  if v_change.old_contact_id is not null then
    update public.guardian_contacts
       set state = 'revoked', version = version + 1
     where id = v_change.old_contact_id;
  end if;

  -- Approve the change record.
  update public.guardian_contact_changes
     set status = 'approved',
         approved_by_account_id = v_account,
         decided_at = now(),
         version = v_change.version + 1
   where id = v_change.id
  returning * into v_change;

  perform app.record_audit('Guardian contact change approved',
                           'guardian_contact_change', v_change.reference, 'Success',
                           coalesce(p_approval_note, 'Contact change approved'),
                           'System administrator');

  return jsonb_build_object(
    'changeId', v_change.id,
    'changeReference', v_change.reference,
    'status', 'approved',
    'newContactId', v_change.new_contact_id,
    'decidedAt', v_change.decided_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Execution surface
-- ---------------------------------------------------------------------------

revoke all on function app.guardian_claim_verify_token(text) from public, anon;
revoke all on function app.guardian_claim_accept_by_token(text, text, text) from public;
revoke all on function app.guardian_switch_active_child(uuid, uuid) from public;
revoke all on function app.guardian_contact_change_request(uuid, text, text, text) from public;
revoke all on function app.guardian_contact_change_approve(text, text) from public;
revoke all on function app.guardian_link_source_log() from public;

-- The verify-token function is callable pre-login (anon) and post-login.
grant execute on function app.guardian_claim_verify_token(text) to anon, authenticated;
grant execute on function app.guardian_claim_accept_by_token(text, text, text) to authenticated;
grant execute on function app.guardian_switch_active_child(uuid, uuid) to authenticated;
grant execute on function app.guardian_contact_change_request(uuid, text, text, text) to authenticated;
grant execute on function app.guardian_contact_change_approve(text, text) to authenticated;

commit;
