-- =============================================================================
-- 000055 — Remove the Phase 9 debug helper
--
-- app.debug_session_context was a temporary diagnostic used while verifying
-- service-key session context during staging activation. It exposes session
-- internals and must not remain in the exposed app schema.
-- =============================================================================

begin;

revoke execute on function app.debug_session_context() from public, anon, authenticated, service_role;
drop function if exists app.debug_session_context();

commit;
