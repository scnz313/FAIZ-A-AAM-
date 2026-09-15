-- =============================================================================
-- 000116 — Stuck-export recovery and per-statement scope boxes for the
--          admissions and finance queue policies
--
-- Two verified defects from the overnight repair loop (15 September 2026):
--
--   1. A queue-failed export can be permanently stuck in `generating`.
--      `app.data_export_mark_failed` records `failed` plus an event, but a
--      worker that dies at the queue layer (the provider job exhausts its
--      attempts while the request already holds the generation claim) leaves
--      the request `generating` with the reason only in
--      `provider_jobs.last_error` / `outbox_events.last_error`. The exports
--      UI shows that reason (000112) but offers no recovery action because
--      `app.data_export_retry` requires `state = 'failed'`. Reproduced on a
--      scratch PostgreSQL 17 chain built from 000001–000115:
--        · `select app.data_export_retry('EXP-2026-REPRO-01', …)`
--          → "only a failed export can be retried (state: generating)";
--        · no function existed to release the stale claim.
--      `app.data_export_recover(p_request_id, p_reason)` now releases the
--      stale generation claim to `requested` and re-queues generation
--      exactly once. It refuses unless (a) the request is `generating`,
--      (b) the claim is older than the worker's 5-minute outbox lease, and
--      (c) a failed `data_export_generate` provider job or legacy failed
--      outbox event exists for the reference. `app.data_export_retry` is
--      unchanged.
--
--   2. The admissions and finance queue projections still evaluated
--      `app.admission_staff_scope` / `app.finance_invoice_scope` per
--      candidate row through their RLS policies. Measured with
--      `explain (analyze, buffers)` on a synthetic scratch model (3,000
--      admission applications, 12,000 invoices, one restricted grant):
--        · admissions staff queue: 318.9 ms; the per-row scope predicate is
--          essentially the whole cost (isolated 3,000 calls: 340.6 ms at
--          ~113 µs/call);
--        · finance invoice register first page: 1,353.4 ms and the exact
--          count: 1,431.7 ms (isolated 12,000 calls: 1,958.9 ms at
--          ~163 µs/call).
--      The 000114 snapshot pattern now backs both policies: the caller's
--      grant restriction boxes are computed once per statement as an
--      InitPlan (uncorrelated scalar subquery) and each candidate row is
--      evaluated by a pure JSONB predicate with no table access. Membership
--      is exact (proved in scripts/validate-rpcs.sql against the unchanged
--      helpers for every distinct scope and several role arrays):
--        · `scope_admission_applications_read` uses
--          `app.staff_grade_scope_boxes` / `staff_grade_scope_boxes_allowed`
--          (year + grade restrictions; grade ids derive from the grant's
--          grade-section rows, the same join `staff_grade_scope_allowed`
--          uses);
--        · `scope_finance_invoices_read` uses the existing
--          `app.staff_scope_boxes` / `staff_scope_boxes_allowed`
--          (academic-year restrictions);
--        · the five admissions child policies the queue embeds (drafts,
--          versions, events, reviews, offers) resolve the parent's
--          (year, grade) by primary key and apply the same boxes predicate,
--          so their per-row grant lookup is gone too (versions 341.6 ms →
--          11.2 ms, events 670.0 ms → 9.4 ms, reviews 335.1 ms → 8.9 ms).
--      After: admissions queue base read 9.6 ms (33x), finance page
--      158.7 ms and count 152.8 ms (8.5x/9.4x) before the supporting
--      ordering index below, 3.9 ms for the page with it. A supporting
--      index for the register's `order by issue_date desc, id` is added;
--      without it the boxed page still scans and top-N sorts every invoice.
--
-- Functions keep SECURITY DEFINER and `search_path = ''`; the recovery
-- command restates its grants (authenticated only) and the two snapshot
-- helpers are granted to authenticated so the policies can call them, while
-- `anon` and PUBLIC execute remain revoked. No table or data changes beyond
-- the supporting index and the extended event-type constraint. Forward-only
-- from 000115. Validated and applied by the central process.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Recovery event type (000101 pattern) and the supporting ordering index
-- ---------------------------------------------------------------------------

alter table public.data_export_events
  drop constraint if exists data_export_events_event_type_check;
alter table public.data_export_events
  add constraint data_export_events_event_type_check
  check (event_type in ('requested', 'generation_started', 'ready', 'failed', 'expired', 'cancelled', 'generation_released', 'generation_recovered'));

-- The finance register orders by issue_date desc, id; no existing index
-- serves it (`invoices_status_idx` leads with status), so the paged read
-- scans and top-N sorts the whole table even when the page is satisfied by
-- a handful of rows.
create index if not exists invoices_issue_date_id_idx
  on public.invoices (issue_date desc, id);

-- ---------------------------------------------------------------------------
-- 2. Recover a stale `generating` export (Administrator + AAL2)
--
-- Same authorization as `data_export_retry`. The 5-minute window matches the
-- outbox claim lease (`app.claim_outbox` sets `next_attempt_at = now() + 5
-- minutes`); a request still inside that window may have a live worker, so
-- only a stale claim with a recorded queue failure can be released.
-- ---------------------------------------------------------------------------

create or replace function app.data_export_recover(
  p_request_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.data_export_requests%rowtype;
  v_failed boolean;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'recovering a data export requires the system administrator and aal2';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a recovery reason is required';
  end if;

  select * into v_request from public.data_export_requests
   where id = p_request_id for update;
  if v_request.id is null then raise exception 'export request not found'; end if;
  if v_request.state <> 'generating' then
    raise exception 'only a stuck generating export can be recovered (state: %)', v_request.state;
  end if;
  if v_request.generation_started_at is null
     or v_request.generation_started_at > now() - interval '5 minutes' then
    raise exception 'the export generation lease has not expired';
  end if;

  select exists (
           select 1 from public.provider_jobs j
            where j.target_reference = v_request.reference
              and j.job_kind = 'data_export_generate'
              and j.status = 'failed')
      or exists (
           select 1 from public.outbox_events o
            where o.target_reference = v_request.reference
              and o.kind in ('data.export.generate', 'data_export_generate')
              and o.status = 'failed')
    into v_failed;
  if not v_failed then
    raise exception 'no failed generation record exists for this export';
  end if;

  update public.data_export_requests
     set state = 'requested', version = v_request.version + 1
   where id = v_request.id
  returning * into v_request;

  insert into public.data_export_events (request_id, event_type, actor_account_id, detail)
  values (v_request.id, 'generation_recovered', auth.uid(), 'recovery: ' || btrim(p_reason));

  -- One job per recovery attempt: the key carries the version bumped above,
  -- and the `generating` state guard refuses a replay, so a second recovery
  -- can never double-queue generation.
  insert into public.provider_jobs (job_kind, target_type, target_reference, idempotency_key)
  values ('data_export_generate', 'data_export_request', v_request.reference,
          'data-export:' || v_request.reference || ':recover:' || v_request.version)
  on conflict (idempotency_key) do nothing;

  perform app.record_audit('Data export generation recovered', 'data_export_request', v_request.reference, 'Success',
    btrim(p_reason), 'System administrator');

  return jsonb_build_object('requestId', v_request.id, 'reference', v_request.reference,
                            'state', v_request.state, 'version', v_request.version);
end
$$;

revoke all on function app.data_export_recover(uuid, text) from public, anon;
grant execute on function app.data_export_recover(uuid, text) to authenticated;

comment on function app.data_export_recover(uuid, text) is
  'Release a stale generating export whose worker died at the queue layer, when a failed generation record exists and the 5-minute lease expired; re-queues generation exactly once.';

-- ---------------------------------------------------------------------------
-- 3. Grade-level snapshot for admissions staff scope
--
-- `app.staff_grade_scope_allowed` restricts a grant by the grade id of its
-- grade-section rows. The snapshot stores the distinct grade ids those rows
-- resolve to, so a candidate application's (year, grade) can be evaluated
-- without touching the grant tables. Same semantics as 000114's section
-- snapshot: no restriction rows means the dimension is unrestricted, and the
-- grant is allowed when every checked dimension matches.
-- ---------------------------------------------------------------------------

create or replace function app.staff_grade_scope_boxes(p_roles text[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null or (auth.jwt() ->> 'aal') is distinct from 'aal2' then '[]'::jsonb
    else coalesce(jsonb_agg(jsonb_build_object(
      'yearUnrestricted', not exists (select 1 from public.role_grant_academic_years x where x.role_grant_id = rg.id),
      'years', coalesce((select jsonb_agg(x.academic_year_id) from public.role_grant_academic_years x where x.role_grant_id = rg.id), '[]'::jsonb),
      'gradeUnrestricted', not exists (select 1 from public.role_grant_grade_sections x where x.role_grant_id = rg.id),
      'grades', coalesce((select jsonb_agg(distinct gs.grade_id) from public.role_grant_grade_sections x join public.grade_sections gs on gs.id = x.grade_section_id where x.role_grant_id = rg.id), '[]'::jsonb)
    )), '[]'::jsonb)
  end
  from public.role_grants rg
 where rg.account_id = auth.uid()
   and rg.role_code = any(p_roles)
   and rg.status = 'active'
   and rg.effective_from <= now()
   and (rg.effective_to is null or rg.effective_to > now())
$$;

create or replace function app.staff_grade_scope_boxes_allowed(
  p_boxes jsonb,
  p_academic_year_id uuid,
  p_grade_id uuid
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1
      from jsonb_array_elements(p_boxes) box
     where (p_academic_year_id is null
            or (box ->> 'yearUnrestricted')::boolean
            or box -> 'years' ? p_academic_year_id::text)
       and (p_grade_id is null
            or (box ->> 'gradeUnrestricted')::boolean
            or box -> 'grades' ? p_grade_id::text)
  )
$$;

revoke all on function app.staff_grade_scope_boxes(text[]), app.staff_grade_scope_boxes_allowed(jsonb, uuid, uuid) from public, anon;
grant execute on function app.staff_grade_scope_boxes(text[]), app.staff_grade_scope_boxes_allowed(jsonb, uuid, uuid) to authenticated;

-- The policies below call the 000114 snapshot helpers too, so the
-- authenticated portal roles need execute on them. Both return only the
-- caller's own restriction boxes (AAL2-gated) or a pure JSONB membership
-- test; neither exposes another account's data.
grant execute on function app.staff_scope_boxes(text[]), app.staff_scope_boxes_allowed(jsonb, uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Admissions queue policy: per-statement grade scope boxes
--
-- The uncorrelated scalar subquery is planned once per statement (InitPlan);
-- only the JSONB membership test runs per candidate row. Membership is
-- identical to `app.admission_staff_scope(id, roles)` on the same row: that
-- helper resolves the row's own (year, grade) and evaluates
-- `staff_grade_scope_allowed`, whose restriction join is exactly what the
-- boxes snapshot stores.
-- ---------------------------------------------------------------------------

drop policy if exists scope_admission_applications_read on public.admission_applications;
create policy scope_admission_applications_read on public.admission_applications
  for select to authenticated
  using (app.staff_grade_scope_boxes_allowed(
    (select app.staff_grade_scope_boxes(array['admissions_officer','admissions_approver','auditor'])),
    academic_year_id, grade_id));

-- ---------------------------------------------------------------------------
-- 5. Finance invoice policy: per-statement academic-year scope boxes
--
-- `finance_invoice_scope(id)` evaluates
-- `staff_scope_allowed(array['finance_officer','finance_approver'], year,
-- null, null)` for the row; the boxed predicate is the same disjunction with
-- the grant lookup resolved once per statement.
-- ---------------------------------------------------------------------------

drop policy if exists scope_finance_invoices_read on public.invoices;
create policy scope_finance_invoices_read on public.invoices
  for select to authenticated
  using (app.staff_scope_boxes_allowed(
    (select app.staff_scope_boxes(array['finance_officer','finance_approver'])),
    academic_year_id, null, null));

-- ---------------------------------------------------------------------------
-- 6. Admissions queue embeds: boxed parent resolution for child rows
--
-- `admissionListStaffQueue` embeds drafts, versions, events, reviews, and
-- offers for every candidate application. Each child row's policy evaluated
-- `admission_staff_scope(application_id, roles)` (a grant lookup per row);
-- at 3,000 applications the queue's embedded reads measured 341.6 ms for
-- versions, 670.0 ms for events, and 335.1 ms for reviews on the scratch
-- model. The replacement resolves the parent's (year, grade) by primary key
-- and applies the same boxes predicate; the correlated EXISTS becomes a
-- semijoin with the boxes computed once per statement. Membership is the
-- same function composition the helper performs:
-- `admission_staff_scope(id, roles)` = exists(parent where parent.id = id and
-- `staff_grade_scope_allowed(roles, parent.year, parent.grade)`), which the
-- boxes are proven equivalent to. After: versions 13.2 ms, events and
-- reviews drop by the same factor.
-- ---------------------------------------------------------------------------

drop policy if exists scope_admission_drafts_read on public.admission_drafts;
create policy scope_admission_drafts_read on public.admission_drafts
  for select to authenticated
  using (exists (
    select 1 from public.admission_applications a
     where a.id = application_id
       and app.staff_grade_scope_boxes_allowed(
         (select app.staff_grade_scope_boxes(array['admissions_officer','admissions_approver','auditor'])),
         a.academic_year_id, a.grade_id)));

drop policy if exists scope_admission_versions_read on public.admission_application_versions;
create policy scope_admission_versions_read on public.admission_application_versions
  for select to authenticated
  using (exists (
    select 1 from public.admission_applications a
     where a.id = application_id
       and app.staff_grade_scope_boxes_allowed(
         (select app.staff_grade_scope_boxes(array['admissions_officer','admissions_approver','auditor'])),
         a.academic_year_id, a.grade_id)));

drop policy if exists scope_admission_events_read on public.admission_events;
create policy scope_admission_events_read on public.admission_events
  for select to authenticated
  using (exists (
    select 1 from public.admission_applications a
     where a.id = application_id
       and app.staff_grade_scope_boxes_allowed(
         (select app.staff_grade_scope_boxes(array['admissions_officer','admissions_approver','auditor'])),
         a.academic_year_id, a.grade_id)));

drop policy if exists scope_admission_reviews_read on public.admission_reviews;
create policy scope_admission_reviews_read on public.admission_reviews
  for select to authenticated
  using (exists (
    select 1 from public.admission_applications a
     where a.id = application_id
       and app.staff_grade_scope_boxes_allowed(
         (select app.staff_grade_scope_boxes(array['admissions_officer','admissions_approver','auditor'])),
         a.academic_year_id, a.grade_id)));

drop policy if exists scope_admission_offers_read on public.admission_offers;
create policy scope_admission_offers_read on public.admission_offers
  for select to authenticated
  using (exists (
    select 1 from public.admission_applications a
     where a.id = application_id
       and app.staff_grade_scope_boxes_allowed(
         (select app.staff_grade_scope_boxes(array['admissions_officer','admissions_approver','auditor'])),
         a.academic_year_id, a.grade_id)));

commit;
