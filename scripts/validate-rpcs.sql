-- =============================================================================
-- Local RPC suite (driven by scripts/validate-db-local.sh; runs after the RLS
-- suite on the same scratch instance).
--
-- Exercises the plan.md §8 transactional commands end-to-end with fictional
-- actors: applicant submit → officer advance/request-changes → approver offer
-- → applicant accept + unique invoice → sandbox payment (idempotent retries)
-- → enrollment conversion (idempotent) → result publication → timetable
-- publication. Includes denial cases and retry deduplication.
-- =============================================================================

-- 1. Actors (RLS suite already created Sana Wani s1, Firdous Ahmad s2 and
--    their records; add the multi-role staff approver Rania Mir).
insert into auth.users (id) values ('10000000-0000-4000-8000-000000000003');
insert into public.people (id, given_name, family_name, display_name) values
  ('20000000-0000-4000-8000-000000000006', 'Rania', 'Mir', 'Rania Mir');
insert into public.user_accounts (id, person_id, status, verified_contact) values
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000006', 'active', 'staff.demo@example.in');

insert into public.role_grants (account_id, role_code, status, effective_from) values
  ('10000000-0000-4000-8000-000000000003', 'admissions_approver', 'active', now()),
  ('10000000-0000-4000-8000-000000000003', 'admissions_officer', 'active', now()),
  ('10000000-0000-4000-8000-000000000003', 'result_publisher', 'active', now()),
  ('10000000-0000-4000-8000-000000000003', 'timetable_manager', 'active', now()),
  ('10000000-0000-4000-8000-000000000003', 'finance_officer', 'active', now());

-- The synthetic fee schedule must be approved before invoices can be issued,
-- and the RLS-suite result batch (8-A Mathematics) must be 'approved' before
-- the publisher RPC can release it. Both updates run as postgres (bypass RLS).
update public.fee_schedule_versions set status = 'approved' where version = 1;
update public.result_batches set status = 'approved' where status = 'draft';

-- 2. Fictional application owned by Sana (guardian account s1).
insert into public.admission_applications
  (owner_account_id, academic_year_id, grade_id, current_status, student_name, parent_name)
select '10000000-0000-4000-8000-000000000001', ay.id, g.id, 'draft',
       'Test Child Wani', 'Sana Wani'
  from public.academic_years ay
  cross join public.grades g
 where ay.label = '2026-27' and g.code = '8';

-- 3. End-to-end flow.
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);

do $$
declare
  v_app uuid;
  v_version uuid;
  v_version_retry uuid;
  v_invoice_ref text;
  v_receipt_ref text;
  v_receipt_retry text;
  v_balance bigint;
  v_result jsonb;
  v_result_retry jsonb;
  v_pub text;
  v_ttv uuid;
  v_denied boolean;
begin
  select id into v_app from public.admission_applications
   where owner_account_id = '10000000-0000-4000-8000-000000000001' and current_status = 'draft';

  -- Submit (happy path + idempotent retry on the same base version).
  v_version := app.admissions_submit(v_app, '{"step": "personal", "child": "Test Child Wani"}'::jsonb, 0, 1);
  assert v_version is not null, 'submit returns a version id';
  v_version_retry := app.admissions_submit(v_app, '{"step": "personal", "child": "Test Child Wani"}'::jsonb, 0, 1);
  assert v_version_retry = v_version, 'submit retry returns the same version id';
  assert (select count(*) from public.admission_application_versions where application_id = v_app) = 1,
    'submit retry does not duplicate versions';
  assert (select current_status from public.admission_applications where id = v_app) = 'submitted',
    'application moved to submitted';

  -- Not-owner denial.
  v_denied := false;
  begin
    perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
    perform app.admissions_submit(v_app, '{}'::jsonb, 0, 1);
  exception when others then
    v_denied := true;
  end;
  assert v_denied, 'non-owner submit is denied';
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);

  -- Officer advances to under_review then assessment (maker).
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
  perform app.admissions_review_advance(v_app, 'under_review', 'Documents look fine');
  perform app.admissions_review_advance(v_app, 'assessment');
  assert (select current_status from public.admission_applications where id = v_app) = 'assessment',
    'application reached assessment';

  -- Approver offers (checker). Waitlist/decline paths exist; offer is the
  -- conversion-relevant one.
  perform app.admissions_decide(v_app, 'offer', 'Offer extended', 'Approved by committee');
  assert (select current_status from public.admission_applications where id = v_app) = 'offered',
    'application offered';

  -- Applicant accepts → unique admission invoice.
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
  v_invoice_ref := app.admissions_respond_offer(v_app, 'accepted', 1);
  assert v_invoice_ref is not null, 'acceptance issues an invoice';
  assert app.admissions_respond_offer(v_app, 'accepted', 1) = v_invoice_ref,
    'acceptance retry returns the same invoice';
  assert (select count(*) from public.invoices where applicant_ref is not null) = 1,
    'exactly one admission invoice exists';

  -- Invoice balances from ledger charges (the ledger itself is staff-only;
  -- the balance helper is SECURITY DEFINER and visible to the owner).
  v_balance := app.invoice_balance((select id from public.invoices where reference = v_invoice_ref));
  assert v_balance > 0, 'invoice carries a charge balance';

  -- Sandbox payment with idempotent retries.
  v_receipt_ref := app.finance_post_sandbox_payment(v_invoice_ref, 'ATT-DEMO-1', 'TXN-DEMO-1', v_balance);
  assert v_receipt_ref is not null, 'payment posts a receipt';
  v_receipt_retry := app.finance_post_sandbox_payment(v_invoice_ref, 'ATT-DEMO-1', 'TXN-DEMO-1', v_balance);
  assert v_receipt_retry = v_receipt_ref, 'attempt retry returns the same receipt';
  v_receipt_retry := app.finance_post_sandbox_payment(v_invoice_ref, 'ATT-DEMO-2', 'TXN-DEMO-1', v_balance);
  assert v_receipt_retry = v_receipt_ref, 'provider-txn retry returns the same receipt';
  assert (select count(*) from public.receipts) = 1, 'retries never duplicate receipts/payments';
  assert (select status from public.invoices where reference = v_invoice_ref) = 'paid',
    'invoice marked paid';
  assert (select count(*) from public.receipts where reference = v_receipt_ref) = 1,
    'exactly one receipt';

  -- Conversion (idempotent): student + enrollment + guardian link + adoption.
  v_result := app.enrollment_convert(v_app);
  assert (v_result ->> 'student') is not null, 'conversion creates a student';
  v_result_retry := app.enrollment_convert(v_app);
  assert v_result_retry = v_result, 'conversion retry returns the same result';
  assert (select count(*) from public.students where status = 'active') >= 1, 'one student';
  assert (select count(*) from public.enrollments where status = 'active') >= 1, 'one enrollment';
  assert (select count(*) from public.guardian_student_links where status = 'active') >= 1, 'one link';
  assert (select count(*) from public.admission_events
           where application_id = v_app and event_type = 'enrolled') = 1,
    'one enrollment timeline event (conversion record is staff-only)';
  assert (select student_id from public.invoices where reference = v_invoice_ref) is not null,
    'invoice adopted onto the student ledger';
  assert (select current_status from public.admission_applications where id = v_app) = 'enrolled',
    'application marked enrolled';

  -- Result publication (publisher) — the RLS-suite batch for 8-A Mathematics,
  -- already advanced to 'approved' above. Rania (multi-role staff) publishes.
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
  v_pub := app.results_publish_batch(
    (select rb.id from public.result_batches rb
       join public.grade_sections gs on gs.id = rb.grade_section_id
      where gs.section_label = 'A' limit 1),
    (select version from public.result_batches rb
       join public.grade_sections gs on gs.id = rb.grade_section_id
      where gs.section_label = 'A' limit 1));
  assert v_pub is not null, 'publication ref returned';
  assert (select count(*) from public.result_publication_items) >= 1,
    'per-student snapshots published';
  assert (select rb.status from public.result_batches rb
           join public.grade_sections gs on gs.id = rb.grade_section_id
          where gs.section_label = 'A') = 'published',
    'batch marked published';

  -- Publication denial for a non-publisher staff session (Firdous, teacher).
  v_denied := false;
  begin
    perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
    perform app.results_publish_batch(
      (select rb.id from public.result_batches rb
         join public.grade_sections gs on gs.id = rb.grade_section_id
        where gs.section_label = 'A' limit 1),
      (select version from public.result_batches rb
         join public.grade_sections gs on gs.id = rb.grade_section_id
        where gs.section_label = 'A' limit 1));
  exception when others then
    v_denied := true;
  end;
  assert v_denied, 'teacher cannot publish results';
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);

  -- Timetable publication (manager only) — draft from the seed (8-A).
  select id into v_ttv from public.timetable_versions where status = 'draft' limit 1;
  assert v_ttv is not null, 'a draft timetable exists';
  assert app.timetable_publish_version(v_ttv) is not null, 'timetable publication ref returned';
  assert (select status from public.timetable_versions where id = v_ttv) = 'published',
    'timetable version published';
end $$;

reset role;

-- Outbox and audit evidence appended by the same transactions (these tables
-- are not readable by authenticated — the counts run as postgres).
do $$
begin
  assert (select count(*) from public.outbox_events) >= 6, 'outbox events enqueued';
  assert (select count(*) from public.audit_events) >= 6, 'audit rows appended';
end $$;

select 'RPC SUITE PASSED' as result;
