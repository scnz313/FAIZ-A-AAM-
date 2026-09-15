-- =============================================================================
-- 000081 — Public downloads register (content slice C3)
--
-- The public notices page labels its downloads list an authoritative register
-- while `contentService.listDownloads` returned an empty list in Supabase mode
-- and no staff path could approve a document for public view. This migration
-- closes the three database gaps the application then builds on:
--
--   1. `anon_read_public_documents` (000008) checks `scan_status = 'clean'`,
--      but the provider path stores a successful scan as 'ready'
--      (000030 `documents_apply_scan`), so provider-scanned public documents
--      were invisible even to anonymous readers. Both states are finalized
--      and deliverable (`storedDocumentAvailability` accepts either), so the
--      register accepts both.
--
--   2. A SIGNED-IN visitor holds only the `authenticated` role and had no
--      public-register policy at all, so they saw fewer public downloads than
--      a signed-out visitor. The mirror policy grants the same rows.
--
--   3. `app.documents_projection_list` (000039) never exposed `visibility`, so
--      the staff workspace could not show whether a document was already in
--      the public register. The projection is recreated below with the same
--      shape plus `visibility`; object keys, buckets, and checksums still
--      never leave the document boundary.
--
-- No new columns or tables. Forward-only; remote mutations remain frozen.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Public-register reads: approved and finalized for anon and authenticated
-- ---------------------------------------------------------------------------

drop policy if exists anon_read_public_documents on public.documents;
create policy anon_read_public_documents on public.documents
  for select to anon
  using (visibility = 'public_approved' and scan_status in ('clean', 'ready'));

drop policy if exists auth_read_public_documents on public.documents;
create policy auth_read_public_documents on public.documents
  for select to authenticated
  using (visibility = 'public_approved' and scan_status in ('clean', 'ready'));

-- ---------------------------------------------------------------------------
-- 2. Staff projection carries the public-approval flag
-- ---------------------------------------------------------------------------

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
    'visibility', document.visibility,
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
