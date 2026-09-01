-- =============================================================================
-- 000045 — Guardian account claims, campaigns, and applicant upgrade
--
-- Guardian onboarding is school-first: an import or enrollment conversion
-- creates/matches the student, guardian person, guardian record, contacts,
-- enrollment, and relationship; the school then issues a hashed, single-use,
-- expiring claim bound to one guardian, one recorded contact, one provider
-- subject, and an explicit approved link set. A student number, name, date
-- of birth, or phone alone never activates access.
--
-- Real SMS/email dispatch remains BLOCKED until TRAI/DLT sender registration
-- and provider approval; the provider boundary is compensation-safe.
-- =============================================================================

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Campaigns and claim invitations
-- ---------------------------------------------------------------------------

create table public.guardian_campaigns (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('CMP'),
  label             text not null,
  state             text not null default 'draft'
                    check (state in ('draft', 'open', 'closed')),
  academic_year_id  uuid references public.academic_years(id) on delete restrict,
  delivery_channel  text not null default 'sms'
                    check (delivery_channel in ('sms', 'email')),
  eligible_count    int not null default 0,
  missing_contact_count int not null default 0,
  shared_contact_count int not null default 0,
  created_by_account_id uuid not null references public.user_accounts(id) on delete restrict,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index guardian_campaigns_state_idx on public.guardian_campaigns (state, created_at);
create trigger guardian_campaigns_touch before update on public.guardian_campaigns
  for each row execute function app.touch_updated_at();

create table public.guardian_claim_invitations (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('GCL'),
  campaign_id       uuid references public.guardian_campaigns(id) on delete restrict,
  guardian_id       uuid not null references public.guardians(id) on delete restrict,
  guardian_contact_id uuid not null references public.guardian_contacts(id) on delete restrict,
  channel           text not null check (channel in ('sms', 'email')),
  secret_hash       text not null,
  status            text not null default 'pending'
                    check (status in ('pending','dispatched','claimed','expired','revoked','failed')),
  expires_at        timestamptz not null,
  claimed_at        timestamptz,
  provider_subject  uuid references auth.users(id) on delete restrict,
  consent_version   int not null default 1,
  use_count         int not null default 0,
  created_by_account_id uuid not null references public.user_accounts(id) on delete restrict,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index guardian_claim_invitations_guardian_idx on public.guardian_claim_invitations (guardian_id, status);
create index guardian_claim_invitations_hash_idx on public.guardian_claim_invitations (secret_hash);
create unique index guardian_claim_invitations_provider_subject_uidx
  on public.guardian_claim_invitations (provider_subject)
  where provider_subject is not null and status in ('pending', 'dispatched');
create trigger guardian_claim_invitations_touch before update on public.guardian_claim_invitations
  for each row execute function app.touch_updated_at();

-- Exact preverified links a claim may activate: the claim never widens scope.
create table public.guardian_claim_links (
  claim_id          uuid not null references public.guardian_claim_invitations(id) on delete cascade,
  link_id           uuid not null references public.guardian_student_links(id) on delete restrict,
  primary key (claim_id, link_id)
);

create table public.guardian_claim_deliveries (
  id                uuid primary key default gen_random_uuid(),
  claim_id          uuid not null references public.guardian_claim_invitations(id) on delete cascade,
  channel           text not null check (channel in ('sms', 'email')),
  state             text not null default 'queued'
                    check (state in ('queued','sent','delivered','failed','suppressed')),
  attempts          int not null default 0,
  last_attempt_at   timestamptz,
  last_error        text,
  created_at        timestamptz not null default now()
);

create index guardian_claim_deliveries_claim_idx on public.guardian_claim_deliveries (claim_id, state);

-- Contact-change requests: reauthentication + new-contact proof required.
create table public.guardian_contact_changes (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.user_accounts(id) on delete cascade,
  guardian_contact_id uuid not null references public.guardian_contacts(id) on delete restrict,
  pending_value     text not null,
  state             text not null default 'pending'
                    check (state in ('pending','verified','review_required','rejected')),
  review_reason     text,
  requested_at      timestamptz not null default now(),
  decided_at        timestamptz,
  decided_by_account_id uuid references public.user_accounts(id) on delete restrict
);

create index guardian_contact_changes_account_idx on public.guardian_contact_changes (account_id, state);

-- ---------------------------------------------------------------------------
-- RLS: Administrator/service only; claimants act through commands only.
-- ---------------------------------------------------------------------------

alter table public.guardian_campaigns enable row level security;
alter table public.guardian_claim_invitations enable row level security;
alter table public.guardian_claim_links enable row level security;
alter table public.guardian_claim_deliveries enable row level security;
alter table public.guardian_contact_changes enable row level security;

revoke all on public.guardian_campaigns, public.guardian_claim_invitations,
  public.guardian_claim_links, public.guardian_claim_deliveries, public.guardian_contact_changes
  from anon, authenticated;
grant select, insert, update on public.guardian_campaigns, public.guardian_claim_invitations,
  public.guardian_claim_links, public.guardian_claim_deliveries, public.guardian_contact_changes
  to service_role;
-- The Administrator reads claim/campaign projections for the operations queue.
grant select on public.guardian_campaigns, public.guardian_claim_invitations,
  public.guardian_claim_deliveries to authenticated;

create policy guardian_campaigns_service on public.guardian_campaigns
  for all to service_role using (true) with check (true);
create policy guardian_claims_service on public.guardian_claim_invitations
  for all to service_role using (true) with check (true);
create policy guardian_claim_links_service on public.guardian_claim_links
  for all to service_role using (true) with check (true);
create policy guardian_claim_deliveries_service on public.guardian_claim_deliveries
  for all to service_role using (true) with check (true);
create policy guardian_contact_changes_service on public.guardian_contact_changes
  for all to service_role using (true) with check (true);

-- Administrator read policies for the claim operations queue.
create policy guardian_campaigns_admin_read on public.guardian_campaigns
  for select to authenticated
  using (app.is_staff_aal2() and app.has_role('system_administrator'));
create policy guardian_claims_admin_read on public.guardian_claim_invitations
  for select to authenticated
  using (app.is_staff_aal2() and app.has_role('system_administrator'));
create policy guardian_claim_deliveries_admin_read on public.guardian_claim_deliveries
  for select to authenticated
  using (app.is_staff_aal2() and app.has_role('system_administrator'));

-- ---------------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------------

-- Verified contact claims from the Auth JWT: email for email OTP, phone for
-- SMS OTP (Supabase places the verified number in the phone claim).
create or replace function app.auth_claim_phone()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(btrim(coalesce(auth.jwt() ->> 'phone', '')), '')
$$;

-- Administrator campaign create with eligibility preview.
create or replace function app.guardian_campaign_create(
  p_label text,
  p_academic_year_id uuid,
  p_delivery_channel text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_campaign public.guardian_campaigns%rowtype;
  v_eligible int;
  v_missing int;
  v_shared int;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'guardian campaigns require the system administrator and aal2';
  end if;
  if p_label is null or length(btrim(p_label)) < 3 then
    raise exception 'campaign label is required';
  end if;
  if p_delivery_channel not in ('sms', 'email') then
    raise exception 'delivery channel must be sms or email';
  end if;

  select count(*),
         count(*) filter (where not exists (
           select 1 from public.guardian_contacts gc
            where gc.guardian_id = g.id and gc.state = 'recorded')),
         count(*) filter (where exists (
           select 1 from public.guardian_contacts gc
            where gc.guardian_id = g.id and gc.shared_contact_flag))
    into v_eligible, v_missing, v_shared
    from public.guardians g
   where g.status = 'active';

  insert into public.guardian_campaigns
    (label, academic_year_id, delivery_channel, eligible_count,
     missing_contact_count, shared_contact_count, created_by_account_id, state)
  values
    (btrim(p_label), p_academic_year_id, p_delivery_channel,
     v_eligible, v_missing, v_shared, auth.uid(), 'open')
  returning * into v_campaign;

  perform app.record_audit('Guardian campaign created', 'guardian_campaign', v_campaign.reference, 'Success',
                           btrim(p_label), 'System administrator');
  return jsonb_build_object('campaignId', v_campaign.id, 'reference', v_campaign.reference,
                            'state', v_campaign.state, 'eligibleCount', v_eligible,
                            'missingContactCount', v_missing, 'sharedContactCount', v_shared);
end
$$;

-- Administrator claim create: binds one guardian + one recorded contact +
-- the exact approved link set. Stores only the hash of a 192-bit secret.
create or replace function app.guardian_claim_create(
  p_guardian_id uuid,
  p_guardian_contact_id uuid,
  p_channel text,
  p_expires_at timestamptz,
  p_campaign_id uuid default null,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_claim public.guardian_claim_invitations%rowtype;
  v_secret text;
  v_contact public.guardian_contacts%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'guardian claims require the system administrator and aal2';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a claim reason is required';
  end if;
  if p_channel not in ('sms', 'email') then raise exception 'channel must be sms or email'; end if;
  if p_expires_at is null or p_expires_at <= now() then raise exception 'invalid claim expiry'; end if;
  select * into v_contact from public.guardian_contacts where id = p_guardian_contact_id for update;
  if v_contact.id is null or v_contact.guardian_id <> p_guardian_id then
    raise exception 'the recorded contact does not belong to this guardian';
  end if;
  if v_contact.state not in ('recorded', 'delivery_verified') then
    raise exception 'the contact is not claimable (state: %)', v_contact.state;
  end if;
  if not exists (
    select 1 from public.guardian_student_links
     where guardian_id = p_guardian_id and status = 'active'
  ) then
    raise exception 'the guardian has no active links to claim';
  end if;
  if exists (
    select 1 from public.guardian_claim_invitations
     where guardian_id = p_guardian_id and status in ('pending', 'dispatched')
  ) then
    raise exception 'a pending claim already exists for this guardian';
  end if;

  -- 244 bits of randomness from two UUIDv4s (pgcrypto's gen_random_bytes is
  -- schema-dependent across environments; this matches the 000042 pattern).
  v_secret := gen_random_uuid()::text || gen_random_uuid()::text;
  insert into public.guardian_claim_invitations
    (campaign_id, guardian_id, guardian_contact_id, channel, secret_hash,
     status, expires_at, created_by_account_id)
  values
    (p_campaign_id, p_guardian_id, p_guardian_contact_id, p_channel,
     app.hash_invitation_secret(v_secret), 'pending', p_expires_at, auth.uid())
  returning * into v_claim;

  -- Exact approved link set: every active link at claim-creation time.
  insert into public.guardian_claim_links (claim_id, link_id)
  select v_claim.id, l.id from public.guardian_student_links l
   where l.guardian_id = p_guardian_id and l.status = 'active';

  perform app.record_audit('Guardian claim created', 'guardian_claim_invitation', v_claim.reference,
                           'Success', btrim(p_reason), 'System administrator');
  -- The plaintext secret is returned ONCE to the inviting administrator for
  -- out-of-band delivery through the approved channel; never stored.
  return jsonb_build_object('claimId', v_claim.id, 'reference', v_claim.reference,
                            'channel', v_claim.channel, 'status', v_claim.status,
                            'expiresAt', v_claim.expires_at, 'oneTimeSecret', v_secret);
end
$$;

-- Service-role dispatch record (the real provider call stays blocked).
create or replace function app.guardian_claim_mark_dispatched(
  p_claim_reference text,
  p_provider_subject uuid,
  p_provider_ref text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_claim public.guardian_claim_invitations%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' and not (
    app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'claim dispatch requires the service worker or the administrator';
  end if;
  select * into v_claim from public.guardian_claim_invitations
   where reference = p_claim_reference for update;
  if v_claim.id is null then raise exception 'guardian claim not found'; end if;
  if v_claim.status not in ('pending', 'dispatched') then
    raise exception 'guardian claim is not dispatchable (state: %)', v_claim.status;
  end if;
  update public.guardian_claim_invitations
     set status = 'dispatched', provider_subject = p_provider_subject
   where id = v_claim.id;
  insert into public.guardian_claim_deliveries (claim_id, channel, state, attempts, last_attempt_at)
  values (v_claim.id, v_claim.channel, 'sent', 1, now());
  perform app.record_audit('Guardian claim dispatched', 'guardian_claim_invitation', v_claim.reference, 'Success');
  return jsonb_build_object('claimRef', v_claim.reference, 'status', 'dispatched',
                            'providerRef', p_provider_ref);
end
$$;

-- Authenticated claim acceptance: verifies token, expiry, provider subject,
-- verified contact claim, and exact links; creates or reuses ONE account,
-- grants Guardian once, marks the contact delivery-verified, activates only
-- the approved links, bumps revalidation, audits, and enqueues one welcome.
create or replace function app.guardian_claim_accept(
  p_claim_reference text,
  p_given_name text,
  p_family_name text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
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
  if v_email is null and v_phone is null then raise exception 'a verified contact claim is required'; end if;
  if p_given_name is null or btrim(p_given_name) = '' or p_family_name is null or btrim(p_family_name) = '' then
    raise exception 'name is required';
  end if;

  select * into v_claim from public.guardian_claim_invitations
   where reference = p_claim_reference for update;
  if v_claim.id is null then raise exception 'guardian claim not found'; end if;
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
  -- The verified claim must match the bound contact by channel: email claims
  -- match the recorded email; SMS claims match the recorded E.164 number.
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
    values (auth.uid(), 'guardian', 'active', v_claim.created_by_account_id, 'Guardian claim acceptance');
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
  perform app.record_audit('Guardian claim accepted', 'guardian_claim_invitation', v_claim.reference,
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
end
$$;

-- Administrator claim revoke.
create or replace function app.guardian_claim_revoke(
  p_claim_reference text,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_claim public.guardian_claim_invitations%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'guardian claim revoke requires the system administrator and aal2';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a revoke reason is required';
  end if;
  select * into v_claim from public.guardian_claim_invitations
   where reference = p_claim_reference for update;
  if v_claim.id is null then raise exception 'guardian claim not found'; end if;
  if v_claim.status in ('claimed', 'revoked') then
    raise exception 'guardian claim is already closed';
  end if;
  update public.guardian_claim_invitations set status = 'revoked' where id = v_claim.id;
  perform app.record_audit('Guardian claim revoked', 'guardian_claim_invitation', v_claim.reference,
                           'Success', btrim(p_reason), 'System administrator');
  return jsonb_build_object('claimRef', v_claim.reference, 'status', 'revoked');
end
$$;

-- Authenticated contact-change request (reauthentication assumed by route).
create or replace function app.guardian_contact_change_request(
  p_new_contact text,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_guardian public.guardians%rowtype;
  v_contact public.guardian_contacts%rowtype;
  v_normalized text := app.normalize_identity_contact(p_new_contact);
  v_shared boolean;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required';
  end if;
  if v_normalized = '' then raise exception 'the new contact is required'; end if;
  select g.* into v_guardian from public.guardians g
   join public.user_accounts ua on ua.person_id = g.person_id
   where ua.id = auth.uid() for update;
  if v_guardian.id is null then raise exception 'no guardian record for this account'; end if;

  select * into v_contact from public.guardian_contacts
   where guardian_id = v_guardian.id and state in ('recorded', 'delivery_verified')
   order by created_at limit 1 for update;
  if v_contact.id is null then
    insert into public.guardian_contacts (guardian_id, channel, value, state)
    values (v_guardian.id,
            case when position('@' in v_normalized) > 0 then 'email' else 'sms' end,
            v_normalized, 'recorded')
    returning * into v_contact;
  end if;

  select exists (
    select 1 from public.guardian_contacts gc
     where gc.value = v_normalized and gc.guardian_id <> v_guardian.id
       and gc.state <> 'revoked'
  ) into v_shared;

  insert into public.guardian_contact_changes
    (account_id, guardian_contact_id, pending_value, state, review_reason)
  values
    (auth.uid(), v_contact.id, v_normalized,
     case when v_shared then 'review_required' else 'pending' end,
     case when v_shared then 'The new contact is already recorded for another guardian — school review required.' else null end)
  returning reference into v_contact;

  perform app.record_audit('Guardian contact change requested', 'guardian_contact', v_contact.id::text,
                           'Success', btrim(p_reason), 'Guardian');
  return jsonb_build_object('contactId', v_contact.id,
                            'state', case when v_shared then 'review_required' else 'pending' end,
                            'sharedContact', v_shared);
end
$$;

-- Administrator lists.
create or replace function app.guardian_claim_list()
returns setof jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'claimId', c.id, 'reference', c.reference, 'status', c.status,
    'channel', c.channel, 'guardianId', c.guardian_id,
    'expiresAt', c.expires_at, 'claimedAt', c.claimed_at,
    'campaignRef', (select gc.reference from public.guardian_campaigns gc where gc.id = c.campaign_id),
    'createdAt', c.created_at)
    from public.guardian_claim_invitations c
   where app.is_staff_aal2() and app.has_role('system_administrator')
   order by c.created_at desc
$$;

-- ---------------------------------------------------------------------------
-- Execution surface
-- ---------------------------------------------------------------------------

revoke all on function app.guardian_campaign_create(text, uuid, text) from public;
revoke all on function app.guardian_claim_create(uuid, uuid, text, timestamptz, uuid, text) from public;
revoke all on function app.guardian_claim_mark_dispatched(text, uuid, text) from public;
revoke all on function app.guardian_claim_accept(text, text, text) from public;
revoke all on function app.guardian_claim_revoke(text, text) from public;
revoke all on function app.guardian_contact_change_request(text, text) from public;
revoke all on function app.guardian_claim_list() from public;

grant execute on function app.guardian_campaign_create(text, uuid, text) to authenticated;
grant execute on function app.guardian_claim_create(uuid, uuid, text, timestamptz, uuid, text) to authenticated;
grant execute on function app.guardian_claim_mark_dispatched(text, uuid, text) to authenticated;
grant execute on function app.guardian_claim_accept(text, text, text) to authenticated;
grant execute on function app.guardian_claim_revoke(text, text) to authenticated;
grant execute on function app.guardian_contact_change_request(text, text) to authenticated;
grant execute on function app.guardian_claim_list() to authenticated;

commit;
