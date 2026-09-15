\set ON_ERROR_STOP on

do $$
declare
  v_options text[];
begin
  select reloptions into v_options
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relname = 'timetable_period_teachers';
  assert 'security_invoker=true' = any(coalesce(v_options, '{}'::text[])),
    'timetable teacher view must execute with caller RLS';

  assert not has_function_privilege('anon', 'app.guardian_claim_verify_token(text)', 'EXECUTE'),
    'anon must use the rate-limited application claim endpoint';
  assert not has_function_privilege('authenticated', 'app.guardian_claim_verify_token(text)', 'EXECUTE'),
    'authenticated browser clients must not call raw claim lookup';
  assert has_function_privilege('service_role', 'app.guardian_claim_verify_token(text)', 'EXECUTE'),
    'service route may perform the claim lookup';

  assert exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'guardian_preferences'
       and policyname = 'guardian_preferences_guardian_update'
       and with_check ilike '%guardian_student_links%'
  ), 'guardian preference update must require an active student link';

  assert not has_function_privilege('anon', 'app.results_report_release_candidates(uuid)', 'EXECUTE'),
    'anon must not read report release candidates';
  assert has_function_privilege('authenticated', 'app.results_report_release_candidates(uuid)', 'EXECUTE'),
    'authenticated staff may read report release candidates through the role guard';
  assert not has_function_privilege('anon', 'app.results_report_release_publish_batch(uuid,uuid[],text)', 'EXECUTE'),
    'anon must not assemble report releases';
  assert has_function_privilege('authenticated', 'app.results_report_release_publish_batch(uuid,uuid[],text)', 'EXECUTE'),
    'authenticated staff may assemble report releases through the role guard';
  assert (
    select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'results_report_release_publish_batch'
  ), 'report release assembly must run security definer';

  assert not has_function_privilege('anon', 'app.admission_reviewer_directory(uuid)', 'EXECUTE'),
    'anon must not read the admission reviewer directory';
  assert has_function_privilege('authenticated', 'app.admission_reviewer_directory(uuid)', 'EXECUTE'),
    'authenticated staff may read the admission reviewer directory through the scope guard';
  assert (
    select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'results_report_release_publish_batch'
  ), 'report release assembly must run security definer';

  assert not has_function_privilege('anon', 'app.admission_enrollment_reference(uuid)', 'EXECUTE'),
    'anon must not read conversion references';
  assert has_function_privilege('authenticated', 'app.admission_enrollment_reference(uuid)', 'EXECUTE'),
    'authenticated applicants read conversion references through the ownership guard';
  assert (
    select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'admission_enrollment_reference'
  ), 'conversion reference projection must run security definer';

  assert not has_function_privilege('anon', 'app.results_exam_definition_list()', 'EXECUTE'),
    'anon must not list result exam definitions';
  assert has_function_privilege('authenticated', 'app.results_exam_definition_list()', 'EXECUTE'),
    'authenticated staff may list result exam definitions through the role guard';
  assert (
    select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'results_exam_definition_list'
  ), 'exam-definition listing must run security definer';
end
$$;

select 'PHASE 11 LOCAL REPAIRS PASSED' as result;
