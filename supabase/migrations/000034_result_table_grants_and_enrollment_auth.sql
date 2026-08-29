-- Fix 1: Grant SELECT on result_entry_* and result_report_* tables to authenticated
-- (migration 000028 revoked all from anon/authenticated but never re-granted SELECT,
-- making the RLS policies on those tables unreachable for authenticated users)
grant select on
  public.result_entry_sheets,
  public.result_entry_sheet_rosters,
  public.result_entry_sheet_components,
  public.result_entry_sheet_marks,
  public.result_entry_sheet_versions,
  public.result_report_releases,
  public.result_report_release_items,
  public.result_report_release_events
to authenticated;

-- Insert/Update for staff write operations on entry sheets
grant insert, update on
  public.result_entry_sheets,
  public.result_entry_sheet_rosters,
  public.result_entry_sheet_components,
  public.result_entry_sheet_marks,
  public.result_entry_sheet_versions
to authenticated;

-- Insert on release events for audit trail
grant insert on
  public.result_report_release_events
to authenticated;

-- Fix 2: enrollment_convert — move authorization check before any data read
-- The current function reads enrollment_conversions before checking auth.uid(),
-- which allows any authenticated user to read conversion results by guessing UUIDs.
-- We recreate the function with the auth check moved to the top.
create or replace function app.enrollment_convert(
  p_application_id uuid,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_app public.admission_applications%rowtype;
  v_existing public.enrollment_conversions%rowtype;
  v_person public.people%rowtype;
  v_student public.students%rowtype;
  v_enrollment public.enrollments%rowtype;
  v_invoice public.invoices%rowtype;
  v_guardian_link public.guardian_student_links%rowtype;
  v_result jsonb;
  v_next int;
begin
  -- Authorization FIRST: only the applicant or an admissions approver can convert
  select * into v_app from public.admission_applications where id = p_application_id for update;
  if v_app.id is null then raise exception 'application not found'; end if;
  if not (v_app.owner_account_id = auth.uid() or (app.is_staff_aal2() and app.has_role('admissions_approver'))) then
    raise exception 'not authorized to convert this application';
  end if;

  -- Idempotency: return existing result if already converted
  select * into v_existing from public.enrollment_conversions where application_id = p_application_id;
  if v_existing.id is not null then
    return v_existing.result;
  end if;

  -- Verify the application is in a convertible state
  if v_app.current_status not in ('offered') then
    raise exception 'application is not in a convertible state (%)', v_app.current_status;
  end if;

  -- Check that fee is paid (admission invoice exists and is paid)
  select * into v_invoice from public.invoices
    where applicant_ref = v_app.reference and status = 'paid' limit 1;
  if v_invoice.id is null then
    raise exception 'admission fee has not been paid';
  end if;

  -- Create or match the person
  select * into v_person from public.people
    where given_name = split_part(v_app.student_name, ' ', 1)
    and family_name = split_part(v_app.student_name, ' ', 2)
    limit 1;

  if v_person.id is null then
    insert into public.people (given_name, family_name, display_name)
    values (split_part(v_app.student_name, ' ', 1), split_part(v_app.student_name, ' ', 2), v_app.student_name)
    returning * into v_person;
  end if;

  -- Create the student
  insert into public.students (person_id, admission_number, status)
  values (v_person.id, app.new_ref('STU', 6), 'active')
  returning * into v_student;

  -- Create the enrollment
  insert into public.enrollments (student_id, academic_year_id, grade_id, enrollment_date, status)
  values (v_student.id, v_app.academic_year_id, v_app.grade_id, now()::date, 'active')
  returning * into v_enrollment;

  -- Link the guardian
  insert into public.guardian_student_links (guardian_id, student_id, relationship, status, verified_by_account_id, verified_at)
  select g.id, v_student.id, 'parent', 'active', null, now()
  from public.guardians g
  join public.user_accounts ua on ua.person_id = g.person_id
  where ua.id = v_app.owner_account_id
  on conflict do nothing
  returning * into v_guardian_link;

  -- Adopt the invoice onto the student ledger
  update public.invoices set student_id = v_student.id where id = v_invoice.id;

  -- Update the application status
  v_next := v_app.version + 1;
  update public.admission_applications set current_status = 'enrolled', version = v_next where id = p_application_id;

  -- Record the conversion
  v_result := jsonb_build_object(
    'studentId', v_student.id,
    'studentRef', v_student.admission_number,
    'enrollmentId', v_enrollment.id,
    'applicationRef', v_app.reference
  );

  insert into public.enrollment_conversions (application_id, result, idempotency_key)
  values (p_application_id, v_result, p_idempotency_key)
  on conflict (application_id) do nothing;

  perform app.record_audit('Enrollment conversion', 'admission_application', v_app.reference, 'Success');
  perform app.enqueue_outbox('email.enrollment:' || v_app.reference, 'email.deliver', 'admission_application', v_app.reference, jsonb_build_object('channel','email'));

  return v_result;
end
$function$;
