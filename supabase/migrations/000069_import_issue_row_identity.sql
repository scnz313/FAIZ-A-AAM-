-- ---------------------------------------------------------------------------
-- 000069 — import issue row identity
--
-- The Resolve step of the school-data import wizard must act on the exact
-- uploaded row. `data_import_list_issues` exposed only `row_number`, so the
-- browser fabricated identifiers ("row-<n>") that can never match the uuid
-- the resolution command requires; every Accept/Skip was rejected. This
-- forward migration redefines the read projection to return the real
-- `row_id`. No table, RLS policy, or command signature changes.
-- ---------------------------------------------------------------------------

create or replace function app.data_import_list_issues(
  p_batch_id uuid,
  p_severity text default null
) returns setof jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'issueId', i.id, 'batchId', i.batch_id, 'rowId', i.row_id, 'rowNumber', i.row_number,
    'severity', i.severity, 'code', i.code, 'field', i.field,
    'message', i.message, 'resolutionHint', i.resolution_hint,
    'resolvedAtIso', i.resolved_at)
    from public.data_import_issues i
   where i.batch_id = p_batch_id
     and (p_severity is null or i.severity = p_severity)
     and app.is_staff_aal2() and app.has_role('system_administrator')
   order by i.severity, i.row_number
$$;

revoke all on function app.data_import_list_issues(uuid, text) from public;
grant execute on function app.data_import_list_issues(uuid, text) to authenticated;
