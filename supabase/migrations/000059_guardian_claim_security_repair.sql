-- =============================================================================
-- 000059 — Guardian claim security repair: token verification, contact
-- change fix, enrollment binding for both branches
--
-- Forward-only repair of live Phase 5 defects:
--   1. guardian_claim_accept never verified the one-time secret hash.
--   2. guardian_contact_change_request had an invalid RETURNING reference
--      into a mismatched row type.
--   3. guardian_claim_mark_dispatched could rebind an already-dispatched
--      claim to a different subject.
--   4. Account reuse logic was inconsistent for email vs phone channels.
--   5. enrollment_convert only reconciled the guardian on the fresh-create
--      branch; the matched-existing branch skipped guardian/grant/contact.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Claim acceptance: verify the token hash
-- ---------------------------------------------------------------------------

create or replace function app.guardian_claim_accept(
  p_claim_reference text,
  p_given_name text,
  p_family_name text,
  p_one_time_secret text default null
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
  v_verified_contact text;
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

  -- Verify the one-time secret: the claimant must present the token that
  -- hashes to the stored secret_hash. Without this, the claim reference
  -- alone would be sufficient — a security defect.
  if p_one_time_secret is null or length(btrim(p_one_time_secret)) < 16 then
    raise exception 'the one-time claim secret is required';
  end if;
  if app.hash_invitation_secret(btrim(p_one_time_secret)) <> v_claim.secret_hash then
    raise exception 'the one-time claim secret does not match';
  end if;

  select * into v_contact from public.guardian_contacts where id = v_claim.guardian_contact_id for update;
  if v_contact.id is null then raise exception 'the recorded contact no longer exists'; end if;
  -- The verified claim must match the bound contact by channel.
  if v_claim.channel = 'email' then
    if v_email is null or app.normalize_identity_contact(v_contact.value) <> app.normalize_identity_contact(v_email) then
      raise exception 'the verified contact does not match the claim';
    end if;
    v_verified_contact := app.normalize_identity_contact(v_email);
  else
    if v_phone is null or app.normalize_identity_contact(v_contact.value) <> app.normalize_identity_contact(v_phone) then
      raise exception 'the verified contact does not match the claim';
    end if;
    v_verified_contact := app.normalize_identity_contact(v_phone);
  end if;

  select * into v_guardian from public.guardians where id = v_claim.guardian_id for update;
  if v_guardian.id is null or v_guardian.status <> 'active' then
    raise exception 'the guardian record is not active';
  end if;

  -- Create or reuse exactly one account on the guardian's person.
  select * into v_account from public.user_accounts where person_id = v_guardian.person_id for update;
  if v_account.id is not null then
    -- Existing account: the provider subject must match the account ID.
    if v_account.id <> auth.uid() then
      raise exception 'an account already exists for this guardian under a different identity';
    end if;
    if v_account.status in ('suspended', 'closed') then
      raise exception 'this account cannot be claimed';
    end if;
    v_person_id := v_account.person_id;
  else
    -- New account: check that no other account uses the same verified contact.
    if exists (
      select 1 from public.user_accounts
       where app.normalize_identity_contact(verified_contact) = v_verified_contact
    ) then
      raise exception 'an account already exists for this contact';
    end if;
    update public.people
       set given_name = coalesce(nullif(btrim(p_given_name), ''), given_name),
           family_name = coalesce(nullif(btrim(p_family_name), ''), family_name)
     where id = v_guardian.person_id;
    insert into public.user_accounts (id, person_id, status, verified_contact)
    values (auth.uid(), v_guardian.person_id, 'active', v_verified_contact)
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
    'reusedExistingAccount', v_account.id is not null and v_account.id = auth.uid() and v_claim.use_count > 0,
    'activatedLinkCount', v_activated,
    'contactVerifiedAt', now());
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Dispatch: one-time provider binding (rebinding denied)
-- ---------------------------------------------------------------------------

create or replace function app.guardian_claim_mark_dispatched(
  p_claim_reference text,
  p_provider_subject uuid,
  p_provider_ref text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_claim public.guardian_claim_invitations%rowtype;
begin
  if session_user <> 'service_role' and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    if auth.uid() is null then
      raise exception 'authenticated actor required';
    end if;
    if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
      raise exception 'claim dispatch requires the service worker or the administrator';
    end if;
  end if;
  select * into v_claim from public.guardian_claim_invitations
   where reference = p_claim_reference for update;
  if v_claim.id is null then raise exception 'guardian claim not found'; end if;
  if v_claim.status = 'dispatched' then
    -- Idempotent: the same subject can re-dispatch; a different subject cannot.
    if v_claim.provider_subject = p_provider_subject then
      return jsonb_build_object('claimRef', v_claim.reference, 'status', 'dispatched',
                                'providerRef', p_provider_ref);
    end if;
    raise exception 'guardian claim is already bound to a different provider subject';
  end if;
  if v_claim.status not in ('pending') then
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
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Contact change: fix the invalid RETURNING reference
-- ---------------------------------------------------------------------------

create or replace function app.guardian_contact_change_request(
  p_new_contact text,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_guardian public.guardians%rowtype;
  v_contact public.guardian_contacts%rowtype;
  v_change_id uuid;
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
  returning id into v_change_id;

  perform app.record_audit('Guardian contact change requested', 'guardian_contact', v_change_id::text,
                           'Success', btrim(p_reason), 'Guardian');
  return jsonb_build_object('changeId', v_change_id,
                            'state', case when v_shared then 'review_required' else 'pending' end,
                            'sharedContact', v_shared);
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Enrollment conversion: reconcile guardian on BOTH branches
-- ---------------------------------------------------------------------------

create or replace function app.enrollment_convert(p_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.admission_applications%rowtype;
  v_offer public.admission_offers%rowtype;
  v_invoice public.invoices%rowtype;
  v_window public.admission_windows%rowtype;
  v_section public.grade_sections%rowtype;
  v_existing public.enrollment_conversions%rowtype;
  v_candidate_student uuid;
  v_candidate_enrollment uuid;
  v_candidate_link uuid;
  v_review public.admission_duplicate_reviews%rowtype;
  v_person_id uuid;
  v_student_id uuid;
  v_enrollment_id uuid;
  v_guardian_id uuid;
  v_link_id uuid;
  v_enrolled int;
  v_result jsonb;
  v_readiness jsonb;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  select * into v_app from public.admission_applications where id = p_application_id for update;
  if v_app.id is null then raise exception 'application not found'; end if;
  if v_app.current_status = 'withdrawn' then raise exception 'withdrawn applications cannot be converted'; end if;
  if not (v_app.owner_account_id = auth.uid() or (app.is_staff_aal2() and app.has_role('admissions_approver'))) then
    raise exception 'not authorized to convert this application';
  end if;

  select * into v_existing from public.enrollment_conversions where application_id = p_application_id;
  if v_existing.id is not null then
    perform app.enqueue_outbox('email.enrollment_complete:' || v_app.reference, 'email.deliver', 'enrollment', v_existing.enrollment_id::text, jsonb_build_object('channel','email'));
    return v_existing.result;
  end if;

  select * into v_offer from public.admission_offers
   where application_id = p_application_id and response = 'accepted'
   order by created_at desc limit 1 for update;
  if v_offer.id is null then raise exception 'offer must be accepted before conversion'; end if;
  select * into v_invoice from public.invoices
   where applicant_ref = v_app.reference order by created_at desc limit 1 for update;
  select * into v_window from public.admission_windows
   where academic_year_id = v_offer.academic_year_id and grade_id = v_offer.grade_id
   order by version desc, created_at desc limit 1 for update;
  if v_window.id is null then raise exception 'admission placement window is not configured'; end if;
  select * into v_review from public.admission_duplicate_reviews where application_id = p_application_id for update;
  if v_review.id is not null and v_review.status = 'pending' then
    return jsonb_build_object('application', v_app.reference, 'status', 'manual_review_required', 'manualReviewRequired', true, 'duplicateReviewRef', v_review.reference, 'candidateStudent', v_review.candidate_student_id, 'matched_existing', false);
  elsif v_review.id is not null and v_review.status = 'rejected' then
    return jsonb_build_object('application', v_app.reference, 'status', 'manual_review_rejected', 'manualReviewRequired', true, 'duplicateReviewRef', v_review.reference, 'candidateStudent', v_review.candidate_student_id, 'matched_existing', false);
  end if;

  select * into v_readiness from app.enrollment_readiness(p_application_id);
  if coalesce((v_readiness ->> 'ready')::boolean, false) = false then
    raise exception 'enrollment readiness failed: %', coalesce(v_readiness ->> 'policyPendingKeys', v_readiness::text);
  end if;

  select * into v_section from public.grade_sections
   where academic_year_id = v_offer.academic_year_id and grade_id = v_offer.grade_id and status = 'active'
   order by section_label limit 1;
  if v_section.id is null then raise exception 'no grade section is configured for the offered grade'; end if;

  select count(*) into v_enrolled from public.enrollments e join public.grade_sections gs on gs.id = e.grade_section_id
   where e.academic_year_id = v_offer.academic_year_id and gs.grade_id = v_offer.grade_id and e.status = 'active';
  if v_window.capacity is null or v_enrolled >= v_window.capacity then raise exception 'admission capacity is unavailable'; end if;

  -- Reconcile the guardian record + grant for the applicant on BOTH branches.
  -- This ensures the matched-existing branch also gets the Guardian grant.
  insert into public.guardians (person_id, status)
  select ua.person_id, 'active' from public.user_accounts ua where ua.id = v_app.owner_account_id
  on conflict (person_id) do nothing;
  select g.id into v_guardian_id from public.guardians g
   join public.user_accounts ua on ua.person_id = g.person_id
   where ua.id = v_app.owner_account_id;
  if v_guardian_id is null then raise exception 'the applicant account has no provisionable guardian record'; end if;

  if not exists (
    select 1 from public.role_grants
     where account_id = v_app.owner_account_id and role_code = 'guardian' and status = 'active'
  ) then
    insert into public.role_grants (account_id, role_code, status, granted_by_account_id, reason)
    values (v_app.owner_account_id, 'guardian', 'active', auth.uid(), 'Enrollment conversion guardian binding');
  end if;

  -- Create-or-match: an already-active linked student belonging to the
  -- application owner with the same normalized name and offer placement.
  select s.id, e.id, l.id into v_candidate_student, v_candidate_enrollment, v_candidate_link
    from public.students s join public.people p on p.id = s.person_id
    join public.enrollments e on e.student_id = s.id and e.status = 'active' and e.academic_year_id = v_offer.academic_year_id
    join public.grade_sections gs on gs.id = e.grade_section_id and gs.grade_id = v_offer.grade_id
    join public.guardian_student_links l on l.student_id = s.id and l.status = 'active'
    join public.guardians g on g.id = l.guardian_id
    join public.user_accounts ua on ua.person_id = g.person_id and ua.id = v_app.owner_account_id
   where lower(regexp_replace(btrim(p.display_name), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(v_app.student_name), '\s+', ' ', 'g'))
   order by e.created_at limit 1;
  if v_candidate_student is not null then
    if not exists (select 1 from public.admission_identity_evidence ie where ie.application_id = p_application_id and ie.candidate_student_id = v_candidate_student and ie.status = 'verified' and ie.evidence_type in ('birth_certificate','school_reference','verified_document','guardian_reference','other')) then
      insert into public.admission_duplicate_reviews (application_id, candidate_student_id, reason)
      values (p_application_id, v_candidate_student, 'A same-name enrolled student requires verified identity evidence before matching.')
      on conflict (application_id) do update set updated_at = now(), version = public.admission_duplicate_reviews.version + 1
      returning * into v_review;
      update public.admission_applications set current_status = 'duplicate_review', version = version + 1 where id = p_application_id;
      insert into public.admission_events (application_id, event_type, visible_to_applicant, copy) values (p_application_id, 'duplicate_review', false, 'Manual duplicate review required');
      perform app.record_audit('Admission duplicate review required', 'admission_application', v_app.reference, 'Failed', 'Verified identity evidence is required before an existing student can be matched.');
      return jsonb_build_object('application', v_app.reference, 'status', 'manual_review_required', 'manualReviewRequired', true, 'duplicateReviewRef', v_review.reference, 'candidateStudent', v_candidate_student, 'matched_existing', false);
    end if;
    update public.invoices set student_id = v_candidate_student, enrollment_id = v_candidate_enrollment where id = v_invoice.id;
    update public.admission_applications set current_status = 'enrolled' where id = v_app.id;
    v_result := jsonb_build_object('application', v_app.reference, 'student', v_candidate_student, 'enrollment', v_candidate_enrollment, 'invoice', v_invoice.reference, 'guardian_link', v_candidate_link, 'matched_existing', true);
    insert into public.enrollment_conversions (application_id, student_id, enrollment_id, guardian_link_id, matched_existing, result) values (v_app.id, v_candidate_student, v_candidate_enrollment, v_candidate_link, true, v_result);
    insert into public.admission_events (application_id, event_type, visible_to_applicant, copy) values (v_app.id, 'enrolled', true, 'Enrollment complete — verified existing student match');
    perform app.record_audit('Enrollment conversion matched verified student', 'enrollment', v_candidate_enrollment::text, 'Success');
    perform app.enqueue_outbox('email.enrollment_complete:' || v_app.reference, 'email.deliver', 'enrollment', v_candidate_enrollment::text, jsonb_build_object('channel','email'));
    return v_result;
  end if;

  -- Fresh create path: student + enrollment + guardian link in ONE transaction.
  insert into public.people (given_name, family_name, display_name) values (v_app.student_name, '', v_app.student_name) returning id into v_person_id;
  insert into public.students (person_id, status) values (v_person_id, 'active') returning id into v_student_id;
  insert into public.enrollments (student_id, academic_year_id, grade_section_id, status) values (v_student_id, v_offer.academic_year_id, v_section.id, 'active') returning id into v_enrollment_id;

  insert into public.guardian_student_links
    (guardian_id, student_id, relationship_label, status, verification_source, approved_by_account_id, approved_at, effective_from)
  values
    (v_guardian_id, v_student_id, 'Parent', 'active', 'enrollment_invitation', auth.uid(), now(), now())
  returning id into v_link_id;

  update public.invoices set student_id = v_student_id, enrollment_id = v_enrollment_id where id = v_invoice.id;
  update public.admission_applications set current_status = 'enrolled' where id = v_app.id;
  v_result := jsonb_build_object('application', v_app.reference, 'student', v_student_id, 'enrollment', v_enrollment_id, 'invoice', v_invoice.reference, 'guardian_link', v_link_id, 'matched_existing', false);
  insert into public.enrollment_conversions (application_id, student_id, enrollment_id, guardian_link_id, matched_existing, result) values (v_app.id, v_student_id, v_enrollment_id, v_link_id, false, v_result);
  insert into public.admission_events (application_id, event_type, visible_to_applicant, copy) values (v_app.id, 'enrolled', true, 'Enrollment complete');
  perform app.record_audit('Enrollment conversion', 'enrollment', v_enrollment_id::text, 'Success');
  perform app.enqueue_outbox('email.enrollment_complete:' || v_app.reference, 'email.deliver', 'enrollment', v_enrollment_id::text, jsonb_build_object('channel','email'));
  return v_result;
end
$$;

revoke all on function app.enrollment_convert(uuid) from public, anon;
grant execute on function app.enrollment_convert(uuid) to authenticated;

revoke all on function app.guardian_claim_accept(text, text, text, text) from public, anon;
grant execute on function app.guardian_claim_accept(text, text, text, text) to authenticated;

commit;
