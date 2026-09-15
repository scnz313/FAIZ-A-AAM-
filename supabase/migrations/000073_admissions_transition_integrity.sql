-- ---------------------------------------------------------------------------
-- 000073 — admissions transition integrity
--
-- 1. admissions_review_advance / admissions_request_changes had no row lock
--    and no expected-version parameter: two concurrent maker clicks could
--    both pass the status check and append duplicate review/event rows, and
--    the stated optimistic-concurrency contract was unenforced. The _v2
--    functions lock the application row and reject a stale version.
-- 2. The service transition matrix drifted from the staff UI and the demo
--    adapter: "Start review" on a changes-requested application and
--    decline from changes-requested/waitlisted always failed in Supabase.
--    The matrix is now the intended one.
-- 3. admissions_decide_v2 stored the typed reason only in
--    admission_reviews.visible_reason while the applicant-visible event copy
--    stayed generic, although the staff dialog promises the applicant sees
--    it. Offer/waitlist copies now include the reason when provided.
-- 4. The offered fee was never persisted, so the applicant saw ₹0.00 until
--    the invoice existed. The offer now records the approved fee schedule
--    total in conditions (admissionFeePaise/feeScheduleVersionId) when a
--    schedule is approved; the invoice still comes from the schedule.
-- ---------------------------------------------------------------------------

create or replace function app.admissions_review_advance_v2(
  p_application_id uuid,
  p_action text,
  p_visible_reason text default null,
  p_private_note text default null,
  p_expected_version int default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.admission_applications%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not (app.is_staff_aal2() and app.has_any_role(
      array['admissions_officer', 'admissions_approver', 'system_administrator'])) then
    raise exception 'admissions officer role and aal2 required';
  end if;
  if p_action not in ('under_review', 'assessment') then
    raise exception 'invalid advance action';
  end if;
  select * into v_app from public.admission_applications
   where id = p_application_id for update;
  if v_app.id is null then
    raise exception 'application not found';
  end if;
  if p_expected_version is not null and v_app.version <> p_expected_version then
    raise exception 'application version mismatch (expected %, found %)', p_expected_version, v_app.version;
  end if;
  if p_action = 'under_review' and v_app.current_status not in ('submitted', 'changes_requested') then
    raise exception 'only submitted or changes-requested applications enter review (state: %)', v_app.current_status;
  end if;
  if p_action = 'assessment' and v_app.current_status <> 'under_review' then
    raise exception 'only reviewed applications reach assessment (state: %)', v_app.current_status;
  end if;

  insert into public.admission_reviews (application_id, officer_account_id, action,
                                        visible_reason, private_note)
  values (p_application_id, auth.uid(), 'reviewed', p_visible_reason, p_private_note);

  update public.admission_applications
     set current_status = p_action, version = v_app.version + 1
   where id = p_application_id;

  insert into public.admission_events (application_id, event_type, visible_to_applicant, copy)
  values (p_application_id, p_action, true,
          case when p_action = 'under_review' then 'Application under review'
               else 'Application moved to assessment' end);

  perform app.record_audit('Admission review: ' || p_action, 'admission_application',
                           v_app.reference, 'Success');
end
$$;

create or replace function app.admissions_request_changes_v2(
  p_application_id uuid,
  p_visible_reason text,
  p_private_note text default null,
  p_expected_version int default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.admission_applications%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not (app.is_staff_aal2() and app.has_any_role(
      array['admissions_officer', 'admissions_approver', 'system_administrator'])) then
    raise exception 'admissions officer role and aal2 required';
  end if;
  if p_visible_reason is null or length(btrim(p_visible_reason)) < 3 then
    raise exception 'a reason shown to the applicant is required';
  end if;
  select * into v_app from public.admission_applications
   where id = p_application_id for update;
  if v_app.id is null then
    raise exception 'application not found';
  end if;
  if p_expected_version is not null and v_app.version <> p_expected_version then
    raise exception 'application version mismatch (expected %, found %)', p_expected_version, v_app.version;
  end if;
  if v_app.current_status not in ('submitted', 'under_review') then
    raise exception 'application cannot be returned in state (%)', v_app.current_status;
  end if;

  insert into public.admission_reviews (application_id, officer_account_id, action,
                                        visible_reason, private_note)
  values (p_application_id, auth.uid(), 'requested_changes', btrim(p_visible_reason), p_private_note);

  update public.admission_applications
     set current_status = 'changes_requested', version = v_app.version + 1
   where id = p_application_id;

  insert into public.admission_events (application_id, event_type, visible_to_applicant, copy)
  values (p_application_id, 'changes_requested', true, 'Changes requested: ' || btrim(p_visible_reason));

  perform app.record_audit('Admission changes requested', 'admission_application',
                           v_app.reference, 'Success');
  perform app.enqueue_outbox(
    'email.application_changes:' || v_app.reference || ':v' || (v_app.version + 1),
    'email.deliver', 'admission_application', v_app.reference,
    jsonb_build_object('channel', 'email'));
end
$$;

create or replace function app.admissions_decide_v2(
  p_application_id uuid, p_action text, p_visible_reason text default null,
  p_private_note text default null, p_conditions jsonb default '{}'::jsonb,
  p_expires_at timestamptz default null, p_expected_version int default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_app public.admission_applications%rowtype;
  v_next int;
  v_offer public.admission_offers%rowtype;
  v_conditions jsonb;
  v_schedule public.fee_schedule_versions%rowtype;
  v_fee bigint;
  v_reason text := nullif(btrim(coalesce(p_visible_reason, '')), '');
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('admissions_approver')) then raise exception 'admissions approver role and aal2 required'; end if;
  if p_action not in ('offer','waitlist','decline') then raise exception 'invalid decision action'; end if;
  select * into v_app from public.admission_applications where id = p_application_id for update;
  if v_app.id is null then raise exception 'application not found'; end if;
  if p_expected_version is not null and v_app.version <> p_expected_version then raise exception 'application version mismatch (expected %, found %)', p_expected_version, v_app.version; end if;
  if not app.admission_staff_scope(p_application_id, array['admissions_approver']) then raise exception 'application is outside the approver scope'; end if;
  if v_app.owner_account_id = auth.uid() then raise exception 'an approver cannot decide their own application'; end if;
  if not exists (select 1 from public.admission_reviews ar where ar.application_id = p_application_id and ar.officer_account_id <> auth.uid() and ar.action in ('reviewed','moved_to_assessment','requested_changes')) then raise exception 'a separate admissions reviewer step is required'; end if;
  if p_action in ('offer','waitlist') and v_app.current_status not in ('under_review','assessment') then
    raise exception 'application cannot be % in state (%)', p_action, v_app.current_status;
  end if;
  if p_action = 'decline' and v_app.current_status not in ('under_review','assessment','waitlisted','changes_requested') then
    raise exception 'application cannot be declined in state (%)', v_app.current_status;
  end if;
  v_next := v_app.version + 1;
  if p_action = 'offer' then
    /* Persist the approved fee so the applicant sees the real amount before
       the invoice exists; the invoice still issues from the schedule. */
    v_conditions := coalesce(p_conditions, '{}'::jsonb);
    if not (v_conditions ? 'admissionFeePaise') then
      select * into v_schedule from public.fee_schedule_versions
       where status = 'approved' order by version desc limit 1;
      if v_schedule.id is not null then
        select coalesce(sum(fs.amount_paise), 0) into v_fee
          from public.fee_schedule_items fs
         where fs.schedule_version_id = v_schedule.id and fs.kind in ('fee', 'other');
        if v_fee > 0 then
          v_conditions := v_conditions || jsonb_build_object(
            'admissionFeePaise', v_fee,
            'feeScheduleVersionId', v_schedule.id);
        end if;
      end if;
    end if;
    insert into public.admission_offers (application_id, grade_id, academic_year_id, conditions, expires_at, decided_by_account_id, final_approved_by_account_id, final_approved_at)
    values (p_application_id, v_app.grade_id, v_app.academic_year_id, v_conditions, coalesce(p_expires_at, now() + interval '14 days'), auth.uid(), auth.uid(), now())
    returning * into v_offer;
    update public.admission_applications set current_status = 'offered', version = v_next where id = p_application_id;
    insert into public.admission_events (application_id, event_type, visible_to_applicant, copy)
    values (p_application_id, 'offered', true, 'Offer extended' || case when v_reason is null then '' else ': ' || v_reason end);
    perform app.enqueue_outbox('email.offer:' || v_app.reference, 'email.deliver', 'admission_application', v_app.reference, jsonb_build_object('channel','email'));
  elsif p_action = 'waitlist' then
    update public.admission_applications set current_status = 'waitlisted', version = v_next where id = p_application_id;
    insert into public.admission_events (application_id, event_type, visible_to_applicant, copy)
    values (p_application_id, 'waitlisted', true, 'Placed on the waitlist' || case when v_reason is null then '' else ': ' || v_reason end);
    perform app.enqueue_outbox('email.application_decision:' || v_app.reference || ':v' || v_next, 'email.deliver', 'admission_application', v_app.reference, jsonb_build_object('channel','email','decision','waitlisted'));
  else
    update public.admission_applications set current_status = 'declined', version = v_next where id = p_application_id;
    insert into public.admission_events (application_id, event_type, visible_to_applicant, copy)
    values (p_application_id, 'declined', true, 'Application declined: ' || coalesce(v_reason, 'no reason given'));
    perform app.enqueue_outbox('email.application_decision:' || v_app.reference || ':v' || v_next, 'email.deliver', 'admission_application', v_app.reference, jsonb_build_object('channel','email','decision','declined'));
  end if;
  insert into public.admission_reviews (application_id, officer_account_id, action, visible_reason, private_note) values (p_application_id, auth.uid(), 'reviewed', p_visible_reason, p_private_note);
  perform app.record_audit('Admission decision: ' || p_action, 'admission_application', v_app.reference, 'Success');
  return jsonb_build_object('applicationId', v_app.id, 'reference', v_app.reference, 'status', case p_action when 'offer' then 'offered' when 'waitlist' then 'waitlisted' else 'declined' end, 'version', v_next);
end
$$;

revoke all on function app.admissions_review_advance_v2(uuid,text,text,text,int), app.admissions_request_changes_v2(uuid,text,text,int) from public;
grant execute on function app.admissions_review_advance_v2(uuid,text,text,text,int), app.admissions_request_changes_v2(uuid,text,text,int) to authenticated;
