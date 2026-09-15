-- =============================================================================
-- 000086 — Import validation, resolution, and upload-boundary completion
--
-- Forward-only migration (plan.md Phase 11.3 completion). Repairs the school
-- data import lifecycle end to end:
--
--   1. `documents_create_upload_intent` rejected `data_import_batch` owner
--      domains and its object-key pattern rejected `.csv`, so the import
--      Upload step could never create an intent. It now accepts import
--      source documents for an AAL2 Administrator and validates the batch is
--      still awaiting its source document.
--   2. `document_actor_allowed` had no branch for `data_import_batch`, so the
--      finalize route denied the uploader with 404 after the intent existed.
--   3. `data_import_apply_validation` records server-computed row statuses and
--      issues idempotently. Nothing previously moved a batch from
--      `validating` to `needs_resolution`/`ready`, and no row ever received a
--      committable status.
--   4. `data_import_resolve_issue` inserts a resolution AND marks the issue
--      resolved + applies the row effect. The previous browser-side insert
--      never set `resolved_at`, so a batch with errors could never commit.
--   5. `data_import_finish_validation` performs the auditing state transition
--      `validating`/`needs_resolution` → `ready`/`needs_resolution`.
--   6. `data_import_get_batch` exposes the batch scan projection (headers and
--      counts only — never row payloads) for the Map/Validate steps.
--   7. `data_export_retry` re-queues a failed export generation under a new
--      provider-job key instead of leaving `failed` as a dead end.
--
-- Never edit migrations 000001–000085.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Upload intent accepts import source documents
-- ---------------------------------------------------------------------------
-- Same signature as 000027; the only changes are the owner-domain allowlist,
-- the `.csv` object key/extensions, and the import-batch authorization check.

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
  if p_owner_domain not in ('admission_application','job_application','student','data_import_batch') then
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
  insert into public.documents (owner_domain, owner_record_id, category, object_key, safe_filename, mime_type, size_bytes, scan_status, visibility, uploaded_by_account_id, declared_mime_type, allowed_mime_types, max_bytes, attachment_code)
  values (p_owner_domain, p_owner_record_id, p_attachment_code, v_key, left(regexp_replace(coalesce(p_safe_filename,'upload'), '[^a-zA-Z0-9._-]+', '-', 'g'), 120), p_declared_mime_type, p_declared_size, 'pending_scan', 'private', auth.uid(), p_declared_mime_type, coalesce(p_allowed_mime_types, array['application/pdf','image/jpeg','image/png']), p_max_bytes, p_attachment_code)
  returning id, reference into v_id, v_ref;
  insert into public.document_processing_events (document_id, event_type, detail) values (v_id, 'upload_intent_created', p_owner_domain || ':' || coalesce(p_attachment_code,'document'));
  return jsonb_build_object('id', v_id, 'reference', v_ref, 'objectKey', v_key, 'status', 'pending_scan');
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Document access includes the import batch owner
-- ---------------------------------------------------------------------------
-- Same predicate as 000039; the import source document is owned by the batch
-- and only an AAL2 Administrator may finalize/read/deliver it.

create or replace function app.document_actor_allowed(
  p_owner_domain text,
  p_owner_record_id uuid
) returns boolean
language sql
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    (p_owner_domain = 'admission_application' and exists (
      select 1
        from public.admission_applications application
       where application.id = p_owner_record_id
         and application.owner_account_id = auth.uid()
    ))
    or (p_owner_domain = 'job_application' and exists (
      select 1
        from public.job_applications application
       where application.id = p_owner_record_id
         and application.owner_account_id = auth.uid()
    ))
    or (p_owner_domain = 'student' and app.guardian_has_capability(p_owner_record_id, 'documents'))
    or (p_owner_domain = 'data_import_batch'
        and app.is_staff_aal2() and app.has_role('system_administrator'))
    or (p_owner_domain = 'invoice' and exists (
      select 1
        from public.invoices invoice
       where invoice.id = p_owner_record_id
         and (
           (invoice.student_id is not null and app.guardian_has_capability(invoice.student_id, 'documents'))
           or (invoice.applicant_ref is not null and exists (
             select 1
               from public.admission_applications application
              where application.reference = invoice.applicant_ref
                and application.owner_account_id = auth.uid()
           ))
         )
    ))
    or (p_owner_domain = 'result_publication' and exists (
      select 1
        from public.result_publication_items item
       where item.publication_id = p_owner_record_id
         and app.guardian_has_capability(item.student_id, 'documents')
    ))
    or app.document_staff_allowed(p_owner_domain, p_owner_record_id)
  )
$$;

-- ---------------------------------------------------------------------------
-- 3. Apply server-computed validation
-- ---------------------------------------------------------------------------
-- Called by the authenticated validation route after the Map step. The
-- browser never receives row payloads: it receives counts, issue messages,
-- and the stored row id each issue belongs to. Re-running validation replaces
-- the pre-commit issue set (resolutions cascade) so it is idempotent.

create or replace function app.data_import_apply_validation(
  p_batch_id uuid,
  p_rows jsonb,
  p_issues jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.data_import_batches%rowtype;
  v_error_count int := 0;
  v_warning_count int := 0;
  v_row jsonb;
  v_issue jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' and not (
    app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'import validation requires the administrator or the service worker';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then raise exception 'rows must be an array'; end if;
  if jsonb_typeof(coalesce(p_issues, '[]'::jsonb)) <> 'array' then raise exception 'issues must be an array'; end if;

  select * into v_batch from public.data_import_batches where id = p_batch_id for update;
  if v_batch.id is null then raise exception 'import batch not found'; end if;
  if v_batch.state not in ('scanning', 'mapping', 'validating', 'needs_resolution') then
    raise exception 'validation can only run before the decision (state: %)', v_batch.state;
  end if;

  -- Replace the pre-commit issue set (resolutions cascade with their issue).
  delete from public.data_import_issues where batch_id = p_batch_id;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    update public.data_import_rows
       set status = coalesce(v_row ->> 'status', 'pending')
     where id = (v_row ->> 'rowId')::uuid and batch_id = p_batch_id;
  end loop;

  for v_issue in select * from jsonb_array_elements(coalesce(p_issues, '[]'::jsonb)) loop
    insert into public.data_import_issues
      (batch_id, row_id, row_number, severity, code, field, message, resolution_hint)
    values
      (p_batch_id,
       nullif(v_issue ->> 'rowId', '')::uuid,
       nullif(v_issue ->> 'rowNumber', '')::int,
       v_issue ->> 'severity',
       v_issue ->> 'code',
       nullif(v_issue ->> 'field', ''),
       v_issue ->> 'message',
       nullif(v_issue ->> 'resolutionHint', ''));
    if v_issue ->> 'severity' = 'error' then
      v_error_count := v_error_count + 1;
    else
      v_warning_count := v_warning_count + 1;
    end if;
  end loop;

  update public.data_import_batches
     set row_count = (select count(*) from public.data_import_rows where batch_id = p_batch_id),
         error_count = v_error_count,
         warning_count = v_warning_count,
         version = v_batch.version + 1
   where id = p_batch_id
  returning * into v_batch;

  perform app.record_audit('Data import validation recorded', 'data_import_batch', v_batch.reference, 'Success',
    'errors=' || v_error_count || ' warnings=' || v_warning_count,
    'System administrator');

  return jsonb_build_object(
    'batchId', v_batch.id, 'reference', v_batch.reference, 'state', v_batch.state,
    'version', v_batch.version, 'rowCount', v_batch.row_count,
    'errorCount', v_error_count, 'warningCount', v_warning_count);
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Resolve one issue (accept / reject / modify / skip)
-- ---------------------------------------------------------------------------
-- Records the resolution, marks the issue resolved, and applies the row
-- effect the commit matrix understands: accept → valid/warning, skip/reject
-- → skipped, modify → resolved with the merged normalized value.

create or replace function app.data_import_resolve_issue(
  p_batch_id uuid,
  p_row_id uuid,
  p_issue_id uuid,
  p_resolution text,
  p_resolved_value jsonb default null,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.data_import_batches%rowtype;
  v_issue public.data_import_issues%rowtype;
  v_row public.data_import_rows%rowtype;
  v_resolution public.data_import_resolutions%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'resolving import issues requires the system administrator and aal2';
  end if;
  if p_resolution not in ('accept', 'reject', 'modify', 'skip') then
    raise exception 'invalid issue resolution';
  end if;
  if p_resolution = 'modify' and (p_resolved_value is null or jsonb_typeof(p_resolved_value) <> 'object') then
    raise exception 'a modified resolution requires the corrected value';
  end if;

  select * into v_batch from public.data_import_batches where id = p_batch_id for update;
  if v_batch.id is null then raise exception 'import batch not found'; end if;
  if v_batch.state not in ('validating', 'needs_resolution') then
    raise exception 'issues can only be resolved after validation (state: %)', v_batch.state;
  end if;

  select * into v_issue from public.data_import_issues
   where id = p_issue_id and batch_id = p_batch_id and row_id = p_row_id
   for update;
  if v_issue.id is null then raise exception 'import issue not found for this row'; end if;

  -- Idempotent replay: an already-resolved issue returns its stored resolution.
  if v_issue.resolved_at is not null then
    select * into v_resolution from public.data_import_resolutions
     where issue_id = v_issue.id order by resolved_at desc limit 1;
    if v_resolution.id is not null then
      return jsonb_build_object(
        'id', v_resolution.id, 'batchId', v_resolution.batch_id, 'rowId', v_resolution.row_id,
        'issueId', v_resolution.issue_id, 'resolution', v_resolution.resolution,
        'resolvedValue', v_resolution.resolved_value, 'resolvedAtIso', v_resolution.resolved_at,
        'note', v_resolution.note);
    end if;
  end if;

  select * into v_row from public.data_import_rows
   where id = p_row_id and batch_id = p_batch_id for update;
  if v_row.id is null then raise exception 'import row not found'; end if;

  insert into public.data_import_resolutions
    (batch_id, row_id, issue_id, resolution, resolved_value, resolved_by_account_id, note)
  values
    (p_batch_id, p_row_id, p_issue_id, p_resolution, p_resolved_value, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  returning * into v_resolution;

  update public.data_import_issues set resolved_at = now() where id = v_issue.id;

  if p_resolution in ('skip', 'reject') then
    update public.data_import_rows set status = 'skipped' where id = v_row.id;
  elsif p_resolution = 'modify' then
    update public.data_import_rows
       set normalized = normalized || p_resolved_value, status = 'resolved'
     where id = v_row.id;
  else
    -- Accepting keeps any remaining unresolved warning as a warning.
    if exists (
      select 1 from public.data_import_issues
       where row_id = v_row.id and severity = 'warning' and resolved_at is null and id <> v_issue.id
    ) then
      update public.data_import_rows set status = 'warning' where id = v_row.id;
    else
      update public.data_import_rows set status = 'valid' where id = v_row.id;
    end if;
  end if;

  perform app.record_audit('Data import issue resolved', 'data_import_batch', v_batch.reference, 'Success',
    v_issue.code || ' → ' || p_resolution, 'System administrator');

  return jsonb_build_object(
    'id', v_resolution.id, 'batchId', v_resolution.batch_id, 'rowId', v_resolution.row_id,
    'issueId', v_resolution.issue_id, 'resolution', v_resolution.resolution,
    'resolvedValue', v_resolution.resolved_value, 'resolvedAtIso', v_resolution.resolved_at,
    'note', v_resolution.note);
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Finish validation (validating / needs_resolution → ready / needs_resolution)
-- ---------------------------------------------------------------------------

create or replace function app.data_import_finish_validation(
  p_batch_id uuid,
  p_expected_version int
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.data_import_batches%rowtype;
  v_unresolved_errors int;
  v_target text;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'finishing import validation requires the system administrator and aal2';
  end if;

  select * into v_batch from public.data_import_batches where id = p_batch_id for update;
  if v_batch.id is null then raise exception 'import batch not found'; end if;
  if v_batch.state in ('completed', 'cancelled', 'committing') then
    raise exception 'import batch is already closed';
  end if;
  if v_batch.version <> p_expected_version then
    raise exception 'import batch version mismatch (expected %, found %)', p_expected_version, v_batch.version;
  end if;
  if v_batch.state not in ('validating', 'needs_resolution', 'ready') then
    raise exception 'validation can only be finished from validating or needs_resolution (state: %)', v_batch.state;
  end if;

  select count(*) into v_unresolved_errors from public.data_import_issues
   where batch_id = p_batch_id and severity = 'error' and resolved_at is null;
  v_target := case when v_unresolved_errors > 0 then 'needs_resolution' else 'ready' end;

  if v_batch.state = v_target then
    return jsonb_build_object(
      'batchId', v_batch.id, 'reference', v_batch.reference, 'state', v_batch.state,
      'version', v_batch.version, 'unresolvedErrorCount', v_unresolved_errors,
      'warningCount', v_batch.warning_count);
  end if;

  if not app.data_import_valid_transition(v_batch.state, v_target) then
    raise exception 'invalid import state transition % → %', v_batch.state, v_target;
  end if;

  update public.data_import_batches
     set state = v_target, version = v_batch.version + 1
   where id = p_batch_id
  returning * into v_batch;

  perform app.record_audit('Data import validation finished', 'data_import_batch', v_batch.reference, 'Success',
    v_target || ' — unresolved errors=' || v_unresolved_errors,
    'System administrator');

  return jsonb_build_object(
    'batchId', v_batch.id, 'reference', v_batch.reference, 'state', v_batch.state,
    'version', v_batch.version, 'unresolvedErrorCount', v_unresolved_errors,
    'warningCount', v_batch.warning_count);
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Batch projection for the wizard (never row payloads)
-- ---------------------------------------------------------------------------

create or replace function app.data_import_get_batch(p_batch_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.data_import_batches%rowtype;
  v_document_ref text;
begin
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'the import batch requires the system administrator and aal2';
  end if;
  select * into v_batch from public.data_import_batches where id = p_batch_id;
  if v_batch.id is null then raise exception 'import batch not found'; end if;
  if v_batch.source_document_id is not null then
    select reference into v_document_ref from public.documents where id = v_batch.source_document_id;
  end if;
  return jsonb_build_object(
    'batchId', v_batch.id, 'reference', v_batch.reference, 'state', v_batch.state,
    'version', v_batch.version, 'sourceSystem', v_batch.source_system,
    'academicYearId', v_batch.academic_year_id,
    'rowCount', v_batch.row_count, 'errorCount', v_batch.error_count,
    'warningCount', v_batch.warning_count,
    'scanRowCount', v_batch.scan_row_count, 'scanColumnCount', v_batch.scan_column_count,
    'scanHeaders', coalesce(v_batch.scan_headers, '[]'::jsonb),
    'scanDetectedEncoding', v_batch.scan_detected_encoding, 'scanError', v_batch.scan_error,
    'hasSourceDocument', v_batch.source_document_id is not null,
    'sourceDocumentRef', v_document_ref,
    'createdAtIso', v_batch.created_at, 'committedAtIso', v_batch.committed_at);
end
$$;

-- ---------------------------------------------------------------------------
-- 7. Retry a failed export generation
-- ---------------------------------------------------------------------------

create or replace function app.data_export_retry(
  p_request_reference text,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.data_export_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'retrying a data export requires the system administrator and aal2';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a retry reason is required';
  end if;

  select * into v_request from public.data_export_requests
   where reference = p_request_reference for update;
  if v_request.id is null then raise exception 'export request not found'; end if;
  if v_request.state <> 'failed' then
    raise exception 'only a failed export can be retried (state: %)', v_request.state;
  end if;

  update public.data_export_requests
     set state = 'requested', version = v_request.version + 1
   where id = v_request.id
  returning * into v_request;

  insert into public.data_export_events (request_id, event_type, actor_account_id, detail)
  values (v_request.id, 'requested', auth.uid(), 'retry: ' || btrim(p_reason));

  -- New provider-job key per attempt so the failed job never shadows the retry.
  insert into public.provider_jobs (job_kind, target_type, target_reference, idempotency_key)
  values ('data_export_generate', 'data_export_request', v_request.reference,
          'data-export:' || v_request.reference || ':retry:' || v_request.version)
  on conflict (idempotency_key) do nothing;

  perform app.record_audit('Data export retry requested', 'data_export_request', v_request.reference, 'Success',
    btrim(p_reason), 'System administrator');

  return jsonb_build_object('reference', v_request.reference, 'state', v_request.state, 'version', v_request.version);
end
$$;

-- ---------------------------------------------------------------------------
-- 8. Execution surface
-- ---------------------------------------------------------------------------

revoke all on function app.documents_create_upload_intent(text, uuid, text, text, text, bigint, text[], bigint, text) from public, anon;
grant execute on function app.documents_create_upload_intent(text, uuid, text, text, text, bigint, text[], bigint, text) to authenticated;

revoke all on function app.document_actor_allowed(text, uuid) from public, anon;
grant execute on function app.document_actor_allowed(text, uuid) to authenticated;

revoke all on function app.data_import_apply_validation(uuid, jsonb, jsonb) from public, anon;
grant execute on function app.data_import_apply_validation(uuid, jsonb, jsonb) to authenticated, service_role;

revoke all on function app.data_import_resolve_issue(uuid, uuid, uuid, text, jsonb, text) from public, anon;
grant execute on function app.data_import_resolve_issue(uuid, uuid, uuid, text, jsonb, text) to authenticated;

revoke all on function app.data_import_finish_validation(uuid, int) from public, anon;
grant execute on function app.data_import_finish_validation(uuid, int) to authenticated;

revoke all on function app.data_import_get_batch(uuid) from public, anon;
grant execute on function app.data_import_get_batch(uuid) to authenticated;

revoke all on function app.data_export_retry(text, text) from public, anon;
grant execute on function app.data_export_retry(text, text) to authenticated;

comment on function app.data_import_apply_validation(uuid, jsonb, jsonb) is
  'Replace the pre-commit validation issue set and row statuses for an import batch (Administrator AAL2 or service worker).';
comment on function app.data_import_resolve_issue(uuid, uuid, uuid, text, jsonb, text) is
  'Resolve one import issue, mark it resolved, and apply the accept/skip/reject/modify row effect.';
comment on function app.data_import_finish_validation(uuid, int) is
  'Transition an import batch from validating/needs_resolution to ready or needs_resolution based on unresolved errors.';
comment on function app.data_import_get_batch(uuid) is
  'Import batch projection for the wizard: scan headers/counts and source-document presence, never row payloads.';
comment on function app.data_export_retry(text, text) is
  'Re-queue generation for a failed protected data export under a new provider-job key.';

commit;
