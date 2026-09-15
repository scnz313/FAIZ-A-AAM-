-- =============================================================================
-- 000107 — Anonymous RPC surface: default PUBLIC EXECUTE revoked
--
-- Read-only catalog evidence (security hardening pass, live project):
--
--   select p.proname
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'app' and has_function_privilege('anon', p.oid, 'EXECUTE');
--
-- returned ten functions. Three are deliberate anonymous projections
-- (`admission_public_configuration`, `documents_public_register`,
-- `public_notice_ids`) and keep their grants. The other seven inherited
-- PostgreSQL's default EXECUTE to PUBLIC because the creating migration
-- granted `authenticated` (or `service_role`) without revoking `public`:
--
--   1. `data_import_flag_shared_contacts()` is a SECURITY DEFINER write with
--      no authorization check at all. An anonymous PostgREST call could run
--      its guardian-contact flag update (verified: the `app` schema is
--      exposed and an anonymous OPTIONS/POST reaches the function). It is
--      called only by `app.data_import_commit` internally, so it is now
--      service-only.
--   2. `data_import_record_scan` and `data_import_record_mapping` self-check
--      `auth.uid()` and the system-administrator role, but they are internal
--      commands and must not sit on the anonymous surface. The scan caller is
--      the service-role outbox worker (000097) and the interactive
--      administrator; the mapping caller is the interactive administrator.
--   3. `data_import_batches_state_guard()` is a trigger function: it must
--      never be invocable as an RPC, and triggers do not check EXECUTE at
--      fire time, so revoking it breaks nothing.
--   4. `data_export_allowed_columns` / `data_export_allowed_filters` are
--      immutable metadata helpers used inside `app.data_export_request`.
--      They stay available to authenticated sessions but leave the anonymous
--      surface.
--
-- Forward-only from 000106. Never edit migrations 000001–000106. This file is
-- validated and applied by the central process; it is intentionally not
-- applied to staging by the implementing agent.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Shared-contact flag computation: service-internal only
-- ---------------------------------------------------------------------------

revoke all on function app.data_import_flag_shared_contacts() from public, anon, authenticated;
grant execute on function app.data_import_flag_shared_contacts() to service_role;

-- ---------------------------------------------------------------------------
-- 2. Import trigger function: never directly callable
-- ---------------------------------------------------------------------------

revoke all on function app.data_import_batches_state_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Import scan/mapping commands: authenticated staff and the worker only
-- ---------------------------------------------------------------------------

revoke all on function app.data_import_record_scan(uuid, integer, integer, jsonb, text, text) from public, anon;
grant execute on function app.data_import_record_scan(uuid, integer, integer, jsonb, text, text) to authenticated, service_role;

revoke all on function app.data_import_record_mapping(uuid, uuid, jsonb) from public, anon;
grant execute on function app.data_import_record_mapping(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Export catalog helpers: authenticated metadata, not anonymous
-- ---------------------------------------------------------------------------

revoke all on function app.data_export_allowed_columns(text) from public, anon;
grant execute on function app.data_export_allowed_columns(text) to authenticated, service_role;

revoke all on function app.data_export_allowed_filters(text) from public, anon;
grant execute on function app.data_export_allowed_filters(text) to authenticated, service_role;

commit;
