-- =============================================================================
-- 000119 guardian link-request reference assertions.
--
-- The pending queue on `/portal/link-child` showed "Unnamed student" because
-- `links.listMine` embedded `students(...)` through guardian RLS, which hides
-- a student until the link is active. `app.guardian_links_mine()` is a definer
-- projection over the caller's own `guardian_student_links` rows; this suite
-- locks that boundary on the local scratch instance:
--   * the caller's own pending row carries the student reference and name;
--   * an unrelated guardian's rows and students never appear;
--   * an account with no guardian record receives nothing;
--   * suspended accounts and an anonymous session receive nothing;
--   * the underlying `students`/`people` reads stay hidden (no widening).
-- Run by scripts/validate-db-local.sh.
-- =============================================================================

\set ON_ERROR_STOP on

-- Match real Supabase behavior: auth.uid() reads the request GUC.
create or replace function auth.uid() returns uuid language sql as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

begin;

-- Synthetic actors and children (fixed UUIDs; local validation only).
insert into auth.users (id) values
  ('10000000-0000-4000-8000-000000000101'),
  ('10000000-0000-4000-8000-000000000102'),
  ('10000000-0000-4000-8000-000000000103');

insert into public.people (id, given_name, family_name, display_name) values
  ('20000000-0000-4000-8000-000000000101', 'Guardian', 'A', 'Guardian A'),
  ('20000000-0000-4000-8000-000000000102', 'Guardian', 'B', 'Guardian B'),
  ('20000000-0000-4000-8000-000000000103', 'No', 'Guardian', 'No Guardian'),
  -- display_name deliberately empty: the projection composes given/family.
  ('20000000-0000-4000-8000-000000000111', 'Aayan', 'Yousuf', ''),
  ('20000000-0000-4000-8000-000000000112', 'Linked', 'Child', 'Linked Child'),
  ('20000000-0000-4000-8000-000000000113', 'Other', 'Child', 'Other Child'),
  ('20000000-0000-4000-8000-000000000114', 'Other', 'Pending', 'Other Pending');

insert into public.user_accounts (id, person_id, status, verified_contact) values
  ('10000000-0000-4000-8000-000000000101', '20000000-0000-4000-8000-000000000101', 'active', 'guardian.a@example.test'),
  ('10000000-0000-4000-8000-000000000102', '20000000-0000-4000-8000-000000000102', 'active', 'guardian.b@example.test'),
  ('10000000-0000-4000-8000-000000000103', '20000000-0000-4000-8000-000000000103', 'active', 'no.guardian@example.test');

insert into public.role_grants (account_id, role_code, status, effective_from) values
  ('10000000-0000-4000-8000-000000000101', 'guardian', 'active', now()),
  ('10000000-0000-4000-8000-000000000102', 'guardian', 'active', now());

insert into public.guardians (id, person_id, status) values
  ('30000000-0000-4000-8000-000000000101', '20000000-0000-4000-8000-000000000101', 'active'),
  ('30000000-0000-4000-8000-000000000102', '20000000-0000-4000-8000-000000000102', 'active');

insert into public.students (id, reference, person_id, status) values
  ('40000000-0000-4000-8000-000000000111', 'STU-TEST-PENDING', '20000000-0000-4000-8000-000000000111', 'active'),
  ('40000000-0000-4000-8000-000000000112', 'STU-TEST-LINKED', '20000000-0000-4000-8000-000000000112', 'active'),
  ('40000000-0000-4000-8000-000000000113', 'STU-TEST-OTHER', '20000000-0000-4000-8000-000000000113', 'active'),
  ('40000000-0000-4000-8000-000000000114', 'STU-TEST-OTHER-PENDING', '20000000-0000-4000-8000-000000000114', 'active');

-- `guardian_request` links record an audit event on insert (000063), which
-- needs an actor; the fixture transaction supplies the owning account claim.
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000101', false);
insert into public.guardian_student_links (id, reference, guardian_id, student_id, relationship_label, status, verification_source) values
  ('50000000-0000-4000-8000-000000000111', 'LINK-TEST-A-PENDING', '30000000-0000-4000-8000-000000000101', '40000000-0000-4000-8000-000000000111', 'Father', 'pending_verification', 'guardian_request'),
  ('50000000-0000-4000-8000-000000000112', 'LINK-TEST-A-ACTIVE',  '30000000-0000-4000-8000-000000000101', '40000000-0000-4000-8000-000000000112', 'Father', 'active', 'guardian_request');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000102', false);
insert into public.guardian_student_links (id, reference, guardian_id, student_id, relationship_label, status, verification_source) values
  ('50000000-0000-4000-8000-000000000113', 'LINK-TEST-B-ACTIVE',  '30000000-0000-4000-8000-000000000102', '40000000-0000-4000-8000-000000000113', 'Mother', 'active', 'guardian_request'),
  ('50000000-0000-4000-8000-000000000114', 'LINK-TEST-B-PENDING', '30000000-0000-4000-8000-000000000102', '40000000-0000-4000-8000-000000000114', 'Mother', 'pending_verification', 'guardian_request');
select set_config('request.jwt.claim.sub', '', false);

-- Grant boundary: anon never executes the projection, authenticated does.
do $$
begin
  assert not has_function_privilege('anon', 'app.guardian_links_mine()', 'EXECUTE'),
    'anonymous callers must never read guardian link rows';
  assert has_function_privilege('authenticated', 'app.guardian_links_mine()', 'EXECUTE'),
    'authenticated sessions read their own rows through the projection';
  assert has_function_privilege('service_role', 'app.guardian_links_mine()', 'EXECUTE'),
    'the service role keeps the projection for provider work';
  assert (
    select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'guardian_links_mine'
  ), 'the own-row projection must run security definer';
end
$$;

-- Guardian A: own pending row carries the reference and composed name.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000101', true);
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal1"}', true);
do $$
declare v_rows jsonb := app.guardian_links_mine();
begin
  assert jsonb_array_length(v_rows) = 2,
    'guardian A sees exactly their two links (got ' || jsonb_array_length(v_rows)::text || ')';

  assert (
    select count(*) from jsonb_array_elements(v_rows) r
     where r ->> 'reference' = 'LINK-TEST-A-PENDING'
       and r ->> 'status' = 'pending_verification'
       and r ->> 'student_reference' = 'STU-TEST-PENDING'
       and r ->> 'student_name' = 'Aayan Yousuf'
       and r ->> 'guardian_name' = 'Guardian A'
  ) = 1, 'the pending row must carry the student reference and the composed name';

  assert (
    select count(*) from jsonb_array_elements(v_rows) r
     where r ->> 'reference' like 'LINK-TEST-B%'
  ) = 0, 'another guardian''s rows must never appear';

  assert (
    select count(*) from jsonb_array_elements(v_rows) r
     where r ->> 'reference' = 'LINK-TEST-A-ACTIVE'
       and jsonb_array_length(r -> 'guardian_link_capabilities') = 5
       and (
         select count(*) from jsonb_array_elements(r -> 'guardian_link_capabilities') c
          where c ->> 'capability' = 'profile'
       ) = 1
  ) = 1, 'an active link keeps its capability array';

  assert (
    select jsonb_array_length(r -> 'guardian_link_capabilities')
      from jsonb_array_elements(v_rows) r
     where r ->> 'reference' = 'LINK-TEST-A-PENDING'
  ) = 0, 'a pending link carries no capabilities';

  -- The projection is the only path: the pending student stays hidden by RLS.
  assert (select count(*) from public.students where id = '40000000-0000-4000-8000-000000000111') = 0,
    'the pending student row must stay invisible to the guardian';
  assert (select count(*) from public.people where id = '20000000-0000-4000-8000-000000000111') = 0,
    'the pending student person row must stay invisible to the guardian';
  assert (select count(*) from public.students where id = '40000000-0000-4000-8000-000000000112') = 1,
    'the active link keeps its student visible through RLS';
end
$$;
reset role;

-- Guardian B: sees only B rows; A's pending reference never leaks.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000102', true);
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal1"}', true);
do $$
declare v_rows jsonb := app.guardian_links_mine();
begin
  assert jsonb_array_length(v_rows) = 2,
    'guardian B sees exactly their two links (got ' || jsonb_array_length(v_rows)::text || ')';
  assert (
    select count(*) from jsonb_array_elements(v_rows) r
     where r ->> 'reference' like 'LINK-TEST-A%'
  ) = 0, 'guardian A''s links must never appear for guardian B';
  assert v_rows::text not like '%STU-TEST-PENDING%',
    'guardian A''s requested student reference must never appear for guardian B';
end
$$;
reset role;

-- An authenticated account with no guardian record receives nothing.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000103', true);
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal1"}', true);
do $$
begin
  assert jsonb_array_length(app.guardian_links_mine()) = 0,
    'an account without a guardian record receives no link rows';
end
$$;
reset role;

-- No session (no sub claim) receives nothing.
set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal1"}', true);
do $$
begin
  assert jsonb_array_length(app.guardian_links_mine()) = 0,
    'a session without a user id receives no link rows';
end
$$;
reset role;

-- An inactive guardian record likewise returns nothing.
update public.guardians set status = 'inactive'
 where id = '30000000-0000-4000-8000-000000000101';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000101', true);
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal1"}', true);
do $$
begin
  assert jsonb_array_length(app.guardian_links_mine()) = 0,
    'an inactive guardian record receives no link rows';
end
$$;
reset role;
update public.guardians set status = 'active'
 where id = '30000000-0000-4000-8000-000000000101';

-- A suspended guardian account receives nothing, and recovers on reactivation.
update public.user_accounts set status = 'suspended'
 where id = '10000000-0000-4000-8000-000000000101';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000101', true);
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal1"}', true);
do $$
begin
  assert jsonb_array_length(app.guardian_links_mine()) = 0,
    'a suspended account receives no link rows';
end
$$;
reset role;
update public.user_accounts set status = 'active'
 where id = '10000000-0000-4000-8000-000000000101';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000101', true);
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal1"}', true);
do $$
begin
  assert jsonb_array_length(app.guardian_links_mine()) = 2,
    'reactivating the account restores the own-row read';
end
$$;
reset role;

rollback;

select 'GUARDIAN LINK REFERENCE PASSED' as result;
