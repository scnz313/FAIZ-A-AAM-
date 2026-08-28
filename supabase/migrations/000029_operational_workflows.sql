-- =============================================================================
-- 000029 — Slice 5 operational workflows
--
-- This migration completes the local, provider-neutral operational facades.
-- It deliberately does not add a payment provider, email/PDF worker, or
-- storage scanner.  Domain writes remain transactional, append-only where
-- history matters, optimistic-versioned, and idempotent where a browser
-- retry can repeat an intent.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Shared helpers and idempotency
-- ---------------------------------------------------------------------------

create or replace function app.slice5_idempotency(
  p_operation_key text,
  p_request_hash text,
  p_result jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.idempotency_records%rowtype;
begin
  if p_operation_key is null or length(btrim(p_operation_key)) < 3 then
    raise exception 'idempotency key is required';
  end if;
  select * into v_row from public.idempotency_records
   where operation_key = btrim(p_operation_key)
   for update;
  if v_row.id is not null then
    if v_row.request_hash <> coalesce(p_request_hash, '') then
      raise exception 'idempotency key was already used for another request';
    end if;
    return jsonb_build_object('replayed', true, 'result', v_row.result);
  end if;
  insert into public.idempotency_records(operation_key, request_hash, state, result)
  values (btrim(p_operation_key), coalesce(p_request_hash, ''), 'completed', p_result);
  return jsonb_build_object('replayed', false, 'result', p_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- Finance: provider-neutral local sandbox attempts, concessions, adjustments,
-- refunds, and reconciliation evidence.
-- ---------------------------------------------------------------------------

alter table public.payment_attempts
  add column if not exists provider_code text not null default 'sandbox',
  add column if not exists idempotency_key text,
  add column if not exists expected_version int not null default 1;
create unique index if not exists payment_attempts_idempotency_idx
  on public.payment_attempts (idempotency_key)
  where idempotency_key is not null;

alter table public.refund_requests
  add column if not exists idempotency_key text,
  add column if not exists request_hash text;
create unique index if not exists refund_requests_idempotency_idx
  on public.refund_requests(idempotency_key) where idempotency_key is not null;

alter table public.reconciliation_runs
  add column if not exists idempotency_key text,
  add column if not exists request_hash text;
create unique index if not exists reconciliation_runs_idempotency_idx
  on public.reconciliation_runs(idempotency_key) where idempotency_key is not null;

create table if not exists public.reconciliation_imports (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.reconciliation_runs(id) on delete cascade,
  idempotency_key text not null,
  request_hash text not null,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id,idempotency_key)
);
create index if not exists reconciliation_imports_run_idx on public.reconciliation_imports(run_id,created_at desc);
alter table public.reconciliation_imports enable row level security;
revoke all on public.reconciliation_imports from anon, authenticated;
create policy reconciliation_imports_staff_read on public.reconciliation_imports
  for select to authenticated using (app.staff_scope_allowed(array['finance_officer','finance_approver','auditor'],null,null,null));

alter table public.concessions
  add column if not exists requested_by_account_id uuid references public.user_accounts(id) on delete restrict,
  add column if not exists type text not null default 'concession',
  add column if not exists status text not null default 'approved',
  add column if not exists version int not null default 1,
  add column if not exists approved_at timestamptz;
alter table public.concessions drop constraint if exists concessions_status_check;
alter table public.concessions add constraint concessions_status_check
  check (status in ('requested', 'approved', 'rejected', 'posted'));
alter table public.concessions drop constraint if exists concessions_type_check;
alter table public.concessions add constraint concessions_type_check
  check (type in ('concession', 'adjustment', 'write_off'));
create index if not exists concessions_status_idx on public.concessions (status, created_at desc);

create table if not exists public.finance_adjustment_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default app.new_ref('ADJ'),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  kind text not null check (kind in ('concession', 'adjustment', 'write_off')),
  amount_paise bigint not null check (amount_paise > 0),
  reason text not null check (length(btrim(reason)) >= 3),
  requested_by_account_id uuid not null references public.user_accounts(id) on delete restrict,
  approved_by_account_id uuid references public.user_accounts(id) on delete restrict,
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'posted')),
  version int not null default 1,
  idempotency_key text unique,
  decided_at timestamptz,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_adjustment_invoice_idx
  on public.finance_adjustment_requests (invoice_id, created_at desc);
create trigger finance_adjustment_touch before update on public.finance_adjustment_requests
  for each row execute function app.touch_updated_at();
create trigger finance_adjustment_no_delete before delete on public.finance_adjustment_requests
  for each row execute function app.block_mutation();

create table if not exists public.reconciliation_evidence (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default app.new_ref('RCE'),
  run_id uuid not null references public.reconciliation_runs(id) on delete cascade,
  provider_code text not null default 'sandbox',
  provider_event_id text not null,
  provider_txn_id text,
  invoice_reference text,
  amount_paise bigint not null check (amount_paise > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  state text not null check (state in ('captured', 'failed', 'refunded', 'pending')),
  evidence jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  unique (run_id, provider_code, provider_event_id)
);
create index if not exists reconciliation_evidence_run_idx
  on public.reconciliation_evidence (run_id, imported_at);

alter table public.finance_adjustment_requests enable row level security;
alter table public.reconciliation_evidence enable row level security;
revoke all on public.finance_adjustment_requests, public.reconciliation_evidence from anon, authenticated;
create policy finance_adjustment_staff_read on public.finance_adjustment_requests
  for select to authenticated using (app.finance_invoice_scope(invoice_id) or exists (select 1 from public.invoices i where i.id=finance_adjustment_requests.invoice_id and app.staff_scope_allowed(array['auditor'],i.academic_year_id,null,null)));
create policy reconciliation_evidence_staff_read on public.reconciliation_evidence
  for select to authenticated using (
    (invoice_reference is not null and exists (select 1 from public.invoices i where i.reference=reconciliation_evidence.invoice_reference and (app.finance_invoice_scope(i.id) or app.staff_scope_allowed(array['auditor'],i.academic_year_id,null,null))))
    or (invoice_reference is null and app.staff_scope_allowed(array['finance_officer','finance_approver','auditor'], null, null, null))
  );
drop policy if exists scope_finance_reconciliation_read on public.reconciliation_runs;
create policy scope_finance_reconciliation_slice5_read on public.reconciliation_runs
  for select to authenticated using (
    app.staff_scope_allowed(array['finance_officer','finance_approver','auditor'], null, null, null)
    and (not exists (select 1 from public.reconciliation_evidence re where re.run_id=reconciliation_runs.id and re.invoice_reference is not null)
      or exists (select 1 from public.reconciliation_evidence re join public.invoices i on i.reference=re.invoice_reference where re.run_id=reconciliation_runs.id and app.finance_invoice_scope(i.id)))
  );

alter table public.reconciliation_exceptions
  add column if not exists evidence_id uuid references public.reconciliation_evidence(id) on delete set null,
  add column if not exists resolved_by_account_id uuid references public.user_accounts(id) on delete restrict,
  add column if not exists resolution_reason text,
  add column if not exists version int not null default 1,
  add column if not exists resolved_at timestamptz;

-- Provider-neutral contract shape used by the local sandbox.  A real provider
-- adapter may replace these operations in Slice 6; it never writes the ledger
-- directly.
create or replace function app.finance_actor_invoice_allowed(p_invoice_id uuid)
returns boolean language sql security definer set search_path = '' as $$
  select exists (
    select 1 from public.invoices i
     where i.id = p_invoice_id
       and (
         (i.applicant_ref is not null and exists (
           select 1 from public.admission_applications aa
            where aa.reference = i.applicant_ref and aa.owner_account_id = auth.uid()
         ))
         or (i.student_id is not null and app.guardian_has_capability(i.student_id, 'finance'))
         or app.finance_invoice_scope(i.id)
       )
  )
$$;

create or replace function app.finance_create_attempt_v2(
  p_invoice_ref text,
  p_amount_paise bigint,
  p_method text,
  p_idempotency_key text,
  p_provider_code text default 'sandbox'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_balance bigint;
  v_existing public.payment_attempts%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 3 then raise exception 'idempotency key is required'; end if;
  select * into v_existing from public.payment_attempts where idempotency_key = btrim(p_idempotency_key) for update;
  if v_existing.id is not null then
    if v_existing.invoice_id <> (select id from public.invoices where reference = p_invoice_ref) or v_existing.amount_paise <> p_amount_paise then
      raise exception 'idempotency key was already used for another payment attempt';
    end if;
    return jsonb_build_object('attemptRef', v_existing.reference, 'providerOrderRef', v_existing.provider_order_ref,
                              'status', v_existing.status, 'version', v_existing.expected_version, 'replayed', true);
  end if;
  select * into v_invoice from public.invoices where reference = p_invoice_ref;
  if v_invoice.id is null then raise exception 'invoice not found'; end if;
  if not app.finance_actor_invoice_allowed(v_invoice.id) then raise exception 'not authorized for this invoice'; end if;
  v_balance := app.invoice_balance(v_invoice.id);
  if v_balance <= 0 then raise exception 'invoice is already settled'; end if;
  if p_amount_paise is null or p_amount_paise <> v_balance then raise exception 'amount mismatch: attempt must equal the current balance (%)', v_balance; end if;
  if p_method is null or length(btrim(p_method)) = 0 then raise exception 'invalid payment method'; end if;
  insert into public.payment_attempts(invoice_id, method, amount_paise, provider_code, idempotency_key, provider_order_ref, status, expected_version)
  values (v_invoice.id, btrim(p_method), p_amount_paise, coalesce(nullif(btrim(p_provider_code),''),'sandbox'), btrim(p_idempotency_key), 'sbx_' || replace(gen_random_uuid()::text,'-',''), 'created', 1)
  returning * into v_attempt;
  return jsonb_build_object('attemptRef', v_attempt.reference, 'providerOrderRef', v_attempt.provider_order_ref,
                            'status', v_attempt.status, 'version', v_attempt.expected_version, 'replayed', false);
end;
$$;

create or replace function app.finance_refresh_attempt_v2(
  p_attempt_reference text,
  p_expected_version int default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_attempt public.payment_attempts%rowtype; v_invoice public.invoices%rowtype; v_next text;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  select * into v_attempt from public.payment_attempts where reference = p_attempt_reference for update;
  if v_attempt.id is null then raise exception 'attempt not found'; end if;
  if p_expected_version is not null and v_attempt.expected_version <> p_expected_version then raise exception 'payment attempt version mismatch (expected %, found %)', p_expected_version, v_attempt.expected_version; end if;
  select * into v_invoice from public.invoices where id = v_attempt.invoice_id;
  if not app.finance_actor_invoice_allowed(v_invoice.id) then raise exception 'not authorized for this attempt'; end if;
  if v_attempt.status in ('succeeded','failed','cancelled') then
    return jsonb_build_object('attemptRef',v_attempt.reference,'status',v_attempt.status,'version',v_attempt.expected_version,'replayed',true);
  end if;
  v_next := case v_attempt.status when 'created' then 'processing' when 'processing' then 'succeeded' when 'delayed' then 'succeeded' else v_attempt.status end;
  update public.payment_attempts set status = v_next, expected_version = expected_version + 1, updated_at = now() where id = v_attempt.id returning * into v_attempt;
  return jsonb_build_object('attemptRef',v_attempt.reference,'status',v_attempt.status,'version',v_attempt.expected_version,'replayed',false);
end;
$$;

create or replace function app.finance_request_adjustment(
  p_invoice_id uuid,
  p_amount_paise bigint,
  p_kind text,
  p_reason text,
  p_expected_invoice_version int,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_invoice public.invoices%rowtype; v_row public.finance_adjustment_requests%rowtype;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('finance_officer')) then raise exception 'finance officer role and aal2 required'; end if;
  if p_amount_paise is null or p_amount_paise <= 0 or p_kind not in ('concession','adjustment','write_off') then raise exception 'invalid adjustment'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'adjustment reason is required'; end if;
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if v_invoice.id is null then raise exception 'invoice not found'; end if;
  if not app.finance_invoice_scope(v_invoice.id) then raise exception 'finance invoice is outside the assigned academic-year scope'; end if;
  if p_expected_invoice_version is not null and v_invoice.version <> p_expected_invoice_version then raise exception 'invoice version mismatch (expected %, found %)', p_expected_invoice_version, v_invoice.version; end if;
  if p_idempotency_key is not null then select * into v_row from public.finance_adjustment_requests where idempotency_key = p_idempotency_key; end if;
  if v_row.id is not null then return jsonb_build_object('reference',v_row.reference,'id',v_row.id,'status',v_row.status,'version',v_row.version,'replayed',true); end if;
  insert into public.finance_adjustment_requests(invoice_id,kind,amount_paise,reason,requested_by_account_id,idempotency_key)
  values(p_invoice_id,p_kind,p_amount_paise,btrim(p_reason),auth.uid(),nullif(btrim(p_idempotency_key),'')) returning * into v_row;
  perform app.record_audit('Finance adjustment requested','finance_adjustment',v_row.reference,'Success',btrim(p_reason));
  return jsonb_build_object('reference',v_row.reference,'id',v_row.id,'status',v_row.status,'version',v_row.version,'replayed',false);
end;
$$;

create or replace function app.finance_approve_adjustment(
  p_adjustment_id uuid,
  p_expected_version int,
  p_approve boolean,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.finance_adjustment_requests%rowtype;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('finance_approver')) then raise exception 'finance approver role and aal2 required'; end if;
  select * into v_row from public.finance_adjustment_requests where id = p_adjustment_id for update;
  if v_row.id is null then raise exception 'adjustment not found'; end if;
  if not app.finance_invoice_scope(v_row.invoice_id) then raise exception 'finance adjustment is outside the assigned academic-year scope'; end if;
  if v_row.requested_by_account_id = auth.uid() then raise exception 'adjustment requires independent approval'; end if;
  if v_row.version <> p_expected_version then raise exception 'adjustment version mismatch (expected %, found %)', p_expected_version, v_row.version; end if;
  if v_row.status <> 'requested' then return jsonb_build_object('id',v_row.id,'reference',v_row.reference,'status',v_row.status,'version',v_row.version,'replayed',true); end if;
  update public.finance_adjustment_requests set status = case when p_approve then 'approved' else 'rejected' end, approved_by_account_id = auth.uid(), decided_at = now(), version = version + 1, updated_at = now() where id = v_row.id returning * into v_row;
  perform app.record_audit('Finance adjustment decision','finance_adjustment',v_row.reference,case when p_approve then 'Success' else 'Denied' end,coalesce(nullif(btrim(p_reason),''),'Adjustment decision'));
  return jsonb_build_object('id',v_row.id,'reference',v_row.reference,'status',v_row.status,'version',v_row.version,'replayed',false);
end;
$$;

create or replace function app.finance_post_adjustment(
  p_adjustment_id uuid,
  p_expected_version int,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.finance_adjustment_requests%rowtype; v_ledger public.ledger_entries%rowtype; v_invoice public.invoices%rowtype;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('finance_officer')) then raise exception 'finance officer role and aal2 required'; end if;
  select * into v_row from public.finance_adjustment_requests where id = p_adjustment_id for update;
  if v_row.id is null then raise exception 'adjustment not found'; end if;
  if not app.finance_invoice_scope(v_row.invoice_id) then raise exception 'finance adjustment is outside the assigned academic-year scope'; end if;
  if v_row.version <> p_expected_version then raise exception 'adjustment version mismatch (expected %, found %)', p_expected_version, v_row.version; end if;
  if v_row.status = 'posted' then select * into v_ledger from public.ledger_entries where invoice_id = v_row.invoice_id and reason like '%' || v_row.reference || '%' order by created_at desc limit 1; return jsonb_build_object('reference',v_row.reference,'status','posted','version',v_row.version,'ledgerReference',v_ledger.reference,'replayed',true); end if;
  if v_row.status <> 'approved' then raise exception 'adjustment is not approved'; end if;
  select * into v_invoice from public.invoices where id = v_row.invoice_id for update;
  insert into public.ledger_entries(invoice_id,entry_type,amount_paise,reason,created_by_account_id)
  values(v_row.invoice_id,case v_row.kind when 'write_off' then 'write_off' when 'concession' then 'concession' else 'adjustment' end,-v_row.amount_paise,v_row.reference || ': ' || v_row.reason,auth.uid()) returning * into v_ledger;
  update public.finance_adjustment_requests set status='posted', posted_at=now(), version=version+1, updated_at=now() where id=v_row.id returning * into v_row;
  update public.invoices set version=version+1 where id=v_invoice.id;
  perform app.record_audit('Finance adjustment posted','finance_adjustment',v_row.reference,'Success',v_row.reason);
  return jsonb_build_object('reference',v_row.reference,'status',v_row.status,'version',v_row.version,'ledgerReference',v_ledger.reference,'replayed',false);
end;
$$;

create or replace function app.finance_request_refund_v2(
  p_payment_id uuid,
  p_amount_paise bigint,
  p_reason text,
  p_expected_version int default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_payment public.payments%rowtype; v_request public.refund_requests%rowtype; v_used bigint; v_hash text;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('finance_officer')) then raise exception 'finance officer role and aal2 required'; end if;
  if p_amount_paise is null or p_amount_paise <= 0 or p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'refund amount and reason are required'; end if;
  v_hash:=p_payment_id::text||'|'||p_amount_paise::text||'|'||btrim(p_reason)||'|'||coalesce(p_expected_version::text,'');
  select * into v_payment from public.payments where id=p_payment_id;
  if v_payment.id is null then raise exception 'payment not found'; end if;
  if not exists (select 1 from public.payment_allocations pa where pa.payment_id=v_payment.id and app.finance_invoice_scope(pa.invoice_id)) then raise exception 'finance payment is outside the assigned academic-year scope'; end if;
  select coalesce(sum(rr.amount_paise),0) into v_used from public.refund_requests rr where rr.payment_id=p_payment_id and rr.status in ('requested','approved','processed');
  if p_amount_paise > v_payment.amount_paise - v_used then raise exception 'refund exceeds refundable amount'; end if;
  if p_idempotency_key is not null then
    select * into v_request from public.refund_requests where idempotency_key=btrim(p_idempotency_key) for update;
    if v_request.id is not null then
      if v_request.request_hash<>v_hash then raise exception 'idempotency key was already used for another refund request'; end if;
      return jsonb_build_object('id',v_request.id,'reference',v_request.reference,'status',v_request.status,'version',v_request.version,'replayed',true);
    end if;
  end if;
  insert into public.refund_requests(payment_id,requested_by_account_id,amount_paise,reason,version,idempotency_key,request_hash) values(p_payment_id,auth.uid(),p_amount_paise,btrim(p_reason),coalesce(p_expected_version,1),nullif(btrim(p_idempotency_key),''),v_hash) returning * into v_request;
  perform app.record_audit('Refund requested','refund_request',v_request.reference,'Success',v_request.reason);
  return jsonb_build_object('id',v_request.id,'reference',v_request.reference,'status',v_request.status,'version',v_request.version,'replayed',false);
end;
$$;

create or replace function app.finance_approve_refund(
  p_refund_request_id uuid,
  p_expected_version int,
  p_approve boolean,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_request public.refund_requests%rowtype;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('finance_approver')) then raise exception 'finance approver role and aal2 required'; end if;
  select * into v_request from public.refund_requests where id=p_refund_request_id for update;
  if v_request.id is null then raise exception 'refund request not found'; end if;
  if not exists (select 1 from public.payment_allocations pa where pa.payment_id=v_request.payment_id and app.finance_invoice_scope(pa.invoice_id)) then raise exception 'refund is outside the assigned academic-year scope'; end if;
  if v_request.requested_by_account_id=auth.uid() then raise exception 'refund requires independent approval'; end if;
  if v_request.version<>p_expected_version then raise exception 'refund request version mismatch (expected %, found %)',p_expected_version,v_request.version; end if;
  if v_request.status not in ('requested','approved') then return jsonb_build_object('id',v_request.id,'reference',v_request.reference,'status',v_request.status,'version',v_request.version,'replayed',true); end if;
  update public.refund_requests set status=case when p_approve then 'approved' else 'rejected' end, approver_account_id=auth.uid(), decided_at=now(), version=version+1, updated_at=now() where id=v_request.id returning * into v_request;
  perform app.record_audit('Refund decision','refund_request',v_request.reference,case when p_approve then 'Success' else 'Denied' end,coalesce(p_reason,'Refund decision'));
  return jsonb_build_object('id',v_request.id,'reference',v_request.reference,'status',v_request.status,'version',v_request.version,'replayed',false);
end;
$$;

create or replace function app.finance_post_refund(
  p_refund_request_id uuid,
  p_expected_version int,
  p_provider_ref text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_request public.refund_requests%rowtype; v_refund public.refunds%rowtype; v_payment public.payments%rowtype; v_alloc public.payment_allocations%rowtype; v_ledger public.ledger_entries%rowtype; v_invoice_id uuid;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('finance_officer')) then raise exception 'finance officer role and aal2 required'; end if;
  select * into v_request from public.refund_requests where id=p_refund_request_id for update;
  if v_request.id is null then raise exception 'refund request not found'; end if;
  if not exists (select 1 from public.payment_allocations pa where pa.payment_id=v_request.payment_id and app.finance_invoice_scope(pa.invoice_id)) then raise exception 'refund is outside the assigned academic-year scope'; end if;
  if v_request.version<>p_expected_version then raise exception 'refund request version mismatch (expected %, found %)',p_expected_version,v_request.version; end if;
  select * into v_refund from public.refunds where refund_request_id=v_request.id;
  if v_refund.id is not null and v_refund.status='confirmed' then return jsonb_build_object('id',v_refund.id,'reference',v_refund.reference,'status',v_refund.status,'version',v_request.version,'replayed',true); end if;
  if v_request.status<>'approved' then raise exception 'refund is not approved'; end if;
  select * into v_payment from public.payments where id=v_request.payment_id;
  select * into v_alloc from public.payment_allocations where payment_id=v_payment.id limit 1;
  v_invoice_id:=v_alloc.invoice_id;
  if v_refund.id is null then insert into public.refunds(refund_request_id,amount_paise,provider_ref,status) values(v_request.id,v_request.amount_paise,p_provider_ref,'confirmed') returning * into v_refund; else update public.refunds set status='confirmed',provider_ref=coalesce(p_provider_ref,provider_ref),updated_at=now() where id=v_refund.id returning * into v_refund; end if;
  insert into public.ledger_entries(invoice_id,entry_type,amount_paise,reason,created_by_account_id) values(v_invoice_id,'refund',v_request.amount_paise,v_request.reference || ': ' || v_request.reason,auth.uid()) returning * into v_ledger;
  update public.refund_requests set status='processed',version=version+1,updated_at=now() where id=v_request.id returning * into v_request;
  perform app.record_audit('Refund posted','refund_request',v_request.reference,'Success',v_request.reason);
  return jsonb_build_object('id',v_refund.id,'reference',v_refund.reference,'status',v_refund.status,'version',v_request.version,'ledgerReference',v_ledger.reference,'replayed',false);
end;
$$;

-- Compatibility names used by the frozen finance adapter contract.  They now
-- delegate to the versioned maker/checker request flow instead of returning a
-- missing-RPC placeholder.
create or replace function app.finance_apply_concession(
  p_invoice_id uuid,
  p_amount_paise bigint,
  p_reason text,
  p_type text default 'concession'
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  v := app.finance_request_adjustment(p_invoice_id,p_amount_paise,case when p_type in ('concession','adjustment','write_off') then p_type else 'concession' end,p_reason,null,null);
  return (v->>'id')::uuid;
end;
$$;

create or replace function app.finance_request_refund(
  p_payment_id uuid,
  p_amount_paise bigint,
  p_reason text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  v := app.finance_request_refund_v2(p_payment_id,p_amount_paise,p_reason,null,null);
  return (v->>'id')::uuid;
end;
$$;

create or replace function app.finance_reconciliation_start(
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_run public.reconciliation_runs%rowtype; v_hash text:='start';
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('finance_officer')) then raise exception 'finance officer role and aal2 required'; end if;
  if not exists (select 1 from public.invoices i where app.finance_invoice_scope(i.id)) then raise exception 'finance reconciliation is outside the assigned academic-year scope'; end if;
  if p_idempotency_key is not null then
    select * into v_run from public.reconciliation_runs where idempotency_key=btrim(p_idempotency_key) for update;
    if v_run.id is not null then
      if v_run.request_hash<>v_hash then raise exception 'idempotency key was already used for another reconciliation run'; end if;
      return jsonb_build_object('id',v_run.id,'reference',v_run.reference,'status',v_run.status,'version',1,'replayed',true);
    end if;
  end if;
  if v_run.id is not null then return jsonb_build_object('id',v_run.id,'reference',v_run.reference,'status',v_run.status,'version',1,'replayed',true); end if;
  insert into public.reconciliation_runs(status,summary,created_by_account_id,idempotency_key,request_hash) values('started','{"matched":0,"exceptions":0,"imported":0}'::jsonb,auth.uid(),nullif(btrim(p_idempotency_key),''),v_hash) returning * into v_run;
  perform app.record_audit('Reconciliation started','reconciliation_run',v_run.reference,'Success');
  return jsonb_build_object('id',v_run.id,'reference',v_run.reference,'status',v_run.status,'version',1,'replayed',false);
end;
$$;

create or replace function app.finance_reconciliation_import(
  p_run_id uuid,
  p_evidence jsonb,
  p_expected_version int default 1,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_run public.reconciliation_runs%rowtype; v_item jsonb; v_count int:=0; v_exceptions int:=0; v_event text; v_provider text; v_txn text; v_amount bigint; v_state text; v_invoice text; v_evidence public.reconciliation_evidence%rowtype; v_payment public.payments%rowtype; v_run_version int:=1; v_import public.reconciliation_imports%rowtype; v_hash text; v_result jsonb;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('finance_officer')) then raise exception 'finance officer role and aal2 required'; end if;
  select * into v_run from public.reconciliation_runs where id=p_run_id for update;
  if v_run.id is null then raise exception 'reconciliation run not found'; end if;
  v_hash:=coalesce(p_evidence,'null'::jsonb)::text||'|'||coalesce(p_expected_version::text,'');
  if p_idempotency_key is not null then
    select * into v_import from public.reconciliation_imports where run_id=p_run_id and idempotency_key=btrim(p_idempotency_key) for update;
    if v_import.id is not null then
      if v_import.request_hash<>v_hash then raise exception 'idempotency key was already used for another reconciliation import'; end if;
      return v_import.result;
    end if;
  end if;
  if v_run.status not in ('started','completed') then raise exception 'reconciliation run cannot be imported'; end if;
  if jsonb_typeof(p_evidence)<>'array' then raise exception 'reconciliation evidence must be an array'; end if;
  for v_item in select value from jsonb_array_elements(p_evidence) loop
    v_event:=nullif(v_item->>'providerEventId',''); v_provider:=coalesce(nullif(v_item->>'providerCode',''),'sandbox'); v_txn:=nullif(v_item->>'providerTxnId',''); v_amount:=(v_item->>'amountPaise')::bigint; v_state:=coalesce(nullif(v_item->>'state',''),'pending'); v_invoice:=nullif(v_item->>'invoiceReference','');
    if v_event is null or v_amount is null or v_amount<=0 or v_state not in ('captured','failed','refunded','pending') then raise exception 'invalid reconciliation evidence'; end if;
    insert into public.reconciliation_evidence(run_id,provider_code,provider_event_id,provider_txn_id,invoice_reference,amount_paise,state,evidence) values(p_run_id,v_provider,v_event,v_txn,v_invoice,v_amount,v_state,v_item) on conflict (run_id,provider_code,provider_event_id) do nothing returning * into v_evidence;
    if v_evidence.id is null then continue; end if;
    v_count:=v_count+1;
    if v_state='captured' then
      select p.* into v_payment from public.payments p where p.provider_txn_id=v_txn;
      if v_payment.id is null or v_payment.amount_paise<>v_amount then
        insert into public.reconciliation_exceptions(run_id,evidence_id,kind,detail) values(p_run_id,v_evidence.id,'gateway_only_or_amount_mismatch',v_item); v_exceptions:=v_exceptions+1;
      else update public.reconciliation_runs set summary=coalesce(summary,'{}'::jsonb) || jsonb_build_object('matched',coalesce((summary->>'matched')::int,0)+1) where id=p_run_id; end if;
    elsif v_state in ('failed','pending') then
      insert into public.reconciliation_exceptions(run_id,evidence_id,kind,detail) values(p_run_id,v_evidence.id,'pending_or_failed',v_item); v_exceptions:=v_exceptions+1;
    end if;
  end loop;
  update public.reconciliation_runs set summary=coalesce(summary,'{}'::jsonb) || jsonb_build_object('imported',v_count,'exceptions',coalesce((summary->>'exceptions')::int,0)+v_exceptions),status='completed' where id=p_run_id returning * into v_run;
  perform app.record_audit('Reconciliation evidence imported','reconciliation_run',v_run.reference,'Success');
  v_result:=jsonb_build_object('id',v_run.id,'reference',v_run.reference,'status',v_run.status,'version',v_run_version,'imported',v_count,'exceptions',v_exceptions,'replayed',false);
  if p_idempotency_key is not null then insert into public.reconciliation_imports(run_id,idempotency_key,request_hash,result) values(p_run_id,btrim(p_idempotency_key),v_hash,v_result); end if;
  return v_result;
end;
$$;

create or replace function app.finance_reconciliation_resolve(
  p_exception_id uuid,
  p_resolution_reason text,
  p_expected_version int,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_exception public.reconciliation_exceptions%rowtype;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('finance_officer')) then raise exception 'finance officer role and aal2 required'; end if;
  if p_resolution_reason is null or length(btrim(p_resolution_reason))<3 then raise exception 'reconciliation resolution reason is required'; end if;
  select * into v_exception from public.reconciliation_exceptions where id=p_exception_id for update;
  if v_exception.id is null then raise exception 'reconciliation exception not found'; end if;
  if v_exception.version<>p_expected_version then raise exception 'reconciliation exception version mismatch (expected %, found %)',p_expected_version,v_exception.version; end if;
  if v_exception.status='resolved' then return jsonb_build_object('id',v_exception.id,'status','resolved','version',v_exception.version,'replayed',true); end if;
  update public.reconciliation_exceptions set status='resolved',resolved_by_account_id=auth.uid(),resolution_reason=btrim(p_resolution_reason),resolved_at=now(),version=version+1 where id=v_exception.id returning * into v_exception;
  perform app.record_audit('Reconciliation exception resolved','reconciliation_exception',v_exception.id::text,'Success',v_exception.resolution_reason);
  return jsonb_build_object('id',v_exception.id,'status',v_exception.status,'version',v_exception.version,'replayed',false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Content: structured bodies, checker approval, effective scheduling, and
-- immutable version/idempotency guards.
-- ---------------------------------------------------------------------------

alter table public.content_items
  add column if not exists version int not null default 0,
  add column if not exists current_version_id uuid,
  add column if not exists owner_account_id uuid references public.user_accounts(id) on delete restrict;
alter table public.content_versions
  add column if not exists reviewed_by_account_id uuid references public.user_accounts(id) on delete restrict,
  add column if not exists approved_at timestamptz,
  add column if not exists idempotency_key text;
alter table public.notices
  add column if not exists scheduled_at timestamptz,
  add column if not exists starts_at timestamptz,
  add column if not exists unpublished_at timestamptz,
  add column if not exists published_by_account_id uuid references public.user_accounts(id) on delete restrict,
  add column if not exists approved_by_account_id uuid references public.user_accounts(id) on delete restrict;
create unique index if not exists content_versions_idempotency_idx on public.content_versions(idempotency_key) where idempotency_key is not null;

create or replace function app.content_validate_body(p_body jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
begin
  if p_body is null or jsonb_typeof(p_body) <> 'object' then raise exception 'content body must be a JSON object'; end if;
  if not (p_body ? 'blocks') then raise exception 'content body must include blocks'; end if;
  if jsonb_typeof(p_body->'blocks') <> 'array' then raise exception 'content blocks must be an array'; end if;
  if exists (select 1 from jsonb_array_elements(p_body->'blocks') block where jsonb_typeof(block)<>'object' or not (block ? 'type') or not (block ? 'text')) then raise exception 'content blocks require type and text'; end if;
  return p_body;
end;
$$;

create or replace function app.content_save_draft_v2(
  p_content_item_id uuid,
  p_kind text,
  p_slug text,
  p_title text,
  p_body jsonb,
  p_expected_version int default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_item public.content_items%rowtype; v_version public.content_versions%rowtype; v_next int; v_existing public.content_versions%rowtype;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('content_editor')) then raise exception 'content editor role and aal2 required'; end if;
  perform app.content_validate_body(p_body);
  if p_idempotency_key is not null then select * into v_existing from public.content_versions where idempotency_key=p_idempotency_key; if v_existing.id is not null then return jsonb_build_object('id',v_existing.content_item_id,'versionId',v_existing.id,'version',v_existing.version,'status',v_existing.review_status,'replayed',true); end if; end if;
  if p_content_item_id is null then insert into public.content_items(kind,slug,current_status,owner_account_id) values(coalesce(p_kind,'notice'),btrim(p_slug),'draft',auth.uid()) returning * into v_item; else select * into v_item from public.content_items where id=p_content_item_id for update; if v_item.id is null then raise exception 'content item not found'; end if; if p_expected_version is not null and v_item.version<>p_expected_version then raise exception 'content version mismatch (expected %, found %)',p_expected_version,v_item.version; end if; end if;
  v_next:=v_item.version+1;
  insert into public.content_versions(content_item_id,version,title,body,author_account_id,review_status,idempotency_key) values(v_item.id,v_next,btrim(p_title),p_body,auth.uid(),'draft',nullif(btrim(p_idempotency_key),'')) returning * into v_version;
  update public.content_items set current_status='draft',version=v_next,current_version_id=v_version.id where id=v_item.id;
  if coalesce(p_kind,'notice')='notice' then
    insert into public.notices(content_item_id,status) values(v_item.id,'draft') on conflict (content_item_id) do nothing;
  end if;
  return jsonb_build_object('id',v_item.id,'reference',v_item.reference,'versionId',v_version.id,'version',v_next,'status','draft','replayed',false);
end;
$$;

create or replace function app.content_request_review(
  p_version_id uuid,
  p_expected_version int default null,
  p_idempotency_key text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_version public.content_versions%rowtype; v_item public.content_items%rowtype; v_next public.content_versions%rowtype; v_next_number int;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('content_editor')) then raise exception 'content editor role and aal2 required'; end if;
  select * into v_version from public.content_versions where id=p_version_id; if v_version.id is null then raise exception 'content version not found'; end if;
  if p_expected_version is not null and v_version.version<>p_expected_version then raise exception 'content version mismatch (expected %, found %)',p_expected_version,v_version.version; end if;
  select * into v_item from public.content_items where id=v_version.content_item_id for update;
  if v_version.author_account_id<>auth.uid() and not app.has_role('system_administrator') then raise exception 'only the content editor may request review'; end if;
  if p_idempotency_key is not null then select * into v_next from public.content_versions where idempotency_key=p_idempotency_key; end if;
  if v_next.id is null then
    select coalesce(max(version),0)+1 into v_next_number from public.content_versions where content_item_id=v_version.content_item_id;
    insert into public.content_versions(content_item_id,version,title,body,author_account_id,review_status,idempotency_key)
    values(v_version.content_item_id,v_next_number,v_version.title,v_version.body,v_version.author_account_id,'in_review',nullif(btrim(p_idempotency_key),'')) returning * into v_next;
  end if;
  update public.content_items set current_status='draft',version=v_next.version,current_version_id=v_next.id where id=v_item.id;
  perform app.record_audit('Content review requested','content_item',v_item.reference,'Success');
  return jsonb_build_object('id',v_next.id,'status','in_review','version',v_next.version,'replayed',v_next.id<>v_version.id);
end;
$$;

create or replace function app.content_approve_version(
  p_version_id uuid,
  p_expected_version int default null,
  p_idempotency_key text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_version public.content_versions%rowtype; v_item public.content_items%rowtype; v_next public.content_versions%rowtype; v_next_number int;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('content_publisher')) then raise exception 'content publisher role and aal2 required'; end if;
  select * into v_version from public.content_versions where id=p_version_id; if v_version.id is null then raise exception 'content version not found'; end if;
  if v_version.author_account_id=auth.uid() then raise exception 'publisher cannot approve their own edited version'; end if;
  if p_expected_version is not null and v_version.version<>p_expected_version then raise exception 'content version mismatch (expected %, found %)',p_expected_version,v_version.version; end if;
  if v_version.review_status not in ('in_review','approved') then raise exception 'content version is not in review'; end if;
  if p_idempotency_key is not null then select * into v_next from public.content_versions where idempotency_key=p_idempotency_key; end if;
  if v_next.id is null then
    select coalesce(max(version),0)+1 into v_next_number from public.content_versions where content_item_id=v_version.content_item_id;
    insert into public.content_versions(content_item_id,version,title,body,author_account_id,review_status,reviewed_by_account_id,approved_at,idempotency_key)
    values(v_version.content_item_id,v_next_number,v_version.title,v_version.body,v_version.author_account_id,'approved',auth.uid(),now(),nullif(btrim(p_idempotency_key),'')) returning * into v_next;
  end if;
  select * into v_item from public.content_items where id=v_version.content_item_id;
  perform app.record_audit('Content version approved','content_item',v_item.reference,'Success');
  return jsonb_build_object('id',v_next.id,'status',v_next.review_status,'version',v_next.version,'replayed',v_next.id<>v_version.id);
end;
$$;

create or replace function app.content_publish_version_v2(
  p_version_id uuid,
  p_expected_version int default null,
  p_scheduled_at timestamptz default null,
  p_expires_at timestamptz default null,
  p_idempotency_key text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_version public.content_versions%rowtype; v_item public.content_items%rowtype; v_notice public.notices%rowtype; v_next public.content_versions%rowtype; v_next_number int; v_status text;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('content_publisher')) then raise exception 'content publisher role and aal2 required'; end if;
  select * into v_version from public.content_versions where id=p_version_id; if v_version.id is null then raise exception 'content version not found'; end if;
  if v_version.author_account_id=auth.uid() then raise exception 'publisher cannot publish their own edited version'; end if;
  if p_expected_version is not null and v_version.version<>p_expected_version then raise exception 'content version mismatch (expected %, found %)',p_expected_version,v_version.version; end if;
  if v_version.review_status not in ('approved','published') then raise exception 'content version is not approved'; end if;
  select * into v_item from public.content_items where id=v_version.content_item_id for update;
  v_status:=case when p_scheduled_at is not null and p_scheduled_at>now() then 'scheduled' else 'published' end;
  if p_idempotency_key is not null then select * into v_next from public.content_versions where idempotency_key=p_idempotency_key; end if;
  if v_next.id is null then
    select coalesce(max(version),0)+1 into v_next_number from public.content_versions where content_item_id=v_version.content_item_id;
    insert into public.content_versions(content_item_id,version,title,body,author_account_id,review_status,published_at,idempotency_key)
    values(v_version.content_item_id,v_next_number,v_version.title,v_version.body,v_version.author_account_id,case when v_status='published' then 'published' else 'approved' end,case when v_status='published' then now() else null end,nullif(btrim(p_idempotency_key),'')) returning * into v_next;
  end if;
  update public.content_items set current_status=v_status,current_version_id=v_next.id,version=v_next.version where id=v_item.id;
  select * into v_notice from public.notices where content_item_id=v_item.id for update;
  if v_notice.id is not null then update public.notices set status=v_status,scheduled_at=p_scheduled_at,expires_at=p_expires_at,published_at=case when v_status='published' then now() else null end,published_by_account_id=case when v_status='published' then auth.uid() else null end where id=v_notice.id; end if;
  perform app.record_audit(case when v_status='published' then 'Content published' else 'Content scheduled' end,'content_item',v_item.reference,'Success');
  return jsonb_build_object('id',v_item.id,'reference',v_item.reference,'versionId',v_next.id,'version',v_next.version,'status',v_status,'replayed',v_next.id<>v_version.id);
end;
$$;

create or replace function app.content_expire_due()
returns int language plpgsql security definer set search_path = '' as $$
declare v_count int:=0; v_notice public.notices%rowtype; v_item public.content_items%rowtype;
begin
  for v_notice in select * from public.notices where status='published' and expires_at is not null and expires_at<=now() for update loop
    update public.notices set status='expired' where id=v_notice.id;
    update public.content_items set current_status='expired' where id=v_notice.content_item_id returning * into v_item;
    insert into public.audit_events(actor_label,action,target_type,target_reference,outcome,reason) values('Content scheduler','Notice expired','notice',v_notice.reference,'Success','Expiry reached');
    perform app.enqueue_outbox('content.expired:'||v_notice.reference,'email.deliver','notice',v_notice.reference,jsonb_build_object('channel','email'));
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

create or replace function app.content_publish_due()
returns int language plpgsql security definer set search_path = '' as $$
declare v_count int:=0; v_notice public.notices%rowtype; v_item public.content_items%rowtype; v_source public.content_versions%rowtype; v_next public.content_versions%rowtype; v_next_number int;
begin
  for v_notice in select * from public.notices where status='scheduled' and scheduled_at is not null and scheduled_at<=now() for update loop
    select * into v_item from public.content_items where id=v_notice.content_item_id for update;
    select * into v_source from public.content_versions where id=v_item.current_version_id;
    if v_source.id is null or v_source.review_status not in ('approved','published') then continue; end if;
    select coalesce(max(version),0)+1 into v_next_number from public.content_versions where content_item_id=v_item.id;
    insert into public.content_versions(content_item_id,version,title,body,author_account_id,review_status,published_at)
    values(v_item.id,v_next_number,v_source.title,v_source.body,v_source.author_account_id,'published',now()) returning * into v_next;
    update public.content_items set current_status='published',current_version_id=v_next.id,version=v_next.version where id=v_item.id;
    update public.notices set status='published',published_at=now(),published_by_account_id=null where id=v_notice.id;
    insert into public.audit_events(actor_label,action,target_type,target_reference,outcome,reason) values('Content scheduler','Notice published','notice',v_notice.reference,'Success','Scheduled publication reached its effective time');
    perform app.enqueue_outbox('content.scheduled_published:'||v_notice.reference||':'||v_next.version,'email.deliver','notice',v_notice.reference,jsonb_build_object('channel','email'));
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

create or replace function app.content_unpublish_v2(p_content_item_id uuid,p_reason text,p_expected_version int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_item public.content_items%rowtype; v_notice public.notices%rowtype;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('content_publisher')) then raise exception 'content publisher role and aal2 required'; end if;
  if p_reason is null or length(btrim(p_reason))<3 then raise exception 'unpublish reason is required'; end if;
  select * into v_item from public.content_items where id=p_content_item_id for update; if v_item.id is null then raise exception 'content item not found'; end if;
  if p_expected_version is not null and v_item.version<>p_expected_version then raise exception 'content version mismatch (expected %, found %)',p_expected_version,v_item.version; end if;
  update public.content_items set current_status='archived',version=version+1 where id=v_item.id;
  update public.notices set status='expired',unpublished_at=now() where content_item_id=v_item.id returning * into v_notice;
  perform app.record_audit('Content unpublished','content_item',v_item.reference,'Success',btrim(p_reason));
  return jsonb_build_object('id',v_item.id,'status','archived','version',v_item.version+1,'replayed',false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Support: anonymous first visible message, hashed rate limits, CAPTCHA
-- boundary, requester-safe projection, and complete staff lifecycle.
-- ---------------------------------------------------------------------------

alter table public.support_messages
  alter column author_account_id drop not null,
  add column if not exists author_label text,
  add column if not exists visibility text not null default 'requester';
alter table public.support_requests
  add column if not exists intake_key_hash text,
  add column if not exists captcha_provider text,
  add column if not exists captcha_verified_at timestamptz,
  add column if not exists resolution_code text;
create index if not exists support_intake_hash_idx on public.support_requests(intake_key_hash,created_at desc);

create or replace function app.support_public_intake_v2(
  p_category text,p_subject text,p_body text,p_contact text,p_requester_name text default null,
  p_intake_key_hash text default null,p_captcha_provider text default null,p_captcha_verified_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_request public.support_requests%rowtype; v_message public.support_messages%rowtype;
begin
  if length(btrim(coalesce(p_subject,'')))<1 or length(btrim(coalesce(p_body,'')))<1 then raise exception 'support subject and message are required'; end if;
  if length(btrim(coalesce(p_contact,'')))<5 then raise exception 'a safe contact is required'; end if;
  if p_captcha_verified_at is null or p_captcha_provider is null or length(btrim(p_captcha_provider))=0 then raise exception 'captcha verification is required'; end if;
  if p_intake_key_hash is not null and (select count(*) from public.support_requests where intake_key_hash=p_intake_key_hash and created_at>now()-interval '1 hour')>=5 then raise exception 'public support rate limit reached'; end if;
  insert into public.support_requests(requester_account_id,requester_name,requester_contact,public_intake_key,intake_key_hash,captcha_provider,captcha_verified_at,category,subject)
  values(auth.uid(),nullif(btrim(p_requester_name),''),btrim(p_contact),null,p_intake_key_hash,p_captcha_provider,p_captcha_verified_at,btrim(p_category),btrim(p_subject)) returning * into v_request;
  insert into public.support_messages(support_request_id,author_account_id,author_label,body,is_staff,visibility) values(v_request.id,nullif(auth.uid()::text,''),coalesce(nullif(btrim(p_requester_name),''),'Public requester'),btrim(p_body),false,'requester') returning * into v_message;
  insert into public.support_events(support_request_id,event_type,detail) values(v_request.id,'public_intake','initial requester message');
  if auth.uid() is not null then
    perform app.record_audit('Public support intake','support_request',v_request.reference,'Success');
  end if;
  return jsonb_build_object('id',v_request.id,'reference',v_request.reference,'status',v_request.status,'version',v_request.version);
end;
$$;

create or replace function app.support_respond_v2(p_request_id uuid,p_body text,p_private boolean default false,p_expected_version int default null,p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_request public.support_requests%rowtype;
begin
  if auth.uid() is null or p_body is null or length(btrim(p_body))=0 then raise exception 'message body is required'; end if;
  select * into v_request from public.support_requests where id=p_request_id for update; if v_request.id is null then raise exception 'request not found'; end if;
  if p_expected_version is not null and v_request.version<>p_expected_version then raise exception 'support version mismatch'; end if;
  if p_private then
    if not (app.is_staff_aal2() and app.has_role('support_officer')) then raise exception 'support officer role and aal2 required'; end if;
    insert into public.support_private_notes(support_request_id,author_account_id,body) values(p_request_id,auth.uid(),btrim(p_body));
  else
    if not ((v_request.requester_account_id=auth.uid()) or (app.is_staff_aal2() and app.has_role('support_officer'))) then raise exception 'not the request owner'; end if;
    insert into public.support_messages(support_request_id,author_account_id,author_label,body,is_staff,visibility) values(p_request_id,auth.uid(),case when app.is_staff_aal2() then 'School support' else 'Requester' end,btrim(p_body),app.is_staff_aal2(),'requester');
  end if;
  update public.support_requests set status=case when p_private then status when app.is_staff_aal2() then 'in_progress' else 'open' end,version=version+1,updated_at=now() where id=p_request_id returning * into v_request;
  perform app.record_audit(case when p_private then 'Support private note added' else 'Support responded' end,'support_request',v_request.reference,'Success');
  return jsonb_build_object('id',v_request.id,'reference',v_request.reference,'status',v_request.status,'version',v_request.version);
end;
$$;

create or replace function app.support_set_status(
  p_request_id uuid,p_status text,p_expected_version int,p_reason text default null,p_resolution_code text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_request public.support_requests%rowtype;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('support_officer')) then raise exception 'support officer role and aal2 required'; end if;
  if p_status not in ('open','assigned','in_progress','resolved','closed') then raise exception 'invalid support status'; end if;
  if p_status in ('resolved','closed') and length(btrim(coalesce(p_reason,'')))<3 then raise exception 'resolution reason is required'; end if;
  select * into v_request from public.support_requests where id=p_request_id for update; if v_request.id is null then raise exception 'request not found'; end if;
  if v_request.version<>p_expected_version then raise exception 'support version mismatch'; end if;
  update public.support_requests set status=p_status,resolved_at=case when p_status in ('resolved','closed') then now() else null end,resolution_code=nullif(btrim(p_resolution_code),''),version=version+1,updated_at=now() where id=p_request_id returning * into v_request;
  insert into public.support_events(support_request_id,event_type,detail,actor_account_id) values(v_request.id,'status_changed',p_status || coalesce(': '||btrim(p_reason),''),auth.uid());
  perform app.record_audit('Support status changed','support_request',v_request.reference,'Success',coalesce(p_reason,p_status));
  return jsonb_build_object('id',v_request.id,'reference',v_request.reference,'status',v_request.status,'version',v_request.version);
end;
$$;

-- ---------------------------------------------------------------------------
-- Settings: latest effective is distinct from latest draft; approval and
-- effective date are explicit, with optimistic versions.
-- ---------------------------------------------------------------------------

alter table public.settings_versions
  add column if not exists approved_by_account_id uuid references public.user_accounts(id) on delete restrict,
  add column if not exists approved_at timestamptz;
alter table public.settings_versions drop constraint if exists settings_versions_status_check;
alter table public.settings_versions add constraint settings_versions_status_check
  check (status in ('policy_pending', 'draft', 'approved', 'effective', 'superseded'));

create or replace function app.settings_read_effective()
returns jsonb language sql security definer set search_path = '' as $$
  select to_jsonb(s) from public.settings_versions s
   where app.is_staff_aal2() and app.has_role('system_administrator')
     and s.status='effective' and (s.effective_from is null or s.effective_from<=now())
   order by s.effective_from desc nulls last,s.version desc limit 1
$$;

create or replace function app.settings_read_latest()
returns jsonb language sql security definer set search_path = '' as $$
  select to_jsonb(s) from public.settings_versions s where app.is_staff_aal2() and app.has_role('system_administrator') order by s.version desc limit 1
$$;

create or replace function app.settings_save_v2(p_policy jsonb,p_reason text,p_expected_version int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_latest public.settings_versions%rowtype; v_new public.settings_versions%rowtype;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('system_administrator')) then raise exception 'system administrator role and aal2 required'; end if;
  if p_reason is null or length(btrim(p_reason))<3 then raise exception 'settings change reason is required'; end if;
  select * into v_latest from public.settings_versions order by version desc limit 1 for update;
  if coalesce(v_latest.version,0)<>p_expected_version then raise exception 'settings version mismatch (expected %, found %)',p_expected_version,coalesce(v_latest.version,0); end if;
  insert into public.settings_versions(version,status,policy,changed_by_account_id,change_reason) values(coalesce(v_latest.version,0)+1,'draft',coalesce(p_policy,'{}'::jsonb),auth.uid(),btrim(p_reason)) returning * into v_new;
  perform app.record_audit('Setting draft saved','settings_version',v_new.reference,'Success',btrim(p_reason));
  return jsonb_build_object('id',v_new.id,'reference',v_new.reference,'version',v_new.version,'status',v_new.status);
end;
$$;

create or replace function app.settings_approve(p_settings_id uuid,p_expected_version int,p_effective_from timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.settings_versions%rowtype; v_current public.settings_versions%rowtype;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('system_administrator')) then raise exception 'system administrator role and aal2 required'; end if;
  select * into v_row from public.settings_versions where id=p_settings_id for update; if v_row.id is null then raise exception 'settings version not found'; end if;
  if v_row.version<>p_expected_version then raise exception 'settings version mismatch (expected %, found %)',p_expected_version,v_row.version; end if;
  if v_row.changed_by_account_id=auth.uid() then raise exception 'settings approval requires an independent administrator'; end if;
  if v_row.status not in ('draft','effective') then raise exception 'settings version cannot be approved'; end if;
  select * into v_current from public.settings_versions where status='effective' order by version desc limit 1 for update;
  update public.settings_versions
     set status=case when coalesce(p_effective_from,now())>now() then 'approved' else 'effective' end,
         effective_from=coalesce(p_effective_from,now()), approved_by_account_id=auth.uid(), approved_at=now()
   where id=v_row.id returning * into v_row;
  if v_row.status='effective' and v_current.id is not null and v_current.id<>v_row.id then update public.settings_versions set status='superseded' where id=v_current.id; end if;
  perform app.record_audit('Settings approved','settings_version',v_row.reference,'Success');
  return jsonb_build_object('id',v_row.id,'reference',v_row.reference,'version',v_row.version,'status',v_row.status,'effectiveFrom',v_row.effective_from);
end;
$$;

create or replace function app.settings_effective_due()
returns int language plpgsql security definer set search_path = '' as $$
declare v_count int:=0; v_due public.settings_versions%rowtype; v_current public.settings_versions%rowtype;
begin
  select * into v_current from public.settings_versions where status='effective' order by version desc limit 1 for update;
  for v_due in select * from public.settings_versions where status='approved' and effective_from is not null and effective_from<=now() order by effective_from,version for update loop
    if v_current.id is not null and v_current.id<>v_due.id then update public.settings_versions set status='superseded' where id=v_current.id; end if;
    update public.settings_versions set status='effective' where id=v_due.id;
    v_current:=v_due; v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Users, audit, notifications, document projection
-- ---------------------------------------------------------------------------

alter table public.user_accounts
  add column if not exists mfa_status text not null default 'unknown',
  add column if not exists mfa_verified_at timestamptz;
alter table public.user_accounts drop constraint if exists user_accounts_mfa_status_check;
alter table public.user_accounts add constraint user_accounts_mfa_status_check
  check (mfa_status in ('unknown','required','pending','verified'));
alter table public.account_invitations
  add column if not exists intended_mfa_required boolean not null default true;
alter table public.in_app_notifications
  add column if not exists version int not null default 1,
  add column if not exists idempotency_key text,
  add column if not exists source_event_id uuid references public.outbox_events(id) on delete cascade;
create unique index if not exists in_app_notifications_idempotency_idx on public.in_app_notifications(idempotency_key) where idempotency_key is not null;
create unique index if not exists in_app_notifications_source_recipient_idx on public.in_app_notifications(source_event_id,recipient_account_id) where source_event_id is not null;
create index if not exists audit_events_action_idx on public.audit_events(action,created_at desc);

create or replace function app.project_notification_event(p_event_id uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_event public.outbox_events%rowtype;
  v_recipient uuid;
  v_recipients uuid[] := '{}';
  v_assignee uuid;
  v_count int := 0;
  v_title text;
  v_body text;
  v_target_type text;
  v_target_ref text;
begin
  select * into v_event from public.outbox_events where id=p_event_id;
  if v_event.id is null then return 0; end if;
  if v_event.kind like 'pdf.%' then return 0; end if;
  v_target_type:=v_event.target_type;
  v_target_ref:=v_event.target_reference;

  if v_target_type in ('admission_application','admission_applications','job_application','job_applications') then
    if v_target_type in ('admission_application','admission_applications') then select owner_account_id into v_recipient from public.admission_applications where reference=v_target_ref;
    else select owner_account_id into v_recipient from public.job_applications where reference=v_target_ref;
    end if;
    if v_recipient is not null then v_recipients:=array_append(v_recipients,v_recipient); end if;
  elsif v_target_type in ('support_request','support_requests') then
    select requester_account_id,assignee_account_id into v_recipient,v_assignee from public.support_requests where reference=v_target_ref;
    if v_recipient is not null then v_recipients:=array_append(v_recipients,v_recipient); end if;
    if v_assignee is not null then v_recipients:=array_append(v_recipients,v_assignee); end if;
  elsif v_target_type in ('guardian','guardians') then
    select ua.id into v_recipient from public.guardians g join public.people p on p.id=g.person_id join public.user_accounts ua on ua.person_id=p.id where g.id=(select id from public.guardians where reference=v_target_ref);
    if v_recipient is not null then v_recipients:=array_append(v_recipients,v_recipient); end if;
  elsif v_target_type in ('guardian_student_link','guardian_links','guardian_student_links') then
    select ua.id into v_recipient from public.guardian_student_links l join public.guardians g on g.id=l.guardian_id join public.user_accounts ua on ua.person_id=g.person_id where l.reference=v_target_ref;
    if v_recipient is not null then v_recipients:=array_append(v_recipients,v_recipient); end if;
  elsif v_target_type in ('student','students','result_report_release','result_report_releases') then
    if v_target_type in ('student','students') then
      select coalesce(array_agg(ua.id),'{}') into v_recipients from public.guardian_student_links l join public.guardians g on g.id=l.guardian_id join public.user_accounts ua on ua.person_id=g.person_id where l.student_id=(select id from public.students where reference=v_target_ref) and l.status='active';
    else
      select coalesce(array_agg(distinct ua.id),'{}') into v_recipients from public.result_report_releases r join public.guardian_student_links l on l.student_id=r.student_id and l.status='active' join public.guardians g on g.id=l.guardian_id join public.user_accounts ua on ua.person_id=g.person_id where r.reference=v_target_ref;
    end if;
  elsif v_target_type in ('invoice','invoices') then
    select coalesce(array_agg(distinct ua.id),'{}') into v_recipients from public.invoices i left join public.guardian_student_links l on l.student_id=i.student_id and l.status='active' left join public.guardians g on g.id=l.guardian_id left join public.user_accounts ua on ua.person_id=g.person_id where i.reference=v_target_ref and ua.id is not null;
  elsif v_target_type in ('user_account','user_accounts','staff_requester') then
    if (v_event.payload->>'accountId') ~* '^[0-9a-f-]{36}$' then v_recipients:=array_append(v_recipients,(v_event.payload->>'accountId')::uuid); end if;
  elsif v_target_type in ('account_invitation','account_invitations') then
    select created_by_account_id into v_recipient from public.account_invitations where reference=v_target_ref;
    if v_recipient is not null then v_recipients:=array_append(v_recipients,v_recipient); end if;
  end if;

  v_title:=case
    when v_event.kind like 'security.%' then 'Account security update'
    when v_event.kind like 'support.%' then 'Support request update'
    when v_event.kind like 'result.%' then 'Results update'
    when v_event.kind like 'timetable.%' then 'Timetable update'
    when v_event.kind like 'content.%' or v_event.kind like 'notice.%' then 'School notice update'
    when v_event.kind like 'finance.%' or v_event.kind like 'payment.%' then 'Finance update'
    else 'School account update' end;
  v_body:=case
    when v_event.kind like 'security.%' then 'Your account security status changed. Sign in to review the current status.'
    when v_event.kind like 'support.%' then 'Your support request has a new safe update. Sign in to review it.'
    when v_event.kind like 'result.%' then 'A results record has a new update. Sign in to review the published record.'
    when v_event.kind like 'timetable.%' then 'A timetable record has a new update. Sign in to review the current schedule.'
    when v_event.kind like 'finance.%' or v_event.kind like 'payment.%' then 'A finance record has a new update. Sign in to review the ledger.'
    else 'There is a new school account update. Sign in to review it.' end;

  foreach v_recipient in array v_recipients loop
    if v_recipient is null then continue; end if;
    insert into public.in_app_notifications(recipient_account_id,kind,title,body,target_type,target_reference,source_event_id,idempotency_key)
    values(v_recipient,v_event.kind,v_title,v_body,v_target_type,v_target_ref,p_event_id,'in_app:'||p_event_id::text||':'||v_recipient::text)
    on conflict do nothing;
    if found then v_count:=v_count+1; end if;
  end loop;
  return v_count;
end;
$$;

create or replace function app.project_notification_event_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform app.project_notification_event(new.id);
  exception when others then
    -- Notification projection is secondary work; a malformed/missing target
    -- must never abort the authoritative domain/outbox transaction.
    null;
  end;
  return new;
end;
$$;
drop trigger if exists outbox_project_notifications on public.outbox_events;
create trigger outbox_project_notifications after insert on public.outbox_events
  for each row execute function app.project_notification_event_trigger();

create or replace function app.accounts_mark_mfa_verified()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_account public.user_accounts%rowtype;
begin
  if auth.uid() is null or (auth.jwt() ->> 'aal') <> 'aal2' then raise exception 'aal2 verification is required'; end if;
  if not app.account_has_staff_grant() then raise exception 'staff MFA verification is required'; end if;
  select * into v_account from public.user_accounts where id=auth.uid() for update;
  if v_account.id is null or v_account.status<>'active' then raise exception 'active account not found'; end if;
  update public.user_accounts set mfa_status='verified',mfa_verified_at=now() where id=v_account.id returning * into v_account;
  perform app.record_audit('MFA verified','user_account',v_account.id::text,'Success');
  return jsonb_build_object('accountId',v_account.id,'status',v_account.mfa_status,'verifiedAt',v_account.mfa_verified_at);
end;
$$;

create or replace function app.users_admin_list()
returns jsonb language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(row_data order by row_data->>'name'), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', ua.id, 'status', ua.status, 'verified_contact', ua.verified_contact,
        'mfa_status', ua.mfa_status, 'mfa_verified_at', ua.mfa_verified_at,
        'name', p.display_name, 'staff_members', coalesce((select jsonb_agg(jsonb_build_object('id',sm.id,'reference',sm.reference,'title',sm.title,'employment_status',sm.employment_status)) from public.staff_members sm where sm.person_id=ua.person_id),'[]'::jsonb),
        'role_grants', coalesce((select jsonb_agg(jsonb_build_object('id',rg.id,'reference',rg.reference,'role_code',rg.role_code,'status',rg.status,'version',rg.version,'effective_from',rg.effective_from,'effective_to',rg.effective_to,'reason',rg.reason)) from public.role_grants rg where rg.account_id=ua.id),'[]'::jsonb),
        'invitations', coalesce((select jsonb_agg(jsonb_build_object('reference',ai.reference,'contact',ai.contact,'status',ai.status,'expires_at',ai.expires_at,'provider_state',ai.provider_state)) from public.account_invitations ai where ai.account_id=ua.id),'[]'::jsonb)
      ) as row_data
      from public.user_accounts ua join public.people p on p.id=ua.person_id
      where app.is_staff_aal2() and app.has_role('system_administrator')
      union all
      select jsonb_build_object(
        'id', null, 'status', ai.status, 'verified_contact', null,
        'mfa_status', 'not_applicable', 'mfa_verified_at', null,
        'name', ai.intended_display_name, 'staff_members', '[]'::jsonb,
        'role_grants', '[]'::jsonb,
        'invitations', jsonb_build_array(jsonb_build_object('reference',ai.reference,'contact',ai.contact,'status',ai.status,'expires_at',ai.expires_at,'provider_state',ai.provider_state,'role_code',ai.intended_role_code,'reason',ai.intended_reason))
      ) as row_data
      from public.account_invitations ai
      where app.is_staff_aal2() and app.has_role('system_administrator') and ai.purpose='staff' and ai.account_id is null and ai.status in ('pending','expired','revoked')
    ) rows
$$;

create or replace function app.notifications_mark_read(p_notification_id uuid,p_expected_version int default 1)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.in_app_notifications%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  select * into v_row from public.in_app_notifications where id=p_notification_id and recipient_account_id=auth.uid() for update;
  if v_row.id is null then raise exception 'notification not found'; end if;
  if v_row.version<>coalesce(p_expected_version,1) then raise exception 'notification version mismatch (expected %, found %)',p_expected_version,v_row.version; end if;
  if v_row.read_at is null then update public.in_app_notifications set read_at=now(),version=version+1 where id=v_row.id returning * into v_row; end if;
  return jsonb_build_object('id',v_row.id,'readAt',v_row.read_at,'version',v_row.version);
end;
$$;

create or replace function app.notifications_mark_all(p_expected_version int default null)
returns int language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  update public.in_app_notifications set read_at=now(),version=version+1 where recipient_account_id=auth.uid() and read_at is null and (p_expected_version is null or version=p_expected_version); get diagnostics v_count=row_count; return v_count;
end;
$$;

create or replace function app.audit_list_page(
  p_limit int default 50,p_cursor timestamptz default null,p_actor_account_id uuid default null,p_action text default null,p_target_type text default null,p_outcome text default null
) returns setof public.audit_events language sql security definer set search_path = '' as $$
  select ae.* from public.audit_events ae
   where app.is_staff_aal2() and (app.has_role('auditor') or app.has_role('system_administrator'))
     and (p_cursor is null or ae.created_at<p_cursor)
     and (p_actor_account_id is null or ae.actor_account_id=p_actor_account_id)
     and (p_action is null or ae.action=p_action)
     and (p_target_type is null or ae.target_type=p_target_type)
     and (p_outcome is null or ae.outcome=p_outcome)
   order by ae.created_at desc,ae.id desc limit least(greatest(coalesce(p_limit,50),1),100)
$$;

create or replace function app.documents_projection_list(p_owner_domain text default null,p_owner_record_id uuid default null)
returns setof jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('id',d.id,'reference',d.reference,'ownerDomain',d.owner_domain,'ownerReference',case
      when d.owner_domain='student' then (select s.reference from public.students s where s.id=d.owner_record_id)
      when d.owner_domain='invoice' then (select i.reference from public.invoices i where i.id=d.owner_record_id)
      when d.owner_domain='admission_application' then (select a.reference from public.admission_applications a where a.id=d.owner_record_id)
      when d.owner_domain='job_application' then (select j.reference from public.job_applications j where j.id=d.owner_record_id)
      else d.reference end,'category',d.category,'filename',d.safe_filename,'mimeType',d.mime_type,'sizeBytes',d.size_bytes,'checksum',d.checksum,'status',case when d.scan_status='clean' then 'ready' else d.scan_status end,'visibility',d.visibility,'version',d.version,'retentionClass',d.retention_class,'createdAt',d.created_at,'updatedAt',d.updated_at)
    from public.documents d
   where (
     app.document_staff_allowed(d.owner_domain,d.owner_record_id)
     or (
       d.scan_status in ('clean','ready') and (
         (d.owner_domain='student' and app.guardian_has_capability(d.owner_record_id,'documents'))
         or (d.owner_domain='invoice' and exists (select 1 from public.invoices i where i.id=d.owner_record_id and i.student_id is not null and app.guardian_has_capability(i.student_id,'documents')))
       )
     )
   )
   and (p_owner_domain is null or d.owner_domain=p_owner_domain)
   and (p_owner_record_id is null or d.owner_record_id=p_owner_record_id)
   order by d.created_at desc
$$;

-- Strict execution surface.  Existing legacy commands remain available for
-- the C2.4 compatibility tests; new UI calls use the v2 commands above.
revoke all on function app.slice5_idempotency(text,text,jsonb), app.accounts_mark_mfa_verified(), app.project_notification_event(uuid), app.finance_actor_invoice_allowed(uuid), app.finance_create_attempt_v2(text,bigint,text,text,text), app.finance_refresh_attempt_v2(text,int), app.finance_request_adjustment(uuid,bigint,text,text,int,text), app.finance_approve_adjustment(uuid,int,boolean,text), app.finance_post_adjustment(uuid,int,text), app.finance_request_refund_v2(uuid,bigint,text,int,text), app.finance_approve_refund(uuid,int,boolean,text), app.finance_post_refund(uuid,int,text), app.finance_reconciliation_start(text), app.finance_reconciliation_import(uuid,jsonb,int,text), app.finance_reconciliation_resolve(uuid,text,int,text), app.content_validate_body(jsonb), app.content_save_draft_v2(uuid,text,text,text,jsonb,int,text), app.content_request_review(uuid,int,text), app.content_approve_version(uuid,int,text), app.content_publish_version_v2(uuid,int,timestamptz,timestamptz,text), app.content_expire_due(), app.content_publish_due(), app.content_unpublish_v2(uuid,text,int), app.support_public_intake_v2(text,text,text,text,text,text,text,timestamptz), app.support_respond_v2(uuid,text,boolean,int,text), app.support_set_status(uuid,text,int,text,text), app.settings_read_effective(), app.settings_save_v2(jsonb,text,int), app.settings_approve(uuid,int,timestamptz), app.settings_effective_due(), app.notifications_mark_read(uuid,int), app.notifications_mark_all(int), app.audit_list_page(int,timestamptz,uuid,text,text,text), app.documents_projection_list(text,uuid) from public, anon, authenticated;
grant execute on function app.finance_actor_invoice_allowed(uuid), app.finance_create_attempt_v2(text,bigint,text,text,text), app.finance_refresh_attempt_v2(text,int), app.finance_request_adjustment(uuid,bigint,text,text,int,text), app.finance_approve_adjustment(uuid,int,boolean,text), app.finance_post_adjustment(uuid,int,text), app.finance_request_refund_v2(uuid,bigint,text,int,text), app.finance_request_refund(uuid,bigint,text), app.finance_apply_concession(uuid,bigint,text,text), app.finance_approve_refund(uuid,int,boolean,text), app.finance_post_refund(uuid,int,text), app.finance_reconciliation_start(text), app.finance_reconciliation_import(uuid,jsonb,int,text), app.finance_reconciliation_resolve(uuid,text,int,text) to authenticated;
grant execute on function app.content_validate_body(jsonb), app.content_save_draft_v2(uuid,text,text,text,jsonb,int,text), app.content_request_review(uuid,int,text), app.content_approve_version(uuid,int,text), app.content_publish_version_v2(uuid,int,timestamptz,timestamptz,text), app.content_unpublish_v2(uuid,text,int) to authenticated;
grant execute on function app.content_expire_due(), app.content_publish_due() to service_role;
grant execute on function app.support_public_intake_v2(text,text,text,text,text,text,text,timestamptz) to anon, authenticated;
grant execute on function app.support_respond_v2(uuid,text,boolean,int,text), app.support_set_status(uuid,text,int,text,text), app.settings_save_v2(jsonb,text,int), app.settings_approve(uuid,int,timestamptz), app.notifications_mark_read(uuid,int), app.notifications_mark_all(int), app.audit_list_page(int,timestamptz,uuid,text,text,text), app.documents_projection_list(text,uuid) to authenticated;
grant execute on function app.settings_read_effective(), app.settings_read_latest(), app.users_admin_list() to authenticated, service_role;
grant execute on function app.settings_effective_due() to service_role;
grant execute on function app.accounts_mark_mfa_verified() to authenticated;
grant execute on function app.project_notification_event(uuid) to service_role;

-- Rows are never written from the browser with broad INSERT/UPDATE grants.
revoke insert, update, delete on public.finance_adjustment_requests, public.reconciliation_evidence from anon, authenticated;
grant select on public.finance_adjustment_requests, public.reconciliation_evidence to authenticated;
grant select on public.reconciliation_imports to authenticated;

commit;
