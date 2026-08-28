-- =============================================================================
-- 000025 — authorization scope hardening (local Slice 1)
--
-- This is a forward-only policy/RPC hardening migration. It does not change the
-- canonical 17-role model. Functional business access requires aal2 plus the
-- exact role, grant scope, assignment, review-panel assignment, or guardian
-- capability that owns the record. `system_administrator` remains an access
-- and configuration role; it is never a substitute for a business role.
-- Auditors receive read-only evidence projections and no business mutation
-- policy. Commands continue to be the audited write boundary.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Exact role/scope/capability helpers
-- ---------------------------------------------------------------------------

create or replace function app.staff_scope_allowed(
  p_roles text[],
  p_academic_year_id uuid default null,
  p_grade_section_id uuid default null,
  p_subject_id uuid default null
) returns boolean
language sql
security definer
set search_path = ''
as $$
  select (auth.uid() is not null and (auth.jwt() ->> 'aal') = 'aal2')
     and exists (
       select 1
         from public.role_grants rg
        where rg.account_id = auth.uid()
          and rg.role_code = any(p_roles)
          and rg.status = 'active'
          and rg.effective_from <= now()
          and (rg.effective_to is null or rg.effective_to > now())
          and (
            p_academic_year_id is null
            or not exists (select 1 from public.role_grant_academic_years rgy where rgy.role_grant_id = rg.id)
            or exists (select 1 from public.role_grant_academic_years rgy where rgy.role_grant_id = rg.id and rgy.academic_year_id = p_academic_year_id)
          )
          and (
            p_grade_section_id is null
            or not exists (select 1 from public.role_grant_grade_sections rgs where rgs.role_grant_id = rg.id)
            or exists (select 1 from public.role_grant_grade_sections rgs where rgs.role_grant_id = rg.id and rgs.grade_section_id = p_grade_section_id)
          )
          and (
            p_subject_id is null
            or not exists (select 1 from public.role_grant_subjects rgsub where rgsub.role_grant_id = rg.id)
            or exists (select 1 from public.role_grant_subjects rgsub where rgsub.role_grant_id = rg.id and rgsub.subject_id = p_subject_id)
          )
     )
$$;

create or replace function app.staff_grade_scope_allowed(
  p_roles text[], p_academic_year_id uuid, p_grade_id uuid
) returns boolean
language sql
security definer
set search_path = ''
as $$
  select (auth.uid() is not null and (auth.jwt() ->> 'aal') = 'aal2')
     and exists (
       select 1
         from public.role_grants rg
        where rg.account_id = auth.uid()
          and rg.role_code = any(p_roles)
          and rg.status = 'active'
          and rg.effective_from <= now()
          and (rg.effective_to is null or rg.effective_to > now())
          and (
            p_academic_year_id is null
            or not exists (select 1 from public.role_grant_academic_years rgy where rgy.role_grant_id = rg.id)
            or exists (select 1 from public.role_grant_academic_years rgy where rgy.role_grant_id = rg.id and rgy.academic_year_id = p_academic_year_id)
          )
          and (
            p_grade_id is null
            or not exists (select 1 from public.role_grant_grade_sections rgs where rgs.role_grant_id = rg.id)
            or exists (
              select 1
                from public.role_grant_grade_sections rgs
                join public.grade_sections gs on gs.id = rgs.grade_section_id
               where rgs.role_grant_id = rg.id and gs.grade_id = p_grade_id
            )
          )
     )
$$;

create or replace function app.teacher_assignment_allowed(
  p_academic_year_id uuid, p_grade_section_id uuid, p_subject_id uuid
) returns boolean
language sql
security definer
set search_path = ''
as $$
  select (auth.uid() is not null and (auth.jwt() ->> 'aal') = 'aal2')
     and exists (
       select 1
         from public.staff_assignments sa
         join public.staff_members sm on sm.id = sa.staff_member_id
         join public.user_accounts ua on ua.person_id = sm.person_id
         join public.role_grants rg on rg.id = sa.role_grant_id
        where ua.id = auth.uid()
          and rg.account_id = auth.uid() and rg.role_code = 'teacher' and rg.status = 'active'
          and sa.status = 'active'
          and sa.academic_year_id = p_academic_year_id
          and sa.grade_section_id = p_grade_section_id
          and sa.subject_id = p_subject_id
          and sa.effective_from <= now()
          and (sa.effective_to is null or sa.effective_to > now())
     )
$$;

create or replace function app.teacher_section_allowed(p_grade_section_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select (auth.uid() is not null and (auth.jwt() ->> 'aal') = 'aal2')
     and exists (
       select 1
         from public.staff_assignments sa
         join public.staff_members sm on sm.id = sa.staff_member_id
         join public.user_accounts ua on ua.person_id = sm.person_id
         join public.role_grants rg on rg.id = sa.role_grant_id
        where ua.id = auth.uid() and rg.account_id = auth.uid() and rg.role_code = 'teacher'
          and rg.status = 'active' and sa.status = 'active'
          and sa.grade_section_id = p_grade_section_id
          and sa.effective_from <= now()
          and (sa.effective_to is null or sa.effective_to > now())
     )
$$;

create or replace function app.guardian_has_capability(p_student_id uuid, p_capability text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.guardian_student_links l
      join public.guardians g on g.id = l.guardian_id
      join public.user_accounts ua on ua.person_id = g.person_id
      join public.guardian_link_capabilities c on c.link_id = l.id
     where ua.id = auth.uid()
       and l.student_id = p_student_id
       and l.status = 'active'
       and (l.effective_from is null or l.effective_from <= now())
       and (l.effective_to is null or l.effective_to > now())
       and c.capability = p_capability
  )
$$;

create or replace function app.guardian_publication_allowed(p_publication_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.result_publication_items pi
     where pi.publication_id = p_publication_id
       and app.guardian_has_capability(pi.student_id, 'academics')
  )
$$;

create or replace function app.guardian_notice_ids()
returns uuid[]
language sql
security definer
set search_path = ''
as $$
  select array(
    select distinct na.notice_id
      from public.notice_audiences na
      join public.enrollments e on (
        (na.audience = 'student' and e.student_id = na.student_id)
        or
        (na.audience = 'grade_section' and e.grade_section_id = na.grade_section_id)
        or (na.audience = 'academic_year' and e.academic_year_id = na.academic_year_id)
      )
     where na.audience in ('student','grade_section','academic_year')
       and (
         (na.audience = 'student' and app.guardian_has_capability(na.student_id, 'notices'))
         or (na.audience in ('grade_section','academic_year') and e.status = 'active' and app.guardian_has_capability(e.student_id, 'notices'))
       )
       and (
         na.audience <> 'student'
         or exists (
           select 1 from public.guardian_student_links l
            where l.student_id = na.student_id and l.status = 'active'
              and app.guardian_has_capability(l.student_id, 'notices')
         )
       )
  )
$$;

create or replace function app.admission_staff_scope(p_application_id uuid, p_roles text[])
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.admission_applications a
      where a.id = p_application_id
        and app.staff_grade_scope_allowed(p_roles, a.academic_year_id, a.grade_id)
  )
$$;

create or replace function app.hr_application_scope(p_application_id uuid, p_roles text[])
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.job_applications ja
     where ja.id = p_application_id
       and (
         (app.has_role('hr_reviewer') and exists (
           select 1 from public.job_review_assignments jra
            where jra.application_id = ja.id and jra.reviewer_account_id = auth.uid()
              and jra.status in ('assigned','accepted','completed')
         ))
         or (app.has_role('hr_approver') and app.staff_scope_allowed(p_roles, null, null, null))
         or (app.has_role('auditor') and app.staff_scope_allowed(p_roles, null, null, null))
       )
  )
$$;

create or replace function app.finance_invoice_scope(p_invoice_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.invoices i
     where i.id = p_invoice_id
       and app.staff_scope_allowed(array['finance_officer','finance_approver'], i.academic_year_id, null, null)
  )
$$;

create or replace function app.result_batch_scope(p_batch_id uuid, p_roles text[])
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.result_batches b
      join public.exam_definitions ed on ed.id = b.exam_definition_id
     where b.id = p_batch_id
       and app.staff_scope_allowed(p_roles, ed.academic_year_id, b.grade_section_id, b.subject_id)
  )
$$;

create or replace function app.document_staff_allowed(p_owner_domain text, p_owner_record_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select case p_owner_domain
    when 'admission_application' then app.admission_staff_scope(p_owner_record_id, array['admissions_officer','admissions_approver','auditor'])
    when 'job_application' then app.hr_application_scope(p_owner_record_id, array['hr_reviewer','hr_approver','auditor'])
    when 'invoice' then app.finance_invoice_scope(p_owner_record_id)
    when 'result_publication' then exists (
      select 1 from public.result_publications rp
       where rp.id = p_owner_record_id
         and app.result_batch_scope(rp.batch_id, array['exam_reviewer','result_publisher','auditor'])
    )
    when 'student' then exists (
      select 1 from public.enrollments e
       where e.student_id = p_owner_record_id
         and (app.staff_scope_allowed(array['finance_officer','finance_approver','auditor'], e.academic_year_id, null, null)
           or app.teacher_section_allowed(e.grade_section_id))
    )
    else false
  end
$$;

revoke all on function app.staff_scope_allowed(text[], uuid, uuid, uuid), app.staff_grade_scope_allowed(text[], uuid, uuid), app.teacher_assignment_allowed(uuid, uuid, uuid), app.teacher_section_allowed(uuid), app.guardian_has_capability(uuid, text), app.guardian_publication_allowed(uuid), app.guardian_notice_ids(), app.admission_staff_scope(uuid, text[]), app.hr_application_scope(uuid, text[]), app.finance_invoice_scope(uuid), app.result_batch_scope(uuid, text[]), app.document_staff_allowed(text, uuid) from public;
grant execute on function app.staff_scope_allowed(text[], uuid, uuid, uuid), app.staff_grade_scope_allowed(text[], uuid, uuid), app.teacher_assignment_allowed(uuid, uuid, uuid), app.teacher_section_allowed(uuid), app.guardian_has_capability(uuid, text), app.guardian_publication_allowed(uuid), app.guardian_notice_ids(), app.admission_staff_scope(uuid, text[]), app.hr_application_scope(uuid, text[]), app.finance_invoice_scope(uuid), app.result_batch_scope(uuid, text[]), app.document_staff_allowed(text, uuid) to authenticated;

-- Remove policies whose predicates trusted only broad staff AAL2 or ignored
-- guardian capability. Applicant-owner/public policies remain intact.
do $$
declare r record;
begin
  for r in
    select policyname, tablename
      from pg_policies
     where schemaname = 'public'
       and tablename = any (array[
         'school_profile_versions','academic_years','grades','grade_sections','subjects','rooms','period_definitions','settings_versions','feature_flags','people','user_accounts','role_grants','role_grant_academic_years','role_grant_grade_sections','role_grant_subjects','staff_members','staff_assignments','guardians','students','guardian_student_links','guardian_link_capabilities','account_invitations','enrollments','enrollment_conversions','student_support_records',
         'admission_windows','admission_applications','admission_drafts','admission_application_versions','admission_reviews','admission_assessments','admission_offers','admission_events','job_vacancies','job_vacancy_versions','job_applications','job_application_versions','job_review_assignments','job_scorecards','job_interviews','job_events',
         'fee_schedule_versions','fee_schedule_items','invoices','invoice_items','concessions','ledger_entries','payment_attempts','gateway_events','payments','payment_allocations','receipts','refund_requests','refunds','reconciliation_runs','reconciliation_exceptions',
         'exam_definitions','assessment_components','grade_band_versions','result_batches','result_rosters','result_batch_versions','mark_entries','result_publications','result_publication_items','result_correction_requests','result_events','timetable_versions','timetable_periods','timetable_publications','timetable_overrides','exam_schedule_versions','exam_schedule_entries',
         'content_items','content_versions','notices','notice_audiences','documents','document_processing_events','support_requests','support_messages','support_private_notes','support_events','notification_deliveries','email_suppressions'
       ]::name[])
       and (
         coalesce(qual,'') like '%is_staff_aal2%'
         or coalesce(with_check,'') like '%is_staff_aal2%'
         or policyname like 'teacher_%'
         or policyname like 'guardian_%'
         or policyname = 'owner_read_clean_documents'
         or policyname = 'auth_read_notices'
       )
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Identity and school configuration
-- ---------------------------------------------------------------------------
create policy scope_staff_profile_read on public.school_profile_versions for select to authenticated
  using (app.staff_scope_allowed(array['content_editor','content_publisher','admissions_officer','admissions_approver','finance_officer','finance_approver','hr_reviewer','hr_approver','teacher','exam_reviewer','result_publisher','timetable_manager','support_officer','auditor'], null, null, null) or (app.has_role('system_administrator') and app.is_staff_aal2()));
create policy scope_staff_year_read on public.academic_years for select to authenticated
  using (app.staff_scope_allowed(array['content_editor','content_publisher','admissions_officer','admissions_approver','finance_officer','finance_approver','hr_reviewer','hr_approver','teacher','exam_reviewer','result_publisher','timetable_manager','support_officer','auditor'], id, null, null) or (app.has_role('system_administrator') and app.is_staff_aal2()));
create policy scope_staff_grade_read on public.grades for select to authenticated
  using (app.staff_grade_scope_allowed(array['content_editor','content_publisher','admissions_officer','admissions_approver','finance_officer','finance_approver','hr_reviewer','hr_approver','teacher','exam_reviewer','result_publisher','timetable_manager','support_officer','auditor'], null, id) or (app.has_role('system_administrator') and app.is_staff_aal2()));
create policy scope_staff_section_read on public.grade_sections for select to authenticated
  using (app.staff_scope_allowed(array['admissions_officer','admissions_approver','finance_officer','finance_approver','teacher','exam_reviewer','result_publisher','timetable_manager','support_officer','auditor'], academic_year_id, id, null) or (app.has_role('system_administrator') and app.is_staff_aal2()));
create policy scope_staff_subject_read on public.subjects for select to authenticated
  using (app.staff_scope_allowed(array['teacher','exam_reviewer','result_publisher','timetable_manager','auditor'], null, null, id) or (app.has_role('system_administrator') and app.is_staff_aal2()));
create policy scope_staff_room_read on public.rooms for select to authenticated
  using (app.staff_scope_allowed(array['timetable_manager','teacher','auditor'], null, null, null) or (app.has_role('system_administrator') and app.is_staff_aal2()));
create policy scope_staff_period_read on public.period_definitions for select to authenticated
  using (app.staff_scope_allowed(array['timetable_manager','teacher','auditor'], academic_year_id, null, null) or (app.has_role('system_administrator') and app.is_staff_aal2()));
create policy scope_admin_settings_read on public.settings_versions for select to authenticated using (app.has_role('system_administrator') and app.is_staff_aal2());
create policy scope_admin_flags_read on public.feature_flags for select to authenticated using (app.has_role('system_administrator') and app.is_staff_aal2());

create policy scope_staff_people_read on public.people for select to authenticated
  using (app.is_staff_aal2() and app.has_any_role(array['admissions_officer','admissions_approver','finance_officer','finance_approver','teacher','exam_reviewer','result_publisher','timetable_manager','support_officer','auditor']));
create policy scope_staff_guardians_read on public.guardians for select to authenticated
  using (app.is_staff_aal2() and app.has_any_role(array['admissions_officer','admissions_approver','finance_officer','finance_approver','teacher','exam_reviewer','result_publisher','timetable_manager','support_officer','auditor']));
create policy scope_staff_students_read on public.students for select to authenticated
  using (app.is_staff_aal2() and app.has_any_role(array['admissions_officer','admissions_approver','finance_officer','finance_approver','teacher','exam_reviewer','result_publisher','timetable_manager','support_officer','auditor']));
create policy scope_staff_links_read on public.guardian_student_links for select to authenticated
  using (app.is_staff_aal2() and app.has_any_role(array['admissions_officer','admissions_approver','finance_officer','finance_approver','teacher','exam_reviewer','result_publisher','timetable_manager','support_officer','auditor']));
create policy scope_staff_capabilities_read on public.guardian_link_capabilities for select to authenticated
  using (app.is_staff_aal2() and app.has_any_role(array['admissions_officer','admissions_approver','finance_officer','finance_approver','teacher','exam_reviewer','result_publisher','timetable_manager','support_officer','auditor']));
create policy scope_admin_accounts_read on public.user_accounts for select to authenticated using (app.has_role('system_administrator') and app.is_staff_aal2());
create policy scope_admin_grants_read on public.role_grants for select to authenticated using (app.has_role('system_administrator') and app.is_staff_aal2());
create policy scope_admin_grant_years_read on public.role_grant_academic_years for select to authenticated using (app.has_role('system_administrator') and app.is_staff_aal2());
create policy scope_admin_grant_sections_read on public.role_grant_grade_sections for select to authenticated using (app.has_role('system_administrator') and app.is_staff_aal2());
create policy scope_admin_grant_subjects_read on public.role_grant_subjects for select to authenticated using (app.has_role('system_administrator') and app.is_staff_aal2());
create policy scope_admin_staff_read on public.staff_members for select to authenticated using (app.has_role('system_administrator') and app.is_staff_aal2());
create policy scope_admin_invitations_read on public.account_invitations for select to authenticated using (app.has_role('system_administrator') and app.is_staff_aal2());
create policy scope_own_invitation_read on public.account_invitations for select to authenticated using (account_id = auth.uid());
create policy scope_staff_own_assignments_read on public.staff_assignments for select to authenticated using (
  exists (select 1 from public.staff_members sm join public.user_accounts ua on ua.person_id = sm.person_id where sm.id = staff_assignments.staff_member_id and ua.id = auth.uid())
  or (app.is_staff_aal2() and app.has_any_role(array['timetable_manager','auditor']))
);

-- Existing direct identity writes are intentionally limited to the audited
-- SECURITY DEFINER command layer; no functional role can mutate access rows.
drop policy if exists staff_update_links on public.guardian_student_links;

-- ---------------------------------------------------------------------------
-- Admissions: reviewer/approver split plus year/grade scope
-- ---------------------------------------------------------------------------
create policy scope_admission_windows_read on public.admission_windows for select to authenticated
  using (app.staff_grade_scope_allowed(array['admissions_officer','admissions_approver','auditor'], academic_year_id, grade_id));
create policy scope_admission_applications_read on public.admission_applications for select to authenticated
  using (app.admission_staff_scope(id, array['admissions_officer','admissions_approver','auditor']));
create policy scope_admission_drafts_read on public.admission_drafts for select to authenticated
  using (app.admission_staff_scope(application_id, array['admissions_officer','admissions_approver','auditor']));
create policy scope_admission_versions_read on public.admission_application_versions for select to authenticated
  using (app.admission_staff_scope(application_id, array['admissions_officer','admissions_approver','auditor']));
create policy scope_admission_reviews_read on public.admission_reviews for select to authenticated
  using (app.admission_staff_scope(application_id, array['admissions_officer','admissions_approver','auditor']));
create policy scope_admission_reviews_write on public.admission_reviews for insert to authenticated
  with check (app.admission_staff_scope(application_id, array['admissions_officer']));
create policy scope_admission_assessments_read on public.admission_assessments for select to authenticated
  using (app.admission_staff_scope(application_id, array['admissions_officer','admissions_approver','auditor']));
create policy scope_admission_assessments_write on public.admission_assessments for insert to authenticated
  with check (app.admission_staff_scope(application_id, array['admissions_officer']));
create policy scope_admission_offers_read on public.admission_offers for select to authenticated
  using (app.admission_staff_scope(application_id, array['admissions_officer','admissions_approver','auditor']));
create policy scope_admission_offers_write on public.admission_offers for update to authenticated
  using (app.admission_staff_scope(application_id, array['admissions_approver']))
  with check (app.admission_staff_scope(application_id, array['admissions_approver']));
create policy scope_admission_events_read on public.admission_events for select to authenticated
  using (app.admission_staff_scope(application_id, array['admissions_officer','admissions_approver','auditor']));
create policy scope_admission_events_write on public.admission_events for insert to authenticated
  with check (app.admission_staff_scope(application_id, array['admissions_officer','admissions_approver']));

-- ---------------------------------------------------------------------------
-- Careers/HR: reviewer assignment and approver separation
-- ---------------------------------------------------------------------------
create policy scope_hr_vacancies_read on public.job_vacancies for select to authenticated
  using (app.is_staff_aal2() and app.has_any_role(array['hr_reviewer','hr_approver','auditor']));
create policy scope_hr_vacancies_write on public.job_vacancies for all to authenticated
  using (app.is_staff_aal2() and app.has_any_role(array['hr_reviewer','hr_approver']))
  with check (app.is_staff_aal2() and app.has_any_role(array['hr_reviewer','hr_approver']));
create policy scope_hr_vacancy_versions_read on public.job_vacancy_versions for select to authenticated
  using (app.is_staff_aal2() and app.has_any_role(array['hr_reviewer','hr_approver','auditor']));
create policy scope_hr_applications_read on public.job_applications for select to authenticated
  using (app.hr_application_scope(id, array['hr_reviewer','hr_approver','auditor']));
create policy scope_hr_applications_write on public.job_applications for update to authenticated
  using (app.hr_application_scope(id, array['hr_approver']))
  with check (app.hr_application_scope(id, array['hr_approver']));
create policy scope_hr_versions_read on public.job_application_versions for select to authenticated
  using (app.hr_application_scope(application_id, array['hr_reviewer','hr_approver','auditor']));
create policy scope_hr_assignments_read on public.job_review_assignments for select to authenticated
  using (app.hr_application_scope(application_id, array['hr_reviewer','hr_approver','auditor']));
create policy scope_hr_assignments_write on public.job_review_assignments for all to authenticated
  using (app.is_staff_aal2() and app.has_role('hr_approver'))
  with check (app.is_staff_aal2() and app.has_role('hr_approver'));
create policy scope_hr_scorecards_read on public.job_scorecards for select to authenticated
  using (app.hr_application_scope(application_id, array['hr_reviewer','hr_approver','auditor']));
create policy scope_hr_scorecards_write on public.job_scorecards for insert to authenticated
  with check (app.hr_application_scope(application_id, array['hr_reviewer']));
create policy scope_hr_interviews_read on public.job_interviews for select to authenticated
  using (app.hr_application_scope(application_id, array['hr_reviewer','hr_approver','auditor']));
create policy scope_hr_interviews_write on public.job_interviews for all to authenticated
  using (app.hr_application_scope(application_id, array['hr_approver']))
  with check (app.hr_application_scope(application_id, array['hr_approver']));
create policy scope_hr_events_read on public.job_events for select to authenticated
  using (app.hr_application_scope(application_id, array['hr_reviewer','hr_approver','auditor']));
create policy scope_hr_events_write on public.job_events for insert to authenticated
  with check (app.hr_application_scope(application_id, array['hr_reviewer','hr_approver']));

-- ---------------------------------------------------------------------------
-- Finance: exact finance roles/audit read and guardian finance capability
-- ---------------------------------------------------------------------------
create policy scope_guardian_invoices on public.invoices for select to authenticated using (
  (app.is_guardian() and student_id is not null and app.guardian_has_capability(student_id, 'finance'))
  or (app.is_guardian() and applicant_ref in (select reference from public.admission_applications where owner_account_id = auth.uid()))
);
create policy scope_guardian_invoice_items on public.invoice_items for select to authenticated using (invoice_id in (select i.id from public.invoices i where (i.student_id is not null and app.guardian_has_capability(i.student_id, 'finance')) or i.applicant_ref in (select reference from public.admission_applications where owner_account_id = auth.uid())));
create policy scope_guardian_receipts on public.receipts for select to authenticated using (invoice_id in (select i.id from public.invoices i where (i.student_id is not null and app.guardian_has_capability(i.student_id, 'finance')) or i.applicant_ref in (select reference from public.admission_applications where owner_account_id = auth.uid())));
create policy scope_guardian_concessions on public.concessions for select to authenticated using (invoice_id in (select i.id from public.invoices i where i.student_id is not null and app.guardian_has_capability(i.student_id, 'finance')));
create policy scope_guardian_ledger on public.ledger_entries for select to authenticated using (invoice_id in (select i.id from public.invoices i where (i.student_id is not null and app.guardian_has_capability(i.student_id, 'finance')) or i.applicant_ref in (select reference from public.admission_applications where owner_account_id = auth.uid())));
create policy scope_guardian_attempts on public.payment_attempts for select to authenticated using (invoice_id in (select i.id from public.invoices i where (i.student_id is not null and app.guardian_has_capability(i.student_id, 'finance')) or i.applicant_ref in (select reference from public.admission_applications where owner_account_id = auth.uid())));
create policy scope_guardian_payments on public.payments for select to authenticated using (exists (select 1 from public.payment_allocations pa join public.invoices i on i.id = pa.invoice_id where pa.payment_id = payments.id and ((i.student_id is not null and app.guardian_has_capability(i.student_id, 'finance')) or i.applicant_ref in (select reference from public.admission_applications where owner_account_id = auth.uid()))));
create policy scope_guardian_allocations on public.payment_allocations for select to authenticated using (invoice_id in (select i.id from public.invoices i where (i.student_id is not null and app.guardian_has_capability(i.student_id, 'finance')) or i.applicant_ref in (select reference from public.admission_applications where owner_account_id = auth.uid())));
create policy scope_finance_schedule_read on public.fee_schedule_versions for select to authenticated using (app.staff_scope_allowed(array['finance_officer','finance_approver','auditor'], null, null, null));
create policy scope_finance_items_read on public.fee_schedule_items for select to authenticated using (app.staff_scope_allowed(array['finance_officer','finance_approver','auditor'], null, null, null));
create policy scope_finance_invoices_read on public.invoices for select to authenticated using (app.finance_invoice_scope(id));
create policy scope_finance_invoice_items_read on public.invoice_items for select to authenticated using (exists (select 1 from public.invoices i where i.id = invoice_items.invoice_id and app.finance_invoice_scope(i.id)));
create policy scope_finance_concessions_read on public.concessions for select to authenticated using (exists (select 1 from public.invoices i where i.id = concessions.invoice_id and app.finance_invoice_scope(i.id)));
create policy scope_finance_ledger_read on public.ledger_entries for select to authenticated using (exists (select 1 from public.invoices i where i.id = ledger_entries.invoice_id and app.finance_invoice_scope(i.id)));
create policy scope_finance_attempts_read on public.payment_attempts for select to authenticated using (exists (select 1 from public.invoices i where i.id = payment_attempts.invoice_id and app.finance_invoice_scope(i.id)));
create policy scope_finance_gateway_read on public.gateway_events for select to authenticated using (app.staff_scope_allowed(array['finance_officer','finance_approver','auditor'], null, null, null));
create policy scope_finance_payments_read on public.payments for select to authenticated using (exists (select 1 from public.payment_allocations pa join public.invoices i on i.id = pa.invoice_id where pa.payment_id = payments.id and app.finance_invoice_scope(i.id)));
create policy scope_finance_allocations_read on public.payment_allocations for select to authenticated using (exists (select 1 from public.invoices i where i.id = payment_allocations.invoice_id and app.finance_invoice_scope(i.id)));
create policy scope_finance_receipts_read on public.receipts for select to authenticated using (exists (select 1 from public.invoices i where i.id = receipts.invoice_id and app.finance_invoice_scope(i.id)));
create policy scope_finance_refund_requests_read on public.refund_requests for select to authenticated using (app.staff_scope_allowed(array['finance_officer','finance_approver','auditor'], null, null, null));
create policy scope_finance_refunds_read on public.refunds for select to authenticated using (app.staff_scope_allowed(array['finance_officer','finance_approver','auditor'], null, null, null));
create policy scope_finance_reconciliation_read on public.reconciliation_runs for select to authenticated using (app.staff_scope_allowed(array['finance_officer','finance_approver','auditor'], null, null, null));
create policy scope_finance_reconciliation_exceptions_read on public.reconciliation_exceptions for select to authenticated using (app.staff_scope_allowed(array['finance_officer','finance_approver','auditor'], null, null, null));

-- ---------------------------------------------------------------------------
-- Results/timetable: exact teacher assignment, reviewer/publisher split, and
-- guardian academics capability.
-- ---------------------------------------------------------------------------
create policy scope_guardian_publication_items on public.result_publication_items for select to authenticated using (
  publication_id = any(app.active_publication_ids())
  and app.guardian_has_capability(student_id, 'academics')
);
create policy scope_guardian_publications on public.result_publications for select to authenticated using (
  status <> 'withdrawn'
  and app.guardian_publication_allowed(id)
);
create policy scope_teacher_batches on public.result_batches for select to authenticated using (
  exists (select 1 from public.exam_definitions ed where ed.id = result_batches.exam_definition_id and app.teacher_assignment_allowed(ed.academic_year_id, result_batches.grade_section_id, result_batches.subject_id))
);
create policy scope_teacher_exam_read on public.exam_definitions for select to authenticated using (app.teacher_section_allowed(grade_section_id));
create policy scope_teacher_components_read on public.assessment_components for select to authenticated using (exists (select 1 from public.exam_definitions ed where ed.id = assessment_components.exam_definition_id and app.teacher_assignment_allowed(ed.academic_year_id, ed.grade_section_id, assessment_components.subject_id)));
create policy scope_teacher_rosters on public.result_rosters for select to authenticated using (exists (select 1 from public.result_batches b join public.exam_definitions ed on ed.id = b.exam_definition_id where b.id = result_rosters.batch_id and app.teacher_assignment_allowed(ed.academic_year_id, b.grade_section_id, b.subject_id)));
create policy scope_teacher_mark_read on public.mark_entries for select to authenticated using (exists (select 1 from public.result_batches b join public.exam_definitions ed on ed.id = b.exam_definition_id where b.id = mark_entries.batch_id and app.teacher_assignment_allowed(ed.academic_year_id, b.grade_section_id, b.subject_id)));
create policy scope_teacher_mark_insert on public.mark_entries for insert to authenticated with check (exists (select 1 from public.result_batches b join public.exam_definitions ed on ed.id = b.exam_definition_id where b.id = mark_entries.batch_id and app.teacher_assignment_allowed(ed.academic_year_id, b.grade_section_id, b.subject_id)));
create policy scope_teacher_mark_update on public.mark_entries for update to authenticated using (exists (select 1 from public.result_batches b join public.exam_definitions ed on ed.id = b.exam_definition_id where b.id = mark_entries.batch_id and app.teacher_assignment_allowed(ed.academic_year_id, b.grade_section_id, b.subject_id))) with check (exists (select 1 from public.result_batches b join public.exam_definitions ed on ed.id = b.exam_definition_id where b.id = mark_entries.batch_id and app.teacher_assignment_allowed(ed.academic_year_id, b.grade_section_id, b.subject_id)));

create policy scope_results_exam_read on public.exam_definitions for select to authenticated using (app.staff_scope_allowed(array['exam_reviewer','result_publisher','auditor'], academic_year_id, grade_section_id, null));
create policy scope_results_components_read on public.assessment_components for select to authenticated using (exists (select 1 from public.exam_definitions ed where ed.id = assessment_components.exam_definition_id and app.staff_scope_allowed(array['exam_reviewer','result_publisher','auditor'], ed.academic_year_id, ed.grade_section_id, assessment_components.subject_id)));
create policy scope_results_bands_read on public.grade_band_versions for select to authenticated using (app.staff_scope_allowed(array['exam_reviewer','result_publisher','auditor'], null, null, null));
create policy scope_results_batches_read on public.result_batches for select to authenticated using (app.result_batch_scope(id, array['exam_reviewer','result_publisher','auditor']));
create policy scope_results_rosters_read on public.result_rosters for select to authenticated using (exists (select 1 from public.result_batches b where b.id = result_rosters.batch_id and app.result_batch_scope(b.id, array['exam_reviewer','result_publisher','auditor'])));
create policy scope_results_versions_read on public.result_batch_versions for select to authenticated using (exists (select 1 from public.result_batches b where b.id = result_batch_versions.batch_id and app.result_batch_scope(b.id, array['exam_reviewer','result_publisher','auditor'])));
create policy scope_results_marks_read on public.mark_entries for select to authenticated using (exists (select 1 from public.result_batches b where b.id = mark_entries.batch_id and app.result_batch_scope(b.id, array['exam_reviewer','result_publisher','auditor'])));
create policy scope_results_marks_review_write on public.mark_entries for insert to authenticated with check (exists (select 1 from public.result_batches b where b.id = mark_entries.batch_id and app.result_batch_scope(b.id, array['exam_reviewer'])));
create policy scope_results_publications_read on public.result_publications for select to authenticated using (exists (select 1 from public.result_batches b where b.id = result_publications.batch_id and app.result_batch_scope(b.id, array['exam_reviewer','result_publisher','auditor'])));
create policy scope_results_publication_items_read on public.result_publication_items for select to authenticated using (exists (select 1 from public.result_publications rp join public.result_batches b on b.id = rp.batch_id where rp.id = result_publication_items.publication_id and app.result_batch_scope(b.id, array['exam_reviewer','result_publisher','auditor'])));
create policy scope_results_corrections_read on public.result_correction_requests for select to authenticated using (exists (select 1 from public.result_publications rp join public.result_batches b on b.id = rp.batch_id where rp.id = result_correction_requests.publication_id and app.result_batch_scope(b.id, array['exam_reviewer','result_publisher','auditor'])));
create policy scope_results_corrections_insert on public.result_correction_requests for insert to authenticated with check (exists (select 1 from public.result_publications rp join public.result_batches b on b.id = rp.batch_id where rp.id = result_correction_requests.publication_id and app.staff_scope_allowed(array['result_publisher'], null, b.grade_section_id, b.subject_id)));
create policy scope_results_corrections_update on public.result_correction_requests for update to authenticated using (app.staff_scope_allowed(array['exam_reviewer'], null, null, null)) with check (app.staff_scope_allowed(array['exam_reviewer'], null, null, null));
create policy scope_results_events_read on public.result_events for select to authenticated using (exists (select 1 from public.result_batches b where b.id = result_events.batch_id and app.result_batch_scope(b.id, array['exam_reviewer','result_publisher','auditor'])));

create policy scope_guardian_timetable_versions on public.timetable_versions for select to authenticated using (
  status = 'published'
  and exists (select 1 from public.enrollments e where e.grade_section_id = timetable_versions.grade_section_id and e.status = 'active' and app.guardian_has_capability(e.student_id, 'academics'))
);
create policy scope_guardian_timetable_periods on public.timetable_periods for select to authenticated using (exists (select 1 from public.timetable_versions tv where tv.id = timetable_periods.timetable_version_id and tv.status = 'published' and exists (select 1 from public.enrollments e where e.grade_section_id = tv.grade_section_id and e.status = 'active' and app.guardian_has_capability(e.student_id, 'academics'))));
create policy scope_timetable_staff_versions on public.timetable_versions for select to authenticated using (
  (app.staff_scope_allowed(array['timetable_manager','auditor'], null, grade_section_id, null))
  or app.teacher_section_allowed(grade_section_id)
);
create policy scope_timetable_staff_periods on public.timetable_periods for select to authenticated using (exists (select 1 from public.timetable_versions tv where tv.id = timetable_periods.timetable_version_id and ((app.staff_scope_allowed(array['timetable_manager','auditor'], null, tv.grade_section_id, null)) or (timetable_periods.teacher_assignment_id is not null and exists (select 1 from public.staff_assignments sa join public.staff_members sm on sm.id = sa.staff_member_id join public.user_accounts ua on ua.person_id = sm.person_id where sa.id = timetable_periods.teacher_assignment_id and ua.id = auth.uid() and sa.status = 'active')))));
create policy scope_timetable_write_versions on public.timetable_versions for insert to authenticated with check (app.staff_scope_allowed(array['timetable_manager'], null, grade_section_id, null));
create policy scope_timetable_update_versions on public.timetable_versions for update to authenticated using (app.staff_scope_allowed(array['timetable_manager'], null, grade_section_id, null)) with check (app.staff_scope_allowed(array['timetable_manager'], null, grade_section_id, null));
create policy scope_timetable_write_periods on public.timetable_periods for all to authenticated using (exists (select 1 from public.timetable_versions tv where tv.id = timetable_periods.timetable_version_id and app.staff_scope_allowed(array['timetable_manager'], null, tv.grade_section_id, null))) with check (exists (select 1 from public.timetable_versions tv where tv.id = timetable_periods.timetable_version_id and app.staff_scope_allowed(array['timetable_manager'], null, tv.grade_section_id, null)));
create policy scope_timetable_publications_read on public.timetable_publications for select to authenticated using (exists (select 1 from public.timetable_versions tv where tv.id = timetable_publications.timetable_version_id and app.staff_scope_allowed(array['timetable_manager','auditor'], null, tv.grade_section_id, null)));
create policy scope_timetable_publications_write on public.timetable_publications for insert to authenticated with check (exists (select 1 from public.timetable_versions tv where tv.id = timetable_publications.timetable_version_id and app.staff_scope_allowed(array['timetable_manager'], null, tv.grade_section_id, null)));
create policy scope_timetable_overrides_read on public.timetable_overrides for select to authenticated using (app.staff_scope_allowed(array['timetable_manager','auditor'], null, grade_section_id, null) or app.teacher_section_allowed(grade_section_id));
create policy scope_timetable_overrides_write on public.timetable_overrides for insert to authenticated with check (app.staff_scope_allowed(array['timetable_manager'], null, grade_section_id, null));
create policy scope_exam_schedule_read on public.exam_schedule_versions for select to authenticated using (app.staff_scope_allowed(array['timetable_manager','auditor'], null, grade_section_id, null));
create policy scope_exam_schedule_write on public.exam_schedule_versions for insert to authenticated with check (app.staff_scope_allowed(array['timetable_manager'], null, grade_section_id, null));
create policy scope_exam_schedule_update on public.exam_schedule_versions for update to authenticated using (app.staff_scope_allowed(array['timetable_manager'], null, grade_section_id, null)) with check (app.staff_scope_allowed(array['timetable_manager'], null, grade_section_id, null));
create policy scope_exam_entries_read on public.exam_schedule_entries for select to authenticated using (exists (select 1 from public.exam_schedule_versions ev where ev.id = exam_schedule_entries.schedule_version_id and app.staff_scope_allowed(array['timetable_manager','auditor'], null, ev.grade_section_id, null)));
create policy scope_exam_entries_write on public.exam_schedule_entries for all to authenticated using (exists (select 1 from public.exam_schedule_versions ev where ev.id = exam_schedule_entries.schedule_version_id and app.staff_scope_allowed(array['timetable_manager'], null, ev.grade_section_id, null))) with check (exists (select 1 from public.exam_schedule_versions ev where ev.id = exam_schedule_entries.schedule_version_id and app.staff_scope_allowed(array['timetable_manager'], null, ev.grade_section_id, null)));

-- ---------------------------------------------------------------------------
-- Content, documents, support, and notification projections
-- ---------------------------------------------------------------------------
create policy scope_content_items_read on public.content_items for select to authenticated using (app.staff_scope_allowed(array['content_editor','content_publisher','auditor'], null, null, null));
create policy scope_content_items_write on public.content_items for insert to authenticated with check (app.staff_scope_allowed(array['content_editor'], null, null, null));
create policy scope_content_items_update on public.content_items for update to authenticated using (app.staff_scope_allowed(array['content_editor'], null, null, null)) with check (app.staff_scope_allowed(array['content_editor'], null, null, null));
create policy scope_content_versions_read on public.content_versions for select to authenticated using (exists (select 1 from public.content_items ci where ci.id = content_versions.content_item_id and app.staff_scope_allowed(array['content_editor','content_publisher','auditor'], null, null, null)));
create policy scope_content_versions_write on public.content_versions for insert to authenticated with check (app.staff_scope_allowed(array['content_editor'], null, null, null));
create policy scope_notices_read on public.notices for select to authenticated using (app.staff_scope_allowed(array['content_editor','content_publisher','auditor'], null, null, null));
create policy scope_notices_write on public.notices for insert to authenticated with check (app.staff_scope_allowed(array['content_editor'], null, null, null));
create policy scope_notices_update on public.notices for update to authenticated using (app.staff_scope_allowed(array['content_editor'], null, null, null)) with check (app.staff_scope_allowed(array['content_editor'], null, null, null));
create policy scope_notice_audiences_read on public.notice_audiences for select to authenticated using (app.staff_scope_allowed(array['content_editor','content_publisher','auditor'], null, null, null));
create policy scope_notice_audiences_write on public.notice_audiences for insert to authenticated with check (app.staff_scope_allowed(array['content_editor'], null, null, null));
create policy scope_documents_read on public.documents for select to authenticated using (
  (scan_status = 'clean' and ((owner_domain = 'admission_application' and exists (select 1 from public.admission_applications a where a.id = owner_record_id and a.owner_account_id = auth.uid())) or (owner_domain = 'job_application' and exists (select 1 from public.job_applications j where j.id = owner_record_id and j.owner_account_id = auth.uid()))))
  or app.document_staff_allowed(owner_domain, owner_record_id)
  or (owner_domain = 'student' and exists (select 1 from public.students s where s.id = owner_record_id and app.guardian_has_capability(s.id, 'documents')))
  or (owner_domain = 'invoice' and exists (select 1 from public.invoices i where i.id = owner_record_id and i.student_id is not null and app.guardian_has_capability(i.student_id, 'documents')))
);
create policy scope_documents_write on public.documents for insert to authenticated with check (app.document_staff_allowed(owner_domain, owner_record_id));
create policy scope_documents_update on public.documents for update to authenticated using (app.document_staff_allowed(owner_domain, owner_record_id)) with check (app.document_staff_allowed(owner_domain, owner_record_id));
create policy scope_document_events_read on public.document_processing_events for select to authenticated using (app.document_staff_allowed((select owner_domain from public.documents d where d.id = document_processing_events.document_id), (select owner_record_id from public.documents d where d.id = document_processing_events.document_id)));
create policy scope_support_read on public.support_requests for select to authenticated using (requester_account_id = auth.uid() or app.staff_scope_allowed(array['support_officer','auditor'], null, null, null));
create policy scope_support_update on public.support_requests for update to authenticated using (app.staff_scope_allowed(array['support_officer'], null, null, null)) with check (app.staff_scope_allowed(array['support_officer'], null, null, null));
create policy scope_support_messages_read on public.support_messages for select to authenticated using (support_request_id in (select id from public.support_requests where requester_account_id = auth.uid() or app.staff_scope_allowed(array['support_officer','auditor'], null, null, null)));
create policy scope_support_messages_write on public.support_messages for insert to authenticated with check ((is_staff = false and author_account_id = auth.uid() and support_request_id in (select id from public.support_requests where requester_account_id = auth.uid())) or (is_staff = true and app.staff_scope_allowed(array['support_officer'], null, null, null)));
create policy scope_support_private_read on public.support_private_notes for select to authenticated using (app.staff_scope_allowed(array['support_officer','auditor'], null, null, null));
create policy scope_support_private_write on public.support_private_notes for insert to authenticated with check (app.staff_scope_allowed(array['support_officer'], null, null, null));
create policy scope_support_events_read on public.support_events for select to authenticated using (app.staff_scope_allowed(array['support_officer','auditor'], null, null, null) or support_request_id in (select id from public.support_requests where requester_account_id = auth.uid()));
create policy scope_support_events_write on public.support_events for insert to authenticated with check (app.staff_scope_allowed(array['support_officer'], null, null, null));
create policy scope_notification_deliveries_read on public.notification_deliveries for select to authenticated using (app.staff_scope_allowed(array['support_officer','auditor'], null, null, null));
create policy scope_notification_deliveries_write on public.notification_deliveries for insert to authenticated with check (app.staff_scope_allowed(array['support_officer'], null, null, null));
create policy scope_notification_deliveries_update on public.notification_deliveries for update to authenticated using (app.staff_scope_allowed(array['support_officer'], null, null, null)) with check (app.staff_scope_allowed(array['support_officer'], null, null, null));
create policy scope_suppressions_read on public.email_suppressions for select to authenticated using (app.staff_scope_allowed(array['support_officer','auditor'], null, null, null));
create policy scope_suppressions_write on public.email_suppressions for insert to authenticated with check (app.staff_scope_allowed(array['support_officer'], null, null, null));

-- Guardian relationship, academic, notice, and enrollment reads are kept
-- separate from finance/documents so each link capability is enforceable.
create policy scope_guardian_students on public.students for select to authenticated using (app.is_guardian() and app.guardian_has_capability(students.id, 'profile'));
create policy scope_student_own_record on public.students for select to authenticated using (app.has_role('student') and person_id = (select person_id from public.user_accounts where id = auth.uid()));
create policy scope_guardian_people on public.people for select to authenticated using (app.is_guardian() and exists (select 1 from public.students s where s.person_id = people.id and app.guardian_has_capability(s.id, 'profile')));
create policy scope_guardian_links on public.guardian_student_links for select to authenticated using (guardian_id in (select g.id from public.guardians g join public.user_accounts ua on ua.person_id = g.person_id where ua.id = auth.uid()));
create policy scope_guardian_capabilities on public.guardian_link_capabilities for select to authenticated using (link_id in (select l.id from public.guardian_student_links l where l.guardian_id in (select g.id from public.guardians g join public.user_accounts ua on ua.person_id = g.person_id where ua.id = auth.uid()) and l.status = 'active'));
create policy scope_guardian_enrollments on public.enrollments for select to authenticated using (app.is_guardian() and exists (select 1 from public.guardian_student_links l where l.student_id = enrollments.student_id and l.status = 'active' and l.guardian_id in (select g.id from public.guardians g join public.user_accounts ua on ua.person_id = g.person_id where ua.id = auth.uid())));
create policy scope_staff_enrollments on public.enrollments for select to authenticated using (
  app.staff_scope_allowed(array['finance_officer','finance_approver','auditor'], academic_year_id, null, null)
  or app.teacher_section_allowed(grade_section_id)
  or app.staff_scope_allowed(array['admissions_officer','admissions_approver'], academic_year_id, grade_section_id, null)
);
create policy scope_staff_conversions on public.enrollment_conversions for select to authenticated using (app.admission_staff_scope(application_id, array['admissions_officer','admissions_approver','auditor']));
create policy scope_staff_support_records on public.student_support_records for select to authenticated using (app.staff_scope_allowed(array['support_officer','auditor'], null, null, null));

create policy scope_auth_published_notices on public.notices for select to authenticated using (
  (status in ('published','expired') and id = any(app.public_notice_ids()))
  or id in (
    select na.notice_id from public.notice_audiences na
     where na.audience = 'role'
       and na.role_code in (select role_code from public.role_grants where account_id = auth.uid() and status = 'active')
       and (
         na.role_code not in ('content_editor','content_publisher','admissions_officer','admissions_approver','finance_officer','finance_approver','hr_reviewer','hr_approver','teacher','exam_reviewer','result_publisher','timetable_manager','support_officer','auditor','system_administrator')
         or app.is_staff_aal2()
       )
  )
);
create policy scope_guardian_notices on public.notices for select to authenticated using (id = any(app.guardian_notice_ids()));

-- Attachment links have no independent business meaning; they inherit the
-- authorization of their owning record/document.
create policy scope_admission_documents_read on public.admission_documents for select to authenticated using (app.admission_staff_scope(application_id, array['admissions_officer','admissions_approver','auditor']) or exists (select 1 from public.admission_applications a where a.id = application_id and a.owner_account_id = auth.uid()));
create policy scope_job_documents_read on public.job_documents for select to authenticated using (app.hr_application_scope(application_id, array['hr_reviewer','hr_approver','auditor']) or exists (select 1 from public.job_applications a where a.id = application_id and a.owner_account_id = auth.uid()));
create policy scope_student_documents_read on public.student_documents for select to authenticated using (app.document_staff_allowed('student', student_id) or app.guardian_has_capability(student_id, 'documents'));
create policy scope_invoice_documents_read on public.invoice_documents for select to authenticated using (app.finance_invoice_scope(invoice_id) or exists (select 1 from public.invoices i where i.id = invoice_id and i.student_id is not null and app.guardian_has_capability(i.student_id, 'documents')));
create policy scope_result_documents_read on public.result_documents for select to authenticated using (exists (select 1 from public.result_publications rp where rp.id = publication_id and app.result_batch_scope(rp.batch_id, array['exam_reviewer','result_publisher','auditor'])));
create policy scope_support_documents_read on public.support_documents for select to authenticated using (app.staff_scope_allowed(array['support_officer','auditor'], null, null, null) or exists (select 1 from public.support_requests sr where sr.id = support_request_id and sr.requester_account_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Maker/checker command hardening
-- ---------------------------------------------------------------------------

-- The v2 command requires a separately recorded reviewer step and an
-- optimistic version. The legacy signature delegates to it for callers that
-- have not yet supplied a version; all new adapter calls use v2.
create or replace function app.admissions_decide_v2(
  p_application_id uuid, p_action text, p_visible_reason text default null,
  p_private_note text default null, p_conditions jsonb default '{}'::jsonb,
  p_expires_at timestamptz default null, p_expected_version int default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_app public.admission_applications%rowtype; v_next int;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('admissions_approver')) then raise exception 'admissions approver role and aal2 required'; end if;
  if p_action not in ('offer','waitlist','decline') then raise exception 'invalid decision action'; end if;
  select * into v_app from public.admission_applications where id = p_application_id for update;
  if v_app.id is null then raise exception 'application not found'; end if;
  if p_expected_version is not null and v_app.version <> p_expected_version then raise exception 'application version mismatch (expected %, found %)', p_expected_version, v_app.version; end if;
  if not app.admission_staff_scope(p_application_id, array['admissions_approver']) then raise exception 'application is outside the approver scope'; end if;
  if v_app.owner_account_id = auth.uid() then raise exception 'an approver cannot decide their own application'; end if;
  if not exists (select 1 from public.admission_reviews ar where ar.application_id = p_application_id and ar.officer_account_id <> auth.uid() and ar.action in ('reviewed','moved_to_assessment','requested_changes')) then raise exception 'a separate admissions reviewer step is required'; end if;
  if v_app.current_status not in ('under_review','assessment') then raise exception 'application cannot be decided in state (%)', v_app.current_status; end if;
  v_next := v_app.version + 1;
  if p_action = 'offer' then
    insert into public.admission_offers (application_id, grade_id, academic_year_id, conditions, expires_at, decided_by_account_id)
    values (p_application_id, v_app.grade_id, v_app.academic_year_id, coalesce(p_conditions,'{}'::jsonb), coalesce(p_expires_at, now() + interval '14 days'), auth.uid());
    update public.admission_applications set current_status = 'offered', version = v_next where id = p_application_id;
    insert into public.admission_events (application_id, event_type, visible_to_applicant, copy) values (p_application_id, 'offered', true, 'Offer extended');
  elsif p_action = 'waitlist' then
    update public.admission_applications set current_status = 'waitlisted', version = v_next where id = p_application_id;
    insert into public.admission_events (application_id, event_type, visible_to_applicant, copy) values (p_application_id, 'waitlisted', true, 'Placed on the waitlist');
  else
    update public.admission_applications set current_status = 'declined', version = v_next where id = p_application_id;
    insert into public.admission_events (application_id, event_type, visible_to_applicant, copy) values (p_application_id, 'declined', true, 'Application declined: ' || coalesce(p_visible_reason, 'no reason given'));
  end if;
  insert into public.admission_reviews (application_id, officer_account_id, action, visible_reason, private_note) values (p_application_id, auth.uid(), 'reviewed', p_visible_reason, p_private_note);
  perform app.record_audit('Admission decision: ' || p_action, 'admission_application', v_app.reference, 'Success');
  return jsonb_build_object('applicationId', v_app.id, 'reference', v_app.reference, 'status', case p_action when 'offer' then 'offered' when 'waitlist' then 'waitlisted' else 'declined' end, 'version', v_next);
end
$$;

create or replace function app.admissions_decide(
  p_application_id uuid, p_action text, p_visible_reason text default null,
  p_private_note text default null, p_conditions jsonb default '{}'::jsonb,
  p_expires_at timestamptz default null
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.admissions_decide_v2(p_application_id, p_action, p_visible_reason, p_private_note, p_conditions, p_expires_at, null);
end
$$;

-- HR actions are maker/checker by transition: reviewers may shortlist or
-- schedule interviews; approvers alone may offer or reject.
create or replace function app.jobs_decide_v2(
  p_application_id uuid, p_action text, p_reason text default null,
  p_private_note text default null, p_scheduled_at timestamptz default null,
  p_expected_version int default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_app public.job_applications%rowtype; v_status text; v_next int;
begin
  if auth.uid() is null or not app.is_staff_aal2() then raise exception 'HR role and aal2 required'; end if;
  if p_action not in ('shortlist','interview','offer','not_selected') then raise exception 'invalid decision action'; end if;
  if p_action in ('shortlist','interview') and not app.has_role('hr_reviewer') then raise exception 'HR reviewer role and aal2 required'; end if;
  if p_action in ('offer','not_selected') and not app.has_role('hr_approver') then raise exception 'HR approver role and aal2 required'; end if;
  select * into v_app from public.job_applications where id = p_application_id for update;
  if v_app.id is null then raise exception 'application not found'; end if;
  if p_expected_version is not null and v_app.version <> p_expected_version then raise exception 'application version mismatch (expected %, found %)', p_expected_version, v_app.version; end if;
  if v_app.owner_account_id = auth.uid() then raise exception 'HR reviewer cannot decide their own application'; end if;
  if p_action in ('shortlist','interview') and not app.hr_application_scope(p_application_id, array['hr_reviewer']) then raise exception 'reviewer assignment required'; end if;
  if p_action in ('offer','not_selected') and not app.hr_application_scope(p_application_id, array['hr_approver']) then raise exception 'application is outside the approver scope'; end if;
  if p_action = 'interview' and p_scheduled_at is null then raise exception 'interview requires a scheduled time'; end if;
  v_status := case p_action when 'shortlist' then 'shortlisted' when 'interview' then 'interview' when 'offer' then 'offered' else 'not_selected' end;
  v_next := v_app.version + 1;
  update public.job_applications set current_status = v_status, version = v_next where id = p_application_id;
  if p_action = 'interview' then insert into public.job_interviews (application_id, scheduled_at, outcome, notes) values (p_application_id, p_scheduled_at, 'pending', p_private_note); end if;
  insert into public.job_events (application_id, event_type, visible_to_applicant, copy) values (p_application_id, p_action, true, coalesce(p_reason, initcap(replace(p_action,'_',' '))));
  perform app.record_audit('Job decision: ' || p_action, 'job_application', v_app.reference, 'Success');
  return jsonb_build_object('applicationId', v_app.id, 'reference', v_app.reference, 'status', v_status, 'version', v_next);
end
$$;

create or replace function app.jobs_decide(
  p_application_id uuid, p_action text, p_reason text default null,
  p_private_note text default null, p_scheduled_at timestamptz default null
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform app.jobs_decide_v2(p_application_id, p_action, p_reason, p_private_note, p_scheduled_at, null);
end
$$;

-- Mark entry commands require the teacher role in addition to the exact
-- assignment check already present in the legacy function.
alter function app.results_submit_marks(uuid, jsonb, int) rename to results_submit_marks_legacy;
create function app.results_submit_marks(p_batch_id uuid, p_marks jsonb, p_expected_version int) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not (app.is_staff_aal2() and app.has_role('teacher')) then raise exception 'teacher role and aal2 required'; end if;
  perform app.results_submit_marks_legacy(p_batch_id, p_marks, p_expected_version);
end
$$;

revoke all on function app.admissions_decide_v2(uuid,text,text,text,jsonb,timestamptz,int), app.results_submit_marks_legacy(uuid,jsonb,int) from public;
grant execute on function app.admissions_decide_v2(uuid,text,text,text,jsonb,timestamptz,int), app.results_submit_marks_legacy(uuid,jsonb,int) to authenticated;
revoke all on function app.jobs_decide_v2(uuid,text,text,text,timestamptz,int), app.admissions_decide(uuid,text,text,text,jsonb,timestamptz), app.jobs_decide(uuid,text,text,text,timestamptz), app.results_submit_marks(uuid,jsonb,int) from public;
grant execute on function app.jobs_decide_v2(uuid,text,text,text,timestamptz,int), app.admissions_decide(uuid,text,text,text,jsonb,timestamptz), app.jobs_decide(uuid,text,text,text,timestamptz), app.results_submit_marks(uuid,jsonb,int) to authenticated;

commit;
