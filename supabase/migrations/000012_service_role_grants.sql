-- =============================================================================
-- Forward-only: service-role execution grants for the outbox worker path.
--
-- plan.md §7 permits the secret-key client for "webhooks, outbox processing,
-- Auth administration, and controlled maintenance" — this migration grants
-- exactly those functions (claim/deliver/fail + the balance helper) to
-- service_role. The transactional DOMAIN commands (admissions_submit, …) are
-- deliberately NOT granted: they require an authenticated actor session.
-- =============================================================================
begin;

grant execute on function app.claim_outbox(int) to service_role;
grant execute on function app.mark_outbox_delivered(text) to service_role;
grant execute on function app.fail_outbox(text, text) to service_role;
grant execute on function app.invoice_balance(uuid) to service_role;

commit;
