-- =============================================================================
-- Forward-only: `document_processing_events.document_id` becomes nullable.
--
-- The outbox worker records PDF job state (`generation_requested`) for
-- receipt/report generation BEFORE the provider adapter creates the object;
-- the document row may not exist yet (plan.md §6.12 job states).
-- =============================================================================
begin;

alter table public.document_processing_events alter column document_id drop not null;

commit;
