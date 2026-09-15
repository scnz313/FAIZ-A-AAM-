-- 000101 — Allow the export generation-release event type.
--
-- `data_export_release_generation` records a `generation_released` event
-- when a transient failure returns a claimed export to the queue, but the
-- event-type check constraint predates that state. Extend the constraint;
-- existing rows are unchanged.

begin;

alter table public.data_export_events
  drop constraint if exists data_export_events_event_type_check;
alter table public.data_export_events
  add constraint data_export_events_event_type_check
  check (event_type in ('requested', 'generation_started', 'ready', 'failed', 'expired', 'cancelled', 'generation_released'));

commit;
