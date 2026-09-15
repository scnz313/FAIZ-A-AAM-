-- 000096 — Import parse job must be enqueued for service-driven transitions.
--
-- Migration 000067 starts the import pipeline with a trigger on
-- public.documents: when a data-import source document becomes clean/ready,
-- the batch moves to 'scanning'. But 000062's state guard only enqueued the
-- `data_import_parse` outbox event when `auth.uid()` was present, and the
-- scan callback runs as the scanner service (no user session) — so every
-- Supabase-mode import stalled in 'scanning' with no parse job. The guard
-- keeps the source-document requirement and the idempotent event key; it no
-- longer requires a user session for the transition.

begin;

create or replace function app.data_import_batches_state_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preview jsonb;
begin
  -- (a) A batch must have a source document before it can be scanned.
  if new.state = 'scanning' and new.source_document_id is null then
    raise exception 'a private source document is required before scanning';
  end if;

  -- (b) Entering 'scanning' enqueues the parse job. The transition may be
  --     driven by an authenticated command or by the document scan trigger
  --     (service context); both must enqueue. The event key is idempotent.
  if (old.state is distinct from new.state) and new.state = 'scanning' then
    perform app.enqueue_outbox(
      'data_import_parse:' || new.id::text || ':v' || new.version::text,
      'data_import_parse',
      'data_import_batch',
      new.reference,
      jsonb_build_object('batchId', new.id, 'documentId', new.source_document_id,
                         'sourceSystem', new.source_system));
  end if;

  -- (c) When the batch enters 'ready', record an immutable preview digest so a
  --     later commit can detect drift between the confirmed preview and the
  --     state at which the operator approved the commit.
  if (old.state is distinct from new.state) and new.state = 'ready' then
    select app.data_import_preview(new.id) into v_preview;
    new.preview_digest := md5(v_preview::text);
    new.preview_computed_at := now();
  end if;

  return new;
end;
$$;

commit;
