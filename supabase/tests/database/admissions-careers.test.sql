-- =============================================================================
-- B2 admissions/careers database tests (pgTAP, `supabase db test`).
-- plan.md §12: FKs, checks, uniqueness, RLS, append-only, references.
-- =============================================================================

begin;
select plan(79);

-- ---------------------------------------------------------------------------
-- Tables exist.
-- ---------------------------------------------------------------------------
select has_table('public', 'admission_windows', 'admission_windows exists');
select has_table('public', 'admission_applications', 'admission_applications exists');
select has_table('public', 'admission_drafts', 'admission_drafts exists');
select has_table('public', 'admission_application_versions', 'admission_application_versions exists');
select has_table('public', 'admission_reviews', 'admission_reviews exists');
select has_table('public', 'admission_assessments', 'admission_assessments exists');
select has_table('public', 'admission_offers', 'admission_offers exists');
select has_table('public', 'admission_events', 'admission_events exists');
select has_table('public', 'job_vacancies', 'job_vacancies exists');
select has_table('public', 'job_vacancy_versions', 'job_vacancy_versions exists');
select has_table('public', 'job_applications', 'job_applications exists');
select has_table('public', 'job_application_versions', 'job_application_versions exists');
select has_table('public', 'job_review_assignments', 'job_review_assignments exists');
select has_table('public', 'job_scorecards', 'job_scorecards exists');
select has_table('public', 'job_interviews', 'job_interviews exists');
select has_table('public', 'job_events', 'job_events exists');

-- ---------------------------------------------------------------------------
-- Not-null on application and owner columns.
-- ---------------------------------------------------------------------------
select col_not_null('public', 'admission_applications', 'owner_account_id');
select col_not_null('public', 'admission_applications', 'current_status');
select col_not_null('public', 'admission_applications', 'student_name');
select col_not_null('public', 'admission_applications', 'parent_name');
select col_not_null('public', 'admission_drafts', 'application_id');
select col_not_null('public', 'admission_application_versions', 'application_id');
select col_not_null('public', 'admission_application_versions', 'snapshot');
select col_not_null('public', 'admission_application_versions', 'submitted_by_account_id');
select col_not_null('public', 'admission_reviews', 'application_id');
select col_not_null('public', 'admission_assessments', 'application_id');
select col_not_null('public', 'admission_offers', 'application_id');
select col_not_null('public', 'admission_events', 'application_id');
select col_not_null('public', 'job_applications', 'vacancy_id');
select col_not_null('public', 'job_applications', 'vacancy_version');
select col_not_null('public', 'job_applications', 'owner_account_id');
select col_not_null('public', 'job_applications', 'current_status');
select col_not_null('public', 'job_applications', 'applicant_name');
select col_not_null('public', 'job_application_versions', 'application_id');
select col_not_null('public', 'job_application_versions', 'snapshot');
select col_not_null('public', 'job_application_versions', 'submitted_by_account_id');
select col_not_null('public', 'job_review_assignments', 'application_id');
select col_not_null('public', 'job_review_assignments', 'reviewer_account_id');
select col_not_null('public', 'job_scorecards', 'application_id');
select col_not_null('public', 'job_interviews', 'application_id');
select col_not_null('public', 'job_events', 'application_id');

-- ---------------------------------------------------------------------------
-- Status and value checks.
-- ---------------------------------------------------------------------------
select col_has_check('public', 'admission_windows', 'status', 'admission window status check');
select col_has_check('public', 'admission_applications', 'current_status', 'application status check');
select col_has_check('public', 'admission_reviews', 'action', 'review action check');
select col_has_check('public', 'admission_offers', 'response', 'offer response check');
select col_has_check('public', 'job_vacancies', 'current_status', 'vacancy status check');
select col_has_check('public', 'job_applications', 'current_status', 'job application status check');
select col_has_check('public', 'job_review_assignments', 'status', 'assignment status check');
select col_has_check('public', 'job_interviews', 'outcome', 'interview outcome check');
select col_has_check('public', 'job_scorecards', 'score', 'score non-negative check');

-- ---------------------------------------------------------------------------
-- Uniqueness: one version/one offer/one assessment/one draft per application.
-- (No composite primary keys exist in this slice: every B2 table uses a
-- surrogate `id` primary key; the multi-column constraints below are
-- separate unique constraints, not PKs.)
-- ---------------------------------------------------------------------------
select col_is_unique('public', 'admission_application_versions', ARRAY['application_id', 'version'], 'one admission version per application/version');
select col_is_unique('public', 'job_vacancy_versions', ARRAY['vacancy_id', 'version'], 'one vacancy version per vacancy/version');
select col_is_unique('public', 'job_application_versions', ARRAY['application_id', 'version'], 'one job version per application/version');
select col_is_unique('public', 'job_review_assignments', ARRAY['application_id', 'reviewer_account_id'], 'one assignment per application/reviewer');
select col_is_unique('public', 'admission_offers', 'application_id', 'one offer per application');
select col_is_unique('public', 'admission_assessments', 'application_id', 'one assessment per application');
select col_is_unique('public', 'admission_drafts', 'application_id', 'one draft per application');

-- ---------------------------------------------------------------------------
-- Composite FK: job applications always reference an immutable vacancy version.
-- ---------------------------------------------------------------------------
select has_fk(
  'public', 'job_applications',
  ARRAY['vacancy_id', 'vacancy_version'],
  'job_vacancy_versions',
  ARRAY['vacancy_id', 'version'],
  'job application references a vacancy version'
);

-- ---------------------------------------------------------------------------
-- Append-only: submitted versions and events block UPDATE/DELETE via
-- app.block_mutation().
-- ---------------------------------------------------------------------------
select has_trigger('public', 'admission_application_versions', 'admission_versions_no_update', 'admission versions block update');
select has_trigger('public', 'admission_application_versions', 'admission_versions_no_delete', 'admission versions block delete');
select has_trigger('public', 'admission_events', 'admission_events_no_update', 'admission events block update');
select has_trigger('public', 'admission_events', 'admission_events_no_delete', 'admission events block delete');
select has_trigger('public', 'job_vacancy_versions', 'job_vacancy_versions_no_update', 'vacancy versions block update');
select has_trigger('public', 'job_vacancy_versions', 'job_vacancy_versions_no_delete', 'vacancy versions block delete');
select has_trigger('public', 'job_application_versions', 'job_application_versions_no_update', 'job versions block update');
select has_trigger('public', 'job_application_versions', 'job_application_versions_no_delete', 'job versions block delete');
select has_trigger('public', 'job_events', 'job_events_no_update', 'job events block update');
select has_trigger('public', 'job_events', 'job_events_no_delete', 'job events block delete');
select is(
  (select count(*)::int
     from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('admission_application_versions', 'admission_events',
                        'job_vacancy_versions', 'job_application_versions', 'job_events')
      and not t.tgisinternal
      and t.tgfoid = 'app.block_mutation'::regproc),
  10,
  'all ten append-only triggers call app.block_mutation'
);

-- ---------------------------------------------------------------------------
-- RLS is enabled on every B2 table.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_tables t
    where t.schemaname = 'public'
      and t.tablename in ('admission_windows', 'admission_applications', 'admission_drafts',
                          'admission_application_versions', 'admission_reviews', 'admission_assessments',
                          'admission_offers', 'admission_events', 'job_vacancies', 'job_vacancy_versions',
                          'job_applications', 'job_application_versions', 'job_review_assignments',
                          'job_scorecards', 'job_interviews', 'job_events')
      and t.rowsecurity),
  16,
  'all B2 tables have RLS enabled'
);

-- Exactly two anonymous policies exist in this slice, both read-only SELECT
-- policies on the published-vacancy tables.
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and roles = '{anon}'),
  2,
  'exactly two anonymous policies in the B2 slice'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and roles = '{anon}'
      and tablename in ('job_vacancies', 'job_vacancy_versions')
      and cmd <> 'SELECT'),
  0,
  'anonymous policies on vacancy tables grant SELECT only'
);

-- Base privileges: anon may read vacancies but not applications; the
-- authenticated role keeps its applicant-facing grants.
select has_table_privilege('anon', 'job_vacancies', 'SELECT', 'anon may read vacancies');
select hasnt_table_privilege('anon', 'admission_applications', 'SELECT', 'anon has no select on applications');
select has_table_privilege('authenticated', 'admission_applications', 'SELECT', 'authenticated may read own applications');

-- ---------------------------------------------------------------------------
-- Reference helper: app.new_ref('ADMW') style references.
-- (References are unique-defaulted, so exercise the helper exactly once.)
-- ---------------------------------------------------------------------------
select matches(
  app.new_ref('ADMW'),
  '^ADMW-\d{4}-[0-9A-F]{6}$',
  'new_ref produces ADMW-YYYY-XXXXXX'
);

-- ---------------------------------------------------------------------------
-- Negative RLS without an auth context (auth.uid() is null in the local
-- stub): anon sees no unpublished vacancies, and authenticated without a
-- session sees no applications at all.
-- ---------------------------------------------------------------------------
set role anon;
select is(
  (select count(*)::int from public.job_vacancies where current_status = 'draft'),
  0,
  'anon sees no unpublished vacancies'
);
reset role;

set role authenticated;
select is(
  (select count(*)::int from public.admission_applications),
  0,
  'authenticated without a session sees no admission applications'
);
select is(
  (select count(*)::int from public.job_applications),
  0,
  'authenticated without a session sees no job applications'
);
reset role;

rollback;
