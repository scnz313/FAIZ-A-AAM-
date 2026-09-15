-- =============================================================================
-- 000084 — Document public-visibility command (UI/server parity)
--
-- The staff documents workspace gates the public-register control on the
-- `content.publish` action (content_publisher only), but
-- `documentsSetPublicVisibility` updated `documents.visibility` directly
-- under the generic `staff_update_documents` policy (any AAL2 staff), and the
-- readiness rule lived only in the application layer. The server was broader
-- than the UI.
--
-- `app.documents_set_public_visibility` becomes the single authorized
-- command:
--   * SECURITY DEFINER with `search_path = ''`;
--   * requires `app.is_staff_aal2()` and `app.has_role('content_publisher')`;
--   * locks the document FOR UPDATE;
--   * refuses approval unless the scan state is the real ready state
--     (`ready` or `clean`, 000030 `documents_apply_scan` / 000081 register)
--     and the bytes are finalized with a verified checksum (000027 added
--     `finalized_at` and `checksum_verified` to `public.documents`);
--   * refuses approval of a deleted or retention-reached document;
--   * withdrawal to `private` is always allowed;
--   * records 'Document public visibility changed' through `app.record_audit`
--     with the caller's optional reason;
--   * returns `{documentId, reference, visibility}`.
--
-- Forward-only; remote mutations remain frozen.
-- =============================================================================

begin;

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

commit;
