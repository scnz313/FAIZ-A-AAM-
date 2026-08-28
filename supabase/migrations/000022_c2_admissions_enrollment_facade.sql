-- =============================================================================
-- 000022 — C2.2 admissions draft and enrollment facade hardening
--
-- Local-first migration. It is intentionally forward-only and must not be
-- pushed to the linked project until the staging ledger is re-read.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Admissions: owner-scoped draft save/upsert
-- ---------------------------------------------------------------------------
create or replace function app.admissions_save_draft(
  p_application_id uuid default null,
  p_academic_year_id uuid default null,
  p_grade_id uuid default null,
  p_student_name text default null,
  p_parent_name text default null,
  p_parent_contact text default null,
  p_draft jsonb default '{}'::jsonb,
  p_schema_version int default 1,
  p_expected_version int default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.admission_applications%rowtype;
  v_updated_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if p_draft is null or jsonb_typeof(p_draft) <> 'object' then
    raise exception 'draft must be an object';
  end if;
  if p_schema_version is null or p_schema_version < 1 then
    raise exception 'invalid draft schema version';
  end if;
  if p_application_id is null then
    if p_academic_year_id is null or p_grade_id is null then
      raise exception 'academic year and grade are required for a new draft';
    end if;
    if p_student_name is null or length(btrim(p_student_name)) = 0
       or p_parent_name is null or length(btrim(p_parent_name)) = 0 then
      raise exception 'student and guardian names are required for a new draft';
    end if;
    insert into public.admission_applications
      (owner_account_id, academic_year_id, grade_id, current_status,
       student_name, parent_name, parent_contact)
    values
      (auth.uid(), p_academic_year_id, p_grade_id, 'draft',
       btrim(p_student_name), btrim(p_parent_name), nullif(btrim(p_parent_contact), ''))
    returning * into v_app;
  else
    select * into v_app
      from public.admission_applications
     where id = p_application_id
     for update;
    if v_app.id is null then
      raise exception 'application not found';
    end if;
    if v_app.owner_account_id <> auth.uid() then
      raise exception 'not the application owner';
    end if;
    if v_app.current_status not in ('draft', 'changes_requested') then
      raise exception 'application is not in an editable state (%)', v_app.current_status;
    end if;
    if p_expected_version is not null and v_app.version <> p_expected_version then
      raise exception 'application version mismatch (expected %, found %)', p_expected_version, v_app.version;
    end if;
    update public.admission_applications
       set academic_year_id = coalesce(p_academic_year_id, academic_year_id),
           grade_id = coalesce(p_grade_id, grade_id),
           student_name = coalesce(nullif(btrim(p_student_name), ''), student_name),
           parent_name = coalesce(nullif(btrim(p_parent_name), ''), parent_name),
           parent_contact = coalesce(nullif(btrim(p_parent_contact), ''), parent_contact)
     where id = v_app.id
     returning * into v_app;
  end if;

  insert into public.admission_drafts
    (application_id, draft, schema_version, expires_at)
  values
    (v_app.id, p_draft, p_schema_version, now() + interval '90 days')
  on conflict (application_id) do update
    set draft = excluded.draft,
        schema_version = excluded.schema_version,
        expires_at = excluded.expires_at
  returning updated_at into v_updated_at;

  return jsonb_build_object(
    'id', v_app.id,
    'reference', v_app.reference,
    'version', v_app.version,
    'status', v_app.current_status,
    'updatedAt', v_updated_at
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Enrollment: create-or-match wrapper
--
-- The original command remains the create path. This wrapper first looks for
-- an already-active linked student belonging to the application owner with
-- the same normalized name and offer placement. A match adopts the paid
-- invoice and records matched_existing=true; otherwise the original command
-- performs its existing guarded create path.
-- ---------------------------------------------------------------------------
alter function app.enrollment_convert(uuid) rename to enrollment_convert_create;

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
  v_existing public.enrollment_conversions%rowtype;
  v_student_id uuid;
  v_enrollment_id uuid;
  v_link_id uuid;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;

  select * into v_existing from public.enrollment_conversions
   where application_id = p_application_id;
  if v_existing.id is not null then
    return v_existing.result;
  end if;

  select * into v_app from public.admission_applications where id = p_application_id;
  if v_app.id is null then
    raise exception 'application not found';
  end if;
  select * into v_offer from public.admission_offers where application_id = p_application_id;
  select * into v_invoice from public.invoices where applicant_ref = v_app.reference;

  -- Let the original command return its canonical readiness/authorization
  -- errors when the application is not yet conversion-ready.
  if v_offer.id is null or v_offer.response <> 'accepted' or v_invoice.id is null
     or app.invoice_balance(v_invoice.id) > 0 then
    return app.enrollment_convert_create(p_application_id);
  end if;

  select s.id, e.id, l.id
    into v_student_id, v_enrollment_id, v_link_id
    from public.guardian_student_links l
    join public.guardians g on g.id = l.guardian_id
    join public.user_accounts ua on ua.person_id = g.person_id
    join public.students s on s.id = l.student_id
    join public.people p on p.id = s.person_id
    join public.enrollments e on e.student_id = s.id
    join public.grade_sections gs on gs.id = e.grade_section_id
   where ua.id = v_app.owner_account_id
     and l.status = 'active'
     and e.status = 'active'
     and e.academic_year_id = v_offer.academic_year_id
     and gs.grade_id = v_offer.grade_id
     and lower(btrim(p.display_name)) = lower(btrim(v_app.student_name))
   order by e.created_at
   limit 1;

  if v_student_id is null then
    return app.enrollment_convert_create(p_application_id);
  end if;

  if not (
    v_app.owner_account_id = auth.uid()
    or (app.is_staff_aal2() and app.has_any_role(array['admissions_approver']))
  ) then
    raise exception 'not authorized to convert this application';
  end if;

  update public.invoices
     set student_id = v_student_id, enrollment_id = v_enrollment_id
   where id = v_invoice.id;
  update public.admission_applications
     set current_status = 'enrolled'
   where id = v_app.id;

  v_result := jsonb_build_object(
    'application', v_app.reference,
    'student', v_student_id,
    'enrollment', v_enrollment_id,
    'invoice', v_invoice.reference,
    'guardian_link', v_link_id,
    'matched_existing', true
  );
  insert into public.enrollment_conversions
    (application_id, student_id, enrollment_id, guardian_link_id, matched_existing, result)
  values
    (v_app.id, v_student_id, v_enrollment_id, v_link_id, true, v_result);
  insert into public.admission_events (application_id, event_type, visible_to_applicant, copy)
  values (v_app.id, 'enrolled', true, 'Enrollment complete — existing linked student matched');
  perform app.record_audit('Enrollment conversion matched existing student', 'enrollment', v_enrollment_id::text, 'Success');
  perform app.enqueue_outbox(
    'email.enrollment_complete:' || v_app.reference, 'email.deliver', 'enrollment',
    v_enrollment_id::text, jsonb_build_object('channel', 'email'));
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------
-- Enrollment readiness projection
-- ---------------------------------------------------------------------------
create or replace function app.enrollment_readiness(p_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.admission_applications%rowtype;
  v_offer public.admission_offers%rowtype;
  v_invoice public.invoices%rowtype;
  v_capacity int;
  v_enrolled int;
  v_offered boolean := false;
  v_accepted boolean := false;
  v_fee_paid boolean := false;
  v_documents_complete boolean := true;
  v_capacity_available boolean := false;
  v_final_approved boolean := false;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  select * into v_app from public.admission_applications where id = p_application_id;
  if v_app.id is null then raise exception 'application not found'; end if;
  if not (
    v_app.owner_account_id = auth.uid()
    or (app.is_staff_aal2() and app.has_any_role(array['admissions_officer','admissions_approver']))
  ) then
    raise exception 'not authorized to read enrollment readiness';
  end if;

  select * into v_offer from public.admission_offers where application_id = p_application_id;
  v_offered := v_offer.id is not null;
  v_accepted := v_offer.response = 'accepted';
  v_final_approved := v_offer.decided_by_account_id is not null;
  select * into v_invoice from public.invoices where applicant_ref = v_app.reference;
  v_fee_paid := v_invoice.id is not null and app.invoice_balance(v_invoice.id) = 0;
  v_documents_complete := not exists (
    select 1 from public.admission_documents ad
    join public.documents d on d.id = ad.document_id
    where ad.application_id = p_application_id
      and d.scan_status in ('pending_scan','quarantined','failed')
  );
  select aw.capacity into v_capacity
    from public.admission_windows aw
   where v_offer.id is not null
     and aw.academic_year_id = v_offer.academic_year_id
     and aw.grade_id = v_offer.grade_id
   order by aw.created_at desc
   limit 1;
  select count(*) into v_enrolled
    from public.enrollments e
    join public.grade_sections gs on gs.id = e.grade_section_id
   where v_offer.id is not null
     and e.academic_year_id = v_offer.academic_year_id
     and gs.grade_id = v_offer.grade_id
     and e.status = 'active';
  v_capacity_available := v_capacity is not null and v_enrolled < v_capacity;

  return jsonb_build_object(
    'applicationRef', v_app.reference,
    'offered', v_offered,
    'accepted', v_accepted,
    'admissionInvoiceRef', case when v_invoice.id is null then null else v_invoice.reference end,
    'feePaid', v_fee_paid,
    'documentsComplete', v_documents_complete,
    'capacityAvailable', v_capacity_available,
    'finalApproved', v_final_approved,
    'policyPending', jsonb_build_array(
      case when v_capacity is null then 'admission-capacity' else null end,
      case when not exists (select 1 from public.settings_versions where status = 'effective') then 'school-policy' else null end
    )
  );
end
$$;

revoke all on function app.enrollment_convert_create(uuid) from public;
revoke all on function app.admissions_save_draft(uuid, uuid, uuid, text, text, text, jsonb, int, int) from public;
revoke all on function app.enrollment_readiness(uuid) from public;
grant execute on function app.enrollment_convert(uuid) to authenticated;
grant execute on function app.admissions_save_draft(uuid, uuid, uuid, text, text, text, jsonb, int, int) to authenticated;
grant execute on function app.enrollment_readiness(uuid) to authenticated;

commit;
