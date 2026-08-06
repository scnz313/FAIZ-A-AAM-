-- =============================================================================
-- B3 students/enrollment database tests (pgTAP, `supabase db test`).
-- plan.md §12: tables, checks, uniqueness, FKs, append-only triggers, indexes,
-- RLS, and anonymous-access denial for the enrollment slice.
-- =============================================================================

begin;
select plan(21);

-- Tables exist.
select has_table('public', 'enrollments', 'enrollments exists');
select has_table('public', 'enrollment_conversions', 'enrollment_conversions exists');
select has_table('public', 'student_support_records', 'student_support_records exists');

-- Checks, uniqueness, and foreign keys on the enrollment join.
select col_has_check('public', 'enrollments', 'status', 'enrollment status check');
select col_has_check('public', 'enrollments', 'effective_to', 'effective_to > effective_from check');
select col_is_unique('public', 'enrollments', 'reference', 'enrollment reference unique');
select col_is_unique('public', 'enrollment_conversions', 'application_id', 'one conversion per application');
select col_is_unique('public', 'enrollment_conversions', 'reference', 'conversion reference unique');
select has_fk('public', 'enrollments', 'student_id', 'students', 'id', 'enrollment links to student');
select has_fk('public', 'enrollments', 'academic_year_id', 'academic_years', 'id', 'enrollment links to academic year');
select has_fk('public', 'enrollments', 'grade_section_id', 'grade_sections', 'id', 'enrollment links to grade section');

-- Append-only: conversions cannot be updated or deleted.
select has_trigger('public', 'enrollment_conversions', 'enrollment_conversions_no_update', 'conversion update is blocked');
select has_trigger('public', 'enrollment_conversions', 'enrollment_conversions_no_delete', 'conversion delete is blocked');

-- RLS enabled on every enrollment table; no anonymous policies.
select is(
  (select count(*)::int from pg_tables t
    where t.schemaname = 'public'
      and t.tablename in ('enrollments', 'enrollment_conversions', 'student_support_records')
      and t.rowsecurity),
  3,
  'all enrollment tables have RLS enabled'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename in ('enrollments', 'enrollment_conversions', 'student_support_records')
      and roles = '{anon}'),
  0,
  'no anonymous policies on enrollment tables'
);

-- Enrollment is the central join: lookup and uniqueness indexes exist.
select has_index('public', 'enrollments', 'enrollments_year_idx', 'year/status lookup index');
select has_index('public', 'enrollments', 'enrollments_section_idx', 'section lookup index');
select has_index('public', 'enrollments', 'enrollments_active_unique', 'at most one active enrollment per student/year');
select has_index('public', 'enrollment_conversions', 'enrollment_conversions_student_idx', 'conversion student lookup index');
select has_index('public', 'student_support_records', 'student_support_student_idx', 'support record student lookup index');

-- Negative behavior: anon has no read privilege on enrollments.
select hasnt_table_privilege('anon', 'public.enrollments', 'SELECT', 'anon cannot read enrollments');

rollback;
