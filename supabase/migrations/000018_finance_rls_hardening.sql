-- =============================================================================
-- 000018 — Finance RLS hardening (follow-up to verifier audit)
--
-- 1. Guardian visibility into finance child tables was empty (ledger totals
--    drifted between guardian and staff projections). Add guardian read
--    policies scoped via the same invoice predicate used for invoices.
-- 2. Staff finance reads were over-permissive (any staff aal2). Tighten to
--    the canonical finance roles per blueprint §2.2.
-- 3. Admission-invoice idempotency lacked a DB guard: add a partial unique
--    index on invoices.applicant_ref where not null.
-- =============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. Guardian reads for finance child tables
-- ---------------------------------------------------------------------------

-- invoices is the scoping root: guardian reads an invoice when they own the
-- applicant_ref OR when any linked student_id is theirs (000010 predicate).
-- Child tables derive the same set via invoice_id.
-- Use DO blocks so re-apply is idempotent and naming stays close to the
-- existing staff_read_* convention.

drop policy if exists guardian_read_concessions on public.concessions;
create policy guardian_read_concessions on public.concessions
  for select to authenticated
  using (
    app.is_guardian()
    and invoice_id in (
      select i.id from public.invoices i
       where i.applicant_ref in (
         select reference from public.admission_applications where owner_account_id = auth.uid()
       )
          or i.student_id in (
         select student_id from public.guardian_student_links
          where status = 'active'
            and guardian_id in (select id from public.guardians where person_id = (select person_id from public.user_accounts where id = auth.uid()))
       )
    )
  );

drop policy if exists guardian_read_ledger on public.ledger_entries;
create policy guardian_read_ledger on public.ledger_entries
  for select to authenticated
  using (
    app.is_guardian()
    and invoice_id in (
      select i.id from public.invoices i
       where i.applicant_ref in (
         select reference from public.admission_applications where owner_account_id = auth.uid()
       )
          or i.student_id in (
         select student_id from public.guardian_student_links
          where status = 'active'
            and guardian_id in (select id from public.guardians where person_id = (select person_id from public.user_accounts where id = auth.uid()))
       )
    )
  );

drop policy if exists guardian_read_attempts on public.payment_attempts;
create policy guardian_read_attempts on public.payment_attempts
  for select to authenticated
  using (
    app.is_guardian()
    and invoice_id in (
      select i.id from public.invoices i
       where i.applicant_ref in (
         select reference from public.admission_applications where owner_account_id = auth.uid()
       )
          or i.student_id in (
         select student_id from public.guardian_student_links
          where status = 'active'
            and guardian_id in (select id from public.guardians where person_id = (select person_id from public.user_accounts where id = auth.uid()))
       )
    )
  );

drop policy if exists guardian_read_payments on public.payments;
create policy guardian_read_payments on public.payments
  for select to authenticated
  using (
    app.is_guardian()
    and exists (
      select 1 from public.payment_allocations pa
      join public.invoices i on i.id = pa.invoice_id
       where pa.payment_id = payments.id
         and (
           i.applicant_ref in (
             select reference from public.admission_applications where owner_account_id = auth.uid()
           )
           or i.student_id in (
             select student_id from public.guardian_student_links
              where status = 'active'
                and guardian_id in (select id from public.guardians where person_id = (select person_id from public.user_accounts where id = auth.uid()))
           )
         )
    )
  );

drop policy if exists guardian_read_allocations on public.payment_allocations;
create policy guardian_read_allocations on public.payment_allocations
  for select to authenticated
  using (
    app.is_guardian()
    and invoice_id in (
      select i.id from public.invoices i
       where i.applicant_ref in (
         select reference from public.admission_applications where owner_account_id = auth.uid()
       )
          or i.student_id in (
         select student_id from public.guardian_student_links
          where status = 'active'
            and guardian_id in (select id from public.guardians where person_id = (select person_id from public.user_accounts where id = auth.uid()))
       )
    )
  );

grant select on public.concessions, public.ledger_entries, public.payment_attempts, public.payments, public.payment_allocations to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Tighten staff finance reads to finance roles + auditor + sysadmin
--    (blueprint §2.2 — finance_officer/approver, auditor, system_administrator)
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select policyname, tablename from pg_policies
     where schemaname = 'public'
       and policyname like 'staff_read_%'
       and tablename in (
         'fee_schedule_versions','fee_schedule_items','invoices','invoice_items',
         'concessions','ledger_entries','payment_attempts','gateway_events',
         'payments','payment_allocations','receipts','refund_requests','refunds',
         'reconciliation_runs','reconciliation_exceptions'
       )
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      r.policyname, r.tablename
    );
  end loop;
end $$;

create policy staff_read_fee_schedules on public.fee_schedule_versions
  for select to authenticated using (app.is_staff_aal2() and app.has_any_role(array['finance_officer','finance_approver','auditor','system_administrator']));
create policy staff_read_fee_items on public.fee_schedule_items
  for select to authenticated using (app.is_staff_aal2() and app.has_any_role(array['finance_officer','finance_approver','auditor','system_administrator']));
create policy staff_read_invoices on public.invoices
  for select to authenticated using (app.is_staff_aal2() and app.has_any_role(array['finance_officer','finance_approver','auditor','system_administrator']));
create policy staff_read_invoice_items on public.invoice_items
  for select to authenticated using (app.is_staff_aal2() and app.has_any_role(array['finance_officer','finance_approver','auditor','system_administrator']));
create policy staff_read_concessions on public.concessions
  for select to authenticated using (app.is_staff_aal2() and app.has_any_role(array['finance_officer','finance_approver','auditor','system_administrator']));
create policy staff_read_ledger on public.ledger_entries
  for select to authenticated using (app.is_staff_aal2() and app.has_any_role(array['finance_officer','finance_approver','auditor','system_administrator']));
create policy staff_read_attempts on public.payment_attempts
  for select to authenticated using (app.is_staff_aal2() and app.has_any_role(array['finance_officer','finance_approver','auditor','system_administrator']));
create policy staff_read_gateway_events on public.gateway_events
  for select to authenticated using (app.is_staff_aal2() and app.has_any_role(array['finance_officer','finance_approver','auditor','system_administrator']));
create policy staff_read_payments on public.payments
  for select to authenticated using (app.is_staff_aal2() and app.has_any_role(array['finance_officer','finance_approver','auditor','system_administrator']));
create policy staff_read_allocations on public.payment_allocations
  for select to authenticated using (app.is_staff_aal2() and app.has_any_role(array['finance_officer','finance_approver','auditor','system_administrator']));
create policy staff_read_receipts on public.receipts
  for select to authenticated using (app.is_staff_aal2() and app.has_any_role(array['finance_officer','finance_approver','auditor','system_administrator']));
create policy staff_read_refund_requests on public.refund_requests
  for select to authenticated using (app.is_staff_aal2() and app.has_any_role(array['finance_officer','finance_approver','auditor','system_administrator']));
create policy staff_read_refunds on public.refunds
  for select to authenticated using (app.is_staff_aal2() and app.has_any_role(array['finance_officer','finance_approver','auditor','system_administrator']));
create policy staff_read_reconciliation_runs on public.reconciliation_runs
  for select to authenticated using (app.is_staff_aal2() and app.has_any_role(array['finance_officer','finance_approver','auditor','system_administrator']));
create policy staff_read_reconciliation_exceptions on public.reconciliation_exceptions
  for select to authenticated using (app.is_staff_aal2() and app.has_any_role(array['finance_officer','finance_approver','auditor','system_administrator']));

-- ---------------------------------------------------------------------------
-- 3. Admission-invoice idempotency guard
-- ---------------------------------------------------------------------------
create unique index if not exists invoices_applicant_ref_uniq
  on public.invoices (applicant_ref) where applicant_ref is not null;

commit;
