-- =============================================================================
-- 000019 — Payment attempt lifecycle (plan.md §5.7 steps 3–5)
--
-- Sandbox gateway adapter boundary: create a checkout attempt against an
-- invoice, then advance it created → processing → succeeded. The actual
-- ledger post stays in app.finance_post_sandbox_payment (000009) — the
-- browser return NEVER marks an invoice paid; only the verified post does.
--
-- Authorization mirrors finance_post_sandbox_payment exactly: the applicant
-- owner, a linked guardian of the invoice's student, or finance staff at
-- aal2. Amount must equal the current balance (sandbox full-balance policy).
-- =============================================================================
begin;

-- ---------------------------------------------------------------------------
-- finance_create_attempt — open a checkout attempt for an invoice.
-- Returns (reference, provider_order_ref). Retries create new attempts;
-- posting remains idempotent by provider transaction id.
-- ---------------------------------------------------------------------------
create or replace function app.finance_create_attempt(
  p_invoice_ref text,
  p_amount_paise bigint,
  p_method text
) returns table (reference text, provider_order_ref text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices%rowtype;
  v_balance bigint;
  v_order_ref text;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;

  select * into v_invoice from public.invoices where reference = p_invoice_ref;
  if v_invoice.id is null then
    raise exception 'invoice not found';
  end if;

  -- Owner check: applicant owner OR guardian of the invoiced student OR
  -- finance staff at aal2 (same predicate family as the post RPC).
  if not (
    (
      v_invoice.applicant_ref is not null
      and exists (
        select 1 from public.admission_applications aa
         where aa.reference = v_invoice.applicant_ref
           and aa.owner_account_id = auth.uid()
      )
    )
    or (
      v_invoice.student_id is not null
      and exists (
        select 1
          from public.guardian_student_links gsl
          join public.guardians g on g.id = gsl.guardian_id
          join public.user_accounts ua on ua.person_id = g.person_id
         where gsl.student_id = v_invoice.student_id
           and gsl.status = 'active'
           and ua.id = auth.uid()
      )
    )
    or (app.is_staff_aal2() and app.has_any_role(array['finance_officer', 'finance_approver']))
  ) then
    raise exception 'not authorized for this invoice';
  end if;

  if v_invoice.status not in ('unpaid', 'partial', 'overdue') then
    raise exception 'invoice is already settled';
  end if;

  v_balance := app.invoice_balance(v_invoice.id);
  if v_balance <= 0 then
    raise exception 'invoice is already settled';
  end if;
  if p_amount_paise is null or p_amount_paise <> v_balance then
    raise exception 'amount mismatch: attempt must equal the current balance (%)', v_balance;
  end if;
  if p_method is null or btrim(p_method) = '' then
    raise exception 'invalid payment method';
  end if;

  -- Deterministic sandbox order reference; the real gateway adapter will
  -- replace this with its own order id (provider-neutral core).
  v_order_ref := 'sbx_' || encode(gen_random_bytes(9), 'hex');

  insert into public.payment_attempts (
    invoice_id, method, amount_paise, status, provider_order_ref
  ) values (
    v_invoice.id, btrim(p_method), p_amount_paise, 'created', v_order_ref
  );

  return query select pa.reference, pa.provider_order_ref
    from public.payment_attempts pa
   where pa.provider_order_ref = v_order_ref;
end;
$$;

-- ---------------------------------------------------------------------------
-- finance_refresh_attempt — advance the sandbox state machine one step.
--   created → processing → succeeded
-- Terminal states are returned unchanged (idempotent polling).
-- Returns the new status text.
-- ---------------------------------------------------------------------------
create or replace function app.finance_refresh_attempt(
  p_attempt_reference text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.payment_attempts%rowtype;
  v_invoice public.invoices%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;

  select * into v_attempt from public.payment_attempts where reference = p_attempt_reference;
  if v_attempt.id is null then
    raise exception 'attempt not found';
  end if;

  select * into v_invoice from public.invoices where id = v_attempt.invoice_id;

  -- Same ownership predicate as create.
  if not (
    (
      v_invoice.applicant_ref is not null
      and exists (
        select 1 from public.admission_applications aa
         where aa.reference = v_invoice.applicant_ref
           and aa.owner_account_id = auth.uid()
      )
    )
    or (
      v_invoice.student_id is not null
      and exists (
        select 1
          from public.guardian_student_links gsl
          join public.guardians g on g.id = gsl.guardian_id
          join public.user_accounts ua on ua.person_id = g.person_id
         where gsl.student_id = v_invoice.student_id
           and gsl.status = 'active'
           and ua.id = auth.uid()
      )
    )
    or (app.is_staff_aal2() and app.has_any_role(array['finance_officer', 'finance_approver']))
  ) then
    raise exception 'not authorized for this attempt';
  end if;

  if v_attempt.status in ('succeeded', 'failed', 'cancelled') then
    return v_attempt.status;                   -- idempotent terminal read
  end if;

  update public.payment_attempts
     set status = case v_attempt.status
                    when 'created' then 'processing'
                    when 'processing' then 'succeeded'
                    when 'delayed' then 'succeeded'
                    else v_attempt.status
                  end,
         updated_at = now()
   where id = v_attempt.id
  returning status into v_attempt.status;

  return v_attempt.status;
end;
$$;

revoke all on function
  app.finance_create_attempt(text, bigint, text),
  app.finance_refresh_attempt(text)
from public;

grant execute on function
  app.finance_create_attempt(text, bigint, text),
  app.finance_refresh_attempt(text)
to authenticated;

commit;
