-- =============================================================================
-- 000103 — sheet-native result publication withdrawal
--
-- (Renumbered from 000102 to avoid a version collision with the concurrent
--  anonymous-document audit grant migration; independent forward migration.)
--
-- The live withdrawal command (`app.results_withdraw`, 000015) predates the
-- result-entry-sheet model (000028). It records a family-visible
-- `result_events` row keyed by the publication's `batch_id`, but a sheet-native
-- publication carries `batch_id = null` and `source_entry_sheet_id` instead, so
-- the insert violates `result_events.batch_id NOT NULL` and the whole
-- withdrawal transaction rolls back. No publication could be withdrawn once
-- results moved to entry sheets.
--
-- This forward migration makes the command complete for both models:
--   * `result_events` gains a nullable `entry_sheet_id` source and an
--     at-least-one-source check;
--   * a sheet-native withdrawal marks the source entry sheet `withdrawn`
--     (versioned history row, audited), marks the live publication withdrawn,
--     and supersedes the published report releases that carry that publication
--     so the family portal stops showing the withdrawn subject while the
--     retained rows stay auditable.
--
-- Legacy batch-linked publications keep their existing behavior byte for byte.
-- This migration is written but intentionally NOT applied to staging.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. result_events can be owned by an entry sheet instead of a legacy batch
-- ---------------------------------------------------------------------------
alter table public.result_events alter column batch_id drop not null;
alter table public.result_events
  add column if not exists entry_sheet_id uuid references public.result_entry_sheets(id) on delete restrict;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.result_events'::regclass
       and conname = 'result_events_source_required'
  ) then
    alter table public.result_events
      add constraint result_events_source_required check (batch_id is not null or entry_sheet_id is not null);
  end if;
end
$$;

create index if not exists result_events_entry_sheet_idx
  on public.result_events (entry_sheet_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Withdrawal handles both the legacy batch and the sheet-native source
-- ---------------------------------------------------------------------------
create or replace function app.results_withdraw(
  p_publication_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_publication public.result_publications%rowtype;
  v_sheet public.result_entry_sheets%rowtype;
  v_sheet_version int;
  v_release public.result_report_releases%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not (app.is_staff_aal2() and app.has_any_role(
      array['result_publisher', 'system_administrator'])) then
    raise exception 'result publisher role and aal2 required';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'withdrawal reason is required';
  end if;
  select * into v_publication from public.result_publications where id = p_publication_id for update;
  if v_publication.id is null then
    raise exception 'publication not found';
  end if;
  if v_publication.status = 'withdrawn' then
    return;                                    -- idempotent
  end if;

  update public.result_publications
     set status = 'withdrawn', withdrawn_at = now(), withdrawal_reason = trim(p_reason)
   where id = p_publication_id;

  /* The retained family-visible event must attach to whichever source the
     publication has (legacy batch or entry sheet). */
  insert into public.result_events
    (batch_id, entry_sheet_id, event_type, visible_to_family, copy)
  values
    (v_publication.batch_id, v_publication.source_entry_sheet_id, 'withdrawn', true, trim(p_reason));

  /* Sheet-native withdrawal is a new version of the sheet record: the
     published version is tombstoned, never deleted. */
  if v_publication.source_entry_sheet_id is not null then
    update public.result_entry_sheets
       set state = 'withdrawn', version = version + 1, updated_at = now()
     where id = v_publication.source_entry_sheet_id
     returning * into v_sheet;
    v_sheet_version := v_sheet.version;
    insert into public.result_entry_sheet_versions(sheet_id, version, state, note, actor_account_id)
    values (v_sheet.id, v_sheet_version, 'withdrawn', trim(p_reason), auth.uid());
  end if;

  /* A report release that still carries this publication can no longer be the
     current family-visible manifest; supersede it so the portal falls back to
     the corrected/rebuilt release instead of showing withdrawn marks. */
  for v_release in
    select r.*
      from public.result_report_releases r
     where r.status = 'published'
       and exists (
         select 1 from public.result_report_release_items ri
          where ri.release_id = r.id and ri.publication_id = p_publication_id
       )
     for update
  loop
    update public.result_report_releases
       set status = 'superseded', superseded_at = now()
     where id = v_release.id;
    insert into public.result_report_release_events(release_id, event_type, actor_account_id, reason)
    values (v_release.id, 'withdrawn', auth.uid(), trim(p_reason));
  end loop;

  perform app.record_audit('Results withdrawn', 'result_publication',
                           v_publication.reference, 'Success', 'reason=' || trim(p_reason));
  perform app.enqueue_outbox(
    'email.results_withdrawn:' || v_publication.reference, 'email.deliver',
    'result_publication', v_publication.reference, jsonb_build_object('channel', 'email'));
end
$$;

revoke all on function app.results_withdraw(uuid, text) from public;
grant execute on function app.results_withdraw(uuid, text) to authenticated;

commit;
