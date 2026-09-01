-- =============================================================================
-- 000050 — Service-role execute grants for the claim dispatch boundary
--
-- The provider worker (service_role) binds claimant provider subjects via
-- app.guardian_claim_mark_dispatched; 000045 granted EXECUTE to
-- authenticated only, so the worker hit a permission denial.
-- =============================================================================

begin;

grant execute on function app.guardian_claim_mark_dispatched(text, uuid, text) to service_role;
grant execute on function app.data_export_mark_ready(text, int, uuid) to service_role;
grant execute on function app.data_export_mark_failed(text, text) to service_role;
grant execute on function app.data_import_store_rows(uuid, jsonb) to service_role;
grant execute on function app.data_import_record_issue(uuid, uuid, int, text, text, text, text, text) to service_role;

commit;
