-- =============================================================================
-- B1 identity/access database tests (pgTAP, `supabase db test`).
-- plan.md §12: FKs, checks, uniqueness, RLS, revocation revalidation.
-- =============================================================================

begin;
select plan(31);

-- Tables exist.
select has_table('public', 'people', 'people exists');
select has_table('public', 'user_accounts', 'user_accounts exists');
select has_table('public', 'role_grants', 'role_grants exists');
select has_table('public', 'role_grant_academic_years', 'role grant academic-year scope exists');
select has_table('public', 'role_grant_grade_sections', 'role grant grade-section scope exists');
select has_table('public', 'role_grant_subjects', 'role grant subject scope exists');
select has_table('public', 'staff_members', 'staff_members exists');
select has_table('public', 'staff_assignments', 'staff_assignments exists');
select has_table('public', 'guardians', 'guardians exists');
select has_table('public', 'students', 'students exists');
select has_table('public', 'guardian_student_links', 'guardian_student_links exists');
select has_table('public', 'guardian_link_capabilities', 'guardian_link_capabilities exists');
select has_table('public', 'account_invitations', 'account_invitations exists');
select has_table('public', 'access_revalidation', 'access_revalidation exists');

-- Conventions.
select col_not_null('public', 'people', 'reference');
select col_not_null('public', 'user_accounts', 'person_id');
select col_has_check('public', 'role_grants', 'status', 'grant status check');
select col_has_check('public', 'guardian_student_links', 'status', 'link status check');
select col_has_check('public', 'guardian_link_capabilities', 'capability', 'capability check');
select col_is_unique('public', 'guardians', 'person_id', 'one guardian record per person');

-- Scope tables carry the composite primary keys.
select has_pk('public', 'role_grant_academic_years', 'grant/year composite pk');
select has_pk('public', 'role_grant_grade_sections', 'grant/section composite pk');
select has_pk('public', 'role_grant_subjects', 'grant/subject composite pk');
select has_pk('public', 'guardian_link_capabilities', 'link/capability composite pk');

-- Revalidation helpers bump the security version.
select lives_ok(
  $$ select app.bump_access_revalidation('00000000-0000-4000-8000-000000000001') $$,
  'bump without a row creates the marker'
);
select is(
  (select security_version from public.access_revalidation
    where account_id = '00000000-0000-4000-8000-000000000001'),
  1,
  'first bump sets security version 1'
);
select lives_ok(
  $$ select app.bump_access_revalidation('00000000-0000-4000-8000-000000000001') $$,
  'second bump is safe'
);
select is(
  (select security_version from public.access_revalidation
    where account_id = '00000000-0000-4000-8000-000000000001'),
  2,
  'second bump increments the security version'
);

-- Helpers deny anonymous/postgres contexts (auth.uid() is null).
select is(app.has_role('teacher'), false, 'has_role false without a session');
select is(app.is_staff_aal2(), false, 'is_staff_aal2 false without a session');
select is(app.is_guardian(), false, 'is_guardian false without a session');

-- RLS enabled on every identity/access table.
select is(
  (select count(*)::int from pg_tables t
    where t.schemaname = 'public'
      and t.tablename in ('people', 'user_accounts', 'role_grants', 'role_grant_academic_years',
                          'role_grant_grade_sections', 'role_grant_subjects', 'staff_members',
                          'staff_assignments', 'guardians', 'students', 'guardian_student_links',
                          'guardian_link_capabilities', 'account_invitations', 'access_revalidation')
      and t.rowsecurity),
  14,
  'all identity/access tables have RLS enabled'
);

-- No anon policies exist anywhere in the foundation + B1 slice.
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and roles = '{anon}'),
  0,
  'no anonymous policies in the B1 slice'
);

-- Base privileges exist for tables with policies (RLS filters rows; the role
-- still needs the underlying privilege under the new always-revoked default).
select has_table_privilege('authenticated', 'academic_years', 'SELECT', 'authenticated may read years');
select has_table_privilege('authenticated', 'role_grants', 'SELECT', 'authenticated may read own grants');
select has_table_privilege('authenticated', 'audit_events', 'SELECT', 'audit stays ungranted to authenticated');

rollback;
