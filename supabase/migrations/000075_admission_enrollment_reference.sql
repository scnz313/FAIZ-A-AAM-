-- ---------------------------------------------------------------------------
-- 000075 — admission enrollment reference
--
-- After conversion, the applicant's status page shows the permanent student
-- and enrollment references. The conversion result carries them once, but a
-- reload re-reads only the application projection, and applicants cannot read
-- `enrollment_conversions` under RLS (staff-only policy). This function
-- exposes the three public references for the owning applicant (or authorized
-- admissions staff) without revealing internal ids or the conversion row.
-- ---------------------------------------------------------------------------

create or replace function app.admission_enrollment_reference(p_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not exists (
    select 1
      from public.admission_applications aa
     where aa.id = p_application_id
       and (
         aa.owner_account_id = auth.uid()
         or app.admission_staff_scope(p_application_id, array['admissions_officer', 'admissions_approver', 'auditor'])
       )
  ) then
    raise exception 'application is not accessible to this account';
  end if;

  select jsonb_build_object(
    'studentRef', s.reference,
    'enrollmentRef', e.reference,
    'linkRef', l.reference,
    'matchedExisting', ec.matched_existing)
    into v_result
    from public.enrollment_conversions ec
    join public.students s on s.id = ec.student_id
    join public.enrollments e on e.id = ec.enrollment_id
    left join public.guardian_student_links l on l.id = ec.guardian_link_id
   where ec.application_id = p_application_id;

  return v_result;
end
$$;

revoke all on function app.admission_enrollment_reference(uuid) from public;
grant execute on function app.admission_enrollment_reference(uuid) to authenticated;
