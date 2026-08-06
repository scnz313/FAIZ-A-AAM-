-- =============================================================================
-- B1 school-configuration database tests (pgTAP, `supabase db test`).
-- =============================================================================

begin;
select plan(16);

-- Tables exist with the required conventions.
select has_table('public', 'school_profile_versions', 'school_profile_versions exists');
select has_table('public', 'academic_years', 'academic_years exists');
select has_table('public', 'grades', 'grades exists');
select has_table('public', 'grade_sections', 'grade_sections exists');
select has_table('public', 'subjects', 'subjects exists');
select has_table('public', 'rooms', 'rooms exists');
select has_table('public', 'period_definitions', 'period_definitions exists');
select has_table('public', 'settings_versions', 'settings_versions exists');
select has_table('public', 'feature_flags', 'feature_flags exists');

-- Conventions: reference columns, checks, uniqueness.
select col_not_null('public', 'academic_years', 'reference');
select col_has_check('public', 'academic_years', 'status', 'academic year status check');
select col_has_check('public', 'grade_sections', 'status', 'section status check');
select col_has_check('public', 'period_definitions', 'day_of_week', 'ISO weekday check');
select col_is_unique('public', 'academic_years', 'label', 'year label unique');
select col_is_unique('public', 'subjects', 'code', 'subject code unique');
select col_is_unique('public', 'grade_sections', ARRAY['academic_year_id', 'grade_id', 'section_label'], 'section unique per year/grade');

-- Seeds (synthetic reference data).
select is((select count(*)::int from public.academic_years), 2, 'two academic years seeded');
select is((select count(*)::int from public.grades), 5, 'five grades seeded');
select is((select count(*)::int from public.grade_sections), 2, 'current-year sections seeded (8-A, 9-C)');
select is((select count(*)::int from public.subjects), 7, 'seven subjects seeded');
select is((select count(*)::int from public.period_definitions), 48, 'eight periods × six working days seeded');
select is((select status from public.settings_versions where version = 1), 'policy_pending', 'settings start policy-pending');
select is((select enabled from public.feature_flags where code = 'student_accounts'), false, 'student accounts flag disabled');

-- RLS enabled on every school-configuration table.
select is(
  (select count(*)::int from pg_tables t
    where t.schemaname = 'public'
      and t.tablename in ('school_profile_versions', 'academic_years', 'grades', 'grade_sections',
                          'subjects', 'rooms', 'period_definitions', 'settings_versions', 'feature_flags')
      and t.rowsecurity),
  9,
  'all school-configuration tables have RLS enabled'
);

rollback;
