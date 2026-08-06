-- =============================================================================
-- Forward-only app-layer support:
-- `email_suppressions.created_by_account_id` becomes nullable so verified
-- webhook events (no user session) can record bounce/complaint suppressions;
-- the worker's `pdf.generate` job-state note also needs no user session.
-- =============================================================================
begin;

alter table public.email_suppressions alter column created_by_account_id drop not null;

commit;
