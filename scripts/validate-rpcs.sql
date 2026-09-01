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
--    their records; add separate maker/checker identities: admissions officer
--    Amina Qadir and approver Rania Mir).
insert into auth.users (id) values ('10000000-0000-4000-8000-000000000003');
insert into public.people (id, given_name, family_name, display_name) values
  ('20000000-0000-4000-8000-000000000006', 'Rania', 'Mir', 'Rania Mir');
insert into public.user_accounts (id, person_id, status, verified_contact) values
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000006', 'active', 'staff.demo@example.in');

insert into public.role_grants (account_id, role_code, status, effective_from) values
  ('10000000-0000-4000-8000-000000000003', 'admissions_approver', 'active', now()),
  ('10000000-0000-4000-8000-000000000003', 'result_publisher', 'active', now()),
  ('10000000-0000-4000-8000-000000000003', 'timetable_manager', 'active', now()),
  ('10000000-0000-4000-8000-000000000003', 'finance_officer', 'active', now()),
  ('10000000-0000-4000-8000-000000000003', 'support_officer', 'active', now()),
  ('10000000-0000-4000-8000-000000000003', 'content_publisher', 'active', now()),
  ('10000000-0000-4000-8000-000000000003', 'hr_approver', 'active', now()),
  ('10000000-0000-4000-8000-000000000003', 'content_editor', 'active', now()),
  ('10000000-0000-4000-8000-000000000003', 'exam_reviewer', 'active', now());

insert into auth.users (id) values ('10000000-0000-4000-8000-000000000006');
insert into public.people (id, given_name, family_name, display_name) values
  ('20000000-0000-4000-8000-000000000008', 'Amina', 'Qadir', 'Amina Qadir');
insert into public.user_accounts (id, person_id, status, verified_contact) values
  ('10000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000008', 'active', 'admissions.officer@example.in');
insert into public.role_grants (account_id, role_code, status, effective_from)
values ('10000000-0000-4000-8000-000000000006', 'admissions_officer', 'active', now());

insert into auth.users (id) values ('10000000-0000-4000-8000-000000000007');
insert into public.people (id, given_name, family_name, display_name) values
  ('20000000-0000-4000-8000-000000000009', 'Bilal', 'Khan', 'Bilal Khan');
insert into public.user_accounts (id, person_id, status, verified_contact) values
  ('10000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000009', 'active', 'hr.reviewer@example.in');
insert into public.role_grants (account_id, role_code, status, effective_from)
values ('10000000-0000-4000-8000-000000000007', 'hr_reviewer', 'active', now());

-- Pure system administrator: access administration only, never a substitute
-- for a functional business role.
insert into auth.users (id) values ('10000000-0000-4000-8000-000000000004');
insert into public.people (id, given_name, family_name, display_name) values
  ('20000000-0000-4000-8000-000000000007', 'Aisha', 'Lone', 'Aisha Lone');
insert into public.user_accounts (id, person_id, status, verified_contact) values
  ('10000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000007', 'active', 'admin.demo@example.in');
insert into public.role_grants (account_id, role_code, status, effective_from)
values ('10000000-0000-4000-8000-000000000004', 'system_administrator', 'active', now());
insert into auth.users (id) values ('10000000-0000-4000-8000-000000000005');

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
insert into public.job_review_assignments (application_id, reviewer_account_id)
select ja.id, '10000000-0000-4000-8000-000000000007'
  from public.job_applications ja
 where ja.applicant_name = 'Sana Wani';

-- C2.2/Slice 3 validation exercises an explicitly configured open window and
-- effective policy. Seed configuration is intentionally policy-pending.
update public.admission_windows
   set status = 'open', opens_at = now() - interval '1 day', closes_at = now() + interval '1 day',
       policy = policy - 'school_decision' - 'admission_policy'
 where academic_year_id in (select id from public.academic_years where label = '2026-27');
update public.settings_versions set status = 'effective' where version = (select max(version) from public.settings_versions);

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
  v_draft jsonb;
  v_job_draft jsonb;
  v_job uuid;
  v_pub text;
  v_ttv uuid;
  v_denied boolean;
begin
  select id into v_app from public.admission_applications
    where owner_account_id = '10000000-0000-4000-8000-000000000001' and current_status = 'draft';

  select id into v_job from public.job_applications where applicant_name = 'Sana Wani' limit 1;
  v_job_draft := app.jobs_save_draft(v_job, '{"experience":"5 years","step":"contact"}'::jsonb, 1, 0);
  assert (v_job_draft ->> 'applicationId') = v_job::text, 'career draft is saved server-side';

  -- C2.2 owner-scoped draft save/upsert (the application reference is the
  -- resume key; the submitted version remains immutable until submit).
  v_draft := app.admissions_save_draft(
    v_app,
    (select id from public.academic_years where label = '2026-27'),
    (select id from public.grades where code = '8'),
    'Test Child Wani', 'Sana Wani', '+91 90000 01001',
    '{"step":"personal","child":"Test Child Wani"}'::jsonb,
    1, 0
  );
  assert (v_draft ->> 'reference') is not null, 'draft save returns an application reference';
  assert (v_draft ->> 'version') = '0', 'draft save does not create a submitted version';

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
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', false);
  perform app.admissions_review_advance(v_app, 'under_review', 'Documents look fine');
  perform app.admissions_review_advance(v_app, 'assessment');
  assert (select current_status from public.admission_applications where id = v_app) = 'assessment',
    'application reached assessment';

  -- Approver offers (checker). Waitlist/decline paths exist; offer is the
  -- conversion-relevant one.
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
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
  perform set_config('fass.enrollment_link_id', v_result ->> 'guardian_link', false);
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

  -- C2.3 timetable draft revision, validation, supersession, override, and
  -- exam date-sheet commands use the same manager/AAL2 session.
  select (select id from public.grade_sections where section_label = 'A' limit 1) into v_ttv;
  declare
    v_timetable_draft jsonb;
    v_validation jsonb;
    v_date_sheet jsonb;
  begin
    v_timetable_draft := app.timetable_save_draft(
      v_ttv, null,
      '[{"dayOfWeek":1,"periodNumber":1,"startsAt":"08:30","endsAt":"09:15","kind":"class"}]'::jsonb, 0);
    assert (v_timetable_draft ->> 'revision') = '1', 'timetable draft revision increments';
    v_validation := app.timetable_validate_draft((v_timetable_draft ->> 'versionId')::uuid);
    assert (v_validation ->> 'valid')::boolean, 'timetable draft has no hard conflicts';
    assert app.timetable_publish_version((v_timetable_draft ->> 'versionId')::uuid, 'C2.3 local publication') is not null,
      'timetable draft publishes and supersedes prior effective version';
    assert app.timetable_save_override(v_ttv, current_date, 1, 1, 'cancellation', null, null, null, 'Local validator') is not null,
      'timetable override is saved';
    v_date_sheet := app.exam_schedule_save_draft(v_ttv, jsonb_build_array(jsonb_build_object(
      'examDate', current_date::text,
      'subjectId', (select id from public.subjects limit 1),
      'startsAt', '09:00', 'endsAt', '10:00')), null);
    assert app.exam_schedule_publish((v_date_sheet ->> 'versionId')::uuid, 'C2.3 date sheet') is not null,
      'exam date sheet publishes';
  end;
end $$;

reset role;

-- The RPC transaction created the link; seed its explicit family capabilities
-- as the scratch database owner before the next authenticated retry assertion.
insert into public.guardian_link_capabilities (link_id, capability)
select current_setting('fass.enrollment_link_id', true)::uuid, c.capability
  from (values ('academics'), ('finance'), ('documents'), ('notices'), ('profile')) c(capability)
on conflict do nothing;

-- C2.2 create-or-match conversion: the same guardian/applicant and normalized
-- child identity must adopt the second paid invoice onto the existing linked
-- student instead of creating a duplicate student/enrollment.
insert into public.admission_applications
  (owner_account_id, academic_year_id, grade_id, current_status, student_name, parent_name)
select '10000000-0000-4000-8000-000000000001', ay.id, g.id, 'offered',
       'Test Child Wani', 'Sana Wani'
  from public.academic_years ay
  cross join public.grades g
 where ay.label = '2026-27' and g.code = '8';
insert into public.admission_offers
  (application_id, grade_id, academic_year_id, expires_at, decided_by_account_id)
select aa.id, aa.grade_id, aa.academic_year_id, now() + interval '14 days',
       '10000000-0000-4000-8000-000000000003'
  from public.admission_applications aa
 where aa.student_name = 'Test Child Wani'
   and aa.current_status = 'offered'
   and not exists (select 1 from public.admission_offers ao where ao.application_id = aa.id);

-- Name similarity is only a duplicate signal.  The matching retry carries a
-- separately verified school/birth identity evidence row before conversion.
insert into public.admission_identity_evidence
  (application_id, candidate_student_id, evidence_type, evidence_reference, status, verified_by_account_id, verified_at, reason)
select aa.id, s.id, 'school_reference', 'LOCAL-TEST-IDENTITY-1', 'verified',
       '10000000-0000-4000-8000-000000000003', now(), 'Synthetic validator evidence'
  from public.admission_applications aa
  join public.students s on exists (select 1 from public.people p where p.id = s.person_id and p.display_name = 'Test Child Wani')
 where aa.student_name = 'Test Child Wani' and aa.current_status = 'offered'
   and not exists (select 1 from public.admission_identity_evidence ie where ie.application_id = aa.id);

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
do $$
declare
  v_app2 uuid;
  v_invoice2 text;
  v_balance2 bigint;
  v_match jsonb;
begin
  select id into v_app2 from public.admission_applications
   where student_name = 'Test Child Wani' and current_status = 'offered'
   order by created_at desc limit 1;
  v_invoice2 := app.admissions_respond_offer(v_app2, 'accepted', 1);
  v_balance2 := app.invoice_balance((select id from public.invoices where reference = v_invoice2));
  perform app.finance_post_sandbox_payment(v_invoice2, 'ATT-DEMO-MATCH', 'TXN-DEMO-MATCH', v_balance2);
  v_match := app.enrollment_convert(v_app2);
  assert (v_match ->> 'matched_existing') = 'true', 'conversion matches existing linked student';
  assert (select count(*) from public.students s join public.people p on p.id = s.person_id where p.display_name = 'Test Child Wani' and s.status = 'active') = 1,
    'matched conversion does not duplicate the student';
  assert (select student_id from public.invoices where reference = v_invoice2)
    = (select s.id from public.students s join public.people p on p.id = s.person_id where p.display_name = 'Test Child Wani' and s.status = 'active'),
    'matched conversion adopts the invoice onto the existing student';
end $$;
reset role;

-- Name-only duplicate signal persists a manual-review state instead of
-- throwing/rolling back.  A retry returns the same review without another
-- timeline event, and duplicate_review cannot be resubmitted as a draft.
insert into public.admission_applications
  (owner_account_id, academic_year_id, grade_id, current_status, student_name, parent_name)
select '10000000-0000-4000-8000-000000000001', ay.id, g.id, 'offered',
       'Test Child Wani', 'Sana Wani'
  from public.academic_years ay cross join public.grades g
 where ay.label = '2026-27' and g.code = '8';
insert into public.admission_offers
  (application_id, grade_id, academic_year_id, expires_at, decided_by_account_id)
select aa.id, aa.grade_id, aa.academic_year_id, now() + interval '14 days',
       '10000000-0000-4000-8000-000000000003'
  from public.admission_applications aa
 where aa.student_name = 'Test Child Wani' and aa.current_status = 'offered'
   and not exists (select 1 from public.admission_offers ao where ao.application_id = aa.id);
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
do $$
declare
  v_app uuid;
  v_invoice text;
  v_balance bigint;
  v_first jsonb;
  v_retry jsonb;
  v_submit_denied boolean := false;
begin
  select id into v_app from public.admission_applications where student_name = 'Test Child Wani' and current_status = 'offered' order by created_at desc limit 1;
  v_invoice := app.admissions_respond_offer(v_app, 'accepted', 1);
  v_balance := app.invoice_balance((select id from public.invoices where reference = v_invoice));
  perform app.finance_post_sandbox_payment(v_invoice, 'ATT-DEMO-MANUAL', 'TXN-DEMO-MANUAL', v_balance);
  v_first := app.enrollment_convert(v_app);
  assert (v_first ->> 'status') = 'manual_review_required', 'name-only match returns manual review state';
  assert (v_first ->> 'duplicateReviewRef') is not null, 'manual review returns public review reference';
  v_retry := app.enrollment_convert(v_app);
  assert v_retry = v_first, 'manual review retry returns the same typed state';
  begin
    perform app.admissions_submit(v_app, '{"dob":"2014-01-01"}'::jsonb, (select version from public.admission_applications where id = v_app), 1);
  exception when others then
    v_submit_denied := true;
  end;
  assert v_submit_denied, 'duplicate review state cannot be resubmitted';
end $$;
reset role;
do $$
declare v_app uuid;
begin
  select id into v_app from public.admission_applications where student_name = 'Test Child Wani' and current_status = 'duplicate_review' order by created_at desc limit 1;
  assert (select count(*) from public.admission_duplicate_reviews where application_id = v_app) = 1, 'one duplicate review row';
  assert (select count(*) from public.admission_events where application_id = v_app and event_type = 'duplicate_review') = 1, 'one duplicate review event';
end $$;

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

-- Seed the fresh teacher-entry batch and roster as the database owner. The
-- teacher later submits marks through the scoped RPC; a publisher must not
-- receive a direct INSERT privilege merely to run this fixture.
insert into public.result_batches (exam_definition_id, grade_section_id, subject_id, status, version)
select ed.id, ed.grade_section_id, s.id, 'draft', 1
  from public.exam_definitions ed
  cross join public.subjects s
 where ed.term = 'midterm'
   and ed.grade_section_id in (select id from public.grade_sections where section_label = 'A')
   and s.code = 'MAT'
   and not exists (select 1 from public.result_batches rb where rb.exam_definition_id = ed.id and rb.subject_id = s.id and rb.status = 'draft');
-- Ensure assessment components exist for the draft batch's exam definition
-- (run as the database owner — authenticated has SELECT-only on this table).
insert into public.assessment_components (exam_definition_id, subject_id, name, max_marks, weight, sort_order)
select rb.exam_definition_id, rb.subject_id, 'Midterm', 100, 1, 0
  from public.result_batches rb
 where rb.status = 'draft'
   and not exists (select 1 from public.assessment_components ac
                    where ac.exam_definition_id = rb.exam_definition_id and ac.subject_id = rb.subject_id);
insert into public.result_rosters (batch_id, student_id, enrollment_id)
select rb.id, e.student_id, e.id
  from public.result_batches rb
  cross join public.enrollments e
 where rb.status = 'draft' and e.grade_section_id = rb.grade_section_id and e.status = 'active';

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
  v_invite_token text;
  v_invite_ref text;
  v_acceptance jsonb;
begin
  -- Links: the pending link for the converted child. Guardian-link activation
  -- is Administrator-only (three-portal consolidation): the teacher is denied
  -- and the support officer is denied; the system administrator approves.
  v_denied := false;
  begin
    perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
    perform app.links_approve(current_setting('fass.link_id', true)::uuid, 1);
  exception when others then
    v_denied := true;
  end;
  assert v_denied, 'teacher cannot approve links';
  v_denied := false;
  begin
    perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
    perform app.links_approve(current_setting('fass.link_id', true)::uuid, 1);
  exception when others then
    v_denied := true;
  end;
  assert v_denied, 'support officer cannot approve links (Administrator-only)';
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
  perform app.links_approve(current_setting('fass.link_id', true)::uuid, 1);
  assert (select status from public.guardian_student_links
           where id = current_setting('fass.link_id', true)::uuid) = 'active',
    'link approved by the system administrator';

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

  -- C2.4 public grievance intake is rate-limited and returns only a safe ref;
  -- the authenticated support projection remains separate from private notes.
  declare
    v_public_support jsonb;
    v_content_draft jsonb;
    v_settings jsonb;
  begin
    v_public_support := app.support_public_intake('other', 'Public question', 'Please call the office', '+91 90000 01009', 'Public Parent', 'local-validator-ip');
    assert (v_public_support ->> 'reference') is not null, 'public support intake returns a safe reference';
    v_content_draft := app.content_save_draft(null, 'notice', 'c2-local-notice', 'C2 local notice', '{"0":"Draft body"}'::jsonb, null);
    assert (v_content_draft ->> 'version') = '1', 'content draft version is created';
    perform app.content_review_version((v_content_draft ->> 'versionId')::uuid, 'approved');
    assert (select review_status from public.content_versions where id = (v_content_draft ->> 'versionId')::uuid) = 'draft',
      'immutable content source version is preserved after review projection';
    perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
    v_settings := app.settings_save('{"gradingScheme":"A1-E2"}'::jsonb, 'Local validator settings', (select coalesce(max(version),0) from public.settings_versions));
    assert (v_settings ->> 'version') is not null, 'settings save uses expected latest version';
    assert (select count(*) from app.audit_list(10)) >= 1, 'auditor/system administrator can read audit projection';
    perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
  end;

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

  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000007', false);
  perform app.jobs_decide((select id from public.job_applications where applicant_name = 'Sana Wani' limit 1),
                          'shortlist', 'Strong profile', null, null);
  assert (select current_status from public.job_applications
           where applicant_name = 'Sana Wani' limit 1) = 'shortlisted', 'job shortlisted by HR';
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
  perform app.jobs_decide((select id from public.job_applications where applicant_name = 'Sana Wani' limit 1),
                          'offer', 'Offer approved', null, null);
  assert (select current_status from public.job_applications
           where applicant_name = 'Sana Wani' limit 1) = 'offered', 'job offer requires the separate HR approver';

  -- Marks: entry officer (exact 8-A MAT scope) submits marks for a fresh batch;
  -- moderator approves; publisher publishes; publisher withdraws.
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
  perform app.results_submit_marks(
    (select id from public.result_batches where status = 'draft' limit 1),
    (select jsonb_agg(jsonb_build_object(
              'rosterId', r.id,
              'componentId', (select ac.id from public.assessment_components ac
                               where ac.exam_definition_id = rb.exam_definition_id
                                 and ac.subject_id = rb.subject_id
                               limit 1),
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

  -- System administrator cannot read or perform functional business work.
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
  assert app.has_any_role(array['system_administrator']) = true,
    'system administrator access role remains available';
  assert app.has_any_role(array['admissions_approver', 'system_administrator']) = false,
    'system administrator is not a functional approver substitute';
  assert (select count(*) from public.invoices) = 0,
    'system administrator cannot read finance rows by default';

  -- Staff invitation stores role/scope and acceptance materializes the
  -- account, staff member, and active grant exactly once.
  v_invite_token := app.staff_invites_create(
    'new.teacher@example.in', now() + interval '14 days', 'New Teacher',
    'teacher', 'New academic-year appointment', '{}', '{}', '{}'
  );
  select reference into v_invite_ref
    from public.account_invitations
   where purpose = 'staff'
   order by created_at desc limit 1;
  assert v_invite_ref is not null, 'staff invitation created';
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', false);
  v_acceptance := app.staff_invites_accept(v_invite_ref, v_invite_token, 'New', 'Teacher');
  assert (v_acceptance ->> 'accountId') = '10000000-0000-4000-8000-000000000005',
    'staff invitation creates the authenticated account';
  assert (select status from public.account_invitations where reference = v_invite_ref) = 'accepted',
    'staff invitation is consumed once';
  assert (select count(*) from public.role_grants where account_id = '10000000-0000-4000-8000-000000000005' and role_code = 'teacher' and status = 'active') = 1,
    'staff invitation creates one active role grant';
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);

  -- Suspension is atomic; reactivation restores account status but never
  -- silently re-grants a revoked role.
  perform app.accounts_suspend('10000000-0000-4000-8000-000000000002', 'Access review');
  assert (select status from public.user_accounts where id = '10000000-0000-4000-8000-000000000002') = 'suspended',
    'account suspended';
  assert (select count(*) from public.role_grants where account_id = '10000000-0000-4000-8000-000000000002' and status = 'active') = 0,
    'suspension revokes all active grants atomically';
  perform app.accounts_reactivate('10000000-0000-4000-8000-000000000002', 'Access review complete');
  assert (select status from public.user_accounts where id = '10000000-0000-4000-8000-000000000002') = 'active',
    'account reactivated';
  assert (select count(*) from public.role_grants where account_id = '10000000-0000-4000-8000-000000000002' and status = 'active') = 0,
    'reactivation does not silently re-grant access';
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
