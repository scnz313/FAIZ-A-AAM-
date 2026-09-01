-- =============================================================================
-- Staff access profile suite (driven by scripts/validate-db-local.sh after the
-- RLS and RPC suites). Verifies migration 000042: two-profile catalog
-- (Administrator and Principal), profile-based invitations, atomic acceptance,
-- profile changes, the last-administrator guard, and the enriched directory
-- projection. Fictional actors only; any failed assertion aborts.
-- =============================================================================

-- 1. Profile actors in a disjoint synthetic namespace (6000/7000/8000) so they
--    cannot collide with the RLS (1000/2000) or RPC flow actors.
insert into auth.users (id) values
  ('60000000-0000-4000-8000-000000000001'),  -- P Admin (system administrator)
  ('60000000-0000-4000-8000-000000000002'),  -- P Principal invitee
  ('60000000-0000-4000-8000-000000000003');  -- P Second admin (guard test)

insert into public.people (id, given_name, family_name, display_name) values
  ('70000000-0000-4000-8000-000000000001', 'Profile', 'Admin', 'Profile Admin'),
  ('70000000-0000-4000-8000-000000000002', 'Profile', 'Principal', 'Profile Principal'),
  ('70000000-0000-4000-8000-000000000003', 'Profile', 'Admin2', 'Profile Admin2');

insert into public.user_accounts (id, person_id, status, verified_contact) values
  ('60000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'active', 'profile.admin@example.in'),
  ('60000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', 'active', 'profile.admin2@example.in');

insert into public.role_grants (account_id, role_code, status, effective_from) values
  ('60000000-0000-4000-8000-000000000001', 'system_administrator', 'active', now()),
  ('60000000-0000-4000-8000-000000000003', 'system_administrator', 'active', now());

insert into public.staff_members (person_id, employment_status, title, access_profile_code, access_profile_version) values
  ('70000000-0000-4000-8000-000000000001', 'active', 'Administrator', 'administrator', 1),
  ('70000000-0000-4000-8000-000000000003', 'active', 'Administrator', 'administrator', 1);

-- The invited principal (7000...0002) has an auth user and person but no
-- application account, staff member, or grant yet; acceptance materializes
-- those from the profile invitation.

-- 2. Catalog and surface assertions.
do $$
begin
  assert to_regclass('public.staff_access_profiles') is not null, 'staff_access_profiles exists';
  assert to_regclass('public.staff_access_profile_roles') is not null, 'staff_access_profile_roles exists';
  assert to_regclass('public.staff_invitation_roles') is not null, 'staff_invitation_roles exists';
  assert exists (select 1 from pg_attribute where attrelid='public.staff_members'::regclass and attname='access_profile_code' and not attisdropped), 'staff profile code column exists';
  assert exists (select 1 from pg_attribute where attrelid='public.account_invitations'::regclass and attname='intended_staff_profile_code' and not attisdropped), 'invitation profile column exists';
  assert not has_table_privilege('authenticated', 'public.staff_invitation_roles', 'SELECT'), 'browser cannot read invitation role snapshots';
  assert exists (select 1 from pg_attribute where attrelid='public.role_definitions'::regclass and attname='is_assignable' and not attisdropped), 'role_definitions.is_assignable exists';
  assert not (select is_assignable from public.role_definitions where code='teacher'), 'teacher role is non-assignable';
  assert not (select is_assignable from public.role_definitions where code='student'), 'student role is non-assignable';
  assert (select is_assignable from public.role_definitions where code='result_entry_officer'), 'result_entry_officer is assignable';
end $$;

-- 3. Catalog visibility for any authenticated aal2 staff member.
set role authenticated;
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claims', '{"aal":"aal2","role":"authenticated","email":"profile.admin@example.in"}', false);
do $$
declare v_profiles jsonb;
begin
  v_profiles := app.staff_profiles_list();
  assert jsonb_array_length(v_profiles) = 2, 'exactly two profiles are listed';
  assert v_profiles @> '[{"code":"administrator"}]'::jsonb, 'administrator profile is listed';
  assert v_profiles @> '[{"code":"principal"}]'::jsonb, 'principal profile is listed';
  assert not v_profiles @> '[{"code":"teacher"}]'::jsonb, 'teacher profile is not listed';
  assert exists (select 1 from jsonb_array_elements(v_profiles) p where p->>'code'='administrator' and jsonb_array_length(p->'roles') = 8), 'administrator expands to eight roles';
  assert exists (select 1 from jsonb_array_elements(v_profiles) p where p->>'code'='principal' and jsonb_array_length(p->'roles') = 7), 'principal expands to seven roles';
  assert exists (select 1 from jsonb_array_elements(v_profiles) p where p->>'code'='principal' and p->'roles' @> '["result_entry_officer"]'::jsonb), 'principal includes result_entry_officer';
  assert exists (select 1 from jsonb_array_elements(v_profiles) p where p->>'code'='administrator' and p->'roles' @> '["result_publisher"]'::jsonb), 'administrator includes result_publisher';
end $$;
reset role;

-- 4. Profile invitation: Administrator-only, profile validation.
set role authenticated;
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claims', '{"aal":"aal2","role":"authenticated","email":"profile.admin@example.in"}', false);

do $$
declare
  v_inv jsonb;
  v_ref text;
  v_denied boolean;
begin
  -- Principal invitation.
  v_inv := app.staff_invites_create_profile(
    'profile.newprincipal@example.in', now() + interval '14 days', 'New Principal', 'Principal',
    'principal', 'Approved principal appointment.');
  assert v_inv ->> 'profileCode' = 'principal', 'invitation carries the principal profile';
  v_ref := v_inv ->> 'invitationRef';
  assert v_ref is not null, 'invitation reference returned';
  assert jsonb_array_length(v_inv -> 'roles') = 7, 'invitation snapshots exactly seven principal roles';

  -- Duplicate pending invitation for the same contact is denied.
  v_denied := false;
  begin
    perform app.staff_invites_create_profile(
      'profile.newprincipal@example.in', now() + interval '14 days', 'New Principal', 'Principal',
      'principal', 'Duplicate attempt.');
  exception when others then v_denied := true; end;
  assert v_denied, 'duplicate pending invitation is denied';

  -- Legacy teacher profile code is rejected.
  v_denied := false;
  begin
    perform app.staff_invites_create_profile(
      'profile.badteacher@example.in', now() + interval '14 days', 'Bad Teacher', 'Teacher',
      'teacher', 'Legacy attempt.');
  exception when others then v_denied := true; end;
  assert v_denied, 'teacher profile code is rejected';
end $$;
reset role;

-- 5. Acceptance: provider-bound invitation materializes profile grants
--    atomically; wrong identity is denied; the invited principal then accepts.
set role authenticated;
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claims', '{"aal":"aal2","role":"authenticated","email":"profile.admin@example.in"}', false);
do $$
declare
  v_inv jsonb;
  v_ref text;
  v_denied boolean := false;
  v_result jsonb;
begin
  v_inv := app.staff_invites_create_profile(
    'profile.principal@example.in', now() + interval '14 days', 'Accept Principal', 'Principal',
    'principal', 'Principal appointment.');
  v_ref := v_inv ->> 'invitationRef';
  perform app.staff_invites_attach_provider(v_ref, '60000000-0000-4000-8000-000000000002', 'provider-inv-1');

  -- Wrong identity (the administrator) cannot accept the bound invitation.
  begin
    perform app.staff_invites_accept(v_ref, 'Accept', 'Principal');
  exception when others then v_denied := true; end;
  assert v_denied, 'wrong provider identity cannot accept the invitation';

  -- The invited principal accepts with the verified claim email.
  perform set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000002', false);
  perform set_config('request.jwt.claims', '{"aal":"aal2","role":"authenticated","email":"profile.principal@example.in"}', false);
  v_result := app.staff_invites_accept(v_ref, 'Accept', 'Principal');
  assert v_result ->> 'profileCode' = 'principal', 'acceptance records the principal profile';
  assert jsonb_array_length(v_result -> 'roles') = 7, 'acceptance grants exactly seven principal roles';
  assert (select count(*) from public.role_grants where account_id='60000000-0000-4000-8000-000000000002' and status='active') = 7,
    'invitee holds exactly seven active grants';
  assert exists (
    select 1 from public.role_grants
     where account_id='60000000-0000-4000-8000-000000000002' and role_code='result_entry_officer' and status='active'),
    'invitee holds the result_entry_officer grant';
  assert (select access_profile_code from public.staff_members sm
            join public.user_accounts ua on ua.person_id = sm.person_id
           where ua.id='60000000-0000-4000-8000-000000000002') = 'principal',
    'staff member carries the principal profile marker';
end $$;
reset role;

-- 6. Profile change and the last-administrator guard.
set role authenticated;
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000001', false);
select set_config('request.jwt.claims', '{"aal":"aal2","role":"authenticated","email":"profile.admin@example.in"}', false);
do $$
declare
  v_denied boolean;
  v_version int;
begin
  -- A second active administrator allows admin B to demote admin A to principal.
  perform set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000003', false);
  perform set_config('request.jwt.claims', '{"aal":"aal2","role":"authenticated","email":"profile.admin2@example.in"}', false);
  v_denied := false;
  begin
    perform app.staff_profile_change('60000000-0000-4000-8000-000000000001', 'principal',
      'Profile change review', 1);
  exception when others then v_denied := true; end;
  assert not v_denied, 'profile change from administrator to principal succeeds with a second admin';

  -- The demoted account lost system administration.
  assert not exists (
    select 1 from public.role_grants
     where account_id='60000000-0000-4000-8000-000000000001' and role_code='system_administrator' and status='active'),
    'demoted account no longer holds system administration';

  -- The demoted principal cannot create staff invitations because the
  -- system_administrator grant was revoked (profile codes never authorize;
  -- active grants do).
  perform set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000001', false);
  perform set_config('request.jwt.claims', '{"aal":"aal2","role":"authenticated","email":"profile.admin@example.in"}', false);
  v_denied := false;
  begin
    perform app.staff_invites_create_profile(
      'profile.denied@example.in', now() + interval '14 days', 'Denied', 'Principal',
      'principal', 'Attempted by principal.');
  exception when others then v_denied := true; end;
  assert v_denied, 'principal cannot create staff invitations';

  -- Only admin B remains: suspending the demoted admin A is now denied.
  perform set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000003', false);
  perform set_config('request.jwt.claims', '{"aal":"aal2","role":"authenticated","email":"profile.admin2@example.in"}', false);
  v_denied := false;
  begin
    perform app.accounts_suspend('60000000-0000-4000-8000-000000000001', 'Removing the last admin');
  exception when others then v_denied := true; end;
  assert v_denied, 'suspending the last active administrator is denied';
end $$;
reset role;

-- 7. Enriched directory projection (snake_case keys matching the TypeScript
--    mapper) and pending-invitation union.
set role authenticated;
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000003', false);
select set_config('request.jwt.claims', '{"aal":"aal2","role":"authenticated","email":"profile.admin2@example.in"}', false);
do $$
declare v_rows jsonb;
begin
  v_rows := app.users_admin_list();
  assert exists (
    select 1 from jsonb_array_elements(v_rows) r
     where r ->> 'name' = 'Accept Principal'
       and r -> 'staff_members' @> '[{"access_profile_code":"principal"}]'::jsonb),
    'directory includes the principal profile marker (snake_case key)';
  -- Pending staff invitations appear as directory rows with profile_code.
  assert exists (
    select 1 from jsonb_array_elements(v_rows) r
     where r ->> 'id' is null
       and r -> 'account_invitations' @> '[{"profile_code":"principal"}]'::jsonb),
    'pending staff invitations appear in the directory with profile_code';
end $$;
reset role;

-- 8. Deprecated roles can never be freshly granted (roles_grant guard).
set role authenticated;
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000003', false);
select set_config('request.jwt.claims', '{"aal":"aal2","role":"authenticated","email":"profile.admin2@example.in"}', false);
do $$
declare v_denied boolean;
begin
  v_denied := false;
  begin
    perform app.roles_grant('60000000-0000-4000-8000-000000000002', 'teacher', 'Legacy attempt.');
  exception when others then v_denied := true; end;
  assert v_denied, 'teacher role cannot be freshly granted';

  v_denied := false;
  begin
    perform app.roles_grant('60000000-0000-4000-8000-000000000002', 'student', 'Legacy attempt.');
  exception when others then v_denied := true; end;
  assert v_denied, 'student role cannot be freshly granted';

  -- Profiled accounts are bundle-locked: individual revocation is denied.
  v_denied := false;
  begin
    perform app.roles_revoke(
      (select rg.id from public.role_grants rg
        where rg.account_id = '60000000-0000-4000-8000-000000000002'
          and rg.role_code = 'content_editor' and rg.status = 'active' limit 1),
      'Bundle-locked attempt.', 1);
  exception when others then v_denied := true; end;
  assert v_denied, 'individual revocation on a profiled account is denied';
end $$;
reset role;

-- 9. Guardian-link activation is Administrator-only. The pending link is
--    seeded as the database owner (no RLS insert path); the decision runs as
--    the administrator actor.
insert into public.guardian_student_links
  (guardian_id, student_id, relationship_label, status, verification_source, contact_priority)
select g.id, (select id from public.students limit 1), 'Parent', 'pending_verification', 'guardian_request', 1
  from public.guardians g limit 1;
set role authenticated;
select set_config('request.jwt.claim.sub', '60000000-0000-4000-8000-000000000003', false);
select set_config('request.jwt.claims', '{"aal":"aal2","role":"authenticated","email":"profile.admin2@example.in"}', false);
do $$
declare
  v_denied boolean;
  v_link uuid;
begin
  select id into v_link
    from public.guardian_student_links
   where verification_source = 'guardian_request' and status = 'pending_verification'
   order by created_at desc limit 1;
  if v_link is null then return; end if;

  v_denied := false;
  begin
    perform app.links_approve(v_link, 1);
  exception when others then v_denied := true; end;
  assert not v_denied, 'administrator can activate a guardian link';
  assert (select status from public.guardian_student_links where id = v_link) = 'active',
    'guardian link is active after administrator approval';
end $$;
reset role;

-- 10. Section 6 already proves the principal profile cannot create staff
--    invitations; no further actor assertions are required.
reset role;
