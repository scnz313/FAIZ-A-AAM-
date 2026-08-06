-- =============================================================================
-- Forward-only: service_role schema usage for the outbox worker path.
--
-- PostgREST requires USAGE on the exposed `app` schema for every API role.
-- `authenticated` was granted in B1; service_role (admin client, used by the
-- outbox worker and webhooks per plan.md §7) needs the same grant. Execution
-- on the domain commands stays revoked from service_role — only the worker
-- functions carry service_role EXECUTE (000012).
-- =============================================================================
begin;

grant usage on schema app to service_role;

commit;
