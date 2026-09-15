-- =============================================================================
-- 000107 anonymous RPC grant assertions.
--
-- Read-only live-catalog evidence found seven `app` functions executable by
-- `anon` through PostgreSQL's default PUBLIC grant. This suite locks the
-- repaired boundary on the local scratch instance:
--   * internal import/export helpers are not anonymous;
--   * the deliberate anonymous projections keep their grants.
-- Run by scripts/validate-db-local.sh.
-- =============================================================================

\set ON_ERROR_STOP on

do $$
begin
  assert not has_function_privilege('anon', 'app.data_import_flag_shared_contacts()', 'EXECUTE'),
    'anonymous callers must not run the shared-contact flag write';
  assert has_function_privilege('service_role', 'app.data_import_flag_shared_contacts()', 'EXECUTE'),
    'the service worker keeps the shared-contact flag command';

  assert not has_function_privilege('anon', 'app.data_import_batches_state_guard()', 'EXECUTE'),
    'the import trigger function is never directly callable';

  assert not has_function_privilege('anon', 'app.data_import_record_scan(uuid,integer,integer,jsonb,text,text)', 'EXECUTE'),
    'anonymous callers must not reach the import scan command';
  assert has_function_privilege('authenticated', 'app.data_import_record_scan(uuid,integer,integer,jsonb,text,text)', 'EXECUTE'),
    'the interactive administrator keeps the import scan command';
  assert has_function_privilege('service_role', 'app.data_import_record_scan(uuid,integer,integer,jsonb,text,text)', 'EXECUTE'),
    'the import worker keeps the import scan command';

  assert not has_function_privilege('anon', 'app.data_import_record_mapping(uuid,uuid,jsonb)', 'EXECUTE'),
    'anonymous callers must not reach the import mapping command';
  assert has_function_privilege('authenticated', 'app.data_import_record_mapping(uuid,uuid,jsonb)', 'EXECUTE'),
    'the interactive administrator keeps the import mapping command';

  assert not has_function_privilege('anon', 'app.data_export_allowed_columns(text)', 'EXECUTE'),
    'anonymous callers must not read the export catalog metadata';
  assert not has_function_privilege('anon', 'app.data_export_allowed_filters(text)', 'EXECUTE'),
    'anonymous callers must not read the export filter metadata';

  assert has_function_privilege('anon', 'app.documents_public_register()', 'EXECUTE'),
    'anonymous visitors keep the public document register projection';
  assert has_function_privilege('anon', 'app.admission_public_configuration(uuid)', 'EXECUTE'),
    'anonymous visitors keep the public admission configuration projection';
end
$$;

select 'SECURITY HARDENING PASSED' as result;
