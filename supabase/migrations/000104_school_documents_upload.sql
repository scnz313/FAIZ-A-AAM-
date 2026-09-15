-- =============================================================================
-- 000104 — School document uploads for the public register
--
-- The staff documents workspace can approve an existing document for public
-- view, but a content publisher had no way to upload a school document that
-- the public register could then contain. This forward migration opens the
-- upload boundary for the `school_document` owner domain:
--
--   1. `documents_create_upload_intent` accepts `school_document` and gates
--      it on AAL2 + `content_publisher`, matching the approval command
--      `documents_set_public_visibility` (000084). The uploader's own
--      account is the owner anchor; no reference lookup is performed.
--   2. `document_staff_allowed` grants content publishers the staff
--      projection/delivery branch for the new domain so the uploader can
--      list, finalize, and later approve the document.
--
-- All other owner domains and behaviors are unchanged, and both function
-- signatures are unchanged. Forward-only; never edit migrations 000001–000103.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Upload intent accepts school documents
-- ---------------------------------------------------------------------------
-- Same signature as 000086; the only changes are the owner-domain allowlist
-- and the AAL2 content-publisher authorization check.

create or replace function app.documents_create_upload_intent(
  p_owner_domain text,
  p_owner_record_id uuid,
  p_attachment_code text,
  p_safe_filename text,
  p_declared_mime_type text,
  p_declared_size bigint,
  p_allowed_mime_types text[] default array['application/pdf','image/jpeg','image/png'],
  p_max_bytes bigint default 5242880,
  p_object_key text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_ref text;
  v_key text := coalesce(
    p_object_key,
    'uploads/' || gen_random_uuid()::text ||
    case p_declared_mime_type
      when 'application/pdf' then '.pdf'
      when 'image/jpeg' then '.jpg'
      when 'image/png' then '.png'
      when 'text/csv' then '.csv'
      else '.bin'
    end
  );
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if p_owner_domain not in ('admission_application','job_application','student','data_import_batch','school_document') then
    raise exception 'invalid document owner domain';
  end if;
  if p_declared_size <= 0 or p_declared_size > p_max_bytes then raise exception 'declared file size is not allowed'; end if;
  if v_key !~ '^uploads/[0-9a-fA-F-]{36}\.(pdf|jpg|png|csv)$' then raise exception 'opaque upload key is required'; end if;
  if p_declared_mime_type is null or not (p_declared_mime_type = any(coalesce(p_allowed_mime_types, array['application/pdf','image/jpeg','image/png']))) then
    raise exception 'declared file type is not allowed';
  end if;
  if p_owner_domain = 'admission_application' and not exists (select 1 from public.admission_applications where id = p_owner_record_id and owner_account_id = auth.uid()) then raise exception 'document owner is not accessible to this account'; end if;
  if p_owner_domain = 'job_application' and not exists (select 1 from public.job_applications where id = p_owner_record_id and owner_account_id = auth.uid()) then raise exception 'document owner is not accessible to this account'; end if;
  if p_owner_domain = 'student' and not app.guardian_has_capability(p_owner_record_id, 'documents') then raise exception 'document owner is not accessible to this account'; end if;
  if p_owner_domain = 'data_import_batch' then
    if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
      raise exception 'document owner is not accessible to this account';
    end if;
    if not exists (select 1 from public.data_import_batches where id = p_owner_record_id and state = 'uploaded') then
      raise exception 'import batch is not awaiting a source document';
    end if;
  end if;
  if p_owner_domain = 'school_document' and not (app.is_staff_aal2() and app.has_role('content_publisher')) then raise exception 'document owner is not accessible to this account'; end if;
  insert into public.documents (owner_domain, owner_record_id, category, object_key, safe_filename, mime_type, size_bytes, scan_status, visibility, uploaded_by_account_id, declared_mime_type, allowed_mime_types, max_bytes, attachment_code)
  values (p_owner_domain, p_owner_record_id, p_attachment_code, v_key, left(regexp_replace(coalesce(p_safe_filename,'upload'), '[^a-zA-Z0-9._-]+', '-', 'g'), 120), p_declared_mime_type, p_declared_size, 'pending_scan', 'private', auth.uid(), p_declared_mime_type, coalesce(p_allowed_mime_types, array['application/pdf','image/jpeg','image/png']), p_max_bytes, p_attachment_code)
  returning id, reference into v_id, v_ref;
  insert into public.document_processing_events (document_id, event_type, detail) values (v_id, 'upload_intent_created', p_owner_domain || ':' || coalesce(p_attachment_code,'document'));
  return jsonb_build_object('id', v_id, 'reference', v_ref, 'objectKey', v_key, 'status', 'pending_scan');
end
$$;

revoke all on function app.documents_create_upload_intent(text, uuid, text, text, text, bigint, text[], bigint, text) from public, anon;
grant execute on function app.documents_create_upload_intent(text, uuid, text, text, text, bigint, text[], bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Document access includes the school-document owner
-- ---------------------------------------------------------------------------
-- Same predicate as 000025; the school document is owned by the publishing
-- account and only an AAL2 content publisher may finalize/read/deliver it.

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
    when 'school_document' then app.is_staff_aal2() and app.has_role('content_publisher')
    else false
  end
$$;

revoke all on function app.document_staff_allowed(text, uuid) from public;
grant execute on function app.document_staff_allowed(text, uuid) to authenticated;

commit;
