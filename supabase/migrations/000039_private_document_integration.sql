begin;

-- One explicit authorization predicate is shared by metadata projections and
-- the signed-delivery route. Storage RLS remains defence in depth; callers
-- still have to authorize the document's owning record on every request.
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

revoke all on function app.document_actor_allowed(text, uuid) from public, anon;
grant execute on function app.document_actor_allowed(text, uuid) to authenticated;

-- Metadata is safe to show before a scan finishes, but object keys and bucket
-- names never leave the document boundary. The owning record remains the
-- authorization source, including applicant ownership and scoped staff roles.
create or replace function app.documents_projection_list(
  p_owner_domain text default null,
  p_owner_record_id uuid default null
) returns setof jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', document.id,
    'reference', document.reference,
    'ownerDomain', document.owner_domain,
    'ownerReference', case
      when document.owner_domain = 'student' then (select student.reference from public.students student where student.id = document.owner_record_id)
      when document.owner_domain = 'invoice' then (select invoice.reference from public.invoices invoice where invoice.id = document.owner_record_id)
      when document.owner_domain = 'admission_application' then (select application.reference from public.admission_applications application where application.id = document.owner_record_id)
      when document.owner_domain = 'job_application' then (select application.reference from public.job_applications application where application.id = document.owner_record_id)
      when document.owner_domain = 'result_publication' then (select publication.reference from public.result_publications publication where publication.id = document.owner_record_id)
      else document.reference
    end,
    'attachmentCode', document.attachment_code,
    'category', document.category,
    'filename', document.safe_filename,
    'mimeType', document.mime_type,
    'sizeBytes', document.size_bytes,
    'status', case
      when document.deleted_at is not null
        or (
          document.retention_until is not null
          and document.retention_until <= now()
          and (document.legal_hold_until is null or document.legal_hold_until <= now())
        ) then 'expired'
      when document.scan_status = 'clean' then 'ready'
      else document.scan_status
    end,
    'scanState', case when document.scan_status = 'clean' then 'ready' else document.scan_status end,
    'finalizationState', case
      when document.finalized_at is not null and document.checksum_verified then 'verified'
      when document.scan_status = 'failed' then 'failed'
      else 'pending'
    end,
    'checksumVerified', document.checksum_verified,
    'finalizedAt', document.finalized_at,
    'retentionUntil', document.retention_until,
    'version', document.version,
    'createdAt', document.created_at,
    'updatedAt', document.updated_at
  )
    from public.documents document
   where app.document_actor_allowed(document.owner_domain, document.owner_record_id)
     and (p_owner_domain is null or document.owner_domain = p_owner_domain)
     and (p_owner_record_id is null or document.owner_record_id = p_owner_record_id)
   order by document.created_at desc, document.id desc
$$;

revoke all on function app.documents_projection_list(text, uuid) from public, anon;
grant execute on function app.documents_projection_list(text, uuid) to authenticated;

commit;
