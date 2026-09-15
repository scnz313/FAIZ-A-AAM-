-- =============================================================================
-- 000108 — Scale hot paths and the public-register retention gate
--
-- From the 4k-student scale audit (15 September 2026):
--   1. `app.data_import_commit` (000098) loops import groups and matches rows
--      with `batch_id = ... and coalesce(normalized->>'familyKey', source_key)
--      = ...`. Without a matching index each group degrades to a filtered scan
--      of the whole batch, which is quadratic at 10k rows. The composite index
--      below lets the loop seek per group.
--   2. `app.has_role(text)` was VOLATILE, so the ~40 RLS policies that call it
--      re-evaluated it for every candidate row. `has_any_role`/`is_staff_aal2`
--      are already STABLE; making `has_role` STABLE matches them and lets the
--      planner evaluate it once per statement for constant arguments. A
--      statement-snapshot role answer is the correct semantics for RLS here.
--   3. `app.data_import_flag_shared_contacts()` probes `guardian_contacts` by
--      `(channel, value)` after every commit with no supporting index; add the
--      partial index it needs.
--   4. The public register projection must not list metadata for documents
--      whose retention has elapsed (the delivery route already refuses their
--      bytes). The retention/legal-hold gate now lives in the projection too.
--
-- Index-only and function-definition changes; no data changes, no behavior
-- changes other than the two documented improvements. Forward-only from
-- 000107. Validated and applied by the central process.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Import commit group lookup
-- ---------------------------------------------------------------------------

create index if not exists data_import_rows_batch_group_idx
  on public.data_import_rows (batch_id, (coalesce(normalized ->> 'familyKey', source_key)), status);

-- ---------------------------------------------------------------------------
-- 2. Stable role helper for RLS evaluation
-- ---------------------------------------------------------------------------

alter function app.has_role(text) stable;

-- ---------------------------------------------------------------------------
-- 3. Shared-contact flag scan
-- ---------------------------------------------------------------------------

create index if not exists guardian_contacts_channel_value_idx
  on public.guardian_contacts (channel, value)
  where state <> 'revoked';

-- ---------------------------------------------------------------------------
-- 4. Public register retention gate
-- ---------------------------------------------------------------------------

create or replace function app.documents_public_register()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(d) order by d.finalized_at desc, d.created_at desc), '[]'::jsonb)
  from (
    select d.reference, d.safe_filename, d.category, d.mime_type, d.size_bytes,
           d.created_at, d.finalized_at, d.retention_until, d.legal_hold_until
      from public.documents d
     where d.visibility = 'public_approved'
       and d.scan_status in ('clean', 'ready')
       and d.deleted_at is null
       and d.finalized_at is not null
       and d.owner_domain = 'school_document'
       and (d.retention_until is null or d.retention_until > now()
            or (d.legal_hold_until is not null and d.legal_hold_until > now()))
  ) d
$$;

revoke all on function app.documents_public_register() from public;
grant execute on function app.documents_public_register() to anon, authenticated, service_role;

commit;
