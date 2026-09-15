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

-- The seeded admission windows carry required document requirements, so every
-- application that must pass a submit or conversion gate needs ready,
-- finalized documents. This validator-local trigger attaches them as the
-- database owner because the configuration tables they reference are not
-- readable by the authenticated role.
create function pg_temp.attach_admission_documents() returns trigger
language plpgsql as $$
declare
  v_code text;
begin
  for v_code in
    select distinct dr.code
      from public.admission_document_requirements dr
      join public.admission_windows aw on aw.id = dr.admission_window_id
     where aw.academic_year_id = new.academic_year_id
       and aw.grade_id = new.grade_id
       and dr.status = 'active' and dr.required
  loop
    if not exists (
      select 1 from public.admission_documents ad
       where ad.application_id = new.id and ad.requirement_code = v_code
    ) then
      with inserted as (
        insert into public.documents
          (owner_domain, owner_record_id, category, object_key, safe_filename, mime_type, size_bytes,
           storage_bucket, scan_status, finalized_at, checksum, checksum_verified)
        values ('admission_application', new.id, 'admission_document',
                'admission/' || new.id::text || '/' || v_code || '.pdf', v_code || '.pdf',
                'application/pdf', 1024, 'fass-private-documents', 'ready', now(), repeat('a', 64), true)
        returning id
      )
      insert into public.admission_documents (application_id, document_id, requirement_code)
      select new.id, i.id, v_code from inserted i;
    end if;
  end loop;
  return new;
end $$;

create trigger validate_admission_documents
after insert or update of current_status on public.admission_applications
for each row execute function pg_temp.attach_admission_documents();

-- Backfill applications created before the trigger was installed.
update public.admission_applications set current_status = current_status;

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
  v_refs jsonb;
  v_app_version int;
  v_pref_version int;
  v_student uuid;
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
    '{"step":"personal","child":"Test Child Wani","dob":"2014-05-06","gender":"Female"}'::jsonb,
    1, 0
  );
  assert (v_draft ->> 'reference') is not null, 'draft save returns an application reference';
  assert (v_draft ->> 'version') = '0', 'draft save does not create a submitted version';

  -- Submit (happy path + idempotent retry on the same base version).
  v_version := app.admissions_submit(v_app, '{"step": "personal", "child": "Test Child Wani", "dob": "2014-05-06", "gender": "Female"}'::jsonb, 0, 1);
  assert v_version is not null, 'submit returns a version id';
  v_version_retry := app.admissions_submit(v_app, '{"step": "personal", "child": "Test Child Wani", "dob": "2014-05-06", "gender": "Female"}'::jsonb, 0, 1);
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

  -- Officer advances to under_review then assessment (maker). Versioned
  -- transitions reject a stale copy and advance the application version.
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', false);
  select version into v_app_version from public.admission_applications where id = v_app;
  v_denied := false;
  begin
    perform app.admissions_review_advance_v2(v_app, 'under_review', 'Documents look fine', null, v_app_version + 5);
  exception when others then
    v_denied := true;
  end;
  assert v_denied, 'stale review advance is denied';
  perform app.admissions_review_advance_v2(v_app, 'under_review', 'Documents look fine', null, v_app_version);
  perform app.admissions_review_advance_v2(v_app, 'assessment', null, null, null);
  assert (select current_status from public.admission_applications where id = v_app) = 'assessment',
    'application reached assessment';

  -- Approver offers (checker). Waitlist/decline paths exist; offer is the
  -- conversion-relevant one.
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
  perform app.admissions_decide(v_app, 'offer', 'Offer extended', 'Approved by committee');
  assert (select current_status from public.admission_applications where id = v_app) = 'offered',
    'application offered';
  assert (select copy from public.admission_events where application_id = v_app and event_type = 'offered') = 'Offer extended: Offer extended',
    'offer event carries the applicant-visible reason';

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

  -- Non-owner denials: a different authenticated account cannot respond to
  -- the offer, withdraw, save a draft on, or convert the accepted application.
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
  v_denied := false;
  begin
    perform app.admissions_respond_offer(v_app, 'accepted', 1);
  exception when others then
    v_denied := true;
  end;
  assert v_denied, 'non-owner offer response is denied';
  v_denied := false;
  begin
    perform app.admissions_withdraw(v_app);
  exception when others then
    v_denied := true;
  end;
  assert v_denied, 'non-owner withdrawal is denied';
  v_denied := false;
  begin
    perform app.admissions_save_draft(v_app);
  exception when others then
    v_denied := true;
  end;
  assert v_denied, 'non-owner draft save is denied';
  v_denied := false;
  begin
    perform app.enrollment_convert(v_app);
  exception when others then
    v_denied := true;
  end;
  assert v_denied, 'non-owner conversion is denied';
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);

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
  assert (select count(*) from public.guardian_link_capabilities
           where link_id = current_setting('fass.enrollment_link_id')::uuid) = 5,
    'conversion seeds the five guardian capabilities';

  -- 000077: the submitted snapshot identity lands on the permanent student.
  assert (select date_of_birth from public.students where id = (v_result ->> 'student')::uuid) = '2014-05-06'::date,
    'converted student carries the submitted date of birth';
  assert (select gender from public.students where id = (v_result ->> 'student')::uuid) = 'Female',
    'converted student carries the submitted gender';

  -- 000075: the owning applicant re-reads the public conversion references.
  v_refs := app.admission_enrollment_reference(v_app);
  assert (v_refs ->> 'studentRef') = (select reference from public.students where id = (v_result ->> 'student')::uuid),
    'enrollment reference returns the student public reference';
  assert (v_refs ->> 'enrollmentRef') = (select reference from public.enrollments where id = (v_result ->> 'enrollment')::uuid),
    'enrollment reference returns the enrollment public reference';
  assert (v_refs ->> 'linkRef') is not null, 'enrollment reference returns the guardian link reference';
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
  v_denied := false;
  begin
    perform app.admission_enrollment_reference(v_app);
  exception when others then
    v_denied := true;
  end;
  assert v_denied, 'a non-owner cannot read conversion references';
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);

  -- 000076: the family active child lives in guardian_preferences.
  v_student := (v_result ->> 'student')::uuid;
  perform app.context_family_select(v_student, null);
  assert (
    select active_student_id from public.guardian_preferences
     where guardian_id = (
       select g.id from public.guardians g
        join public.user_accounts ua on ua.person_id = g.person_id
       where ua.id = '10000000-0000-4000-8000-000000000001'
     )
  ) = v_student, 'family selection writes the guardian-keyed store';
  v_pref_version := (
    select version from public.guardian_preferences
     where guardian_id = (
       select g.id from public.guardians g
        join public.user_accounts ua on ua.person_id = g.person_id
       where ua.id = '10000000-0000-4000-8000-000000000001'
     )
  );
  perform app.context_family_select(v_student, v_pref_version);
  assert (
    select version from public.guardian_preferences
     where guardian_id = (
       select g.id from public.guardians g
        join public.user_accounts ua on ua.person_id = g.person_id
       where ua.id = '10000000-0000-4000-8000-000000000001'
     )
  ) = v_pref_version + 1, 'family selection is versioned in the guardian store';

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

-- Exactly-once payment ledger after the sandbox retries (audit/outbox are not
-- readable by authenticated, so the whole check runs as the database owner).
do $$
declare v_invoice_id uuid;
begin
  select id into v_invoice_id from public.invoices where applicant_ref is not null;
  assert (select count(*) from public.payments) = 1,
    'retries post exactly one payment';
  assert (select count(*) from public.payment_allocations where invoice_id = v_invoice_id) = 1,
    'retries create exactly one allocation';
  assert (select count(*) from public.ledger_entries where invoice_id = v_invoice_id and entry_type = 'payment') = 1,
    'retries create exactly one payment ledger entry';
  assert (select count(*) from public.receipts) = 1,
    'retries issue exactly one receipt';
  assert (select count(*) from public.audit_events where action like 'Payment posted%') = 1,
    'retries append exactly one payment audit row';
  assert (select count(*) from public.outbox_events where event_key like 'email.receipt:%') = 1,
    'retries enqueue exactly one receipt email';
end $$;

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

-- 000071: the post RPC adopts an application-created attempt (created →
-- processing → succeeded) instead of rejecting it.
insert into public.admission_applications
  (owner_account_id, academic_year_id, grade_id, current_status, student_name, parent_name)
select '10000000-0000-4000-8000-000000000001', ay.id, g.id, 'offered', 'Adopt Child', 'Adopt Guardian'
  from public.academic_years ay cross join public.grades g
 where ay.label = '2026-27' and g.code = '8';
insert into public.admission_offers
  (application_id, grade_id, academic_year_id, expires_at, decided_by_account_id)
select aa.id, aa.grade_id, aa.academic_year_id, now() + interval '14 days',
       '10000000-0000-4000-8000-000000000003'
  from public.admission_applications aa
 where aa.student_name = 'Adopt Child' and aa.current_status = 'offered'
   and not exists (select 1 from public.admission_offers ao where ao.application_id = aa.id);
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
do $$
declare
  v_app uuid;
  v_invoice text;
  v_balance bigint;
  v_attempt jsonb;
  v_receipt text;
begin
  select id into v_app from public.admission_applications
   where student_name = 'Adopt Child' and current_status = 'offered'
   order by created_at desc limit 1;
  v_invoice := app.admissions_respond_offer(v_app, 'accepted', 1);
  v_balance := app.invoice_balance((select id from public.invoices where reference = v_invoice));
  v_attempt := app.finance_create_attempt_v2(v_invoice, v_balance, 'sandbox', 'adopt-attempt-key', 'sandbox');
  assert (v_attempt ->> 'status') = 'created', 'attempt starts created';
  v_attempt := app.finance_refresh_attempt_v2(v_attempt ->> 'attemptRef', (v_attempt ->> 'version')::int);
  v_attempt := app.finance_refresh_attempt_v2(v_attempt ->> 'attemptRef', (v_attempt ->> 'version')::int);
  assert (v_attempt ->> 'status') = 'succeeded', 'attempt reaches succeeded before posting';
  v_receipt := app.finance_post_sandbox_payment(v_invoice, v_attempt ->> 'attemptRef', 'TXN-ADOPT-1', v_balance);
  assert v_receipt is not null, 'post adopts the application-created attempt';
  assert (select count(*) from public.payments p join public.receipts r on r.payment_id = p.id where r.reference = v_receipt) = 1,
    'adopted attempt posts exactly one payment and receipt';
  assert (select status from public.invoices where reference = v_invoice) = 'paid', 'adopted attempt settles the invoice';
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

-- Readiness gate at the DB: an accepted application with an unpaid admission
-- invoice cannot convert (the command raises instead of creating a student).
insert into public.admission_applications
  (owner_account_id, academic_year_id, grade_id, current_status, student_name, parent_name)
select '10000000-0000-4000-8000-000000000001', ay.id, g.id, 'offered', 'Unpaid Child', 'Sana Wani'
  from public.academic_years ay cross join public.grades g
 where ay.label = '2026-27' and g.code = '8';
insert into public.admission_offers
  (application_id, grade_id, academic_year_id, expires_at, decided_by_account_id)
select aa.id, aa.grade_id, aa.academic_year_id, now() + interval '14 days',
       '10000000-0000-4000-8000-000000000003'
  from public.admission_applications aa
 where aa.student_name = 'Unpaid Child' and aa.current_status = 'offered'
   and not exists (select 1 from public.admission_offers ao where ao.application_id = aa.id);
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
do $$
declare
  v_app uuid;
  v_invoice text;
  v_denied boolean := false;
begin
  select id into v_app from public.admission_applications
   where student_name = 'Unpaid Child' and current_status = 'offered'
   order by created_at desc limit 1;
  v_invoice := app.admissions_respond_offer(v_app, 'accepted', 1);
  begin
    perform app.enrollment_convert(v_app);
  exception when others then
    v_denied := true;
  end;
  assert v_denied, 'unpaid admission invoice blocks conversion';
  assert (select status from public.invoices where reference = v_invoice) = 'unpaid',
    'readiness denial leaves the admission invoice unpaid';
end $$;
reset role;

-- Duplicate-review resolution is admissions-approver only and candidate-bound:
-- an HR reviewer is denied, and the approver cannot resolve a mismatched
-- candidate. Capture the fixture ids before the RLS-scoped sessions.
select set_config('fass.dup_app_id', (select application_id::text
    from public.admission_duplicate_reviews order by created_at desc limit 1), false);
select set_config('fass.dup_candidate_id', (select candidate_student_id::text
    from public.admission_duplicate_reviews order by created_at desc limit 1), false);
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000007', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
do $$
declare v_denied boolean := false;
begin
  begin
    perform app.admissions_duplicate_review_resolve(
      current_setting('fass.dup_app_id')::uuid,
      current_setting('fass.dup_candidate_id')::uuid,
      'approved', 'school_reference', 'LOCAL-DUP-DENIED', 'Role denial check', null);
  exception when others then
    v_denied := true;
  end;
  assert v_denied, 'hr reviewer cannot resolve duplicate reviews';
end $$;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
do $$
declare v_denied boolean := false;
begin
  begin
    perform app.admissions_duplicate_review_resolve(
      current_setting('fass.dup_app_id')::uuid,
      '00000000-0000-4000-8000-0000000000ff'::uuid,
      'approved', 'school_reference', 'LOCAL-DUP-WRONG', 'Candidate mismatch check', null);
  exception when others then
    v_denied := true;
  end;
  assert v_denied, 'duplicate review rejects a mismatched candidate';
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
  v_restored jsonb;
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

  -- Restrict pauses the active link; restore returns it to the active set with
  -- a version bump. Link decisions are Administrator-only: the support officer
  -- is denied (as with approval), and the administrator performs the change.
  v_denied := false;
  /* The claim must be set outside the exception subtransaction: set_config
     rolls back with the subtransaction, which would silently return the next
     call to the previous administrator identity. */
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
  begin
    perform app.links_restrict(current_setting('fass.link_id', true)::uuid, 'Support restrict attempt', 2);
  exception when others then
    v_denied := true;
  end;
  assert v_denied, 'support officer cannot restrict links (Administrator-only)';
  v_denied := false;
  begin
    perform app.links_capabilities_set(current_setting('fass.link_id', true)::uuid, array['profile'], 2);
  exception when others then
    v_denied := true;
  end;
  assert v_denied, 'support officer cannot change link capabilities (Administrator-only)';
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
  perform app.links_restrict(current_setting('fass.link_id', true)::uuid, 'Support review opened', 2);
  assert (select status from public.guardian_student_links
           where id = current_setting('fass.link_id', true)::uuid) = 'restricted',
    'active link restricted by the system administrator';
  v_restored := app.links_restore(current_setting('fass.link_id', true)::uuid, 'Review completed without findings', 3);
  assert (select status from public.guardian_student_links
           where id = current_setting('fass.link_id', true)::uuid) = 'active',
    'restricted link restored by the system administrator';
  assert (select version from public.guardian_student_links
           where id = current_setting('fass.link_id', true)::uuid) = 4,
    'restore bumps the link version';
  assert (v_restored ->> 'status') = 'active' and (v_restored ->> 'version') = '4',
    'restore returns the new status and version';
  v_denied := false;
  begin
    perform app.links_restore(current_setting('fass.link_id', true)::uuid, 'Repeat restore attempt', 4);
  exception when others then
    v_denied := true;
  end;
  assert v_denied, 'only a restricted link can be restored';
  v_denied := false;
  begin
    perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
    perform app.links_restore(current_setting('fass.link_id', true)::uuid, 'Teacher restore attempt', 4);
  exception when others then
    v_denied := true;
  end;
  assert v_denied, 'teacher without the verification grant cannot restore links';
  perform set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);

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
  assert exists (select 1 from public.notice_audiences na
                  where na.notice_id in (select n.id from public.notices n
                                           join public.content_items ci on ci.id = n.content_item_id
                                          where ci.slug = 'notice-annual-day')
                    and na.audience = 'public'),
    'backfilled public audience row exists for the scheduled seed notice';
  assert (select n.id from public.notices n
            join public.content_items ci on ci.id = n.content_item_id
           where ci.slug = 'notice-annual-day') = any(app.public_notice_ids()),
    'backfilled notice is exposed through app.public_notice_ids()';

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

-- ===========================================================================
-- C2 (000080): scheduled publication and expiry are enqueued and swept.
-- The editor (Rania, ...003) authors the versions; a separate publisher
-- (Nadia Shah, ...008) approves them, so maker/checker stays intact. The due
-- functions run under the service-role claim the worker uses. Direct dates
-- stand in for a fake clock: a future schedule is enqueued with a delayed
-- attempt, then the sweep is exercised by backdating the effective time.
-- ===========================================================================
insert into auth.users (id) values ('10000000-0000-4000-8000-000000000008');
insert into public.people (id, given_name, family_name, display_name) values
  ('20000000-0000-4000-8000-000000000010', 'Nadia', 'Shah', 'Nadia Shah');
insert into public.user_accounts (id, person_id, status, verified_contact) values
  ('10000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-000000000010', 'active', 'content.publisher@example.in');
insert into public.role_grants (account_id, role_code, status, effective_from)
values ('10000000-0000-4000-8000-000000000008', 'content_publisher', 'active', now());

set role authenticated;
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
do $$
declare
  v_draft jsonb;
  v_review jsonb;
begin
  v_draft := app.content_save_draft_v2(null, 'notice', 'c2-schedule-expiry', 'C2 scheduled notice',
    '{"blocks":[{"type":"paragraph","text":"Scheduled body"}]}'::jsonb, null, 'c2-schedule-draft');
  v_review := app.content_request_review((v_draft->>'versionId')::uuid, 1, 'c2-schedule-review');
  assert (v_review->>'status') = 'in_review', 'editor requests review for the scheduled notice';
  perform set_config('c2.item', v_draft->>'id', false);
  perform set_config('c2.review_id', v_review->>'id', false);
  perform set_config('c2.review_version', v_review->>'version', false);
end $$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000008', false);
do $$
declare
  v_approval jsonb;
  v_scheduled jsonb;
  v_replay jsonb;
begin
  v_approval := app.content_approve_version(current_setting('c2.review_id')::uuid, current_setting('c2.review_version')::int, 'c2-schedule-approval');
  v_scheduled := app.content_publish_version_v2((v_approval->>'id')::uuid, (v_approval->>'version')::int, now()+interval '2 hours', null, 'c2-schedule-publish');
  assert (v_scheduled->>'status') = 'scheduled', 'future publish is scheduled';
  v_replay := app.content_publish_version_v2((v_approval->>'id')::uuid, (v_approval->>'version')::int, now()+interval '2 hours', null, 'c2-schedule-publish');
  assert (v_replay->>'status') = 'scheduled', 'scheduled publish replays cleanly';
  perform set_config('c2.version', v_scheduled->>'version', false);
  perform set_config('c2.notice', (select n.id::text from public.notices n where n.content_item_id=current_setting('c2.item')::uuid), false);
  perform set_config('c2.notice_ref', (select n.reference from public.notices n where n.content_item_id=current_setting('c2.item')::uuid), false);
end $$;
reset role;

do $$
declare v_key text;
begin
  v_key := 'content.publish:'||current_setting('c2.notice_ref')||':'||current_setting('c2.version');
  assert (select count(*) from public.outbox_events where event_key=v_key and kind='content.publish' and target_type='notice') = 1,
    'scheduling enqueues exactly one content.publish event';
  assert (select next_attempt_at > now() + interval '90 minutes' from public.outbox_events where event_key=v_key),
    'the content.publish attempt is delayed to the scheduled time';
  assert (select count(*) from public.outbox_events where event_key like 'content.publish:'||current_setting('c2.notice_ref')||':%') = 1,
    'replaying the schedule does not stack a second publish event';
  assert (select count(*) from public.outbox_events where event_key like 'content.expire:'||current_setting('c2.notice_ref')||':%') = 0,
    'a schedule without expiry enqueues no expiry event';
end $$;

update public.notices set scheduled_at=now()-interval '1 minute' where id=current_setting('c2.notice')::uuid;

select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;
do $$
begin
  assert app.content_publish_due() >= 1, 'the service-role sweep publishes the due scheduled notice';
  assert app.content_publish_due() = 0, 'a second publish sweep is a no-op';
end $$;
reset role;

do $$
begin
  assert (select status from public.notices where id=current_setting('c2.notice')::uuid) = 'published',
    'the scheduled notice is published';
  assert (select current_status from public.content_items where id=current_setting('c2.item')::uuid) = 'published',
    'the content item follows the published notice';
  assert (select count(*) from public.audit_events where action='Notice published' and target_reference=current_setting('c2.notice_ref')) = 1,
    'the publish sweep records exactly one audit row';
end $$;

set role authenticated;
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
do $$
declare
  v_draft jsonb;
  v_review jsonb;
begin
  v_draft := app.content_save_draft_v2(null, 'notice', 'c2-expiry', 'C2 expiring notice',
    '{"blocks":[{"type":"paragraph","text":"Expiring body"}]}'::jsonb, null, 'c2-expiry-draft');
  v_review := app.content_request_review((v_draft->>'versionId')::uuid, 1, 'c2-expiry-review');
  perform set_config('c2.expiry_item', v_draft->>'id', false);
  perform set_config('c2.expiry_review_id', v_review->>'id', false);
  perform set_config('c2.expiry_review_version', v_review->>'version', false);
end $$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000008', false);
do $$
declare
  v_approval jsonb;
  v_published jsonb;
begin
  v_approval := app.content_approve_version(current_setting('c2.expiry_review_id')::uuid, current_setting('c2.expiry_review_version')::int, 'c2-expiry-approval');
  v_published := app.content_publish_version_v2((v_approval->>'id')::uuid, (v_approval->>'version')::int, null, now()-interval '1 minute', 'c2-expiry-publish');
  assert (v_published->>'status') = 'published', 'a publish with a past expiry still publishes immediately';
  perform set_config('c2.expiry_version', v_published->>'version', false);
  perform set_config('c2.expiry_notice', (select n.id::text from public.notices n where n.content_item_id=current_setting('c2.expiry_item')::uuid), false);
  perform set_config('c2.expiry_notice_ref', (select n.reference from public.notices n where n.content_item_id=current_setting('c2.expiry_item')::uuid), false);
end $$;
reset role;

do $$
begin
  assert (select count(*) from public.outbox_events
           where event_key like 'content.expire:'||current_setting('c2.expiry_notice_ref')||':%'
             and kind='content.expire' and target_type='notice') = 1,
    'a publish with expiry enqueues exactly one content.expire event';
end $$;

select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;
do $$
begin
  assert app.content_expire_due() >= 1, 'the service-role sweep expires the due notice';
  assert app.content_expire_due() = 0, 'a second expiry sweep is a no-op';
end $$;
reset role;

do $$
begin
  assert (select status from public.notices where id=current_setting('c2.expiry_notice')::uuid) = 'expired',
    'the expired notice leaves the published set';
  assert (select current_status from public.content_items where id=current_setting('c2.expiry_item')::uuid) = 'expired',
    'the content item follows the expired notice';
  assert (select count(*) from public.audit_events where action='Notice expired' and target_reference=current_setting('c2.expiry_notice_ref')) = 1,
    'the expiry sweep records exactly one audit row';
  assert (select count(*) from public.outbox_events
           where event_key like 'content.expired:'||current_setting('c2.expiry_notice_ref')||':%'
             and kind='content.expired' and target_type='notice') = 1,
    'the expiry sweep enqueues exactly one content.expired event';
  assert (select count(*) from public.outbox_events
           where event_key like 'content.expired:'||current_setting('c2.expiry_notice_ref')||':%') = 1,
    'replaying the expiry sweep does not stack a second expired event';
end $$;

-- ===========================================================================
-- C7 (000082): pinned/review-due round-trip and idempotent unpublish.
-- Rania (...003) authors the notice; Nadia (...008) approves, publishes, and
-- unpublishes it so maker/checker stays intact and the replay can be checked.
-- ===========================================================================
set role authenticated;
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
do $$
declare
  v_draft jsonb;
  v_review jsonb;
begin
  v_draft := app.content_save_draft_v2(null, 'notice', 'c7-pinned-notice', 'C7 pinned notice',
    '{"blocks":[{"type":"paragraph","text":"Pinned body"}],"metadata":{"pinned":true,"reviewDue":"2026-12-31","audience":"public"}}'::jsonb, null, 'c7-pinned-draft');
  assert (select pinned from public.notices where content_item_id=(v_draft->>'id')::uuid) = true,
    'draft metadata pins the notice';
  assert (select review_due from public.notices where content_item_id=(v_draft->>'id')::uuid) = '2026-12-31'::date,
    'draft metadata stores the review due date';
  v_review := app.content_request_review((v_draft->>'versionId')::uuid, 1, 'c7-pinned-review');
  assert (v_review->>'status') = 'in_review', 'editor requests review for the pinned notice';
  perform set_config('c7.item', v_draft->>'id', false);
  perform set_config('c7.item_ref', v_draft->>'reference', false);
  perform set_config('c7.review_id', v_review->>'id', false);
  perform set_config('c7.review_version', v_review->>'version', false);
end $$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000008', false);
do $$
declare
  v_approval jsonb;
  v_published jsonb;
begin
  v_approval := app.content_approve_version(current_setting('c7.review_id')::uuid, current_setting('c7.review_version')::int, 'c7-pinned-approval');
  v_published := app.content_publish_version_v2((v_approval->>'id')::uuid, (v_approval->>'version')::int, null, null, 'c7-pinned-publish');
  assert (v_published->>'status') = 'published', 'pinned notice publishes';
  assert (select pinned from public.notices where content_item_id=current_setting('c7.item')::uuid) = true,
    'publish preserves the pinned flag from version metadata';
  assert (select review_due from public.notices where content_item_id=current_setting('c7.item')::uuid) = '2026-12-31'::date,
    'publish preserves the review due date from version metadata';
  perform set_config('c7.version', v_published->>'version', false);
  perform set_config('c7.notice', (select n.id::text from public.notices n where n.content_item_id=current_setting('c7.item')::uuid), false);
  perform set_config('c7.notice_ref', (select n.reference from public.notices n where n.content_item_id=current_setting('c7.item')::uuid), false);
end $$;

do $$
declare
  v_first jsonb;
  v_replay jsonb;
begin
  v_first := app.content_unpublish_v3(current_setting('c7.item')::uuid, 'Superseded by the C7 check', current_setting('c7.version')::int, 'c7-unpublish-key');
  assert (v_first->>'status') = 'archived', 'unpublish archives the pinned notice';
  assert (v_first->>'version') = (current_setting('c7.version')::int + 1)::text, 'unpublish bumps the item version once';
  assert (select status from public.notices where id=current_setting('c7.notice')::uuid) = 'expired',
    'unpublish expires the notice projection';
  v_replay := app.content_unpublish_v3(current_setting('c7.item')::uuid, 'Superseded by the C7 check', current_setting('c7.version')::int, 'c7-unpublish-key');
  assert (v_replay->>'status') = 'archived', 'unpublish replay returns the archived result';
  assert (v_replay->>'replayed') = 'true', 'unpublish replay is marked replayed';
  assert (select version from public.content_items where id=current_setting('c7.item')::uuid) = current_setting('c7.version')::int + 1,
    'unpublish replay does not bump the item version again';
end $$;

do $$
declare
  v_denied boolean := false;
begin
  begin
    perform app.content_unpublish_v3(current_setting('c7.item')::uuid, 'A different reason', null, 'c7-unpublish-key');
  exception when others then
    v_denied := true;
  end;
  assert v_denied, 'reusing an unpublish idempotency key with different input is rejected';
end $$;
reset role;

-- Audit/outbox evidence is staff-invisible; assert it as the database owner.
do $$
begin
  assert (select count(*) from public.audit_events
           where action='Content unpublished' and target_reference=current_setting('c7.item_ref')) = 1,
    'unpublish and its replay append exactly one audit row';
  assert (select count(*) from public.outbox_events where target_reference=current_setting('c7.notice_ref')) = 0,
    'a public-audience notice publish enqueues no email event';
end $$;

-- ===========================================================================
-- C7 gap (000083): a scheduled PUBLIC PAGE stores its instant and publishes
-- when the service-role sweep runs. Rania (...003) authors the page, Nadia
-- (...008) approves and schedules it, and the sweep runs as service_role,
-- mirroring the C2 notice flow. The item has no notices projection, so the
-- schedule lives on `content_items.scheduled_at`.
-- ===========================================================================
set role authenticated;
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
do $$
declare
  v_draft jsonb;
  v_review jsonb;
begin
  v_draft := app.content_save_draft_v2(null, 'page', 'c7-scheduled-page', 'C7 scheduled page',
    '{"blocks":[{"type":"paragraph","text":"Scheduled page body"}],"metadata":{"audience":"public"}}'::jsonb, null, 'c7-page-draft');
  assert not exists (select 1 from public.notices where content_item_id=(v_draft->>'id')::uuid),
    'a page draft never creates a notice projection';
  v_review := app.content_request_review((v_draft->>'versionId')::uuid, 1, 'c7-page-review');
  assert (v_review->>'status') = 'in_review', 'editor requests review for the scheduled page';
  perform set_config('c7.page_item', v_draft->>'id', false);
  perform set_config('c7.page_item_ref', v_draft->>'reference', false);
  perform set_config('c7.page_review_id', v_review->>'id', false);
  perform set_config('c7.page_review_version', v_review->>'version', false);
end $$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000008', false);
do $$
declare
  v_approval jsonb;
  v_scheduled jsonb;
  v_replay jsonb;
begin
  v_approval := app.content_approve_version(current_setting('c7.page_review_id')::uuid, current_setting('c7.page_review_version')::int, 'c7-page-approval');
  v_scheduled := app.content_publish_version_v2((v_approval->>'id')::uuid, (v_approval->>'version')::int, now()+interval '2 hours', null, 'c7-page-schedule');
  assert (v_scheduled->>'status') = 'scheduled', 'future page publish is scheduled';
  assert (select current_status from public.content_items where id=current_setting('c7.page_item')::uuid) = 'scheduled',
    'the page item state follows the schedule';
  assert (select scheduled_at from public.content_items where id=current_setting('c7.page_item')::uuid) > now(),
    'the page item stores the future schedule';
  v_replay := app.content_publish_version_v2((v_approval->>'id')::uuid, (v_approval->>'version')::int, now()+interval '2 hours', null, 'c7-page-schedule');
  assert (v_replay->>'status') = 'scheduled', 'scheduled page publish replays cleanly';
  perform set_config('c7.page_version', v_scheduled->>'version', false);
end $$;
reset role;

do $$
declare v_key text;
begin
  v_key := 'content.publish:'||current_setting('c7.page_item_ref')||':'||current_setting('c7.page_version');
  assert (select count(*) from public.outbox_events where event_key=v_key and kind='content.publish' and target_type='content_item') = 1,
    'scheduling a page enqueues exactly one content.publish event';
  assert (select count(*) from public.outbox_events where event_key like 'content.publish:'||current_setting('c7.page_item_ref')||':%') = 1,
    'replaying the page schedule does not stack a second publish event';
end $$;

update public.content_items set scheduled_at=now()-interval '1 minute' where id=current_setting('c7.page_item')::uuid;

select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;
do $$
begin
  assert app.content_publish_due() >= 1, 'the service-role sweep publishes the due scheduled page';
  assert app.content_publish_due() = 0, 'a second publish sweep is a no-op';
end $$;
reset role;

do $$
begin
  assert (select current_status from public.content_items where id=current_setting('c7.page_item')::uuid) = 'published',
    'the scheduled page is published';
  assert (select scheduled_at from public.content_items where id=current_setting('c7.page_item')::uuid) is null,
    'the published page clears its schedule';
  assert (select version from public.content_items where id=current_setting('c7.page_item')::uuid) = current_setting('c7.page_version')::int + 1,
    'the sweep appends and points at the published version';
  assert (select review_status from public.content_versions where id=(select current_version_id from public.content_items where id=current_setting('c7.page_item')::uuid)) = 'published',
    'the appended page version is published';
  assert (select count(*) from public.audit_events
           where action='Content published' and target_type='content_item' and target_reference=current_setting('c7.page_item_ref')) = 1,
    'the page publish sweep records exactly one audit row';
  assert (select count(*) from public.outbox_events
           where event_key like 'content.scheduled_published:'||current_setting('c7.page_item_ref')||':%' and target_type='content_item') = 1,
    'the page publish sweep enqueues exactly one scheduled_published event';
  assert (select count(*) from public.outbox_events where target_reference=current_setting('c7.page_item_ref')) = 2,
    'the page schedule holds exactly the publish trigger and the published event';
end $$;

-- C8. School-data import validation, resolution, and export retry (000086).
-- A non-administrator cannot create an import batch.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
set role authenticated;
do $$
declare
  v_denied boolean := false;
  v_year uuid;
begin
  select id into v_year from public.academic_years where label = '2026-27';
  begin
    perform app.data_import_create_batch(v_year, 'denied import', null, true, true);
  exception when others then
    v_denied := true;
  end;
  assert v_denied, 'a non-administrator cannot create an import batch';
end $$;
reset role;

-- The Administrator walks upload intent → scan → mapping → validation →
-- resolution → ready → commit, then retries a failed export.
reset role;
insert into public.data_export_requests (reference, domain, state, format, filters, columns, purpose, reason, requested_by_account_id)
values ('EXP-2026-C8-0001', 'students', 'failed', 'csv', '{}'::jsonb, '[]'::jsonb, 'rpc suite', 'rpc suite', '10000000-0000-4000-8000-000000000004');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
set role authenticated;
do $$
declare
  v_year uuid;
  v_batch jsonb;
  v_doc jsonb;
begin
  select id into v_year from public.academic_years where label = '2026-27';
  assert v_year is not null, 'an academic year exists for imports';
  -- The private source document boundary accepts the import batch owner.
  v_batch := app.data_import_create_batch(v_year, 'rpc-suite-import', null, true, true);
  v_doc := app.documents_create_upload_intent(
    'data_import_batch', (v_batch ->> 'batchId')::uuid, 'source_csv', 'roster.csv', 'text/csv', 120,
    array['text/csv'], 5242880, 'uploads/' || gen_random_uuid()::text || '.csv');
  perform set_config('c8.batch_id', v_batch ->> 'batchId', false);
  perform set_config('c8.doc_id', v_doc ->> 'id', false);
  assert (v_doc ->> 'reference') is not null, 'the import source upload intent is created';
  assert (v_doc -> 'objectKey')::text like '%.csv%', 'the CSV object key is accepted';
end $$;
reset role;

-- The provider worker finalises, links, and scans the private source; a clean
-- scan starts the import (the same path the outbox worker runs).
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select app.documents_finalize_upload(current_setting('c8.doc_id')::uuid, 'text/csv', 120, repeat('a', 64));
select app.documents_link_attachment(current_setting('c8.doc_id')::uuid, 'data_import_batch', current_setting('c8.batch_id')::uuid, 'source_csv');
select app.documents_apply_scan(current_setting('c8.doc_id')::uuid, 'ready', 'rpc suite');
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
set role authenticated;
do $$
declare
  v_batch_id uuid := current_setting('c8.batch_id')::uuid;
  v_state text;
begin
  select state into v_state from public.data_import_batches where id = v_batch_id;
  assert v_state = 'scanning', 'a clean import source moves the batch to scanning';
  perform app.data_import_record_scan(v_batch_id, 1, 2, '["entity","source_key"]'::jsonb, 'utf-8', null);
  assert (app.data_import_record_mapping(v_batch_id, null, '{"entity":{"targetField":"entity"}}'::jsonb) ->> 'state') = 'validating',
    'recording the mapping moves the batch to validating';
  perform app.data_import_store_rows(
    v_batch_id,
    jsonb_build_array(jsonb_build_object(
      'rowNumber', 2, 'entity', 'students', 'sourceKey', 'RPC-STU-X',
      'normalized', jsonb_build_object('givenName', ''), 'status', 'pending')));
end $$;
reset role;

-- Roster payloads stay service/admin-only, so the row id is read at the
-- server boundary and carried into the next authenticated command block.
select set_config('c8.row_id', id::text, false)
  from public.data_import_rows
 where batch_id = current_setting('c8.batch_id')::uuid and source_key = 'RPC-STU-X';

select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
set role authenticated;
do $$
declare
  v_batch_id uuid := current_setting('c8.batch_id')::uuid;
  v_row_id uuid := current_setting('c8.row_id')::uuid;
  v_apply jsonb;
  v_finish jsonb;
  v_issue_id uuid;
  v_res jsonb;
  v_detail jsonb;
  v_commit jsonb;
  v_export_ref text;
  v_retry jsonb;
begin
  v_apply := app.data_import_apply_validation(
    v_batch_id,
    jsonb_build_array(jsonb_build_object('rowId', v_row_id, 'status', 'error')),
    jsonb_build_array(jsonb_build_object(
      'rowId', v_row_id, 'rowNumber', 2, 'severity', 'error', 'code', 'missing_required_field',
      'field', 'givenName', 'message', 'missing name', 'resolutionHint', 'map the name column')));
  assert (v_apply ->> 'errorCount')::int = 1, 'server validation records the row issue';

  v_finish := app.data_import_finish_validation(v_batch_id, (v_apply ->> 'version')::int);
  assert (v_finish ->> 'state') = 'needs_resolution', 'unresolved errors hold the batch for resolution';

  select id into v_issue_id from public.data_import_issues where batch_id = v_batch_id limit 1;
  v_res := app.data_import_resolve_issue(v_batch_id, v_row_id, v_issue_id, 'skip', null, 'wrong row');
  assert (v_res ->> 'resolution') = 'skip', 'the issue resolution is recorded';
  perform app.data_import_resolve_issue(v_batch_id, v_row_id, v_issue_id, 'skip', null, 'wrong row');
  assert (select count(*) from public.data_import_resolutions where issue_id = v_issue_id) = 1,
    'an idempotent resolution replay does not duplicate the record';

  v_finish := app.data_import_finish_validation(v_batch_id, (select version from public.data_import_batches where id = v_batch_id));
  assert (v_finish ->> 'state') = 'ready', 'resolved errors make the batch ready';

  v_detail := app.data_import_get_batch(v_batch_id);
  assert (v_detail ->> 'hasSourceDocument')::boolean, 'the batch detail reports its source document';
  assert (v_detail -> 'scanHeaders') is not null, 'the batch detail exposes scan headers only';

  v_commit := app.data_import_commit(
    v_batch_id, (v_detail ->> 'version')::int, 'rpc suite import commit', 'rpc-suite-import-commit-1', 0, 0);
  assert (v_commit ->> 'state') = 'completed', 'the import commits once and closes';
  assert (v_commit ->> 'skippedCount')::int = 1,
    'the commit result counts the row skipped before commit (000110)';
  assert (select commit_result ->> 'skippedCount' from public.data_import_batches where id = v_batch_id) = (v_commit ->> 'skippedCount'),
    'the stored commit summary counts the persisted skipped row (000110)';

  -- Export retry re-queues a failed request under a new provider-job key.
  v_export_ref := 'EXP-2026-C8-0001';
  v_retry := app.data_export_retry(v_export_ref, 'retry after provider outage');
  assert (v_retry ->> 'state') = 'requested', 'a failed export can be retried';
end $$;
reset role;

-- Row effects from the resolution and the retry job are server-visible after
-- the commands; neither is readable through the browser projection.
do $$
declare
  v_row_id uuid := current_setting('c8.row_id')::uuid;
begin
  assert (select status from public.data_import_rows where id = v_row_id) = 'skipped',
    'skipping applies the row effect the commit matrix reads';
  assert (select count(*) from public.provider_jobs where target_reference = 'EXP-2026-C8-0001' and job_kind = 'data_export_generate') = 1,
    'the export retry enqueues exactly one generation job';
end $$;

-- C9. Hot-path repairs (000110): notification read state, export pagination
-- page boundaries, and the stored import skip summary. All three defects were
-- reproduced on the pre-000110 chain and these assertions fail without the
-- forward migration.
insert into auth.users (id) values ('10000000-0000-4000-8000-000000000009');
insert into public.people (id, given_name, family_name, display_name) values
  ('20000000-0000-4000-8000-000000000011', 'Nusrat', 'Bano', 'Nusrat Bano');
insert into public.user_accounts (id, person_id, status, verified_contact) values
  ('10000000-0000-4000-8000-000000000009', '20000000-0000-4000-8000-000000000011', 'active', 'notifications.fixture@example.in');
insert into public.in_app_notifications (recipient_account_id, kind, title, body) values
  ('10000000-0000-4000-8000-000000000009', 'Security', 'Fixture notification one', 'first'),
  ('10000000-0000-4000-8000-000000000009', 'Security', 'Fixture notification two', 'second');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000009', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
set role authenticated;
do $$
declare
  v_id uuid;
  v_read jsonb;
  v_count int;
begin
  select id into v_id from public.in_app_notifications
   where recipient_account_id = '10000000-0000-4000-8000-000000000009'
   order by title limit 1;
  v_read := app.notifications_mark_read(v_id, 1);
  assert (v_read ->> 'readAt') is not null, 'mark-read records the read timestamp';
  assert (v_read ->> 'version')::int = 2, 'mark-read bumps the notification version';
  v_read := app.notifications_mark_read(v_id, 2);
  assert (v_read ->> 'version')::int = 2, 'mark-read replay at the stored version is idempotent';
  select count(*) into v_count from public.in_app_notifications
   where recipient_account_id = '10000000-0000-4000-8000-000000000009' and read_at is null;
  assert v_count = 1, 'the fixture keeps exactly one unread notification for mark-all';
  assert app.notifications_mark_all() = 1, 'mark-all clears the remaining unread notification';
  assert (select count(*) from public.in_app_notifications
           where recipient_account_id = '10000000-0000-4000-8000-000000000009' and read_at is null) = 0,
    'no unread notification remains after mark-all';
end $$;
reset role;

insert into public.data_export_requests (reference, domain, state, format, filters, columns, purpose, reason, requested_by_account_id, created_at)
values
  ('EXP-2026-C9-0001', 'students', 'ready', 'csv', '{}'::jsonb, '[]'::jsonb, 'page boundary', 'page boundary', '10000000-0000-4000-8000-000000000004', now() - interval '3 minutes'),
  ('EXP-2026-C9-0002', 'students', 'ready', 'csv', '{}'::jsonb, '[]'::jsonb, 'page boundary', 'page boundary', '10000000-0000-4000-8000-000000000004', now() - interval '2 minutes'),
  ('EXP-2026-C9-0003', 'students', 'ready', 'csv', '{}'::jsonb, '[]'::jsonb, 'page boundary', 'page boundary', '10000000-0000-4000-8000-000000000004', now() - interval '1 minutes');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
set role authenticated;
do $$
declare
  v_page jsonb;
  v_cursor text;
  v_seen text[] := '{}';
  v_full text[];
  v_guard int := 0;
  v_row jsonb;
  v_last jsonb;
begin
  select array_agg(r ->> 'reference' order by (r ->> 'createdAt')::timestamptz desc, r ->> 'reference' desc)
    into v_full
    from jsonb_array_elements(app.data_export_list_paginated(null, 100) -> 'rows') r;
  assert coalesce(array_length(v_full, 1), 0) >= 3, 'the export list holds the pagination fixtures';
  loop
    v_guard := v_guard + 1;
    assert v_guard <= 100, 'the export pagination walk terminates';
    v_page := app.data_export_list_paginated(v_cursor, 2);
    for v_row in select r from jsonb_array_elements(v_page -> 'rows') r loop
      assert not ((v_row ->> 'reference') = any(v_seen)), 'consecutive export pages do not overlap';
      v_seen := v_seen || (v_row ->> 'reference');
    end loop;
    if jsonb_array_length(v_page -> 'rows') > 0 then
      v_last := (v_page -> 'rows') -> (jsonb_array_length(v_page -> 'rows') - 1);
      assert (v_page ->> 'nextCursor') is null
          or (split_part(v_page ->> 'nextCursor', '|', 1)::timestamptz = (v_last ->> 'createdAt')::timestamptz
              and split_part(v_page ->> 'nextCursor', '|', 2) = v_last ->> 'reference'),
        'the export cursor is the last row key on the page';
    end if;
    v_cursor := v_page ->> 'nextCursor';
    exit when v_cursor is null;
  end loop;
  assert v_seen = v_full, 'the export pages cover the full ordered list exactly once';
end $$;
reset role;

-- C10. Import/export read repairs (000112): the report counts the rows
-- skipped before commit, the paged import reads return totals with correct
-- cursor arithmetic, and a failed export carries its reason in the list
-- projection. These assertions fail on the pre-000112 chain.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
set role authenticated;
do $$
declare
  v_report jsonb;
  v_stored text;
begin
  v_report := app.data_import_report(current_setting('c8.batch_id')::uuid);
  v_stored := (select commit_result ->> 'skippedCount'
                 from public.data_import_batches
                where id = current_setting('c8.batch_id')::uuid);
  assert (v_report ->> 'skippedCount')::int = 1,
    'the import report counts the row skipped before commit (000112)';
  assert (v_report ->> 'skippedCount') = v_stored,
    'the import report agrees with the stored commit summary (000112)';
end $$;
reset role;

-- Paged-read fixtures. Distinct created_at values keep the ordering
-- deterministic across both the legacy and the paged reads.
insert into public.data_import_batches
  (reference, state, source_system, academic_year_id, row_count, created_by_account_id,
   authority_confirmation, privacy_confirmation, created_at)
select 'IMP-2026-C10-' || lpad(g::text, 4, '0'), 'completed', 'rpc-suite-page',
       (select id from public.academic_years where label = '2026-27'),
       1, '10000000-0000-4000-8000-000000000004', true, true, now() - (g || ' hours')::interval
  from generate_series(1, 7) g;

insert into public.data_import_issues (batch_id, row_number, severity, code, message)
select current_setting('c8.batch_id')::uuid, 1000 + g,
       case when g % 2 = 0 then 'error' else 'warning' end,
       'missing_required_field', 'paged issue ' || g
  from generate_series(1, 7) g;

select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
set role authenticated;
do $$
declare
  v_batch_id uuid := current_setting('c8.batch_id')::uuid;
  v_full text[];
  v_seen text[] := '{}';
  v_page jsonb;
  v_offset int := 0;
  v_next int;
  v_total int;
  v_guard int := 0;
  v_row jsonb;
  v_denied boolean;
begin
  -- Batch pagination: the legacy read is the coverage oracle; the walk must
  -- carry the same total, no overlap, and matching next-offset arithmetic.
  select array_agg(b ->> 'reference') into v_full
    from app.data_import_list_batches() b;
  assert coalesce(array_length(v_full, 1), 0) > 7, 'the paged batch fixtures exist';
  loop
    v_guard := v_guard + 1;
    assert v_guard <= 50, 'the batch pagination walk terminates';
    v_page := app.data_import_list_batches_paginated(50, v_offset);
    v_total := (v_page ->> 'total')::int;
    v_next := case when v_page ->> 'nextOffset' is null then null else (v_page ->> 'nextOffset')::int end;
    assert v_total = array_length(v_full, 1), 'the batch total matches the full set';
    for v_row in select r from jsonb_array_elements(v_page -> 'rows') r loop
      assert not ((v_row ->> 'reference') = any(v_seen)), 'batch pages do not overlap';
      assert (v_row ->> 'reference') = any(v_full), 'every paged batch is in the legacy set';
      v_seen := v_seen || (v_row ->> 'reference');
    end loop;
    exit when v_next is null;
    assert v_next = v_offset + jsonb_array_length(v_page -> 'rows'),
      'the batch nextOffset is the next row offset';
    v_offset := v_next;
  end loop;
  assert array_length(v_seen, 1) = array_length(v_full, 1),
    'the batch pages cover every batch exactly once';

  -- Issue pagination: same walk, and the paged order must equal the legacy
  -- severity/row_number order exactly.
  select array_agg(i ->> 'issueId') into v_full
    from app.data_import_list_issues(v_batch_id, null) i;
  v_seen := '{}';
  v_offset := 0;
  loop
    v_guard := v_guard + 1;
    assert v_guard <= 100, 'the issue pagination walk terminates';
    v_page := app.data_import_list_issues_paginated(v_batch_id, null, 3, v_offset);
    v_total := (v_page ->> 'total')::int;
    v_next := case when v_page ->> 'nextOffset' is null then null else (v_page ->> 'nextOffset')::int end;
    assert v_total = array_length(v_full, 1), 'the issue total matches the full set';
    for v_row in select r from jsonb_array_elements(v_page -> 'rows') r loop
      assert v_row ? 'rowId', 'the paged issue projection carries the row identity';
      v_seen := v_seen || (v_row ->> 'issueId');
    end loop;
    exit when v_next is null;
    assert v_next = v_offset + jsonb_array_length(v_page -> 'rows'),
      'the issue nextOffset is the next row offset';
    v_offset := v_next;
  end loop;
  assert v_seen = v_full, 'the issue pages cover the legacy order exactly once';

  -- Filters, clamps, and refusal paths.
  v_page := app.data_import_list_issues_paginated(v_batch_id, 'error', 100, 0);
  assert (v_page ->> 'total')::int
      = (select count(*) from public.data_import_issues where batch_id = v_batch_id and severity = 'error'),
    'the severity filter bounds the issue total';
  v_page := app.data_import_list_issues_paginated(v_batch_id, null, 0, -5);
  assert jsonb_array_length(v_page -> 'rows') = 1, 'limit 0 clamps to one row';
  assert (v_page -> 'rows' -> 0 ->> 'issueId') = v_full[1], 'a negative offset clamps to the first row';

  v_denied := false;
  begin
    perform app.data_import_list_issues_paginated(v_batch_id, 'fatal', 10, 0);
  exception when others then v_denied := true;
  end;
  assert v_denied, 'an invalid issue severity is refused';
  v_denied := false;
  begin
    perform app.data_import_list_issues_paginated('00000000-0000-4000-8000-00000000dead', null, 10, 0);
  exception when others then v_denied := true;
  end;
  assert v_denied, 'an unknown import batch is refused';
end $$;
reset role;

-- A staff account without the administrator profile cannot use either paged
-- read, even at AAL2.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000007', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
set role authenticated;
do $$
declare
  v_denied boolean;
begin
  v_denied := false;
  begin
    perform app.data_import_list_batches_paginated(10, 0);
  exception when others then v_denied := true;
  end;
  assert v_denied, 'a non-administrator cannot page the import batch list (000112)';
  v_denied := false;
  begin
    perform app.data_import_list_issues_paginated(current_setting('c8.batch_id')::uuid, null, 10, 0);
  exception when others then v_denied := true;
  end;
  assert v_denied, 'a non-administrator cannot page the import issue list (000112)';
end $$;
reset role;

-- Export failure detail: request event, provider job (worker died before
-- recording), and the legacy outbox fallback; the detail is bounded at 500.
insert into public.data_export_requests (reference, domain, state, format, filters, columns, purpose, reason, requested_by_account_id, created_at)
values
  ('EXP-2026-C10-0001', 'students', 'failed', 'csv', '{}'::jsonb, '[]'::jsonb, 'failure detail', 'failure detail', '10000000-0000-4000-8000-000000000004', now() - interval '4 minutes'),
  ('EXP-2026-C10-0002', 'students', 'generating', 'csv', '{}'::jsonb, '[]'::jsonb, 'failure detail', 'failure detail', '10000000-0000-4000-8000-000000000004', now() - interval '3 minutes'),
  ('EXP-2026-C10-0003', 'students', 'failed', 'csv', '{}'::jsonb, '[]'::jsonb, 'failure detail', 'failure detail', '10000000-0000-4000-8000-000000000004', now() - interval '2 minutes'),
  ('EXP-2026-C10-0004', 'students', 'failed', 'csv', '{}'::jsonb, '[]'::jsonb, 'failure detail', 'failure detail', '10000000-0000-4000-8000-000000000004', now() - interval '1 minutes');

insert into public.data_export_events (request_id, event_type, detail)
select id, 'failed', 'queue refused the artifact upload'
  from public.data_export_requests where reference = 'EXP-2026-C10-0001';
insert into public.data_export_events (request_id, event_type, detail)
select id, 'failed', repeat('x', 900)
  from public.data_export_requests where reference = 'EXP-2026-C10-0004';

insert into public.provider_jobs (job_kind, target_type, target_reference, idempotency_key, status, attempts, last_error, finished_at)
values ('data_export_generate', 'data_export_request', 'EXP-2026-C10-0002',
        'data-export:EXP-2026-C10-0002:1', 'failed', 10,
        'worker died before recording the failure', now() - interval '3 minutes');

insert into public.outbox_events (event_key, kind, target_type, target_reference, status, attempts, last_error)
values ('data_export_generate:EXP-2026-C10-0003:v1', 'data_export_generate', 'data_export_request',
        'EXP-2026-C10-0003', 'failed', 10, 'legacy outbox error detail');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
set role authenticated;
do $$
declare
  v_row jsonb;
begin
  select r into v_row from jsonb_array_elements(app.data_export_list_paginated(null, 100) -> 'rows') r
   where r ->> 'reference' = 'EXP-2026-C10-0001';
  assert v_row is not null, 'the failed export fixture is on the first page';
  assert (v_row ->> 'lastEventType') = 'failed', 'the request failure event is the latest signal';
  assert (v_row ->> 'lastEventDetail') = 'queue refused the artifact upload',
    'the request failure detail is exposed';
  assert (v_row ->> 'failedAt') is not null, 'the request failure time is exposed';

  select r into v_row from jsonb_array_elements(app.data_export_list_paginated(null, 100) -> 'rows') r
   where r ->> 'reference' = 'EXP-2026-C10-0002';
  assert (v_row ->> 'lastEventType') = 'failed', 'a failed provider job is a failure signal';
  assert (v_row ->> 'lastEventDetail') = 'worker died before recording the failure',
    'the provider-job failure detail is the fallback';
  assert (v_row ->> 'failedAt') is not null, 'the provider-job failure time is exposed';

  select r into v_row from jsonb_array_elements(app.data_export_list_paginated(null, 100) -> 'rows') r
   where r ->> 'reference' = 'EXP-2026-C10-0003';
  assert (v_row ->> 'lastEventDetail') = 'legacy outbox error detail',
    'the legacy outbox failure detail is the fallback';

  select r into v_row from jsonb_array_elements(app.data_export_list_paginated(null, 100) -> 'rows') r
   where r ->> 'reference' = 'EXP-2026-C10-0004';
  assert length(v_row ->> 'lastEventDetail') = 500, 'the failure detail is bounded to 500 characters';

  select r into v_row from jsonb_array_elements(app.data_export_list_paginated(null, 100) -> 'rows') r
   where r ->> 'reference' = 'EXP-2026-C9-0001';
  assert (v_row ->> 'failedAt') is null, 'a ready export carries no failure time';
  assert (v_row ->> 'lastEventDetail') is null, 'a ready export with no events carries no detail';
end $$;
reset role;

-- =============================================================================
-- Scale hot paths (000114): guardian-link queue paging, staff document paging,
-- and the per-statement result-entry scope snapshot.
-- =============================================================================

-- Fixtures (postgres): three guardian links with distinct statuses for the
-- guardian created by the RLS suite, plus two student-owned documents and one
-- school document. `enrollment_invitation` skips the claim-source audit
-- trigger, which requires an authenticated actor.
insert into public.guardian_student_links
  (reference, guardian_id, student_id, relationship_label, status, verification_source, effective_from)
select 'LINK-2026-C11-000' || row_number() over (order by st.reference),
       g.id, st.id, 'Parent',
       case row_number() over (order by st.reference) when 1 then 'active' when 2 then 'restricted' else 'pending_verification' end,
       'enrollment_invitation', now() - interval '1 day'
  from public.guardians g
  cross join (select id, reference from public.students order by reference limit 3) st
 where g.person_id = '20000000-0000-4000-8000-000000000001';

insert into public.documents
  (reference, owner_domain, owner_record_id, category, object_key, safe_filename, mime_type,
   size_bytes, scan_status, visibility, finalized_at, checksum_verified)
select 'DOC-2026-C11-000' || row_number() over (order by st.reference),
       'student', st.id, 'student_record', 'rpc-suite/c11-' || st.reference || '.pdf',
       'c11-record.pdf', 'application/pdf', 4096, 'ready', 'private', now() - interval '1 hour', true
  from (select s.id, s.reference from public.students s
         where exists (select 1 from public.enrollments e where e.student_id = s.id)
         order by s.reference limit 2) st;

insert into public.documents
  (reference, owner_domain, owner_record_id, category, object_key, safe_filename, mime_type,
   size_bytes, scan_status, visibility, finalized_at, checksum_verified)
values ('DOC-2026-C11-0003', 'school_document', '55555555-5555-4555-8555-555555555555', 'school_policy',
        'rpc-suite/c11-policy.pdf', 'c11-policy.pdf', 'application/pdf', 4096, 'ready', 'private',
        now() - interval '1 hour', true);

-- Two result sheets: one inside and one outside the scoped role below.
insert into public.exam_definitions (academic_year_id, grade_section_id, term, status)
select (select id from public.academic_years where label = '2026-27'),
       (select gs.id from public.grade_sections gs join public.grades g on g.id = gs.grade_id
         where g.code = '9' and gs.section_label = 'C'),
       'rpc-suite-c11', 'open';
insert into public.result_entry_sheets
  (reference, exam_definition_id, academic_year_id, grade_section_id, subject_id, state, version)
select 'RES-2026-C11-0001', ed.id, ed.academic_year_id, ed.grade_section_id, sub.id, 'draft', 1
  from public.exam_definitions ed
  cross join (select id from public.subjects where code = 'MAT') sub
 where ed.term = 'rpc-suite-c11';
insert into public.result_entry_sheets
  (reference, exam_definition_id, academic_year_id, grade_section_id, subject_id, state, version)
select 'RES-2026-C11-0002', ed.id, ed.academic_year_id, ed.grade_section_id, sub.id, 'draft', 1
  from public.exam_definitions ed
  cross join (select id from public.subjects where code = 'SCI') sub
 where ed.term = 'rpc-suite-c11';

-- Scoped publisher: restricted to the subject of the first suite sheet, so
-- exactly one of the two sheets is in scope.
insert into auth.users (id) values ('10000000-0000-4000-8000-000000000012');
insert into public.people (id, given_name, family_name, display_name)
  values ('20000000-0000-4000-8000-000000000012', 'Scoped', 'Publisher', 'Scoped Publisher');
insert into public.user_accounts (id, person_id, status, verified_contact)
  values ('10000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000012', 'active', 'scoped.publisher@example.in');
insert into public.role_grants (id, account_id, role_code, status, effective_from)
  values ('30000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000012', 'result_publisher', 'active', now());
insert into public.role_grant_subjects (role_grant_id, subject_id)
select '30000000-0000-4000-8000-000000000012', res.subject_id
  from public.result_entry_sheets res where res.reference = 'RES-2026-C11-0001';

-- Guardian-link paging under the administrator actor.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
set role authenticated;
do $$
declare
  v_status text;
  v_full uuid[];
  v_seen uuid[];
  v_page jsonb;
  v_offset int;
  v_next int;
  v_row jsonb;
  v_guard int;
  v_denied boolean;
begin
  foreach v_status in array array['active', 'restricted', 'pending_verification'] loop
    select array_agg(l.id order by l.created_at asc, l.id asc) into v_full
      from public.guardian_student_links l where l.status = v_status;
    assert coalesce(array_length(v_full, 1), 0) >= 1, 'the link fixtures exist for ' || v_status;
    v_seen := '{}';
    v_offset := 0;
    v_guard := 0;
    loop
      v_guard := v_guard + 1;
      assert v_guard <= 50, 'the link pagination walk terminates';
      v_page := app.guardian_link_requests_list_paginated(v_status, 2, v_offset);
      assert (v_page ->> 'total')::int = array_length(v_full, 1), 'the link total matches the table count';
      for v_row in select r from jsonb_array_elements(v_page -> 'rows') r loop
        assert not (((v_row ->> 'id')::uuid) = any(v_seen)), 'link pages do not overlap';
        assert (v_row ->> 'id')::uuid = any(v_full), 'every paged link exists';
        assert v_row ? 'guardian_name' and v_row ? 'student_name' and v_row ? 'student_reference',
          'the paged link projection carries the staff display fields';
        assert v_row ? 'guardian_link_capabilities', 'the paged link projection carries capabilities';
        v_seen := v_seen || ((v_row ->> 'id')::uuid);
      end loop;
      v_next := case when v_page ->> 'nextOffset' is null then null else (v_page ->> 'nextOffset')::int end;
      exit when v_next is null;
      assert v_next = v_offset + jsonb_array_length(v_page -> 'rows'),
        'the link nextOffset is the next row offset';
      v_offset := v_next;
    end loop;
    assert v_seen = v_full, 'the link pages cover the full ordered set exactly once';
  end loop;

  -- Clamps and refusals.
  v_page := app.guardian_link_requests_list_paginated('active', 0, -5);
  assert jsonb_array_length(v_page -> 'rows') = 1, 'link limit 0 clamps to one row';
  v_page := app.guardian_link_requests_list_paginated('active', 5000, 0);
  assert jsonb_array_length(v_page -> 'rows') <= 200, 'the link limit clamps to 200';
  v_denied := false;
  begin
    perform app.guardian_link_requests_list_paginated('ended', 10, 0);
  exception when others then v_denied := true;
  end;
  assert v_denied, 'an unsupported link status is refused';

  -- The single-link read matches the paged row exactly.
  select r into v_row from jsonb_array_elements(app.guardian_link_requests_list_paginated('active', 50, 0) -> 'rows') r limit 1;
  assert app.guardian_link_get((v_row ->> 'id')::uuid) = v_row,
    'guardian_link_get returns the exact paged projection';
end $$;
reset role;

-- A guardian cannot read the staff link queue.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
set role authenticated;
do $$
declare v_denied boolean;
begin
  v_denied := false;
  begin
    perform app.guardian_link_requests_list_paginated('active', 10, 0);
  exception when others then v_denied := true;
  end;
  assert v_denied, 'a guardian cannot read the staff link queue';
  assert app.guardian_link_get((select id from public.guardian_student_links where status = 'active' limit 1)) is null,
    'guardian_link_get denies the guardian actor';
end $$;
reset role;

-- AAL1 staff must be refused (000114 NULL-safe is_staff_aal2).
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
select set_config('request.jwt.claims', '{}', false);
set role authenticated;
do $$
declare v_denied boolean;
begin
  assert app.is_staff_aal2() = false, 'a token without an aal claim is not staff AAL2';
  v_denied := false;
  begin
    perform app.guardian_link_requests_list_paginated('active', 10, 0);
  exception when others then v_denied := true;
  end;
  assert v_denied, 'an AAL1 staff caller cannot read the link queue';
end $$;
reset role;

-- Staff document paging under the multi-role staff actor: the legacy
-- projection is the oracle, row for row and in order.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
set role authenticated;
do $$
declare
  v_legacy jsonb[];
  v_paged jsonb[] := '{}';
  v_rows jsonb[];
  v_page jsonb;
  v_offset int := 0;
  v_guard int := 0;
  v_total int;
  v_owner_id uuid;
  v_owner_reference text;
  v_owner_total int;
begin
  select array_agg(row) into v_legacy
    from (select app.documents_projection_list(null, null) as row) r;
  assert coalesce(array_length(v_legacy, 1), 0) >= 3, 'the document fixtures are visible to the staff actor';
  loop
    v_guard := v_guard + 1;
    assert v_guard <= 200, 'the document pagination walk terminates';
    v_page := app.documents_projection_list_paginated(null, null, 2, v_offset);
    v_total := (v_page ->> 'total')::int;
    assert v_total = array_length(v_legacy, 1), 'the document total matches the legacy projection';
    select array_agg(value) into v_rows from jsonb_array_elements(v_page -> 'rows') e(value);
    if v_rows is not null then v_paged := v_paged || v_rows; end if;
    if v_page ->> 'nextOffset' is null then exit; end if;
    assert (v_page ->> 'nextOffset')::int = v_offset + jsonb_array_length(v_page -> 'rows'),
      'the document nextOffset is the next row offset';
    v_offset := (v_page ->> 'nextOffset')::int;
  end loop;
  assert v_paged = v_legacy, 'the document pages equal the legacy projection in order';

  -- Clamps and the single-reference read.
  v_page := app.documents_projection_list_paginated(null, null, 0, -5);
  assert jsonb_array_length(v_page -> 'rows') = 1, 'document limit 0 clamps to one row';
  v_page := app.documents_projection_list_paginated(null, null, 5000, 0);
  assert jsonb_array_length(v_page -> 'rows') <= 200, 'the document limit clamps to 200';
  assert app.documents_projection_get(v_legacy[1] ->> 'reference') = v_legacy[1],
    'documents_projection_get returns the exact legacy projection for one reference';

  -- Owner-filtered paging keeps the legacy filter semantics. The projection's
  -- `id` is the document id; resolve the owner record through its reference.
  select (r.row ->> 'ownerReference') into v_owner_reference
    from (select app.documents_projection_list('student', null) as row) r limit 1;
  select id into v_owner_id from public.students where reference = v_owner_reference;
  assert v_owner_id is not null, 'a student-owned document is visible to the staff actor';
  select count(*) into v_owner_total
    from (select app.documents_projection_list('student', v_owner_id) as row) r;
  v_page := app.documents_projection_list_paginated('student', v_owner_id, 10, 0);
  assert (v_page ->> 'total')::int = v_owner_total, 'the owner filter bounds the document total';
  assert (v_page -> 'rows' -> 0 ->> 'ownerReference') = v_owner_reference,
    'the owner filter keeps the owning reference projection';
end $$;
reset role;

-- Results scope: the rebuilt list must agree per sheet with the unchanged
-- per-sheet predicate, including a restricted grant and the officer branch.
-- The sheet id list is captured as postgres because RLS already filters the
-- table by the same predicate (the negative case needs the full list).
select set_config('c11.sheet_ids',
  (select string_agg(id::text, ',' order by reference) from public.result_entry_sheets where reference like 'RES-2026-C11-%'),
  false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000012', false);
set role authenticated;
do $$
declare
  v_sheet_id uuid;
  v_scope boolean;
  v_in_list boolean;
  v_checked int := 0;
  v_mismatch int := 0;
  v_scoped_allow int := 0;
begin
  foreach v_sheet_id in array string_to_array(current_setting('c11.sheet_ids'), ',')::uuid[] loop
    v_scope := app.result_entry_sheet_scope(v_sheet_id, array['teacher','exam_reviewer','result_publisher','auditor']);
    v_in_list := exists (select 1 from app.results_entry_sheet_list() r where r ->> 'id' = v_sheet_id::text);
    v_checked := v_checked + 1;
    if v_scope then v_scoped_allow := v_scoped_allow + 1; end if;
    if v_scope is distinct from v_in_list then v_mismatch := v_mismatch + 1; end if;
  end loop;
  assert v_checked = 2, 'the result sheet fixtures exist';
  assert v_scoped_allow = 1, 'the restricted grant sees exactly its own sheet';
  assert v_mismatch = 0, 'the rebuilt list matches the per-sheet scope for a restricted grant';
end $$;
reset role;

-- Boxes vs the unchanged scope helper across every distinct sheet scope and a
-- set of role arrays (including an empty one). The snapshot helpers are
-- service-only, so this comparison runs as the database owner; both helpers
-- read the request claims through the auth stubs.
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
do $$
declare
  v_roles text;
  v_scope record;
  v_old boolean;
  v_new boolean;
  v_checked int := 0;
begin
  foreach v_roles in array array[
    'result_entry_officer',
    'exam_reviewer,result_publisher,auditor',
    'finance_officer',
    ''
  ] loop
    for v_scope in select distinct academic_year_id, grade_section_id, subject_id from public.result_entry_sheets loop
      v_old := app.staff_scope_allowed(
        case when v_roles = '' then '{}'::text[] else string_to_array(v_roles, ',') end,
        v_scope.academic_year_id, v_scope.grade_section_id, v_scope.subject_id);
      v_new := app.staff_scope_boxes_allowed(
        app.staff_scope_boxes(case when v_roles = '' then '{}'::text[] else string_to_array(v_roles, ',') end),
        v_scope.academic_year_id, v_scope.grade_section_id, v_scope.subject_id);
      v_checked := v_checked + 1;
      assert v_old is not distinct from v_new, 'the scope snapshot matches staff_scope_allowed';
    end loop;
  end loop;
  assert v_checked >= 8, 'the scope comparison covered the sheet scopes';
end $$;

-- =============================================================================
-- C12. 000116 — stuck-export recovery and the boxed admissions/finance
-- policies. These assertions fail on the pre-000116 chain: `data_export_recover`
-- does not exist and the policies evaluate the scope helper per row.
-- =============================================================================

-- Recovery fixtures (postgres): one stale generating request per signal path,
-- a stale request with no failure signal, and one still inside the lease.
insert into public.data_export_requests
  (id, reference, domain, state, format, filters, columns, purpose, reason, requested_by_account_id,
   generation_started_at, generation_attempts)
values
  ('00000000-0000-4000-8000-0000000c1201', 'EXP-2026-C12-0001', 'students', 'generating', 'csv', '{}'::jsonb, '[]'::jsonb,
   'recovery fixture', 'recovery fixture', '10000000-0000-4000-8000-000000000004', now() - interval '10 minutes', 3),
  ('00000000-0000-4000-8000-0000000c1202', 'EXP-2026-C12-0002', 'students', 'generating', 'csv', '{}'::jsonb, '[]'::jsonb,
   'no signal fixture', 'no signal fixture', '10000000-0000-4000-8000-000000000004', now() - interval '10 minutes', 2),
  ('00000000-0000-4000-8000-0000000c1203', 'EXP-2026-C12-0003', 'students', 'generating', 'csv', '{}'::jsonb, '[]'::jsonb,
   'lease fixture', 'lease fixture', '10000000-0000-4000-8000-000000000004', now() - interval '1 minute', 1),
  ('00000000-0000-4000-8000-0000000c1204', 'EXP-2026-C12-0004', 'students', 'generating', 'csv', '{}'::jsonb, '[]'::jsonb,
   'legacy signal fixture', 'legacy signal fixture', '10000000-0000-4000-8000-000000000004', now() - interval '10 minutes', 4);

insert into public.provider_jobs (job_kind, target_type, target_reference, idempotency_key, status, attempts, max_attempts, last_error, finished_at)
values
  ('data_export_generate', 'data_export_request', 'EXP-2026-C12-0001',
   'data-export:EXP-2026-C12-0001:v1', 'failed', 5, 5,
   'export request is not generatable (state: generating)', now() - interval '9 minutes'),
  ('data_export_generate', 'data_export_request', 'EXP-2026-C12-0003',
   'data-export:EXP-2026-C12-0003:v1', 'failed', 5, 5,
   'lease fixture failure', now() - interval '1 minute');

insert into public.outbox_events (event_key, kind, target_type, target_reference, status, attempts, last_error)
values ('data_export_generate:EXP-2026-C12-0004:v1', 'data_export_generate', 'data_export_request',
        'EXP-2026-C12-0004', 'failed', 10, 'legacy queue failure detail');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
set role authenticated;
do $$
declare
  v_denied boolean;
  v_result jsonb;
begin
  -- Guard: no failed generation record.
  v_denied := false;
  begin
    perform app.data_export_recover('00000000-0000-4000-8000-0000000c1202', 'no signal recorded');
  exception when others then v_denied := true;
  end;
  assert v_denied, 'a stuck export with no failed queue record is refused (000116)';

  -- Guard: the worker lease has not expired.
  v_denied := false;
  begin
    perform app.data_export_recover('00000000-0000-4000-8000-0000000c1203', 'lease still active');
  exception when others then v_denied := true;
  end;
  assert v_denied, 'a generating export inside the lease window is refused (000116)';

  -- Guard: an audited reason is required.
  v_denied := false;
  begin
    perform app.data_export_recover('00000000-0000-4000-8000-0000000c1201', 'no');
  exception when others then v_denied := true;
  end;
  assert v_denied, 'a recovery reason shorter than three characters is refused (000116)';

  -- Happy path: the provider-job signal releases the stale claim.
  v_result := app.data_export_recover('00000000-0000-4000-8000-0000000c1201', 'worker died at the queue layer');
  assert (v_result ->> 'state') = 'requested', 'a stale queue-failed export is released to requested (000116)';
  assert (v_result ->> 'reference') = 'EXP-2026-C12-0001', 'the recovery returns the request reference';

  -- Idempotent repeat: the state guard refuses a replay.
  v_denied := false;
  begin
    perform app.data_export_recover('00000000-0000-4000-8000-0000000c1201', 'worker died at the queue layer');
  exception when others then v_denied := true;
  end;
  assert v_denied, 'a replayed recovery is refused; generation is queued exactly once (000116)';

  -- The legacy failed outbox event is also a valid signal.
  v_result := app.data_export_recover('00000000-0000-4000-8000-0000000c1204', 'legacy queue failure recorded');
  assert (v_result ->> 'state') = 'requested', 'a failed legacy outbox event is a recovery signal (000116)';

  -- Retry behavior is unchanged: it still requires the failed state.
  v_denied := false;
  begin
    perform app.data_export_retry('EXP-2026-C12-0001', 'retry probe');
  exception when others then v_denied := true;
  end;
  assert v_denied, 'data_export_retry still requires the failed state (000116)';
end $$;
reset role;

-- Server-visible effects of the recovery: one event with the reason, one new
-- version-keyed generation job, one audit row, and the bumped version.
do $$
declare
  v_jobs int;
  v_recover_jobs int;
  v_recovery_key text;
  v_version text;
begin
  assert (select state from public.data_export_requests where reference = 'EXP-2026-C12-0001') = 'requested',
    'the recovered request is requested (000116)';
  assert (select count(*) from public.data_export_events e
            join public.data_export_requests r on r.id = e.request_id
           where r.reference = 'EXP-2026-C12-0001'
             and e.event_type = 'generation_recovered'
             and e.detail = 'recovery: worker died at the queue layer') = 1,
    'the recovery event records the reason (000116)';
  select count(*) into v_jobs from public.provider_jobs where target_reference = 'EXP-2026-C12-0001';
  assert v_jobs = 2, 'the recovery adds exactly one generation job to the failed fixture (000116)';
  select count(*), min(idempotency_key) into v_recover_jobs, v_recovery_key
    from public.provider_jobs
   where target_reference = 'EXP-2026-C12-0001'
     and idempotency_key like 'data-export:EXP-2026-C12-0001:recover:%';
  assert v_recover_jobs = 1, 'the recovery job is keyed exactly once (000116)';
  select version::text into v_version from public.data_export_requests where reference = 'EXP-2026-C12-0001';
  assert v_recovery_key = 'data-export:EXP-2026-C12-0001:recover:' || v_version,
    'the recovery job key carries the bumped version (000116)';
  assert (select count(*) from public.audit_events
           where action = 'Data export generation recovered' and target_reference = 'EXP-2026-C12-0001') = 1,
    'the recovery writes exactly one audit row (000116)';
  assert (select count(*) from public.audit_events
           where action = 'Data export generation recovered' and target_reference = 'EXP-2026-C12-0004') = 1,
    'the legacy-signal recovery is audited too (000116)';
end $$;

-- AAL1, non-administrator staff, and guardian callers are refused.
select set_config('request.jwt.claims', '{}', false);
set role authenticated;
do $$
declare v_denied boolean;
begin
  v_denied := false;
  begin
    perform app.data_export_recover('00000000-0000-4000-8000-0000000c1202', 'no aal2');
  exception when others then v_denied := true;
  end;
  assert v_denied, 'an AAL1 administrator cannot recover an export (000116)';
end $$;
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000007', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
set role authenticated;
do $$
declare v_denied boolean;
begin
  v_denied := false;
  begin
    perform app.data_export_recover('00000000-0000-4000-8000-0000000c1202', 'non admin recovery');
  exception when others then v_denied := true;
  end;
  assert v_denied, 'a non-administrator staff caller cannot recover an export (000116)';
end $$;
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
set role authenticated;
do $$
declare v_denied boolean;
begin
  v_denied := false;
  begin
    perform app.data_export_recover('00000000-0000-4000-8000-0000000c1202', 'guardian recovery');
  exception when others then v_denied := true;
  end;
  assert v_denied, 'a guardian cannot recover an export (000116)';
end $$;
reset role;

-- Scoped actors for the policy membership proof: a finance officer restricted
-- to 2026-27 and an admissions officer restricted to one grade, both with a
-- year restriction on the admissions grant so both boxes are exercised.
insert into auth.users (id) values
  ('10000000-0000-4000-8000-000000000013'),
  ('10000000-0000-4000-8000-000000000014');
insert into public.people (id, given_name, family_name, display_name) values
  ('20000000-0000-4000-8000-000000000013', 'Zoya', 'Nazir', 'Zoya Nazir'),
  ('20000000-0000-4000-8000-000000000014', 'Farhan', 'Wani', 'Farhan Wani');
insert into public.user_accounts (id, person_id, status, verified_contact) values
  ('10000000-0000-4000-8000-000000000013', '20000000-0000-4000-8000-000000000013', 'active', 'scoped.finance@example.in'),
  ('10000000-0000-4000-8000-000000000014', '20000000-0000-4000-8000-000000000014', 'active', 'scoped.admissions@example.in');
insert into public.role_grants (id, account_id, role_code, status, effective_from) values
  ('40000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-000000000013', 'finance_officer', 'active', now()),
  ('40000000-0000-4000-8000-0000000000c2', '10000000-0000-4000-8000-000000000014', 'admissions_officer', 'active', now());
insert into public.role_grant_academic_years (role_grant_id, academic_year_id)
select '40000000-0000-4000-8000-0000000000c1', id from public.academic_years where label = '2026-27';
insert into public.role_grant_academic_years (role_grant_id, academic_year_id)
select '40000000-0000-4000-8000-0000000000c2', id from public.academic_years where label = '2026-27';
insert into public.role_grant_grade_sections (role_grant_id, grade_section_id)
select '40000000-0000-4000-8000-0000000000c2', gs.id
  from public.grade_sections gs
 where gs.grade_id = (select grade_id from public.grade_sections order by id limit 1);

-- Two admission applications for the membership proof: the in-scope fixture
-- (2026-27 in the allowed grade) and two out-of-scope fixtures (one per box).
insert into public.admission_applications
  (reference, owner_account_id, academic_year_id, grade_id, current_status, student_name, parent_name)
select 'APP-2026-C12-IN', '10000000-0000-4000-8000-000000000001',
       (select id from public.academic_years where label = '2026-27'),
       (select grade_id from public.grade_sections order by id limit 1),
       'under_review', 'Scoped Fixture In', 'Sana Wani';
insert into public.admission_applications
  (reference, owner_account_id, academic_year_id, grade_id, current_status, student_name, parent_name)
select 'APP-2026-C12-OUT-GRADE', '10000000-0000-4000-8000-000000000001',
       (select id from public.academic_years where label = '2026-27'),
       (select id from public.grades
         where id <> (select grade_id from public.grade_sections order by id limit 1)
         order by code limit 1),
       'under_review', 'Scoped Fixture Out Grade', 'Sana Wani';
insert into public.admission_applications
  (reference, owner_account_id, academic_year_id, grade_id, current_status, student_name, parent_name)
select 'APP-2026-C12-OUT-YEAR', '10000000-0000-4000-8000-000000000001',
       (select id from public.academic_years where label = '2025-26'),
       (select grade_id from public.grade_sections order by id limit 1),
       'under_review', 'Scoped Fixture Out Year', 'Sana Wani';

-- Two invoices for the membership proof: one per academic year. They belong
-- to a dedicated C12 student so other suites' `limit 1` invoice lookups for
-- their own fixture students are untouched.
insert into public.people (id, given_name, family_name, display_name)
values ('20000000-0000-4000-8000-000000000015', 'C12', 'Fixture', 'C12 Fixture');
insert into public.students (reference, person_id)
values ('STU-2026-C12-0001', '20000000-0000-4000-8000-000000000015');
insert into public.invoices
  (reference, student_id, academic_year_id, term, status, issue_date, due_date)
select 'INV-2026-C12-IN', st.id, ay.id, 'Term 1', 'unpaid', current_date, current_date + 30
  from public.students st
  cross join public.academic_years ay
 where ay.label = '2026-27' and st.reference = 'STU-2026-C12-0001';
insert into public.invoices
  (reference, student_id, academic_year_id, term, status, issue_date, due_date)
select 'INV-2026-C12-OUT', st.id, ay.id, 'Term 1', 'unpaid', current_date, current_date + 30
  from public.students st
  cross join public.academic_years ay
 where ay.label = '2025-26' and st.reference = 'STU-2026-C12-0001';

-- Function-level equivalence: every distinct application scope and several
-- role arrays (including wrong-role and empty) must agree between the
-- unchanged grade helper and the snapshot.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000014', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
set role authenticated;
do $$
declare
  v_roles text;
  v_scope record;
  v_old boolean;
  v_new boolean;
  v_checked int := 0;
  v_allowed int := 0;
begin
  foreach v_roles in array array[
    'admissions_officer',
    'admissions_officer,admissions_approver,auditor',
    'finance_officer',
    ''
  ] loop
    for v_scope in select distinct academic_year_id, grade_id from public.admission_applications loop
      v_old := app.staff_grade_scope_allowed(
        case when v_roles = '' then '{}'::text[] else string_to_array(v_roles, ',') end,
        v_scope.academic_year_id, v_scope.grade_id);
      v_new := app.staff_grade_scope_boxes_allowed(
        app.staff_grade_scope_boxes(case when v_roles = '' then '{}'::text[] else string_to_array(v_roles, ',') end),
        v_scope.academic_year_id, v_scope.grade_id);
      v_checked := v_checked + 1;
      if v_new then v_allowed := v_allowed + 1; end if;
      assert v_old is not distinct from v_new, 'the grade snapshot matches staff_grade_scope_allowed (000116)';
    end loop;
  end loop;
  assert v_checked >= 4, 'the grade comparison covered the application scopes (000116)';
  assert v_allowed > 0 and v_allowed < v_checked, 'the grade comparison covers allowed and denied scopes';
end $$;
reset role;

-- Membership proof: the boxed policy sees exactly the rows the unchanged
-- predicate allows for the restricted admissions actor.
select set_config('c12.ads_expected',
  (select count(*)::text from public.admission_applications a
    where app.admission_staff_scope(a.id, array['admissions_officer','admissions_approver','auditor'])), false);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000014', false);
set role authenticated;
do $$
declare v_expected int := current_setting('c12.ads_expected')::int;
begin
  assert v_expected > 0, 'the restricted admissions actor has in-scope fixtures';
  assert (select count(*) from public.admission_applications) = v_expected,
    'the boxed admissions policy preserves membership (000116)';
  assert exists (select 1 from public.admission_applications where reference = 'APP-2026-C12-IN'),
    'the in-scope fixture is visible through the boxed policy (000116)';
  assert not exists (select 1 from public.admission_applications where reference = 'APP-2026-C12-OUT-GRADE'),
    'the out-of-grade fixture is denied through the boxed policy (000116)';
  assert not exists (select 1 from public.admission_applications where reference = 'APP-2026-C12-OUT-YEAR'),
    'the out-of-year fixture is denied through the boxed policy (000116)';
end $$;
reset role;

-- Child embeds: the queue's five embedded collections resolve the parent and
-- apply the same boxed predicate. One child fixture per scope proves the
-- membership is preserved row for row for the restricted actor.
insert into public.admission_events (application_id, event_type, copy)
select id, 'submitted', 'C12 child fixture'
  from public.admission_applications
 where reference in ('APP-2026-C12-IN', 'APP-2026-C12-OUT-GRADE', 'APP-2026-C12-OUT-YEAR');
insert into public.admission_application_versions (application_id, version, snapshot, submitted_by_account_id)
select id, 1, '{"fixture": true}'::jsonb, '10000000-0000-4000-8000-000000000001'
  from public.admission_applications where reference = 'APP-2026-C12-IN';
insert into public.admission_reviews (application_id, officer_account_id, action, visible_reason)
select id, '10000000-0000-4000-8000-000000000006', 'reviewed', 'C12 child fixture'
  from public.admission_applications where reference = 'APP-2026-C12-IN';

select set_config('c12.child_expected',
  (select count(*)::text from public.admission_events e
    where app.admission_staff_scope(e.application_id, array['admissions_officer','admissions_approver','auditor']))
  || ',' || (select count(*)::text from public.admission_application_versions v
    where app.admission_staff_scope(v.application_id, array['admissions_officer','admissions_approver','auditor']))
  || ',' || (select count(*)::text from public.admission_reviews r
    where app.admission_staff_scope(r.application_id, array['admissions_officer','admissions_approver','auditor']))
  || ',' || (select count(*)::text from public.admission_drafts d
    where app.admission_staff_scope(d.application_id, array['admissions_officer','admissions_approver','auditor']))
  || ',' || (select count(*)::text from public.admission_offers o
    where app.admission_staff_scope(o.application_id, array['admissions_officer','admissions_approver','auditor'])), false);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000014', false);
set role authenticated;
do $$
declare
  v_expected int[] := string_to_array(current_setting('c12.child_expected'), ',')::int[];
  v_total int;
begin
  v_total := v_expected[1] + v_expected[2] + v_expected[3] + v_expected[4] + v_expected[5];
  assert v_total > 0, 'the child embed fixtures are visible to the restricted actor';
  assert (select count(*) from public.admission_events) = v_expected[1],
    'the boxed events embed preserves membership (000116)';
  assert (select count(*) from public.admission_application_versions) = v_expected[2],
    'the boxed versions embed preserves membership (000116)';
  assert (select count(*) from public.admission_reviews) = v_expected[3],
    'the boxed reviews embed preserves membership (000116)';
  assert (select count(*) from public.admission_drafts) = v_expected[4],
    'the boxed drafts embed preserves membership (000116)';
  assert (select count(*) from public.admission_offers) = v_expected[5],
    'the boxed offers embed preserves membership (000116)';
  assert exists (
    select 1 from public.admission_events e
     join public.admission_applications a on a.id = e.application_id
    where a.reference = 'APP-2026-C12-IN'),
    'the in-scope child fixture is visible through the boxed parent resolution (000116)';
  assert not exists (
    select 1 from public.admission_events e
     join public.admission_applications a on a.id = e.application_id
    where a.reference in ('APP-2026-C12-OUT-GRADE', 'APP-2026-C12-OUT-YEAR')),
    'the out-of-scope child fixtures are denied through the boxed parent resolution (000116)';
end $$;
reset role;

-- Finance snapshot equivalence across every invoice year and the caller roles.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000013', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
set role authenticated;
do $$
declare
  v_roles text;
  v_year uuid;
  v_old boolean;
  v_new boolean;
  v_checked int := 0;
  v_allowed int := 0;
begin
  foreach v_roles in array array[
    'finance_officer',
    'finance_officer,finance_approver',
    'auditor',
    ''
  ] loop
    for v_year in select distinct academic_year_id from public.invoices loop
      v_old := app.staff_scope_allowed(
        case when v_roles = '' then '{}'::text[] else string_to_array(v_roles, ',') end,
        v_year, null, null);
      v_new := app.staff_scope_boxes_allowed(
        app.staff_scope_boxes(case when v_roles = '' then '{}'::text[] else string_to_array(v_roles, ',') end),
        v_year, null, null);
      v_checked := v_checked + 1;
      if v_new then v_allowed := v_allowed + 1; end if;
      assert v_old is not distinct from v_new, 'the year snapshot matches staff_scope_allowed (000116)';
    end loop;
  end loop;
  assert v_checked >= 2, 'the year comparison covered both academic years (000116)';
  assert v_allowed > 0 and v_allowed < v_checked, 'the year comparison covers allowed and denied scopes';
end $$;
reset role;

-- Membership proof: the boxed finance policy sees exactly the rows the
-- unchanged predicate allows for the restricted finance actor.
select set_config('c12.fin_expected',
  (select count(*)::text from public.invoices i where app.finance_invoice_scope(i.id)), false);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000013', false);
set role authenticated;
do $$
declare v_expected int := current_setting('c12.fin_expected')::int;
begin
  assert v_expected > 0, 'the restricted finance actor has in-scope fixtures';
  assert (select count(*) from public.invoices) = v_expected,
    'the boxed finance policy preserves membership (000116)';
  assert exists (select 1 from public.invoices where reference = 'INV-2026-C12-IN'),
    'the in-year fixture is visible through the boxed policy (000116)';
  assert not exists (select 1 from public.invoices where reference = 'INV-2026-C12-OUT'),
    'the out-of-year fixture is denied through the boxed policy (000116)';
end $$;
reset role;

-- C10. Notification dismissal (000117): a recipient can clear notices, the
-- command is version-guarded, replay is idempotent, cross-account dismissal
-- is denied, and rows are marked rather than deleted.
insert into auth.users (id) values ('10000000-0000-4000-8000-000000000016');
insert into public.people (id, given_name, family_name, display_name) values
  ('20000000-0000-4000-8000-000000000016', 'Sadia', 'Rashid', 'Sadia Rashid');
insert into public.user_accounts (id, person_id, status, verified_contact) values
  ('10000000-0000-4000-8000-000000000016', '20000000-0000-4000-8000-000000000016', 'active', 'notifications.dismiss@example.in');
insert into public.in_app_notifications (recipient_account_id, kind, title, body) values
  ('10000000-0000-4000-8000-000000000016', 'Timetable', 'Dismiss fixture one', 'first'),
  ('10000000-0000-4000-8000-000000000016', 'Timetable', 'Dismiss fixture two', 'second'),
  ('10000000-0000-4000-8000-000000000016', 'Timetable', 'Dismiss fixture three', 'third');
-- A second account proves dismissal is strictly recipient-scoped.
insert into auth.users (id) values ('10000000-0000-4000-8000-000000000018');
insert into public.people (id, given_name, family_name, display_name) values
  ('20000000-0000-4000-8000-000000000018', 'Tariq', 'Bhat', 'Tariq Bhat');
insert into public.user_accounts (id, person_id, status, verified_contact) values
  ('10000000-0000-4000-8000-000000000018', '20000000-0000-4000-8000-000000000018', 'active', 'notifications.keep@example.in');
insert into public.in_app_notifications (recipient_account_id, kind, title, body) values
  ('10000000-0000-4000-8000-000000000018', 'Timetable', 'Keeper fixture', 'kept');
select set_config('c10.other_id',
  (select id::text from public.in_app_notifications
    where recipient_account_id = '10000000-0000-4000-8000-000000000018'), false);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000016', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
set role authenticated;
do $$
declare
  v_id uuid;
  v_result jsonb;
  v_count int;
begin
  select id into v_id from public.in_app_notifications
   where recipient_account_id = '10000000-0000-4000-8000-000000000016'
   order by title limit 1;
  v_result := app.notifications_dismiss(v_id, 1);
  assert (v_result ->> 'dismissedAt') is not null, 'dismiss records the dismissal timestamp (000117)';
  assert (v_result ->> 'readAt') is not null, 'dismissal implies read (000117)';
  assert (v_result ->> 'version')::int = 2, 'dismiss bumps the notification version (000117)';
  v_result := app.notifications_dismiss(v_id, 2);
  assert (v_result ->> 'version')::int = 2, 'dismiss replay at the stored version is idempotent (000117)';
  begin
    perform app.notifications_dismiss(current_setting('c10.other_id')::uuid, 1);
    raise exception 'cross-account dismissal unexpectedly succeeded';
  exception when others then
    if sqlerrm like '%notification not found%' then null; else raise; end if;
  end;
  select count(*) into v_count from public.in_app_notifications
   where recipient_account_id = '10000000-0000-4000-8000-000000000016' and dismissed_at is null;
  assert v_count = 2, 'one dismissal removes exactly one active row (000117)';
  assert app.notifications_dismiss_all() = 2, 'dismiss-all clears every remaining row once (000117)';
  assert app.notifications_dismiss_all() = 0, 'dismiss-all replay changes nothing (000117)';
  assert (select count(*) from public.in_app_notifications
           where recipient_account_id = '10000000-0000-4000-8000-000000000016') = 3,
    'dismissal marks rows, it never deletes them (000117)';
  assert (select count(*) from public.in_app_notifications
           where recipient_account_id = '10000000-0000-4000-8000-000000000016' and read_at is null) = 0,
    'no unread notification remains after dismiss-all (000117)';
end $$;
reset role;
do $$
begin
  assert (select count(*) from public.in_app_notifications
           where recipient_account_id = '10000000-0000-4000-8000-000000000018' and dismissed_at is null) = 1,
    'the other account keeps its active notification (000117)';
end $$;

select 'RPC SUITE PASSED' as result;
