-- Phase 11 local-only forward repair for the CSV import document lifecycle.
begin;

create or replace function app.documents_link_attachment(
  p_document_id uuid, p_owner_domain text, p_owner_record_id uuid, p_attachment_code text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_doc public.documents%rowtype;
begin
  if session_user <> 'service_role' and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'document linking requires the storage service';
  end if;
  select * into v_doc from public.documents where id = p_document_id for update;
  if v_doc.id is null or v_doc.owner_domain <> p_owner_domain or v_doc.owner_record_id <> p_owner_record_id then
    raise exception 'document ownership mismatch';
  end if;
  if v_doc.scan_status not in ('pending_scan','ready','clean') or not v_doc.checksum_verified then
    raise exception 'document is not finalized';
  end if;
  update public.documents set attachment_code = p_attachment_code where id = p_document_id;
  if p_owner_domain = 'admission_application' then
    insert into public.admission_documents(application_id, document_id, requirement_code)
    values (p_owner_record_id, p_document_id, p_attachment_code) on conflict (document_id) do nothing;
  elsif p_owner_domain = 'job_application' then
    insert into public.job_documents(application_id, document_id, requirement_code)
    values (p_owner_record_id, p_document_id, p_attachment_code) on conflict (document_id) do nothing;
  elsif p_owner_domain = 'student' then
    insert into public.student_documents(student_id, document_id)
    values (p_owner_record_id, p_document_id) on conflict (document_id) do nothing;
  elsif p_owner_domain = 'data_import_batch' then
    if p_attachment_code <> 'source_csv' then raise exception 'invalid import attachment code'; end if;
    update public.data_import_batches
       set source_document_id = p_document_id, version = version + 1
     where id = p_owner_record_id and state = 'uploaded';
    if not found then raise exception 'import batch is not awaiting a source document'; end if;
  else
    raise exception 'unsupported document owner domain';
  end if;
  return jsonb_build_object('reference', v_doc.reference, 'status', v_doc.scan_status);
end
$$;
revoke all on function app.documents_link_attachment(uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function app.documents_link_attachment(uuid,text,uuid,text) to service_role;

create or replace function app.import_start_after_clean_scan()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_domain = 'data_import_batch'
     and new.scan_status in ('ready','clean')
     and old.scan_status is distinct from new.scan_status then
    update public.data_import_batches
       set state = 'scanning', version = version + 1
     where id = new.owner_record_id and source_document_id = new.id and state = 'uploaded';
  end if;
  return new;
end
$$;
revoke all on function app.import_start_after_clean_scan() from public, anon, authenticated;
drop trigger if exists documents_start_import_after_scan on public.documents;
create trigger documents_start_import_after_scan
  after update of scan_status on public.documents
  for each row execute function app.import_start_after_clean_scan();

commit;
