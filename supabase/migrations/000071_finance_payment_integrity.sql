-- ---------------------------------------------------------------------------
-- 000071 — admission payment posting integrity
--
-- Defects corrected (found by the admissions→enrollment workflow audit):
--   1. The app creates an attempt with finance_create_attempt_v2 (status
--      'created' → 'processing' → 'succeeded'), then posts it. The old
--      finance_post_sandbox_payment saw the attempt row, found no payment,
--      and always raised 'attempt exists but has no payment' — no sandbox
--      payment could ever post from the application.
--   2. The invoice balance was read without a row lock, so two concurrent
--      posts could both pass and double-post the balance.
--   3. A NULL resolved owner made the authorization comparison NULL, which
--      is not TRUE, so the guard did not raise; and idempotent returns ran
--      before the owner check, letting an unrelated authenticated actor
--      probe another invoice's receipt reference.
--   4. A provider transaction id already used on a different invoice
--      returned that invoice's receipt.
--
-- The function now adopts the pre-created attempt after verifying its
-- invoice, status and amount; locks the invoice before the balance check;
-- denies a NULL owner; performs the owner check before any idempotent
-- return; and scopes provider-transaction idempotency to the invoice.
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
  v_staff boolean;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;

  -- Lock the invoice first: balance check, posting, and status flip are one
  -- serialized unit.
  select * into v_invoice from public.invoices where reference = p_invoice_ref for update;
  if v_invoice.id is null then
    raise exception 'invoice not found';
  end if;

  -- Who may pay: the guardian of the invoiced student, the applicant owner
  -- (pre-conversion admission invoice), or finance staff (aal2).
  v_staff := app.is_staff_aal2() and app.has_any_role(
    array['finance_officer', 'finance_approver', 'system_administrator']);
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
  if not v_staff then
    if v_owner is null or auth.uid() <> v_owner then
      raise exception 'not authorized to pay this invoice';
    end if;
  end if;

  -- Existing payment for this provider transaction on THIS invoice → replay.
  select r.reference into v_receipt_ref
    from public.payments p
    join public.receipts r on r.payment_id = p.id
   where p.provider_txn_id = p_provider_txn_id
     and exists (
       select 1 from public.payment_allocations pa
        where pa.payment_id = p.id and pa.invoice_id = v_invoice.id
     );
  if v_receipt_ref is not null then
    return v_receipt_ref;
  end if;
  if exists (select 1 from public.payments where provider_txn_id = p_provider_txn_id) then
    raise exception 'provider transaction already used for another invoice';
  end if;

  select * into v_attempt from public.payment_attempts
   where reference = p_attempt_reference for update;
  if v_attempt.id is not null then
    if v_attempt.invoice_id <> v_invoice.id then
      raise exception 'payment attempt belongs to another invoice';
    end if;
    select r.reference into v_receipt_ref
      from public.payments p
      join public.receipts r on r.payment_id = p.id
     where p.attempt_id = v_attempt.id;
    if v_receipt_ref is not null then
      return v_receipt_ref;
    end if;
    -- The application posts only after the provider reports success; the
    -- server refuses to settle an attempt that has not succeeded.
    if v_attempt.status <> 'succeeded' then
      raise exception 'payment attempt has not succeeded (state: %)', v_attempt.status;
    end if;
    if v_attempt.amount_paise <> p_amount_paise then
      raise exception 'attempt amount mismatch: attempt %, post %', v_attempt.amount_paise, p_amount_paise;
    end if;
  end if;

  v_balance := app.invoice_balance(v_invoice.id);
  if v_balance <= 0 then
    raise exception 'invoice already settled';
  end if;
  if p_amount_paise <> v_balance then
    raise exception 'amount mismatch: expected % paise, got %', v_balance, p_amount_paise;
  end if;

  if v_attempt.id is null then
    -- Provider-neutral sandbox/external post without a pre-created attempt.
    insert into public.payment_attempts (reference, invoice_id, method, amount_paise, status)
    values (p_attempt_reference, v_invoice.id, p_method, p_amount_paise, 'succeeded')
    returning * into v_attempt;
  end if;

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

revoke all on function app.finance_post_sandbox_payment(text,text,text,bigint,text) from public;
grant execute on function app.finance_post_sandbox_payment(text,text,text,bigint,text) to authenticated;
