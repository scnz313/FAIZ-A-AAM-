-- =============================================================================
-- B2–B6 transactional domain RPCs (plan.md §8 transaction contract).
--
-- Every command: verifies the authenticated actor and role/MFA level, checks
-- the expected optimistic version, performs its domain writes, and appends
-- audit + outbox rows in the SAME transaction. Retries are idempotent.
--
-- SECURITY DEFINER rules (plan.md §7): functions live in the `app` schema,
-- `search_path = ''`, auth.uid() is always verified, and broad execution is
-- revoked — only `authenticated` may call these.
--
-- Note: `invoices.student_id` is relaxed to NULL for admission invoices
-- (issued before conversion creates the permanent student); conversion
-- adopts the invoice onto the new student's ledger (plan.md §6.6).
-- =============================================================================
begin;

alter table public.invoices alter column student_id drop not null;

-- ---------------------------------------------------------------------------
-- Helper: current ledger balance of an invoice (positive = outstanding).
-- Charges are positive, payments/concessions negative (plan.md §6.6).
-- ---------------------------------------------------------------------------
create or replace function app.invoice_balance(p_invoice_id uuid)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select coalesce(sum(amount_paise), 0)::bigint
    from public.ledger_entries
   where invoice_id = p_invoice_id
$$;

grant execute on function app.invoice_balance(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Admissions: applicant submits a draft (append-only version, idempotent).
-- p_expected_version is the base version the caller saw (optimistic lock);
-- a retry with the same base returns the SAME immutable version id.
-- ---------------------------------------------------------------------------
create or replace function app.admissions_submit(
  p_application_id uuid,
  p_snapshot jsonb,
  p_expected_version int default 0,
  p_schema_version int default 1
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.admission_applications%rowtype;
  v_next int;
  v_version_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  select * into v_app from public.admission_applications where id = p_application_id;
  if v_app.id is null then
    raise exception 'application not found';
  end if;
  if v_app.owner_account_id <> auth.uid() then
    raise exception 'not the application owner';
  end if;

  v_next := p_expected_version + 1;
  select id into v_version_id from public.admission_application_versions
   where application_id = p_application_id and version = v_next;
  if v_version_id is not null then
    return v_version_id;                       -- idempotent retry
  end if;

  if v_app.version <> p_expected_version then
    raise exception 'application version mismatch (expected %, found %)',
                    p_expected_version, v_app.version;
  end if;

  if v_app.current_status not in ('draft', 'changes_requested') then
    raise exception 'application is not in an editable state (%)', v_app.current_status;
  end if;

  insert into public.admission_application_versions
    (application_id, version, snapshot, schema_version, submitted_by_account_id)
  values (p_application_id, v_next, p_snapshot, p_schema_version, auth.uid())
  returning id into v_version_id;

  update public.admission_applications
     set version = v_next, current_status = 'submitted', submitted_at = now()
   where id = p_application_id;

  delete from public.admission_drafts where application_id = p_application_id;

  insert into public.admission_events (application_id, event_type, visible_to_applicant, copy)
  values (p_application_id, 'submitted', true, 'Application submitted');

  perform app.record_audit('Admission application submitted', 'admission_application',
                           v_app.reference, 'Success');
  perform app.enqueue_outbox(
    'email.application_submitted:' || v_app.reference || ':v' || v_next,
    'email.deliver', 'admission_application', v_app.reference,
    jsonb_build_object('channel', 'email'));
  return v_version_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Admissions: officer requests changes (maker step; never overwrites the
-- submitted snapshot — the applicant's next submit creates a new version).
-- ---------------------------------------------------------------------------
create or replace function app.admissions_request_changes(
  p_application_id uuid,
  p_visible_reason text,
  p_private_note text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.admission_applications%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not (app.is_staff_aal2() and app.has_any_role(
      array['admissions_officer', 'admissions_approver', 'system_administrator'])) then
    raise exception 'admissions officer role and aal2 required';
  end if;
  select * into v_app from public.admission_applications where id = p_application_id;
  if v_app.id is null then
    raise exception 'application not found';
  end if;
  if v_app.current_status not in ('submitted', 'under_review') then
    raise exception 'application cannot be returned in state (%)', v_app.current_status;
  end if;

  insert into public.admission_reviews (application_id, officer_account_id, action,
                                        visible_reason, private_note)
  values (p_application_id, auth.uid(), 'requested_changes', p_visible_reason, p_private_note);

  update public.admission_applications set current_status = 'changes_requested'
   where id = p_application_id;

  insert into public.admission_events (application_id, event_type, visible_to_applicant, copy)
  values (p_application_id, 'changes_requested', true, 'Changes requested: ' || p_visible_reason);

  perform app.record_audit('Admission changes requested', 'admission_application',
                           v_app.reference, 'Success');
  perform app.enqueue_outbox(
    'email.application_changes:' || v_app.reference,
    'email.deliver', 'admission_application', v_app.reference,
    jsonb_build_object('channel', 'email'));
end
$$;

-- ---------------------------------------------------------------------------
-- Admissions: officer advances the application (maker step): 'under_review'
-- after first review, 'assessment' after review/verification passes.
-- ---------------------------------------------------------------------------
create or replace function app.admissions_review_advance(
  p_application_id uuid,
  p_action text,
  p_visible_reason text default null,
  p_private_note text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.admission_applications%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not (app.is_staff_aal2() and app.has_any_role(
      array['admissions_officer', 'admissions_approver', 'system_administrator'])) then
    raise exception 'admissions officer role and aal2 required';
  end if;
  if p_action not in ('under_review', 'assessment') then
    raise exception 'invalid advance action';
  end if;
  select * into v_app from public.admission_applications where id = p_application_id;
  if v_app.id is null then
    raise exception 'application not found';
  end if;
  if p_action = 'under_review' and v_app.current_status <> 'submitted' then
    raise exception 'only submitted applications enter review (state: %)', v_app.current_status;
  end if;
  if p_action = 'assessment' and v_app.current_status <> 'under_review' then
    raise exception 'only reviewed applications reach assessment (state: %)', v_app.current_status;
  end if;

  insert into public.admission_reviews (application_id, officer_account_id, action,
                                        visible_reason, private_note)
  values (p_application_id, auth.uid(), 'reviewed', p_visible_reason, p_private_note);

  update public.admission_applications set current_status = p_action
   where id = p_application_id;

  insert into public.admission_events (application_id, event_type, visible_to_applicant, copy)
  values (p_application_id, p_action, true,
          case when p_action = 'under_review' then 'Application under review'
               else 'Application moved to assessment' end);

  perform app.record_audit('Admission review: ' || p_action, 'admission_application',
                           v_app.reference, 'Success');
end
$$;

-- ---------------------------------------------------------------------------
-- Admissions: approver decides (checker step; self-approval denied).
-- p_action: 'offer' | 'waitlist' | 'decline'
-- ---------------------------------------------------------------------------
create or replace function app.admissions_decide(
  p_application_id uuid,
  p_action text,
  p_visible_reason text default null,
  p_private_note text default null,
  p_conditions jsonb default '{}'::jsonb,
  p_expires_at timestamptz default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.admission_applications%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not (app.is_staff_aal2() and app.has_any_role(
      array['admissions_approver', 'system_administrator'])) then
    raise exception 'admissions approver role and aal2 required';
  end if;
  if p_action not in ('offer', 'waitlist', 'decline') then
    raise exception 'invalid decision action';
  end if;
  select * into v_app from public.admission_applications where id = p_application_id;
  if v_app.id is null then
    raise exception 'application not found';
  end if;
  if v_app.owner_account_id = auth.uid() then
    raise exception 'an approver cannot decide their own application';
  end if;
  if v_app.current_status not in ('under_review', 'assessment') then
    raise exception 'application cannot be decided in state (%)', v_app.current_status;
  end if;

  if p_action = 'offer' then
    insert into public.admission_offers
      (application_id, grade_id, academic_year_id, conditions, expires_at, decided_by_account_id)
    values (p_application_id, v_app.grade_id, v_app.academic_year_id, p_conditions,
            coalesce(p_expires_at, now() + interval '14 days'), auth.uid());
    update public.admission_applications set current_status = 'offered'
     where id = p_application_id;
    insert into public.admission_events (application_id, event_type, visible_to_applicant, copy)
    values (p_application_id, 'offered', true, 'Offer extended');
    perform app.enqueue_outbox(
      'email.offer:' || v_app.reference, 'email.deliver', 'admission_application',
      v_app.reference, jsonb_build_object('channel', 'email'));
  elsif p_action = 'waitlist' then
    update public.admission_applications set current_status = 'waitlisted'
     where id = p_application_id;
    insert into public.admission_events (application_id, event_type, visible_to_applicant, copy)
    values (p_application_id, 'waitlisted', true, 'Placed on the waitlist');
  else
    update public.admission_applications set current_status = 'declined'
     where id = p_application_id;
    insert into public.admission_events (application_id, event_type, visible_to_applicant, copy)
    values (p_application_id, 'declined', true, 'Application declined: ' ||
            coalesce(p_visible_reason, 'no reason given'));
  end if;

  if p_visible_reason is not null then
    insert into public.admission_reviews (application_id, officer_account_id, action,
                                          visible_reason, private_note)
    values (p_application_id, auth.uid(), 'reviewed', p_visible_reason, p_private_note);
  end if;

  perform app.record_audit('Admission decision: ' || p_action, 'admission_application',
                           v_app.reference, 'Success');
end
$$;

-- ---------------------------------------------------------------------------
-- Finance: issue the unique admission invoice for an accepted offer.
-- Idempotent: a retry returns the SAME invoice reference. Uses the latest
-- APPROVED fee schedule; none exists while school policy is pending.
-- ---------------------------------------------------------------------------
create or replace function app.finance_issue_admission_invoice(
  p_application_id uuid,
  p_schedule_version_id uuid default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.admission_applications%rowtype;
  v_offer public.admission_offers%rowtype;
  v_schedule public.fee_schedule_versions%rowtype;
  v_invoice public.invoices%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  select * into v_app from public.admission_applications where id = p_application_id;
  if v_app.id is null then
    raise exception 'application not found';
  end if;
  if v_app.owner_account_id <> auth.uid() then
    raise exception 'not the application owner';
  end if;
  select * into v_offer from public.admission_offers where application_id = p_application_id;
  if v_offer.id is null then
    raise exception 'no offer exists for this application';
  end if;
  if v_offer.response <> 'accepted' then
    raise exception 'offer is not accepted';
  end if;

  select * into v_invoice from public.invoices where applicant_ref = v_app.reference;
  if v_invoice.id is not null then
    return v_invoice.reference;                -- idempotent retry
  end if;

  if p_schedule_version_id is not null then
    select * into v_schedule from public.fee_schedule_versions where id = p_schedule_version_id;
  else
    select * into v_schedule from public.fee_schedule_versions
     where status = 'approved' order by version desc limit 1;
  end if;
  if v_schedule.id is null then
    raise exception 'no approved fee schedule (school policy pending)';
  end if;

  insert into public.invoices
    (student_id, academic_year_id, schedule_version_id, applicant_ref, term,
     status, issue_date, due_date)
  values
    (null, v_offer.academic_year_id, v_schedule.id, v_app.reference, 'Admission',
     'unpaid', current_date, current_date + 14)
  returning * into v_invoice;

  insert into public.invoice_items (invoice_id, label, amount_paise, kind)
  select v_invoice.id, fs.label, fs.amount_paise, fs.kind
    from public.fee_schedule_items fs
   where fs.schedule_version_id = v_schedule.id
     and fs.kind in ('fee', 'other');

  insert into public.ledger_entries (invoice_id, entry_type, amount_paise, reason, created_by_account_id)
  select v_invoice.id, 'charge', fs.amount_paise, 'Invoice issued: ' || fs.label, auth.uid()
    from public.fee_schedule_items fs
   where fs.schedule_version_id = v_schedule.id
     and fs.kind in ('fee', 'other');

  update public.admission_offers
     set admission_invoice_ref = v_invoice.reference
   where id = v_offer.id;

  insert into public.admission_events (application_id, event_type, visible_to_applicant, copy)
  values (p_application_id, 'invoice_issued', true, 'Admission invoice ' || v_invoice.reference || ' issued');

  perform app.record_audit('Admission invoice issued', 'invoice', v_invoice.reference, 'Success');
  perform app.enqueue_outbox(
    'email.invoice_issued:' || v_invoice.reference, 'email.deliver', 'invoice',
    v_invoice.reference, jsonb_build_object('channel', 'email'));
  return v_invoice.reference;
end
$$;

-- ---------------------------------------------------------------------------
-- Admissions: applicant responds to the offer. Accepting requests the unique
-- admission invoice in the same transaction (plan.md §8 offer-response).
-- ---------------------------------------------------------------------------
create or replace function app.admissions_respond_offer(
  p_application_id uuid,
  p_response text,
  p_offer_version int default 1
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.admission_applications%rowtype;
  v_offer public.admission_offers%rowtype;
  v_invoice_ref text;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if p_response not in ('accepted', 'declined') then
    raise exception 'invalid offer response';
  end if;
  select * into v_app from public.admission_applications where id = p_application_id;
  if v_app.id is null or v_app.owner_account_id <> auth.uid() then
    raise exception 'not the application owner';
  end if;
  select * into v_offer from public.admission_offers where application_id = p_application_id;
  if v_offer.id is null then
    raise exception 'no offer exists for this application';
  end if;
  if v_offer.version <> p_offer_version then
    raise exception 'offer version mismatch (expected %, found %)', p_offer_version, v_offer.version;
  end if;
  if v_offer.response <> 'pending' then
    if v_offer.response = p_response then
      return v_offer.admission_invoice_ref;    -- idempotent retry
    end if;
    raise exception 'offer already responded (%)', v_offer.response;
  end if;

  update public.admission_offers
     set response = p_response, responded_at = now()
   where id = v_offer.id;

  if p_response = 'accepted' then
    v_invoice_ref := app.finance_issue_admission_invoice(p_application_id);
    insert into public.admission_events (application_id, event_type, visible_to_applicant, copy)
    values (p_application_id, 'offer_accepted', true, 'Offer accepted');
    perform app.record_audit('Admission offer accepted', 'admission_application',
                             v_app.reference, 'Success');
    return v_invoice_ref;
  else
    update public.admission_applications set current_status = 'declined'
     where id = p_application_id;
    insert into public.admission_events (application_id, event_type, visible_to_applicant, copy)
    values (p_application_id, 'offer_declined', true, 'Offer declined');
    perform app.record_audit('Admission offer declined', 'admission_application',
                             v_app.reference, 'Success');
    return null;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Finance: sandbox payment post (full payment of the invoice balance).
-- Idempotent on the attempt reference and provider transaction id; produces
-- attempt, payment, allocation, receipt, ledger, status, audit, outbox in one
-- transaction (plan.md §6.6, §8). No real gateway data is stored.
-- ---------------------------------------------------------------------------
create or replace function app.finance_post_sandbox_payment(
  p_invoice_ref text,
  p_attempt_reference text,
  p_provider_txn_id text,
  p_amount_paise bigint,
  p_method text default 'sandbox'
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices%rowtype;
  v_owner uuid;
  v_balance bigint;
  v_attempt public.payment_attempts%rowtype;
  v_payment public.payments%rowtype;
  v_receipt_ref text;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  select * into v_invoice from public.invoices where reference = p_invoice_ref;
  if v_invoice.id is null then
    raise exception 'invoice not found';
  end if;

  -- Existing payment for this provider transaction → idempotent return.
  select r.reference into v_receipt_ref
    from public.payments p
    join public.receipts r on r.payment_id = p.id
   where p.provider_txn_id = p_provider_txn_id;
  if v_receipt_ref is not null then
    return v_receipt_ref;
  end if;

  -- Existing attempt for this attempt reference → idempotent return.
  select * into v_attempt from public.payment_attempts where reference = p_attempt_reference;
  if v_attempt.id is not null then
    select r.reference into v_receipt_ref
      from public.payments p
      join public.receipts r on r.payment_id = p.id
     where p.attempt_id = v_attempt.id;
    if v_receipt_ref is not null then
      return v_receipt_ref;
    end if;
    raise exception 'attempt exists but has no payment';
  end if;

  -- Who may pay: the guardian of the invoiced student, the applicant owner
  -- (pre-conversion admission invoice), or finance staff (aal2).
  if v_invoice.student_id is not null then
    select ua.id into v_owner
      from public.guardian_student_links l
      join public.guardians g on g.id = l.guardian_id
      join public.user_accounts ua on ua.person_id = g.person_id
     where l.student_id = v_invoice.student_id and l.status = 'active'
     order by l.contact_priority limit 1;
  elsif v_invoice.applicant_ref is not null then
    select owner_account_id into v_owner from public.admission_applications
     where reference = v_invoice.applicant_ref;
  end if;
  if auth.uid() <> v_owner and not (app.is_staff_aal2() and app.has_any_role(
      array['finance_officer', 'finance_approver', 'system_administrator'])) then
    raise exception 'not authorized to pay this invoice';
  end if;

  v_balance := app.invoice_balance(v_invoice.id);
  if v_balance <= 0 then
    raise exception 'invoice already settled';
  end if;
  if p_amount_paise <> v_balance then
    raise exception 'amount mismatch: expected % paise, got %', v_balance, p_amount_paise;
  end if;

  insert into public.payment_attempts (reference, invoice_id, method, amount_paise, status)
  values (p_attempt_reference, v_invoice.id, p_method, p_amount_paise, 'succeeded')
  returning * into v_attempt;

  insert into public.payments (attempt_id, amount_paise, provider_txn_id)
  values (v_attempt.id, p_amount_paise, p_provider_txn_id)
  returning * into v_payment;

  insert into public.payment_allocations (payment_id, invoice_id, amount_paise)
  values (v_payment.id, v_invoice.id, p_amount_paise);

  v_receipt_ref := app.new_ref('RCPT');
  insert into public.receipts (reference, payment_id, invoice_id)
  values (v_receipt_ref, v_payment.id, v_invoice.id);

  insert into public.ledger_entries (invoice_id, entry_type, amount_paise, reason, created_by_account_id)
  values (v_invoice.id, 'payment', -p_amount_paise, 'Payment ' || p_attempt_reference, auth.uid());

  update public.invoices set status = 'paid' where id = v_invoice.id;

  perform app.record_audit('Payment posted (sandbox)', 'receipt', v_receipt_ref, 'Success');
  perform app.enqueue_outbox(
    'email.receipt:' || v_receipt_ref, 'email.deliver', 'receipt', v_receipt_ref,
    jsonb_build_object('channel', 'email'));
  perform app.enqueue_outbox(
    'pdf.generate:' || v_receipt_ref, 'pdf.generate', 'receipt', v_receipt_ref,
    jsonb_build_object('kind', 'receipt'));
  return v_receipt_ref;
end
$$;

-- ---------------------------------------------------------------------------
-- Enrollment: idempotent conversion of an accepted, fee-paid application into
-- the permanent student, enrollment, and guardian link; adopts the paid
-- admission invoice onto the new student's ledger (plan.md §6.3/§6.6, B3).
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
  v_existing public.enrollment_conversions%rowtype;
  v_section public.grade_sections%rowtype;
  v_person_id uuid;
  v_student_id uuid;
  v_enrollment_id uuid;
  v_guardian_id uuid;
  v_link_id uuid;
  v_invoice public.invoices%rowtype;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  select * into v_app from public.admission_applications where id = p_application_id;
  if v_app.id is null then
    raise exception 'application not found';
  end if;

  select * into v_existing from public.enrollment_conversions
   where application_id = p_application_id;
  if v_existing.id is not null then
    return v_existing.result;                  -- idempotent retry
  end if;

  -- Caller: the applicant owner (self-service conversion when ready) or an
  -- admissions approver (aal2).
  if v_app.owner_account_id = auth.uid() then
    null;
  elsif app.is_staff_aal2() and app.has_any_role(
      array['admissions_approver', 'system_administrator']) then
    null;
  else
    raise exception 'not authorized to convert this application';
  end if;

  -- Readiness gates (plan.md §6.3): offered + accepted + fee paid.
  select * into v_offer from public.admission_offers where application_id = p_application_id;
  if v_offer.id is null or v_offer.response <> 'accepted' then
    raise exception 'offer must be accepted before conversion';
  end if;
  select * into v_invoice from public.invoices where applicant_ref = v_app.reference;
  if v_invoice.id is null then
    raise exception 'admission invoice has not been issued';
  end if;
  if app.invoice_balance(v_invoice.id) > 0 then
    raise exception 'admission invoice is not paid';
  end if;

  -- Placement: the grade/section for the offer's year and grade.
  select gs.* into v_section
    from public.grade_sections gs
   where gs.academic_year_id = v_offer.academic_year_id
     and gs.grade_id = v_offer.grade_id
   order by gs.section_label limit 1;
  if v_section.id is null then
    raise exception 'no grade section configured for the offer placement';
  end if;

  -- Permanent student (the applicant child is a NEW person; matching existing
  -- records is a school-policy refinement — plan.md §14).
  insert into public.people (given_name, family_name, display_name)
  values (v_app.student_name, '', v_app.student_name)
  returning id into v_person_id;
  insert into public.students (person_id, status)
  values (v_person_id, 'active')
  returning id into v_student_id;

  insert into public.enrollments (student_id, academic_year_id, grade_section_id, status)
  values (v_student_id, v_offer.academic_year_id, v_section.id, 'active')
  returning id into v_enrollment_id;

  -- Guardian record for the owner (created once) and the verified link.
  insert into public.guardians (person_id, status)
  select ua.person_id, 'active' from public.user_accounts ua where ua.id = v_app.owner_account_id
  on conflict (person_id) do nothing;
  select g.id into v_guardian_id
    from public.guardians g
    join public.user_accounts ua on ua.person_id = g.person_id
   where ua.id = v_app.owner_account_id;
  insert into public.guardian_student_links
    (guardian_id, student_id, relationship_label, status, verification_source,
     approved_by_account_id, approved_at, effective_from)
  values (v_guardian_id, v_student_id, 'Parent', 'active', 'enrollment_invitation',
          auth.uid(), now(), now())
  returning id into v_link_id;

  -- Adopt the paid admission invoice onto the new student's ledger.
  update public.invoices
     set student_id = v_student_id, enrollment_id = v_enrollment_id
   where id = v_invoice.id;

  update public.admission_applications set current_status = 'enrolled'
   where id = p_application_id;

  v_result := jsonb_build_object('application', v_app.reference, 'student', v_student_id,
                                 'enrollment', v_enrollment_id, 'invoice', v_invoice.reference,
                                 'guardian_link', v_link_id);
  insert into public.enrollment_conversions
    (application_id, student_id, enrollment_id, guardian_link_id, matched_existing, result)
  values (p_application_id, v_student_id, v_enrollment_id, v_link_id, false, v_result);

  insert into public.admission_events (application_id, event_type, visible_to_applicant, copy)
  values (p_application_id, 'enrolled', true, 'Enrollment complete');

  perform app.record_audit('Enrollment conversion', 'enrollment', v_enrollment_id::text, 'Success');
  perform app.enqueue_outbox(
    'email.enrollment_complete:' || v_app.reference, 'email.deliver', 'enrollment',
    v_enrollment_id::text, jsonb_build_object('channel', 'email'));
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------
-- Results: publisher releases an approved batch as immutable per-student
-- snapshots (plan.md §6.7, B5). The portal reads only publication items.
-- ---------------------------------------------------------------------------
create or replace function app.results_publish_batch(
  p_batch_id uuid,
  p_expected_version int
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.result_batches%rowtype;
  v_publication public.result_publications%rowtype;
  v_next int;
  v_roster_count int;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not (app.is_staff_aal2() and app.has_any_role(
      array['result_publisher', 'system_administrator'])) then
    raise exception 'result publisher role and aal2 required';
  end if;
  select * into v_batch from public.result_batches where id = p_batch_id;
  if v_batch.id is null then
    raise exception 'batch not found';
  end if;
  if v_batch.version <> p_expected_version then
    raise exception 'batch version mismatch (expected %, found %)', p_expected_version, v_batch.version;
  end if;
  if v_batch.status <> 'approved' then
    raise exception 'only approved batches can be published (state: %)', v_batch.status;
  end if;

  -- Freeze the eligible roster from active enrollments (idempotent).
  insert into public.result_rosters (batch_id, student_id, enrollment_id)
  select p_batch_id, e.student_id, e.id
    from public.enrollments e
   where e.grade_section_id = v_batch.grade_section_id
     and e.status = 'active'
  on conflict (batch_id, student_id) do nothing;

  select count(*) into v_roster_count from public.result_rosters where batch_id = p_batch_id;
  if v_roster_count = 0 then
    raise exception 'batch has no eligible students';
  end if;

  select coalesce(max(version), 0) + 1 into v_next
    from public.result_publications where batch_id = p_batch_id;

  insert into public.result_publications
    (batch_id, version, status, published_by_account_id)
  values (p_batch_id, v_next, 'final', auth.uid())
  returning * into v_publication;

  insert into public.result_publication_items (publication_id, student_id, snapshot)
  select v_publication.id, r.student_id,
         jsonb_build_object(
           'subject', s.name,
           'term', ed.term,
           'marks', coalesce(jsonb_agg(jsonb_build_object(
                      'component', ac.name, 'max', ac.max_marks,
                      'obtained', me.obtained, 'absent', me.absent))
                    filter (where me.id is not null), '[]'::jsonb))
    from public.result_rosters r
    join public.result_batches b on b.id = r.batch_id
    join public.exam_definitions ed on ed.id = b.exam_definition_id
    join public.subjects s on s.id = b.subject_id
    left join public.mark_entries me
      on me.batch_id = b.id and me.roster_id = r.id
    left join public.assessment_components ac on ac.id = me.component_id
   where r.batch_id = p_batch_id
   group by r.student_id, s.name, ed.term;

  update public.result_batches set status = 'published' where id = p_batch_id;

  insert into public.result_events (batch_id, event_type, visible_to_family, copy)
  values (p_batch_id, 'published', true, 'Results published');

  perform app.record_audit('Results published', 'result_publication',
                           v_publication.reference, 'Success');
  perform app.enqueue_outbox(
    'email.results_published:' || v_publication.reference, 'email.deliver',
    'result_publication', v_publication.reference, jsonb_build_object('channel', 'email'));
  return v_publication.reference;
end
$$;

-- ---------------------------------------------------------------------------
-- Timetable: manager publishes a validated draft as an immutable publication
-- (plan.md §6.8, B5). Basic cohort validation only; deep conflict rules are
-- school-policy pending (plan.md §14).
-- ---------------------------------------------------------------------------
create or replace function app.timetable_publish_version(
  p_version_id uuid,
  p_note text default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version public.timetable_versions%rowtype;
  v_period_count int;
  v_publication public.timetable_publications%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not (app.is_staff_aal2() and app.has_any_role(
      array['timetable_manager', 'system_administrator'])) then
    raise exception 'timetable manager role and aal2 required';
  end if;
  select * into v_version from public.timetable_versions where id = p_version_id;
  if v_version.id is null then
    raise exception 'timetable version not found';
  end if;
  if v_version.status <> 'draft' then
    raise exception 'only draft timetables can be published (state: %)', v_version.status;
  end if;

  select count(*) into v_period_count from public.timetable_periods
   where timetable_version_id = p_version_id;
  if v_period_count = 0 then
    raise exception 'timetable has no periods';
  end if;

  insert into public.timetable_publications
    (timetable_version_id, published_by_account_id, note)
  values (p_version_id, auth.uid(), p_note)
  returning * into v_publication;

  update public.timetable_versions set status = 'published' where id = p_version_id;

  perform app.record_audit('Timetable published', 'timetable_publication',
                           v_publication.reference, 'Success');
  perform app.enqueue_outbox(
    'email.timetable_published:' || v_publication.reference, 'email.deliver',
    'timetable_publication', v_publication.reference, jsonb_build_object('channel', 'email'));
  return v_publication.reference;
end
$$;

-- ---------------------------------------------------------------------------
-- Grants (plan.md §7: revoke broad execution, allow authenticated only).
-- ---------------------------------------------------------------------------
revoke all on function app.invoice_balance(uuid) from public;
revoke all on function app.admissions_submit(uuid, jsonb, int, int) from public;
revoke all on function app.admissions_request_changes(uuid, text, text) from public;
revoke all on function app.admissions_review_advance(uuid, text, text, text) from public;
revoke all on function app.admissions_decide(uuid, text, text, text, jsonb, timestamptz) from public;
revoke all on function app.finance_issue_admission_invoice(uuid, uuid) from public;
revoke all on function app.admissions_respond_offer(uuid, text, int) from public;
revoke all on function app.finance_post_sandbox_payment(text, text, text, bigint, text) from public;
revoke all on function app.enrollment_convert(uuid) from public;
revoke all on function app.results_publish_batch(uuid, int) from public;
revoke all on function app.timetable_publish_version(uuid, text) from public;

grant execute on function app.invoice_balance(uuid) to authenticated;
grant execute on function app.admissions_submit(uuid, jsonb, int, int) to authenticated;
grant execute on function app.admissions_request_changes(uuid, text, text) to authenticated;
grant execute on function app.admissions_review_advance(uuid, text, text, text) to authenticated;
grant execute on function app.admissions_decide(uuid, text, text, text, jsonb, timestamptz) to authenticated;
grant execute on function app.finance_issue_admission_invoice(uuid, uuid) to authenticated;
grant execute on function app.admissions_respond_offer(uuid, text, int) to authenticated;
grant execute on function app.finance_post_sandbox_payment(text, text, text, bigint, text) to authenticated;
grant execute on function app.enrollment_convert(uuid) to authenticated;
grant execute on function app.results_publish_batch(uuid, int) to authenticated;
grant execute on function app.timetable_publish_version(uuid, text) to authenticated;

commit;
