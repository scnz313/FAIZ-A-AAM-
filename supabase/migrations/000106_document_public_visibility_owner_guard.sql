-- =============================================================================
-- 000106 — Public document approval is limited to school documents
--
-- Verified finding (security hardening pass, live catalog + direct RPC):
-- `app.documents_set_public_visibility` (000084) accepted ANY document for
-- public approval. A compromised `content_publisher` could approve a student
-- report card, applicant evidence, staff record, or import artifact for the
-- anonymous public register with a direct RPC call, even though the
-- application layer already refuses those owner domains
-- (`publicApprovalRefusal` in `apps/web/lib/supabase/domain.ts`).
--
-- This migration moves the same owner-domain guard into the SQL boundary:
--   1. Approval (`p_public = true`) is accepted only for the
--      `school_document` owner domain. Withdrawal (`p_public = false`) stays
--      allowed for every domain, so staff can always take a mistakenly
--      approved record out of the register.
--   2. The anonymous register projection `app.documents_public_register`
--      (000087) also requires `owner_domain = 'school_document'`, so no
--      pre-existing or out-of-band row can ever be listed to a visitor.
--   3. The public-read RLS policies on `public.documents` (000081) carry the
--      same owner-domain condition; anonymous visitors have had no table
--      grant since 000087, and the guard keeps any future grant from widening
--      the register.
--
-- Unchanged: function signatures, EXECUTE grants, row locking, scan/byte
-- readiness checks, retention/deletion checks, audit events, and the return
-- shape. The application-layer guard remains in place as the first,
-- user-facing refusal; this migration is the authoritative backstop.
--
-- Forward-only from 000105. Never edit migrations 000001–000105. This file is
-- validated and applied by the central process; it is intentionally not
-- applied to staging by the implementing agent.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Public approval command: only school documents may enter the register
-- ---------------------------------------------------------------------------
-- Same signature, SECURITY DEFINER boundary, authorization check, locking,
-- readiness checks, audit call, and result shape as 000084. The single
-- addition is the owner-domain guard inside the approval branch. Withdrawal
-- reaches none of these conditions and continues to work for every domain.

create or replace function app.documents_set_public_visibility(
  p_document_id uuid,
  p_public boolean,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_doc public.documents%rowtype; v_visibility text;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('content_publisher')) then
    raise exception 'content publisher role and aal2 required';
  end if;
  select * into v_doc from public.documents where id = p_document_id for update;
  if v_doc.id is null then raise exception 'document not found'; end if;
  if p_public then
    /* The public downloads register is for school-level documents only.
       Per-student report cards, applicant evidence, staff records, and
       import/export artifacts are private records; approving one would serve
       personal data anonymously from the register page. Withdrawal is
       deliberately exempt so any document can always be removed. */
    if v_doc.owner_domain <> 'school_document' then
      raise exception 'only school documents can be approved for the public downloads register';
    end if;
    if v_doc.deleted_at is not null then
      raise exception 'deleted document cannot be approved for public view';
    end if;
    if v_doc.retention_until is not null and v_doc.retention_until <= now()
       and (v_doc.legal_hold_until is null or v_doc.legal_hold_until <= now()) then
      raise exception 'document is past its retention period and cannot be approved for public view';
    end if;
    if v_doc.scan_status not in ('clean','ready') then
      raise exception 'document is not ready for public view (scan status %)', v_doc.scan_status;
    end if;
    if not v_doc.checksum_verified or v_doc.finalized_at is null then
      raise exception 'document has not finished byte verification and cannot be approved for public view yet';
    end if;
    v_visibility := 'public_approved';
  else
    v_visibility := 'private';
  end if;
  update public.documents set visibility = v_visibility where id = v_doc.id;
  perform app.record_audit(
    'Document public visibility changed','document',v_doc.reference,'Success',
    nullif(btrim(p_reason),''));
  return jsonb_build_object('documentId',v_doc.id,'reference',v_doc.reference,'visibility',v_visibility);
end;
$$;

revoke all on function app.documents_set_public_visibility(uuid, boolean, text) from public, anon, authenticated;
grant execute on function app.documents_set_public_visibility(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Anonymous register projection: school documents only
-- ---------------------------------------------------------------------------
-- Same shape and grants as 000087; the owner-domain condition is added so the
-- anonymous read path can never surface a report card or applicant record
-- even if a row was approved before this guard existed.

create or replace function app.documents_public_register()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(d) order by d.finalized_at desc, d.created_at desc), '[]'::jsonb)
  from (
    select d.reference, d.safe_filename, d.category, d.mime_type, d.size_bytes,
           d.created_at, d.finalized_at, d.retention_until, d.legal_hold_until
      from public.documents d
     where d.visibility = 'public_approved'
       and d.scan_status in ('clean', 'ready')
       and d.deleted_at is null
       and d.finalized_at is not null
       and d.owner_domain = 'school_document'
  ) d
$$;

revoke all on function app.documents_public_register() from public;
grant execute on function app.documents_public_register() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Public-read policies: the same owner-domain condition
-- ---------------------------------------------------------------------------
-- The anon table grant was revoked by 000087; the policies are recreated so a
-- future GRANT SELECT cannot reopen a non-school public row. Nothing in the
-- application reads public.documents through these policies (staff use
-- app.documents_projection_list; the public register uses the projection
-- above; delivery uses the admin boundary with its own authorization).

drop policy if exists anon_read_public_documents on public.documents;
create policy anon_read_public_documents on public.documents
  for select to anon
  using (visibility = 'public_approved' and scan_status in ('clean', 'ready') and owner_domain = 'school_document');

drop policy if exists auth_read_public_documents on public.documents;
create policy auth_read_public_documents on public.documents
  for select to authenticated
  using (visibility = 'public_approved' and scan_status in ('clean', 'ready') and owner_domain = 'school_document');

commit;
