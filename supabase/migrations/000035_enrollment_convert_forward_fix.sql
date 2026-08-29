begin;

drop function if exists app.enrollment_convert(uuid, text);

create or replace function app.enrollment_convert(p_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.admission_applications%rowtype;
  v_offer public.admission_offers%rowtype;
  v_invoice public.invoices%rowtype;
  v_window public.admission_windows%rowtype;
  v_section public.grade_sections%rowtype;
  v_existing public.enrollment_conversions%rowtype;
  v_candidate_student uuid;
  v_candidate_enrollment uuid;
  v_candidate_link uuid;
  v_review public.admission_duplicate_reviews%rowtype;
  v_person_id uuid;
  v_student_id uuid;
  v_enrollment_id uuid;
  v_guardian_id uuid;
  v_link_id uuid;
  v_enrolled int;
  v_result jsonb;
  v_readiness jsonb;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  select * into v_app from public.admission_applications where id = p_application_id for update;
  if v_app.id is null then raise exception 'application not found'; end if;
  if not (v_app.owner_account_id = auth.uid() or (app.is_staff_aal2() and app.has_role('admissions_approver'))) then raise exception 'not authorized to convert this application'; end if;
  select * into v_existing from public.enrollment_conversions where application_id = p_application_id;
  if v_existing.id is not null then
    perform app.enqueue_outbox('email.enrollment_complete:' || v_app.reference, 'email.deliver', 'enrollment', v_existing.enrollment_id::text, jsonb_build_object('channel','email'));
    return v_existing.result;
  end if;
  select * into v_offer from public.admission_offers where application_id = p_application_id for update;
  if v_offer.id is null or v_offer.response <> 'accepted' then raise exception 'offer must be accepted before conversion'; end if;
  select * into v_invoice from public.invoices where applicant_ref = v_app.reference for update;
  select * into v_window from public.admission_windows where academic_year_id = v_offer.academic_year_id and grade_id = v_offer.grade_id order by version desc, created_at desc limit 1 for update;
  if v_window.id is null then raise exception 'admission placement window is not configured'; end if;
  select * into v_review from public.admission_duplicate_reviews where application_id = p_application_id for update;
  if v_review.id is not null and v_review.status = 'pending' then
    return jsonb_build_object('application', v_app.reference, 'status', 'manual_review_required', 'manualReviewRequired', true, 'duplicateReviewRef', v_review.reference, 'candidateStudent', v_review.candidate_student_id, 'matched_existing', false);
  elsif v_review.id is not null and v_review.status = 'rejected' then
    return jsonb_build_object('application', v_app.reference, 'status', 'manual_review_rejected', 'manualReviewRequired', true, 'duplicateReviewRef', v_review.reference, 'candidateStudent', v_review.candidate_student_id, 'matched_existing', false);
  end if;
  v_readiness := app.enrollment_readiness(p_application_id);
  if coalesce((v_readiness ->> 'ready')::boolean, false) is not true then
    raise exception 'enrollment readiness failed: %', coalesce(v_readiness ->> 'policyPendingKeys', v_readiness::text);
  end if;
  select * into v_section from public.grade_sections where academic_year_id = v_offer.academic_year_id and grade_id = v_offer.grade_id and status = 'active' order by section_label limit 1;
  if v_section.id is null then raise exception 'no grade section configured for the offer placement'; end if;
  select count(*) into v_enrolled from public.enrollments e join public.grade_sections gs on gs.id = e.grade_section_id where e.academic_year_id = v_offer.academic_year_id and gs.grade_id = v_offer.grade_id and e.status = 'active';
  if v_window.capacity is null or v_enrolled >= v_window.capacity then raise exception 'admission capacity is unavailable'; end if;

  select s.id, e.id, l.id into v_candidate_student, v_candidate_enrollment, v_candidate_link
    from public.students s join public.people p on p.id = s.person_id
    join public.enrollments e on e.student_id = s.id and e.status = 'active' and e.academic_year_id = v_offer.academic_year_id
    join public.grade_sections gs on gs.id = e.grade_section_id and gs.grade_id = v_offer.grade_id
    join public.guardian_student_links l on l.student_id = s.id and l.status = 'active'
    join public.guardians g on g.id = l.guardian_id
    join public.user_accounts ua on ua.person_id = g.person_id and ua.id = v_app.owner_account_id
   where lower(regexp_replace(btrim(p.display_name), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(v_app.student_name), '\s+', ' ', 'g'))
   order by e.created_at limit 1;
  if v_candidate_student is not null then
    if not exists (select 1 from public.admission_identity_evidence ie where ie.application_id = p_application_id and ie.candidate_student_id = v_candidate_student and ie.status = 'verified' and ie.evidence_type in ('birth_certificate','school_reference','verified_document','guardian_reference','other')) then
      insert into public.admission_duplicate_reviews (application_id, candidate_student_id, reason)
      values (p_application_id, v_candidate_student, 'A same-name enrolled student requires verified identity evidence before matching.')
      on conflict (application_id) do update set updated_at = now(), version = public.admission_duplicate_reviews.version + 1
      returning * into v_review;
      update public.admission_applications set current_status = 'duplicate_review', version = version + 1 where id = p_application_id;
      insert into public.admission_events (application_id, event_type, visible_to_applicant, copy) values (p_application_id, 'duplicate_review', false, 'Manual duplicate review required');
      perform app.record_audit('Admission duplicate review required', 'admission_application', v_app.reference, 'Failed', 'Verified identity evidence is required before an existing student can be matched.');
      return jsonb_build_object('application', v_app.reference, 'status', 'manual_review_required', 'manualReviewRequired', true, 'duplicateReviewRef', v_review.reference, 'candidateStudent', v_candidate_student, 'matched_existing', false);
    end if;
    update public.invoices set student_id = v_candidate_student, enrollment_id = v_candidate_enrollment where id = v_invoice.id;
    update public.admission_applications set current_status = 'enrolled' where id = v_app.id;
    v_result := jsonb_build_object('application', v_app.reference, 'student', v_candidate_student, 'enrollment', v_candidate_enrollment, 'invoice', v_invoice.reference, 'guardian_link', v_candidate_link, 'matched_existing', true);
    insert into public.enrollment_conversions (application_id, student_id, enrollment_id, guardian_link_id, matched_existing, result) values (v_app.id, v_candidate_student, v_candidate_enrollment, v_candidate_link, true, v_result);
    insert into public.admission_events (application_id, event_type, visible_to_applicant, copy) values (v_app.id, 'enrolled', true, 'Enrollment complete — verified existing student match');
    perform app.record_audit('Enrollment conversion matched verified student', 'enrollment', v_candidate_enrollment::text, 'Success');
    perform app.enqueue_outbox('email.enrollment_complete:' || v_app.reference, 'email.deliver', 'enrollment', v_candidate_enrollment::text, jsonb_build_object('channel','email'));
    return v_result;
  end if;

  insert into public.people (given_name, family_name, display_name) values (v_app.student_name, '', v_app.student_name) returning id into v_person_id;
  insert into public.students (person_id, status) values (v_person_id, 'active') returning id into v_student_id;
  insert into public.enrollments (student_id, academic_year_id, grade_section_id, status) values (v_student_id, v_offer.academic_year_id, v_section.id, 'active') returning id into v_enrollment_id;
  insert into public.guardians (person_id, status) select ua.person_id, 'active' from public.user_accounts ua where ua.id = v_app.owner_account_id on conflict (person_id) do nothing;
  select g.id into v_guardian_id from public.guardians g join public.user_accounts ua on ua.person_id = g.person_id where ua.id = v_app.owner_account_id;
  insert into public.guardian_student_links (guardian_id, student_id, relationship_label, status, verification_source, approved_by_account_id, approved_at, effective_from) values (v_guardian_id, v_student_id, 'Parent', 'active', 'enrollment_invitation', auth.uid(), now(), now()) returning id into v_link_id;
  update public.invoices set student_id = v_student_id, enrollment_id = v_enrollment_id where id = v_invoice.id;
  update public.admission_applications set current_status = 'enrolled' where id = v_app.id;
  v_result := jsonb_build_object('application', v_app.reference, 'student', v_student_id, 'enrollment', v_enrollment_id, 'invoice', v_invoice.reference, 'guardian_link', v_link_id, 'matched_existing', false);
  insert into public.enrollment_conversions (application_id, student_id, enrollment_id, guardian_link_id, matched_existing, result) values (v_app.id, v_student_id, v_enrollment_id, v_link_id, false, v_result);
  insert into public.admission_events (application_id, event_type, visible_to_applicant, copy) values (v_app.id, 'enrolled', true, 'Enrollment complete');
  perform app.record_audit('Enrollment conversion', 'enrollment', v_enrollment_id::text, 'Success');
  perform app.enqueue_outbox('email.enrollment_complete:' || v_app.reference, 'email.deliver', 'enrollment', v_enrollment_id::text, jsonb_build_object('channel','email'));
  return v_result;
end
$$;

revoke all on function app.enrollment_convert(uuid) from public, anon;
grant execute on function app.enrollment_convert(uuid) to authenticated;

commit;
