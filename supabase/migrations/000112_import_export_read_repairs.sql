-- =============================================================================
-- 000112 — Import/export read repairs: paged import batch and issue lists,
--          report skipped-count consistency, export failure detail
--
-- Three verified read-layer defects from the imports/exports verification
-- loop (15 September 2026), reproduced against a scratch PostgreSQL 17
-- database built from migrations 000001–000111 plus the deterministic seed:
--
--   1. `app.data_import_list_batches` and `app.data_import_list_issues`
--      return every row for the school (10k-row import: ~2.9 MB of issues;
--      120 batches measured at 45 KB, 300 issues at 87 KB) while the
--      workspace caps rendering client-side at 50 rows / 100 issues. The
--      browser still downloads and parses the whole set. Two paged reads are
--      added — `app.data_import_list_batches_paginated(p_limit, p_offset)`
--      and `app.data_import_list_issues_paginated(p_batch_id, p_severity,
--      p_limit, p_offset)` — returning `{rows, total, nextOffset}` with
--      deterministic ordering (`created_at desc, id desc`; `severity,
--      row_number nulls last, id`). The existing set-returning functions are
--      left untouched for current callers; the workspace consumes the paged
--      shape and loads further pages on demand. Supporting indexes are added
--      for the batch ordering (the existing `(state, created_at)` index
--      cannot serve it) and for the failure-detail lookups below.
--
--   2. `app.data_import_report` counted `skippedCount` from `outcome =
--      'skipped'`, but rows resolved as skip/reject before commit persist
--      `status = 'skipped'` with a null outcome (000110 fixed only the stored
--      `commit_result`). A batch with one pre-commit skipped row reported
--      `commit_result.skippedCount = 1` and `report.skippedCount = 0`. The
--      report now counts `status = 'skipped'`, the same predicate 000110
--      uses, so the two summaries agree.
--
--   3. `app.data_export_list_paginated` returned request fields only, so a
--      failed export showed "failed" with no reason. The durable failure
--      record is `data_export_events.event_type = 'failed'` written by
--      `data_export_mark_failed`, but a worker that dies before recording —
--      or exhausts its retries at the queue layer — leaves the reason only
--      in `provider_jobs.last_error` (the `data_export_generate` queue) or,
--      on the legacy path, `outbox_events.last_error`; the request can even
--      stay stuck in `generating` with no visible signal at all. Each row now
--      carries `lastEventType`, `lastEventDetail` (bounded to 500 characters,
--      the existing write bound), and `failedAt`, read from the most recent
--      signal across request events, failed generation jobs, and failed
--      outbox events. `failedAt` is only set when that signal is a failure
--      (or the request itself is currently failed).
--
-- No table or data changes. Function signatures, SECURITY DEFINER,
-- `search_path = ''`, authorization checks, and grants are preserved or
-- restated below; the two new reads are granted to `authenticated` only and
-- raise for callers without the administrator profile and AAL2. Forward-only
-- from 000111. Validated and applied by the central process.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Supporting indexes for the paged reads and failure lookups
-- ---------------------------------------------------------------------------

-- The batch list orders by created_at desc, id desc; the 000044 index leads
-- with `state` and cannot serve that ordering.
create index if not exists data_import_batches_created_idx
  on public.data_import_batches (created_at desc, id desc);

-- Failure-detail fallbacks read the latest failed queue row per reference.
create index if not exists provider_jobs_target_failed_idx
  on public.provider_jobs (target_reference, job_kind)
  where status = 'failed';

create index if not exists outbox_events_target_failed_idx
  on public.outbox_events (target_reference)
  where status = 'failed';

-- ---------------------------------------------------------------------------
-- 2. Paged import batch list
-- ---------------------------------------------------------------------------

create or replace function app.data_import_list_batches_paginated(
  p_limit int default 50,
  p_offset int default 0
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_rows jsonb;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'the import batch list requires the system administrator and aal2';
  end if;

  select count(*) into v_total from public.data_import_batches;

  select coalesce(jsonb_agg(jsonb_build_object(
    'batchId', b.id, 'reference', b.reference, 'state', b.state, 'version', b.version,
    'sourceSystem', b.source_system, 'academicYearId', b.academic_year_id,
    'rowCount', b.row_count, 'errorCount', b.error_count, 'warningCount', b.warning_count,
    'createdAtIso', b.created_at, 'committedAtIso', b.committed_at)
    order by b.created_at desc, b.id desc), '[]'::jsonb) into v_rows
    from (
      select * from public.data_import_batches
       order by created_at desc, id desc
       limit v_limit offset v_offset
    ) b;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'nextOffset', case when v_offset + v_limit < v_total then v_offset + v_limit else null end);
end;
$$;

revoke all on function app.data_import_list_batches_paginated(int, int) from public, anon;
grant execute on function app.data_import_list_batches_paginated(int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Paged import issue list
-- ---------------------------------------------------------------------------

create or replace function app.data_import_list_issues_paginated(
  p_batch_id uuid,
  p_severity text default null,
  p_limit int default 100,
  p_offset int default 0
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_rows jsonb;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'the import issue list requires the system administrator and aal2';
  end if;
  if p_severity is not null and p_severity not in ('error', 'warning') then
    raise exception 'invalid issue severity';
  end if;
  if not exists (select 1 from public.data_import_batches where id = p_batch_id) then
    raise exception 'import batch not found';
  end if;

  select count(*) into v_total
    from public.data_import_issues i
   where i.batch_id = p_batch_id
     and (p_severity is null or i.severity = p_severity);

  select coalesce(jsonb_agg(jsonb_build_object(
    'issueId', i.id, 'batchId', i.batch_id, 'rowId', i.row_id, 'rowNumber', i.row_number,
    'severity', i.severity, 'code', i.code, 'field', i.field,
    'message', i.message, 'resolutionHint', i.resolution_hint,
    'resolvedAtIso', i.resolved_at)
    order by i.severity, i.row_number nulls last, i.id), '[]'::jsonb) into v_rows
    from (
      select * from public.data_import_issues
       where batch_id = p_batch_id
         and (p_severity is null or severity = p_severity)
       order by severity, row_number nulls last, id
       limit v_limit offset v_offset
    ) i;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'nextOffset', case when v_offset + v_limit < v_total then v_offset + v_limit else null end);
end;
$$;

revoke all on function app.data_import_list_issues_paginated(uuid, text, int, int) from public, anon;
grant execute on function app.data_import_list_issues_paginated(uuid, text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Import report: count every persisted skipped row
-- ---------------------------------------------------------------------------

create or replace function app.data_import_report(p_batch_id uuid)
returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'batchRef', b.reference, 'state', b.state, 'rowCount', b.row_count,
    'createdCount', (select count(*) from public.data_import_rows r where r.batch_id = b.id and r.outcome = 'create'),
    'updatedCount', (select count(*) from public.data_import_rows r where r.batch_id = b.id and r.outcome = 'update'),
    'unchangedCount', (select count(*) from public.data_import_rows r where r.batch_id = b.id and r.outcome = 'unchanged'),
    -- Rows resolved as skip/reject before commit persist status 'skipped'
    -- with a null outcome; this is the same predicate 000110 stores in
    -- commit_result.skippedCount.
    'skippedCount', (select count(*) from public.data_import_rows r where r.batch_id = b.id and r.status = 'skipped'),
    'errorCount', (select count(*) from public.data_import_rows r where r.batch_id = b.id and r.status in ('error','failed')),
    'committedAtIso', b.committed_at,
    'auditRef', (select ae.target_reference from public.audit_events ae
                  where ae.target_type = 'data_import_batch' and ae.target_reference = b.reference
                  order by ae.created_at desc limit 1))
    from public.data_import_batches b
   where b.id = p_batch_id
$$;

revoke all on function app.data_import_report(uuid) from public, anon;
grant execute on function app.data_import_report(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Export list: carry the latest failure reason
-- ---------------------------------------------------------------------------

create or replace function app.data_export_list_paginated(
  p_cursor text default null,
  p_limit int default 20
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_limit int := least(greatest(p_limit, 1), 100);
  v_cursor_ts timestamptz;
  v_cursor_ref text;
  v_rows jsonb;
  v_next text;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'the export list requires the system administrator and aal2';
  end if;

  if btrim(coalesce(p_cursor, '')) <> '' then
    -- Cursor format: <iso8601 created_at>|<reference>
    v_cursor_ts := split_part(p_cursor, '|', 1)::timestamptz;
    v_cursor_ref := split_part(p_cursor, '|', 2);
  end if;

  -- Order and limit the input rows first: `limit` must bound the page, not
  -- the single aggregate row the projection returns.
  select coalesce(jsonb_agg(jsonb_build_object(
    'requestId', r.id, 'reference', r.reference, 'domain', r.domain, 'state', r.state,
    'format', r.format, 'rowCount', r.row_count, 'purpose', r.purpose,
    'expiresAt', r.expires_at, 'createdAt', r.created_at,
    'lastEventType', r.last_signal_type,
    'lastEventDetail', r.last_signal_detail,
    'failedAt', case
      when r.last_signal_type = 'failed' then r.last_signal_at
      when r.state = 'failed' then r.updated_at
      else null end
  ) order by r.created_at desc, r.reference desc), '[]'::jsonb) into v_rows
    from (
      select x.*,
             le.event_type as last_signal_type,
             le.detail as last_signal_detail,
             le.created_at as last_signal_at
        from (
          select * from public.data_export_requests r
           where (v_cursor_ts is null
                  or (r.created_at, r.reference) < (v_cursor_ts, v_cursor_ref))
           order by r.created_at desc, r.reference desc
           limit v_limit + 1
        ) x
        -- Most recent signal for the request: a request event, a failed
        -- generation job (the worker died before recording an event), or a
        -- failed legacy outbox event. A tie prefers the explicit failure.
        left join lateral (
          select s.event_type, s.detail, s.created_at
            from (
              select e.event_type, left(e.detail, 500) as detail, e.created_at
                from public.data_export_events e
               where e.request_id = x.id
              union all
              select 'failed', left(j.last_error, 500), coalesce(j.finished_at, j.updated_at)
                from public.provider_jobs j
               where j.target_reference = x.reference
                 and j.job_kind = 'data_export_generate'
                 and j.status = 'failed'
              union all
              select 'failed', left(o.last_error, 500), o.updated_at
                from public.outbox_events o
               where o.target_reference = x.reference
                 and o.kind in ('data.export.generate', 'data_export_generate')
                 and o.status = 'failed'
            ) s
           order by s.created_at desc, (s.event_type = 'failed') desc
           limit 1
        ) le on true
    ) r;

  -- If we fetched more than the page size, a next page exists.
  if jsonb_array_length(v_rows) > v_limit then
    v_rows := v_rows - v_limit;
    select to_char(((v_rows -> (v_limit - 1)) ->> 'createdAt')::timestamptz, 'YYYY-MM-DD"T"HH24:MI:SS.USOF')
           || '|' || ((v_rows -> (v_limit - 1)) ->> 'reference') into v_next;
  else
    v_next := null;
  end if;

  return jsonb_build_object('rows', v_rows, 'nextCursor', v_next);
end;
$$;

revoke all on function app.data_export_list_paginated(text, int) from public, anon;
grant execute on function app.data_export_list_paginated(text, int) to authenticated;

commit;
