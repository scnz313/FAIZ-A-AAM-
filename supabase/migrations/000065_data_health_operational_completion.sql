-- =============================================================================
-- 000065 — Data-health workspace and operational hardening completion
--
-- Forward-only migration (plan.md Phase 11.5). Adds:
--   1. data_health_snapshots — persisted data-health check results.
--   2. app.data_health_check() — runs the operational health checks and
--      returns an overall status plus per-check detail.
--   3. app.data_health_snapshot() — runs the checks and persists a snapshot.
--   4. app.health_readiness() — a lightweight readiness probe for the health
--      endpoint (migration applied, key tables present, worker freshness).
--   5. recoverable_error_log — structured log of recoverable errors with a
--      suggested recovery action, for the operational workspace.
--
-- Never edit migrations 000001–000064.
-- =============================================================================

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Data health snapshot table
-- ---------------------------------------------------------------------------

create table if not exists public.data_health_snapshots (
  id                   uuid primary key default gen_random_uuid(),
  reference            text not null unique default app.new_ref('DHS'),
  snapshot_at          timestamptz not null default now(),
  checks               jsonb not null,        -- array of {check, status, detail, count}
  overall_status       text not null
                       check (overall_status in ('healthy', 'degraded', 'unhealthy')),
  created_by_account_id uuid references public.user_accounts(id) on delete set null
);

create index if not exists data_health_snapshots_snapshot_at_idx
  on public.data_health_snapshots (snapshot_at desc);

alter table public.data_health_snapshots enable row level security;

revoke all on public.data_health_snapshots from anon, authenticated;
grant select, insert on public.data_health_snapshots to service_role;
grant select on public.data_health_snapshots to authenticated;

create policy data_health_snapshots_service
  on public.data_health_snapshots for all to service_role
  using (true) with check (true);

-- Staff (AAL2 + system_administrator) may read snapshots.
create policy data_health_snapshots_staff_read
  on public.data_health_snapshots for select to authenticated
  using (app.is_staff_aal2() and app.has_role('system_administrator'));

-- ---------------------------------------------------------------------------
-- 2. Data health check function
-- ---------------------------------------------------------------------------
-- Runs a series of operational health checks and returns
-- { overallStatus, checks: [...], snapshotAt }. Each check reports a status
-- of 'healthy', 'warning', or 'critical' with a count and human detail.
-- overallStatus is 'unhealthy' if any check is critical, 'degraded' if any
-- check is a warning, otherwise 'healthy'. Staff-only (AAL2 + system_administrator).

create or replace function app.data_health_check()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_checks jsonb := '[]'::jsonb;
  v_overall text := 'healthy';
  v_students_without_enrollment int;
  v_guardians_without_links int;
  v_orphaned_documents int;
  v_stale_import_batches int;
  v_failed_exports int;
  v_expired_artifacts int;
  v_max_status text;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'data health checks require the system administrator and aal2';
  end if;

  -- Students with an active identity but no active enrollment placement.
  select count(*) into v_students_without_enrollment
    from public.students s
   where s.status = 'active'
     and not exists (
       select 1 from public.enrollments e
        where e.student_id = s.id
          and e.status = 'active'
          and (e.effective_to is null or e.effective_to > now())
     );

  -- Guardians with an active identity but no active link to any student.
  select count(*) into v_guardians_without_links
    from public.guardians g
   where g.status = 'active'
     and not exists (
       select 1 from public.guardian_student_links l
        where l.guardian_id = g.id
          and l.status = 'active'
          and (l.effective_to is null or l.effective_to > now())
     );

  -- Orphaned documents: owner_record_id no longer matches a record in the
  -- owning domain table. Only the known owner domains are checked; documents
  -- in unknown domains are not flagged (they may be system-owned).
  select count(*) into v_orphaned_documents
    from public.documents d
   where d.deleted_at is null
     and not exists (
       select 1
         from (values
           ('student',         null::uuid),
           ('guardian',        null::uuid),
           ('enrollment',      null::uuid),
           ('admission_application', null::uuid),
           ('invoice',         null::uuid),
           ('data_export_request',  null::uuid),
           ('data_import_batch',    null::uuid)
         ) as v(domain, dummy)
        where d.owner_domain = v.domain
          and exists (
            select 1 from public.students x where x.id = d.owner_record_id
            union all select 1 from public.guardians x where x.id = d.owner_record_id
            union all select 1 from public.enrollments x where x.id = d.owner_record_id
            union all select 1 from public.admission_applications x where x.id = d.owner_record_id
            union all select 1 from public.invoices x where x.id = d.owner_record_id
            union all select 1 from public.data_export_requests x where x.id = d.owner_record_id
            union all select 1 from public.data_import_batches x where x.id = d.owner_record_id
          )
     );

  -- Import batches stuck in a non-terminal state for more than 24 hours.
  select count(*) into v_stale_import_batches
    from public.data_import_batches b
   where b.state in ('uploaded','scanning','mapping','validating',
                     'needs_resolution','ready','committing')
     and b.created_at < now() - interval '24 hours';

  -- Export requests that ended in failure.
  select count(*) into v_failed_exports
    from public.data_export_requests r
   where r.state = 'failed';

  -- Ready exports whose artifact has expired but whose state was never
  -- transitioned to 'expired' (cleanup backlog).
  select count(*) into v_expired_artifacts
    from public.data_export_requests r
   where r.state = 'ready'
     and r.expires_at is not null
     and r.expires_at <= now();

  -- Assemble the check list. A non-zero count on an operational check is a
  -- warning; counts above the critical thresholds are critical.
  v_checks := v_checks
    || jsonb_build_object(
         'check', 'students_without_active_enrollments',
         'status', case when v_students_without_enrollment > 50 then 'critical'
                        when v_students_without_enrollment > 0 then 'warning'
                        else 'healthy' end,
         'count', v_students_without_enrollment,
         'detail', v_students_without_enrollment || ' active students have no active enrollment')
    || jsonb_build_object(
         'check', 'guardians_without_active_links',
         'status', case when v_guardians_without_links > 50 then 'critical'
                        when v_guardians_without_links > 0 then 'warning'
                        else 'healthy' end,
         'count', v_guardians_without_links,
         'detail', v_guardians_without_links || ' active guardians have no active link')
    || jsonb_build_object(
         'check', 'orphaned_documents',
         'status', case when v_orphaned_documents > 20 then 'critical'
                        when v_orphaned_documents > 0 then 'warning'
                        else 'healthy' end,
         'count', v_orphaned_documents,
         'detail', v_orphaned_documents || ' documents reference a missing owner record')
    || jsonb_build_object(
         'check', 'stale_import_batches',
         'status', case when v_stale_import_batches > 0 then 'critical' else 'healthy' end,
         'count', v_stale_import_batches,
         'detail', v_stale_import_batches || ' import batches pending more than 24 hours')
    || jsonb_build_object(
         'check', 'failed_export_requests',
         'status', case when v_failed_exports > 10 then 'critical'
                        when v_failed_exports > 0 then 'warning'
                        else 'healthy' end,
         'count', v_failed_exports,
         'detail', v_failed_exports || ' export requests failed')
    || jsonb_build_object(
         'check', 'expired_export_artifacts_not_cleaned',
         'status', case when v_expired_artifacts > 10 then 'critical'
                        when v_expired_artifacts > 0 then 'warning'
                        else 'healthy' end,
         'count', v_expired_artifacts,
         'detail', v_expired_artifacts || ' ready exports expired but not cleaned up');

  -- Roll up the overall status.
  select max(c ->> 'status') into v_max_status
    from jsonb_array_elements(v_checks) as c;
  if v_max_status = 'critical' then
    v_overall := 'unhealthy';
  elsif v_max_status = 'warning' then
    v_overall := 'degraded';
  else
    v_overall := 'healthy';
  end if;

  return jsonb_build_object(
    'overallStatus', v_overall,
    'checks', v_checks,
    'snapshotAt', now()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Data health snapshot function
-- ---------------------------------------------------------------------------
-- Runs app.data_health_check() and persists the result to
-- data_health_snapshots. Returns the persisted snapshot record as jsonb.
-- Staff-only (AAL2 + system_administrator); the check function already
-- enforces authorization, but we guard here too for defense in depth.

create or replace function app.data_health_snapshot()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
  v_overall text;
  v_checks jsonb;
  v_snapshot public.data_health_snapshots%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'data health snapshots require the system administrator and aal2';
  end if;

  v_result := app.data_health_check();
  v_overall := v_result ->> 'overallStatus';
  v_checks  := v_result -> 'checks';

  insert into public.data_health_snapshots (snapshot_at, checks, overall_status, created_by_account_id)
  values (now(), v_checks, v_overall, auth.uid())
  returning * into v_snapshot;

  perform app.record_audit('Data health snapshot recorded', 'data_health_snapshot',
                           v_snapshot.reference, 'Success', v_overall, 'System administrator');

  return jsonb_build_object(
    'reference', v_snapshot.reference,
    'snapshotAt', v_snapshot.snapshot_at,
    'overallStatus', v_snapshot.overall_status,
    'checks', v_snapshot.checks
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Health readiness probe
-- ---------------------------------------------------------------------------
-- A lightweight readiness check the health endpoint can call without AAL2
-- context. It confirms the migration layer is applied and that the key
-- operational tables are present, and reports worker freshness as null (the
-- application layer fills this from the outbox worker heartbeat). This
-- function is intentionally permissive: it never raises and always returns a
-- jsonb object so the health endpoint can render a structured response.

create or replace function app.health_readiness()
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tables jsonb;
begin
  select jsonb_build_object(
    'students',              exists(select 1 from pg_tables where schemaname = 'public' and tablename = 'students'),
    'guardians',             exists(select 1 from pg_tables where schemaname = 'public' and tablename = 'guardians'),
    'enrollments',           exists(select 1 from pg_tables where schemaname = 'public' and tablename = 'enrollments'),
    'documents',             exists(select 1 from pg_tables where schemaname = 'public' and tablename = 'documents'),
    'data_export_requests',  exists(select 1 from pg_tables where schemaname = 'public' and tablename = 'data_export_requests'),
    'data_import_batches',   exists(select 1 from pg_tables where schemaname = 'public' and tablename = 'data_import_batches'),
    'data_health_snapshots', exists(select 1 from pg_tables where schemaname = 'public' and tablename = 'data_health_snapshots'),
    'recoverable_error_log', exists(select 1 from pg_tables where schemaname = 'public' and tablename = 'recoverable_error_log')
  ) into v_tables;

  return jsonb_build_object(
    'migration', true,           -- this function existing means 000065 applied
    'tables', v_tables,
    'workerFresh', null          -- filled by the application layer from the outbox heartbeat
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Recoverable error log
-- ---------------------------------------------------------------------------
-- Structured log of recoverable errors (validation failures, retryable
-- provider errors, stale-state transitions) with a suggested recovery action.
-- Used by the operational workspace to surface actionable errors to staff.

create table if not exists public.recoverable_error_log (
  id                 uuid primary key default gen_random_uuid(),
  reference          text not null unique default app.new_ref('REL'),
  error_code         text not null,
  error_message      text not null,
  recoverable_action text not null,           -- suggested recovery action
  context            jsonb,                   -- additional context
  account_id         uuid references public.user_accounts(id) on delete set null,
  route              text,
  created_at         timestamptz not null default now(),
  resolved_at        timestamptz
);

create index if not exists recoverable_error_log_created_at_idx
  on public.recoverable_error_log (created_at desc);
create index if not exists recoverable_error_log_error_code_idx
  on public.recoverable_error_log (error_code);
create index if not exists recoverable_error_log_account_idx
  on public.recoverable_error_log (account_id)
  where account_id is not null;

alter table public.recoverable_error_log enable row level security;

revoke all on public.recoverable_error_log from anon, authenticated;
grant select, insert, update on public.recoverable_error_log to service_role;
grant select on public.recoverable_error_log to authenticated;

create policy recoverable_error_log_service
  on public.recoverable_error_log for all to service_role
  using (true) with check (true);

-- Staff (AAL2 + system_administrator) may read all recoverable errors.
create policy recoverable_error_log_staff_read
  on public.recoverable_error_log for select to authenticated
  using (app.is_staff_aal2() and app.has_role('system_administrator'));

-- A user may read their own recoverable errors (e.g. portal-side failures).
create policy recoverable_error_log_self_read
  on public.recoverable_error_log for select to authenticated
  using (account_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Execution surface
-- ---------------------------------------------------------------------------

revoke all on function app.data_health_check() from public, anon;
revoke all on function app.data_health_snapshot() from public, anon;
revoke all on function app.health_readiness() from public, anon;

grant execute on function app.data_health_check() to authenticated;
grant execute on function app.data_health_snapshot() to authenticated;
grant execute on function app.health_readiness() to authenticated;

commit;
