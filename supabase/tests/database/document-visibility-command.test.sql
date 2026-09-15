-- =============================================================================
-- 000106 document public-visibility owner-domain guard assertions.
--
-- Drives `app.documents_set_public_visibility` with fictional actors on the
-- local scratch instance:
--   * a content publisher approves a school document;
--   * a non-publisher staff officer is denied;
--   * a student-owned document is refused for approval (owner-domain guard);
--   * withdrawal of a student-owned document stays allowed;
--   * the anonymous register projection lists only school documents;
--   * a quarantined document is refused for approval.
-- Run by scripts/validate-db-local.sh.
-- =============================================================================

\set ON_ERROR_STOP on

-- Auth stubs read the request GUCs (same upgrade validate-rls.sql applies).
create or replace function auth.uid() returns uuid language sql as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function auth.jwt() returns jsonb language sql as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb
$$;

-- Fictional actors: one content publisher, one non-publisher staff officer.
insert into auth.users (id) values
  ('a0000000-0000-4000-8000-000000000084'),
  ('a0000000-0000-4000-8000-000000000085');
insert into public.people (id, given_name, family_name, display_name) values
  ('b0000000-0000-4000-8000-000000000084', 'Nadia', 'Bhat', 'Nadia Bhat'),
  ('b0000000-0000-4000-8000-000000000085', 'Imran', 'Dar', 'Imran Dar');
insert into public.user_accounts (id, person_id, status, verified_contact) values
  ('a0000000-0000-4000-8000-000000000084', 'b0000000-0000-4000-8000-000000000084', 'active', 'publisher.vis@example.in'),
  ('a0000000-0000-4000-8000-000000000085', 'b0000000-0000-4000-8000-000000000085', 'active', 'officer.vis@example.in');
insert into public.role_grants (account_id, role_code, status, effective_from) values
  ('a0000000-0000-4000-8000-000000000084', 'content_publisher', 'active', now()),
  ('a0000000-0000-4000-8000-000000000085', 'finance_officer', 'active', now());

-- Ready school document, ready student document, quarantined school document.
insert into public.documents
  (reference, owner_domain, owner_record_id, category, object_key, safe_filename,
   mime_type, size_bytes, uploaded_by_account_id, scan_status, checksum,
   checksum_verified, finalized_at)
values
  ('DOC-2026-VIS-SCHOOL', 'school_document', 'a0000000-0000-4000-8000-000000000084', 'policy',
   'vis/school.pdf', 'school.pdf', 'application/pdf', 1024,
   'a0000000-0000-4000-8000-000000000084', 'ready', repeat('a', 64), true, now()),
  ('DOC-2026-VIS-READY', 'student', 'c0000000-0000-4000-8000-000000000084', 'identity',
   'vis/ready.pdf', 'ready.pdf', 'application/pdf', 1024,
   'a0000000-0000-4000-8000-000000000084', 'ready', repeat('b', 64), true, now()),
  ('DOC-2026-VIS-QUAR', 'school_document', 'a0000000-0000-4000-8000-000000000084', 'policy',
   'vis/quarantine.pdf', 'quarantine.pdf', 'application/pdf', 1024,
   'a0000000-0000-4000-8000-000000000084', 'quarantined', repeat('c', 64), true, now());

-- The scratch superuser resolves the row ids (staff reads are RLS-scoped);
-- the command itself locks and reads the row as its security-definer owner.
select set_config('fass.vis_school_id', (select id::text from public.documents where reference = 'DOC-2026-VIS-SCHOOL'), false);
select set_config('fass.vis_ready_id', (select id::text from public.documents where reference = 'DOC-2026-VIS-READY'), false);
select set_config('fass.vis_quar_id', (select id::text from public.documents where reference = 'DOC-2026-VIS-QUAR'), false);

-- 1. Publisher approves a scan-ready, finalized SCHOOL document.
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000084', false);
select set_config('request.jwt.claims', '{"aal":"aal2","role":"authenticated"}', false);
do $$
declare v_result jsonb;
begin
  v_result := app.documents_set_public_visibility(current_setting('fass.vis_school_id')::uuid, true, 'Approved for the public downloads register');
  assert (v_result ->> 'documentId') = current_setting('fass.vis_school_id'), 'command returns the document id';
  assert (v_result ->> 'reference') = 'DOC-2026-VIS-SCHOOL', 'command returns the public reference';
  assert (v_result ->> 'visibility') = 'public_approved', 'command returns the new visibility';
end
$$;

-- 2. Non-publisher staff role is denied.
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000085', false);
do $$
declare v_message text;
begin
  begin
    perform app.documents_set_public_visibility(current_setting('fass.vis_school_id')::uuid, true, null);
    assert false, 'non-publisher staff must not change public visibility';
  exception when others then
    v_message := sqlerrm;
  end;
  assert v_message = 'content publisher role and aal2 required',
    'non-publisher denial is explicit';
end
$$;

-- 3. A ready STUDENT document is refused for public approval (000106 guard).
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000084', false);
do $$
declare v_message text;
begin
  begin
    perform app.documents_set_public_visibility(current_setting('fass.vis_ready_id')::uuid, true, null);
    assert false, 'a student report card must not be approvable for the public register';
  exception when others then
    v_message := sqlerrm;
  end;
  assert v_message = 'only school documents can be approved for the public downloads register',
    'owner-domain refusal is explicit';
end
$$;

-- 4. Out-of-band approval (simulating a legacy writer) is still hidden from
--    the anonymous register projection, which now requires school_document.
reset role;
update public.documents set visibility = 'public_approved' where reference = 'DOC-2026-VIS-READY';
set role anon;
do $$
declare v_register jsonb;
begin
  v_register := app.documents_public_register();
  assert position('DOC-2026-VIS-SCHOOL' in v_register::text) > 0,
    'the approved school document appears in the anonymous register';
  assert position('DOC-2026-VIS-READY' in v_register::text) = 0,
    'a non-school public row is excluded from the anonymous register';
end
$$;

-- 5. Withdrawal remains allowed for any owner domain.
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-4000-8000-000000000084', false);
do $$
declare v_result jsonb;
begin
  v_result := app.documents_set_public_visibility(current_setting('fass.vis_ready_id')::uuid, false, 'Withdrawn: student record never belongs in the register');
  assert (v_result ->> 'visibility') = 'private', 'withdrawal returns private for a non-school document';
end
$$;

-- 6. Quarantined document is refused even for the publisher.
do $$
declare v_message text;
begin
  begin
    perform app.documents_set_public_visibility(current_setting('fass.vis_quar_id')::uuid, true, null);
    assert false, 'quarantined document must be refused';
  exception when others then
    v_message := sqlerrm;
  end;
  assert position('quarantined' in v_message) > 0, 'quarantine refusal names the scan state';
end
$$;
reset role;

-- Persisted state and audit evidence (read as the scratch superuser).
do $$
begin
  assert (select visibility from public.documents where reference = 'DOC-2026-VIS-SCHOOL') = 'public_approved',
    'school-document approval is persisted';
  assert (select visibility from public.documents where reference = 'DOC-2026-VIS-READY') = 'private',
    'withdrawn student document is private';
  assert (select visibility from public.documents where reference = 'DOC-2026-VIS-QUAR') = 'private',
    'refused document keeps its private visibility';
  assert (
    select count(*) from public.audit_events
     where action = 'Document public visibility changed'
       and target_type = 'document'
       and target_reference = 'DOC-2026-VIS-SCHOOL'
       and outcome = 'Success'
       and reason = 'Approved for the public downloads register'
  ) = 1, 'one attributed audit row carries the command reason';
  assert (
    select count(*) from public.audit_events
     where action = 'Document public visibility changed'
       and target_type = 'document'
       and target_reference = 'DOC-2026-VIS-READY'
       and reason = 'Withdrawn: student record never belongs in the register'
  ) = 1, 'withdrawal is audited for a non-school document';

  assert has_function_privilege('authenticated', 'app.documents_set_public_visibility(uuid,boolean,text)', 'EXECUTE'),
    'authenticated staff may execute the command';
  assert not has_function_privilege('anon', 'app.documents_set_public_visibility(uuid,boolean,text)', 'EXECUTE'),
    'anonymous visitors may not execute the command';
  assert (
    select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'documents_set_public_visibility'
  ), 'the command runs security definer';
end
$$;

select 'DOCUMENT VISIBILITY COMMAND PASSED' as result;
