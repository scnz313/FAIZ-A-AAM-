-- Grant EXECUTE on app.new_ref to authenticated so DEFAULT clauses on
-- reference columns resolve during authenticated inserts (plan.md §7).
-- new_ref is used as the DEFAULT for reference columns on every application
-- table; the DEFAULT runs as the current user, so authenticated must hold
-- EXECUTE.  service_role was already granted in migration 000031.

begin;
grant execute on function app.new_ref(text, int) to authenticated;
commit;
