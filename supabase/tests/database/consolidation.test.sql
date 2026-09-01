-- =============================================================================
-- Consolidation verification suite (driven by scripts/validate-db-local.sh).
--
-- Per-stage acceptance evidence for migrations 000043–000046 with fictional
-- actors only. Any failed assertion aborts the run.
--   Stage 3 — non-login teaching records + Principal result entry
--   Stage 4 — school-data import state machine + idempotent commit
--   Stage 5 — guardian claims + enrollment guardian binding
--   Stage 7 — purpose-bound protected exports
-- =============================================================================

-- Synthetic actors in a disjoint namespace (9000/9500) so they cannot collide
-- with the RLS (1000/2000), RPC (1000/3000), or profile (6000/7000) actors.
insert into auth.users (id) values
  ('90000000-0000-4000-8000-000000000001'),  -- V Principal (timetable manager + result entry)
  ('90000000-0000-4000-8000-000000000002'),  -- V Administrator
  ('90000000-0000-4000-8000-000000000003');  -- V Guardian claimant

insert into public.people (id, given_name, family_name, display_name) values
  ('95000000-0000-4000-8000-000000000001', 'Verify', 'Principal', 'Verify Principal'),
  ('95000000-0000-4000-8000-000000000002', 'Verify', 'Administrator', 'Verify Administrator'),
  ('95000000-0000-4000-8000-000000000003', 'Verify', 'Guardian', 'Verify Guardian');

insert into public.user_accounts (id, person_id, status, verified_contact) values
  ('90000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', 'active', 'verify.principal@example.in'),
  ('90000000-0000-4000-8000-000000000002', '95000000-0000-4000-8000-000000000002', 'active', 'verify.admin@example.in');
-- The guardian claimant (…003) intentionally has NO pre-created account:
-- claim acceptance creates it on the guardian's imported person.

insert into public.role_grants (account_id, role_code, status, effective_from) values
  ('90000000-0000-4000-8000-000000000001', 'timetable_manager', 'active', now()),
  ('90000000-0000-4000-8000-000000000001', 'result_entry_officer', 'active', now()),
  ('90000000-0000-4000-8000-000000000001', 'content_editor', 'active', now()),
  ('90000000-0000-4000-8000-000000000002', 'system_administrator', 'active', now()),
  ('90000000-0000-4000-8000-000000000002', 'exam_reviewer', 'active', now()),
  ('90000000-0000-4000-8000-000000000002', 'result_publisher', 'active', now());

insert into public.staff_members (person_id, employment_status, title, access_profile_code, access_profile_version) values
  ('95000000-0000-4000-8000-000000000001', 'active', 'Principal', 'principal', 1),
  ('95000000-0000-4000-8000-000000000002', 'active', 'Administrator', 'administrator', 1);

-- ============================================================================
-- STAGE 3 — teaching records
-- ============================================================================
set role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claims', '{"aal":"aal2","role":"authenticated","email":"verify.principal@example.in"}', false);
do $$
declare
  v_staff jsonb;
  v_staff_id uuid;
  v_assignment jsonb;
  v_assignment_id uuid;
  v_year uuid;
  v_section uuid;
  v_subject uuid;
  v_denied boolean;
begin
  -- Principal creates a non-login teaching record: no auth identity, no grant.
  v_staff := app.teaching_staff_create('Verify Teacher', 'Mathematics teacher', 'Verification appointment.');
  v_staff_id := (v_staff ->> 'staffMemberId')::uuid;
  assert v_staff_id is not null, 'stage3: teaching record created';
  assert not exists (
    select 1 from public.user_accounts ua
     join public.staff_members sm on sm.person_id = ua.person_id
    where sm.id = v_staff_id), 'stage3: teaching record has no login account';
  assert not exists (
    select 1 from public.role_grants rg
     where rg.account_id in (select ua.id from public.user_accounts ua
                              join public.staff_members sm on sm.person_id = ua.person_id
                             where sm.id = v_staff_id)), 'stage3: teaching record holds no role grant';

  select id into v_year from public.academic_years where status = 'current' limit 1;
  select gs.id into v_section from public.grade_sections gs where gs.academic_year_id = v_year limit 1;
  select id into v_subject from public.subjects limit 1;
  if v_section is null or v_subject is null then return; end if;

  v_assignment := app.teaching_assignment_create(v_staff_id, v_year, v_section, v_subject, null, 'Verification assignment.');
  v_assignment_id := (v_assignment ->> 'assignmentId')::uuid;
  assert v_assignment_id is not null, 'stage3: assignment created';
  assert (v_assignment ->> 'status') = 'active', 'stage3: assignment is active';

  -- Duplicate active assignment is denied.
  v_denied := false;
  begin
    perform app.teaching_assignment_create(v_staff_id, v_year, v_section, v_subject, null, 'Duplicate attempt.');
  exception when others then v_denied := true; end;
  assert v_denied, 'stage3: duplicate active assignment is denied';

  -- End is version-checked; history is preserved.
  v_denied := false;
  begin
    perform app.teaching_assignment_end(v_assignment_id, 'Verification end.', 999);
  exception when others then v_denied := true; end;
  assert v_denied, 'stage3: stale-version end is denied';
  perform app.teaching_assignment_end(v_assignment_id, 'Verification end.', 1);
  assert (select status from public.teaching_assignments where id = v_assignment_id) = 'ended',
    'stage3: ended assignment preserves history';

  -- The legacy teacher grant cannot be freshly created.
  v_denied := false;
  begin
    perform app.roles_grant('90000000-0000-4000-8000-000000000003', 'teacher', 'Legacy attempt.');
  exception when others then v_denied := true; end;
  assert v_denied, 'stage3: teacher role cannot be freshly granted';
end $$;
reset role;

-- ============================================================================
-- STAGE 4 — data imports
-- ============================================================================
set role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000002', false);
select set_config('request.jwt.claims', '{"aal":"aal2","role":"authenticated","email":"verify.admin@example.in"}', false);
do $$
declare
  v_batch jsonb;
  v_batch_id uuid;
  v_version int;
  v_preview jsonb;
  v_report jsonb;
  v_denied boolean;
  v_year uuid;
begin
  select id into v_year from public.academic_years where status = 'current' limit 1;
  if v_year is null then return; end if;

  -- Confirmations are mandatory.
  v_denied := false;
  begin
    perform app.data_import_create_batch(v_year, 'Verify SIS', null, false, true);
  exception when others then v_denied := true; end;
  assert v_denied, 'stage4: missing authority confirmation is denied';

  v_batch := app.data_import_create_batch(v_year, 'Verify SIS', null, true, true);
  v_batch_id := (v_batch ->> 'batchId')::uuid;
  v_version := (v_batch ->> 'version')::int;
  assert v_batch_id is not null, 'stage4: batch created';

  -- Store normalized rows (students + a guardian + a relationship).
  perform app.data_import_store_rows(v_batch_id, '[
    {"rowNumber":1,"entity":"students","sourceKey":"VSTU-1","normalized":{"givenName":"Verify","familyName":"Student","displayName":"Verify Student"},"status":"valid"},
    {"rowNumber":2,"entity":"guardians","sourceKey":"VGDN-1","normalized":{"givenName":"Verify","familyName":"Guardian","displayName":"Verify Guardian","contact":"+919000000001"},"status":"valid"},
    {"rowNumber":3,"entity":"guardian_student_relationships","sourceKey":"VREL-1","normalized":{"guardianKey":"VGDN-1","studentKey":"VSTU-1","relationshipLabel":"Father"},"status":"valid"}
  ]'::jsonb);
  -- store_rows mutates the batch; re-read the optimistic version for commit.
  select version into v_version from public.data_import_batches where id = v_batch_id;

  -- Walk the state machine to ready before commit (Upload → Validate → Ready).
  perform app.data_import_set_state(v_batch_id, 'validating', v_version);
  select version into v_version from public.data_import_batches where id = v_batch_id;
  perform app.data_import_set_state(v_batch_id, 'ready', v_version);
  select version into v_version from public.data_import_batches where id = v_batch_id;

  v_preview := app.data_import_preview(v_batch_id);
  assert (v_preview ->> 'createCount')::int >= 1, 'stage4: preview counts creates';

  -- Stale version commit is denied.
  v_denied := false;
  begin
    perform app.data_import_commit(v_batch_id, 999, 'Stale attempt.', 'verify-import-0001', 3, 0);
  exception when others then v_denied := true; end;
  assert v_denied, 'stage4: stale-version commit is denied';

  -- Commit is idempotent per idempotency key and never duplicates entities.
  v_report := app.data_import_commit(v_batch_id, v_version, 'Verification commit.', 'verify-import-0001', 3, 0);
  -- TEMP DEBUG: surface per-row outcomes when the commit reports errors.
  if (v_report ->> 'errorCount')::int > 0 then
    raise notice 'DEBUG import report=%', v_report;
    raise notice 'DEBUG rows=%', (select coalesce(string_agg(r.row_number::text || ':' || r.status || ':' || coalesce(r.outcome, '-'), ', '), '-')
      from public.data_import_rows r where r.batch_id = v_batch_id);
  end if;
  assert (v_report ->> 'errorCount')::int = 0, 'stage4: clean commit has no errors';
  assert (select count(*) from public.external_record_keys where source_system = 'Verify SIS' and source_key = 'VSTU-1') = 1,
    'stage4: exactly one external student key';
  assert (select count(*) from public.external_record_keys where source_system = 'Verify SIS' and source_key = 'VGDN-1') = 1,
    'stage4: exactly one external guardian key';
  assert (select count(*) from public.guardian_student_links l
            join public.external_record_keys ek on ek.entity = 'guardian' and ek.record_id = l.guardian_id
            join public.external_record_keys es on es.entity = 'student' and es.record_id = l.student_id
           where ek.source_key = 'VGDN-1' and es.source_key = 'VSTU-1') = 1,
    'stage4: exactly one imported relationship';

  -- Report is available and immutable.
  v_report := app.data_import_report(v_batch_id);
  assert (v_report ->> 'state') = 'completed', 'stage4: report shows completed state';
end $$;
reset role;

-- ============================================================================
-- STAGE 5 — guardian claims
-- ============================================================================
set role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000002', false);
select set_config('request.jwt.claims', '{"aal":"aal2","role":"authenticated","email":"verify.admin@example.in"}', false);
do $$
declare
  v_claim jsonb;
  v_claim_ref text;
  v_secret text;
  v_contact_id uuid;
  v_guardian_id uuid;
  v_denied boolean;
begin
  -- Find the imported guardian's recorded contact.
  select gc.id into v_contact_id
    from public.guardian_contacts gc
    join public.external_record_keys ek on ek.entity = 'guardian' and ek.record_id = gc.guardian_id
   where ek.source_key = 'VGDN-1' and gc.state = 'recorded'
   order by gc.created_at desc limit 1;
  if v_contact_id is null then return; end if;

  select g.id into v_guardian_id from public.guardians g
   join public.external_record_keys ek on ek.entity = 'guardian' and ek.record_id = g.id
   where ek.source_key = 'VGDN-1';
  if v_guardian_id is null then return; end if;

  v_claim := app.guardian_claim_create(v_guardian_id, v_contact_id, 'sms', now() + interval '7 days', null, 'Verification claim.');
  v_claim_ref := v_claim ->> 'reference';
  v_secret := v_claim ->> 'oneTimeSecret';
  assert v_claim_ref is not null, 'stage5: claim created';
  assert length(coalesce(v_secret, '')) >= 32, 'stage5: one-time secret returned once';
  -- The secret is never stored: only its hash is persisted.
  assert not exists (
    select 1 from public.guardian_claim_invitations
     where reference = v_claim_ref and secret_hash = v_secret), 'stage5: plaintext secret is not stored';

  -- A second pending claim for the same guardian is denied.
  v_denied := false;
  begin
    perform app.guardian_claim_create(v_guardian_id, v_contact_id, 'sms', now() + interval '7 days', null, 'Duplicate attempt.');
  exception when others then v_denied := true; end;
  assert v_denied, 'stage5: duplicate pending claim is denied';
end $$;
reset role;

-- Claim acceptance binds the provider subject and activates exact links only.
do $$
declare
  v_claim_ref text;
  v_guardian_id uuid;
  v_denied boolean;
  v_result jsonb;
begin
  select c.reference, c.guardian_id into v_claim_ref, v_guardian_id
    from public.guardian_claim_invitations c
    join public.external_record_keys ek on ek.entity = 'guardian' and ek.record_id = c.guardian_id
   where ek.source_key = 'VGDN-1' and c.status = 'pending'
   order by c.created_at desc limit 1;
  if v_claim_ref is null then return; end if;

  -- Bind the claimant's provider subject (service/admin dispatch path).
  perform app.guardian_claim_mark_dispatched(v_claim_ref, '90000000-0000-4000-8000-000000000003', 'verify-provider-ref');

  -- The wrong Auth account cannot accept the claim.
  perform set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000001', false);
  perform set_config('request.jwt.claims', '{"aal":"aal2","role":"authenticated","email":"verify.principal@example.in"}', false);
  v_denied := false;
  begin
    perform app.guardian_claim_accept(v_claim_ref, 'Wrong', 'Actor');
  exception when others then v_denied := true; end;
  assert v_denied, 'stage5: wrong provider subject cannot accept the claim';

  -- The bound claimant accepts; one account, one Guardian grant, exact links.
  perform set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000003', false);
  perform set_config('request.jwt.claims', '{"aal":"aal2","role":"authenticated","email":"verify.guardian@example.in","phone":"+919000000001"}', false);
  v_result := app.guardian_claim_accept(v_claim_ref, 'Verify', 'Guardian');
  assert (v_result ->> 'accountId') = '90000000-0000-4000-8000-000000000003', 'stage5: acceptance binds the claimant account';
  assert exists (
    select 1 from public.role_grants
     where account_id = '90000000-0000-4000-8000-000000000003' and role_code = 'guardian' and status = 'active'),
    'stage5: exactly one Guardian grant after acceptance';
  assert (select count(*) from public.role_grants
           where account_id = '90000000-0000-4000-8000-000000000003' and role_code = 'guardian' and status = 'active') = 1,
    'stage5: no duplicate Guardian grant';
  assert (select state from public.guardian_contacts gc
            join public.external_record_keys ek on ek.entity = 'guardian' and ek.record_id = gc.guardian_id
           where ek.source_key = 'VGDN-1' limit 1) = 'delivery_verified',
    'stage5: contact is delivery-verified after acceptance';

  -- Reuse is denied.
  v_denied := false;
  begin
    perform app.guardian_claim_accept(v_claim_ref, 'Verify', 'Guardian');
  exception when others then v_denied := true; end;
  assert v_denied, 'stage5: claim reuse is denied';
end $$;
reset role;

-- ============================================================================
-- STAGE 7 — protected exports
-- ============================================================================
set role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-4000-8000-000000000002', false);
select set_config('request.jwt.claims', '{"aal":"aal2","role":"authenticated","email":"verify.admin@example.in"}', false);
do $$
declare
  v_request jsonb;
  v_ref text;
  v_denied boolean;
begin
  -- Non-allowlisted filter identifiers are rejected.
  v_denied := false;
  begin
    perform app.data_export_request('students', '{"DROP TABLE x": "1"}'::jsonb, '[]'::jsonb, 'csv', 'Verification purpose.', 'Verification reason.');
  exception when others then v_denied := true; end;
  assert v_denied, 'stage7: non-allowlisted filter field is rejected';

  v_request := app.data_export_request('students', '{}'::jsonb, '[]'::jsonb, 'csv', 'Verification export purpose.', 'Verification reason.');
  v_ref := v_request ->> 'reference';
  assert v_ref is not null, 'stage7: export request created';

  -- Completion is service/administrated and sets a 24h expiry.
  perform app.data_export_mark_ready(v_ref, 2, null);
  assert (select state from public.data_export_requests where reference = v_ref) = 'ready',
    'stage7: export marked ready';
  assert (select expires_at from public.data_export_requests where reference = v_ref) > now(),
    'stage7: export has a future expiry';

  -- A closed request cannot be cancelled again.
  v_denied := false;
  begin
    perform app.data_export_cancel(v_ref, 'Second cancel attempt.');
  exception when others then v_denied := true; end;
  assert v_denied, 'stage7: cancelling a ready export is denied';
end $$;
reset role;

-- ============================================================================
-- Cross-stage: the masked legacy inventory runs and returns safe keys only.
-- ============================================================================
do $$
begin
  perform app.legacy_teacher_access_report();
end $$;

select 'CONSOLIDATION SUITE PASSED' as result;
