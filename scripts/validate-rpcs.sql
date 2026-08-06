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
  ('10000000-0000-4000-8000-000000000003', 'finance_officer', 'active', now()),
  ('10000000-0000-4000-8000-000000000003', 'support_officer', 'active', now()),
  ('10000000-0000-4000-8000-000000000003', 'content_publisher', 'active', now()),
  ('10000000-0000-4000-8000-000000000003', 'hr_approver', 'active', now()),
  ('10000000-0000-4000-8000-000000000003', 'exam_reviewer', 'active', now());

-- The synthetic fee schedule must be approved before invoices can be issued,
-- and the RLS-suite result batch (8-A Mathematics) must be 'approved' before
-- the publisher RPC can release it. Both updates run as postgres (bypass RLS).
update public.fee_schedule_versions set status = 'approved' where version = 1;
update public.result_batches set status = 'approved' where status = 'draft';

-- Setup rows for the remaining-commands section (000015): a support
-- request and a published vacancy + job application. These inserts have no
-- RLS path for the acting sessions, so they run as postgres. (The pending
-- guardian link is created AFTER conversion below — the child student does
-- not exist before it.)
insert into public.support_requests (requester_account_id, category, subject)
values ('10000000-0000-4000-8000-000000000001', 'fees', 'Payment question');

insert into public.job_vacancies (title, department, current_status)
values ('Teacher - Mathematics', 'Academics', 'published');
insert into public.job_vacancy_versions (vacancy_id, version, terms, published_by_account_id)
select id, 1, '{"title": "Teacher - Mathematics"}'::jsonb, '10000000-0000-4000-8000-000000000003'
  from public.job_vacancies where title = 'Teacher - Mathematics';
insert into public.job_applications
  (vacancy_id, vacancy_version, owner_account_id, current_status, applicant_name)
select v.id, 1, '10000000-0000-4000-8000-000000000001', 'draft', 'Sana Wani'
  from public.job_vacancies v where v.title = 'Teacher - Mathematics';

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

-- The converted child now exists; create the pending guardian link (postgres
-- context) and share its id through a session GUC.
insert into public.guardian_student_links
  (guardian_id, student_id, relationship_label, status, verification_source, version)
select g.id, s.id, 'Parent', 'pending_verification', 'guardian_request', 1
  from public.guardians g
  cross join public.students s
 where s.person_id in (select id from public.people where display_name = 'Test Child Wani');

select set_config('fass.link_id',
  (select id::text from public.guardian_student_links
    where verification_source = 'guardian_request' limit 1), false);

-- ===========================================================================
-- Remaining commands (000015): links, support, content, careers, marks,
-- moderation, withdrawal. Rania holds the functional roles; Firdous is the
-- pure teacher; Sana is the guardian/applicant.
-- ===========================================================================
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);

do $$
declare
  v_denied boolean;
  v_version uuid;
  v_pub text;
begin
  -- Links: the pending link for the converted child; approve as support staff.
  v_denied := false;
  begin
    perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
    perform app.links_approve(current_setting('fass.link_id', true)::uuid, 1);
  exception when others then
    v_denied := true;
  end;
  assert v_denied, 'teacher cannot approve links';
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
  perform app.links_approve(current_setting('fass.link_id', true)::uuid, 1);
  assert (select status from public.guardian_student_links
           where id = current_setting('fass.link_id', true)::uuid) = 'active',
    'link approved by support staff';

  -- Support: requester replies to their own thread; staff add private notes;
  -- requester cannot add private notes.
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
  perform app.support_respond((select id from public.support_requests limit 1), 'Please clarify the due date', false);
  v_denied := false;
  begin
    perform app.support_respond((select id from public.support_requests limit 1), 'internal only', true);
  exception when others then
    v_denied := true;
  end;
  assert v_denied, 'requester cannot add private notes';
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
  perform app.support_respond((select id from public.support_requests limit 1), 'Noted, we will confirm shortly', false);
  perform app.support_respond((select id from public.support_requests limit 1), 'case notes', true);
  assert (select count(*) from public.support_messages) = 2, 'thread appended (requester + staff)';
  assert (select count(*) from public.support_private_notes) = 1, 'private note stored separately';

  -- Content: publish the scheduled seed notice (publisher only).
  perform app.content_publish_notice(
    (select n.id from public.notices n
       join public.content_items ci on ci.id = n.content_item_id
      where ci.slug = 'notice-annual-day' limit 1));
  assert (select status from public.notices
           where content_item_id in (select id from public.content_items where slug = 'notice-annual-day')) = 'published',
    'scheduled notice published';

  -- Careers: applicant submits (idempotent), HR decides.
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
  v_version := app.jobs_submit(
    (select id from public.job_applications where applicant_name = 'Sana Wani' limit 1),
    '{"experience": "5 years"}'::jsonb, 0);
  assert v_version = app.jobs_submit(
    (select id from public.job_applications where applicant_name = 'Sana Wani' limit 1),
    '{"experience": "5 years"}'::jsonb, 0), 'job submit retry returns the same version';

  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
  perform app.jobs_decide((select id from public.job_applications where applicant_name = 'Sana Wani' limit 1),
                          'shortlist', 'Strong profile', null, null);
  assert (select current_status from public.job_applications
           where applicant_name = 'Sana Wani' limit 1) = 'shortlisted', 'job shortlisted by HR';

  -- Marks: teacher (exact 8-A MAT scope) submits marks for a fresh batch;
  -- moderator approves; publisher publishes; publisher withdraws.
  insert into public.result_batches
    (exam_definition_id, grade_section_id, subject_id, status, version)
  select ed.id, ed.grade_section_id, s.id, 'draft', 1
    from public.exam_definitions ed
    cross join public.subjects s
   where ed.term = 'midterm'
     and ed.grade_section_id in (select id from public.grade_sections where section_label = 'A')
     and s.code = 'MAT'
     and not exists (
       select 1 from public.result_batches rb
        where rb.exam_definition_id = ed.id and rb.subject_id = s.id and rb.status = 'draft');

  insert into public.result_rosters (batch_id, student_id, enrollment_id)
  select rb.id, e.student_id, e.id
    from public.result_batches rb
    cross join public.enrollments e
   where rb.status = 'draft'
     and e.grade_section_id = rb.grade_section_id
     and e.status = 'active';

  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
  perform app.results_submit_marks(
    (select id from public.result_batches where status = 'draft' limit 1),
    (select jsonb_agg(jsonb_build_object(
              'rosterId', r.id,
              'componentId', (select ac.id from public.assessment_components ac
                               join public.exam_definitions ed on ed.id = ac.exam_definition_id
                              where ed.term = 'midterm' limit 1),
              'obtained', 85))
       from public.result_rosters r
       join public.result_batches rb on rb.id = r.batch_id
      where rb.status = 'draft'),
    1);
  assert (select status from public.result_batches where status = 'submitted') = 'submitted',
    'teacher submitted marks (assignment scope)';

  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
  perform app.results_moderate(
    (select id from public.result_batches where status = 'submitted' limit 1),
    'approved', 'Checked', 2);
  assert (select status from public.result_batches
           where status = 'approved' order by created_at desc limit 1) = 'approved',
    'moderator approved the batch';

  v_pub := app.results_publish_batch(
    (select id from public.result_batches where status = 'approved' limit 1),
    (select version from public.result_batches where status = 'approved' limit 1));
  assert v_pub is not null, 'approved batch published';
  perform app.results_withdraw(
    (select id from public.result_publications where reference = v_pub), 'Duplicate entry');
  assert (select status from public.result_publications where reference = v_pub) = 'withdrawn',
    'publication withdrawn with reason';
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
