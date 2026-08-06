-- =============================================================================
-- B0 foundation — conventions, helpers, and operations tables (plan.md §5, §11 B0)
--
-- Conventions applied here and required by every later domain migration:
--   * UUID primary keys; separate random, non-sequential human references
--   * timestamptz in UTC; money as signed bigint paise + currency = 'INR'
--   * mutable operational records carry an integer `version`
--   * status columns are text with explicit CHECK constraints
--   * core relationships are foreign keys, not JSON
--   * append-only tables block UPDATE/DELETE with triggers
--   * RLS is enabled on every table; foundation tables deny direct access
--     until their domain phase ships policies (plan.md §7)
--   * privileged helpers live in the `app` schema with `search_path = ''`
--     and explicit auth checks (SECURITY DEFINER, plan.md §7)
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Private helper schema
-- ---------------------------------------------------------------------------
create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Reference generation: PREFIX-YYYY-XXXXXX (random, non-sequential)
-- Example: APP-2026-7K4M2Q. Never expose sequential counters as references.
-- ---------------------------------------------------------------------------
create or replace function app.new_ref(prefix text, ref_year int default null)
returns text
language sql
volatile
set search_path = ''
as $$
  select upper(prefix) || '-' || coalesce(ref_year, extract(year from now())::int)::text || '-' ||
         upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
$$;

-- ---------------------------------------------------------------------------
-- Mutable-record helpers
-- ---------------------------------------------------------------------------

-- Touch updated_at on UPDATE (domain tables opt in).
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- Optimistic concurrency pattern for domain commands (documented here once):
--   UPDATE domain_table
--      SET ..., version = version + 1
--    WHERE id = $id AND version = $expected_version
-- A zero-row result is the typed 409 conflict (plan.md §5.5); the caller
-- reloads the safe current state. Auto-bump triggers are NOT used so the
-- expected-version guard is the single source of truth.

-- ---------------------------------------------------------------------------
-- Append-only blocker (audit and other immutable rows)
-- ---------------------------------------------------------------------------
create or replace function app.block_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'append-only table: rows cannot be updated or deleted';
end
$$;

-- ===========================================================================
-- Operations tables (plan.md §11 B0 foundation set)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- audit_events — append-only safe actor/action/target/outcome evidence
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('AUD'),
  actor_account_id  uuid,                    -- auth.users.id when known
  actor_label       text not null,           -- safe display label, never secrets
  action            text not null,           -- e.g. 'Result published'
  target_type       text not null,           -- e.g. 'result_publication'
  target_reference  text not null,           -- public reference of the record
  outcome           text not null check (outcome in ('Success', 'Denied', 'Failed')),
  reason            text,
  correlation_id    uuid,
  created_at        timestamptz not null default now()
);

create index audit_events_created_idx on public.audit_events (created_at desc);
create index audit_events_target_idx on public.audit_events (target_type, target_reference);
create index audit_events_actor_idx on public.audit_events (actor_account_id);

create trigger audit_events_no_update
  before update on public.audit_events
  for each row execute function app.block_mutation();
create trigger audit_events_no_delete
  before delete on public.audit_events
  for each row execute function app.block_mutation();

-- ---------------------------------------------------------------------------
-- outbox_events — pending/processing/delivered/failed async work
-- ---------------------------------------------------------------------------
create table public.outbox_events (
  id                uuid primary key default gen_random_uuid(),
  event_key         text not null unique,   -- idempotency key: kind:target:version
  kind              text not null,          -- e.g. 'email.deliver', 'pdf.generate'
  target_type       text not null,
  target_reference  text not null,
  payload           jsonb not null default '{}'::jsonb,
  status            text not null default 'pending'
                    check (status in ('pending', 'processing', 'delivered', 'failed')),
  attempts          int not null default 0,
  max_attempts      int not null default 10 check (max_attempts > 0),
  next_attempt_at   timestamptz not null default now(),
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  delivered_at      timestamptz
);

-- Queue index: equality fields first, time/cursor last (plan.md §5).
create index outbox_events_claim_idx
  on public.outbox_events (status, next_attempt_at)
  where status in ('pending', 'processing');
create index outbox_events_kind_idx on public.outbox_events (kind);

create trigger outbox_events_touch
  before update on public.outbox_events
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- idempotency_records — operation key, request hash, authoritative result
-- ---------------------------------------------------------------------------
create table public.idempotency_records (
  id                uuid primary key default gen_random_uuid(),
  operation_key     text not null unique,
  request_hash      text not null,
  state             text not null check (state in ('in_progress', 'completed', 'rejected')),
  result            jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger idempotency_records_touch
  before update on public.idempotency_records
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- webhook_receipts — unique provider event receipts (payment, future)
-- ---------------------------------------------------------------------------
create table public.webhook_receipts (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null,           -- e.g. 'resend', 'payment'
  event_id          text not null,           -- provider event id (at-least-once delivery)
  event_type        text not null,
  payload_hash      text not null,           -- sha256 of the raw payload
  normalized        jsonb,
  status            text not null default 'received'
                    check (status in ('received', 'processed', 'failed', 'duplicate')),
  received_at       timestamptz not null default now(),
  processed_at      timestamptz,
  unique (provider, event_id)
);

-- ---------------------------------------------------------------------------
-- resend_webhook_events — Resend-specific receipts (unique svix-id)
-- ---------------------------------------------------------------------------
create table public.resend_webhook_events (
  id                uuid primary key default gen_random_uuid(),
  svix_id           text not null unique,    -- at-least-once, may arrive out of order
  event_time        timestamptz not null,
  event_type        text not null,
  payload_hash      text not null,
  normalized        jsonb,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- rate_limit_buckets — hashed subject/action window counters
-- ---------------------------------------------------------------------------
create table public.rate_limit_buckets (
  id                uuid primary key default gen_random_uuid(),
  subject_hash      text not null,           -- sha256(subject:action); never raw identifiers
  action            text not null,
  window_start      timestamptz not null,
  count             int not null default 0,
  unique (subject_hash, action, window_start)
);

-- ---------------------------------------------------------------------------
-- job_runs — cron/maintenance heartbeat and outcome
-- ---------------------------------------------------------------------------
create table public.job_runs (
  id                uuid primary key default gen_random_uuid(),
  job_name          text not null,
  status            text not null check (status in ('started', 'succeeded', 'failed')),
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  outcome           jsonb,
  error             text
);

create index job_runs_name_idx on public.job_runs (job_name, started_at desc);

-- ===========================================================================
-- Reference data pulled forward so the deterministic seed is real: canonical
-- role codes (seeded; plan.md §6 identity module, `role_definitions`).
-- ===========================================================================
create table public.role_definitions (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  label             text not null,
  description       text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

-- ===========================================================================
-- RLS: enable everywhere; deny all direct access until domain policies land.
-- Access flows through app-schema SECURITY DEFINER helpers or the service
-- role for webhooks/outbox/admin (plan.md §7).
-- ===========================================================================
alter table public.audit_events          enable row level security;
alter table public.outbox_events         enable row level security;
alter table public.idempotency_records   enable row level security;
alter table public.webhook_receipts      enable row level security;
alter table public.resend_webhook_events enable row level security;
alter table public.rate_limit_buckets    enable row level security;
alter table public.job_runs              enable row level security;
alter table public.role_definitions      enable row level security;

revoke all on public.audit_events, public.outbox_events, public.idempotency_records,
           public.webhook_receipts, public.resend_webhook_events, public.rate_limit_buckets,
           public.job_runs, public.role_definitions
  from anon, authenticated;

-- ===========================================================================
-- Privileged helpers (SECURITY DEFINER, search_path locked)
-- ===========================================================================

-- Record one audit row. Requires an authenticated actor; service-role callers
-- (webhooks/outbox) insert through the admin client, which bypasses RLS.
create or replace function app.record_audit(
  p_action text,
  p_target_type text,
  p_target_reference text,
  p_outcome text,
  p_reason text default null,
  p_actor_label text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'authenticated actor required';
  end if;
  insert into public.audit_events
    (actor_account_id, actor_label, action, target_type, target_reference, outcome, reason)
  values
    (v_actor, coalesce(p_actor_label, 'authenticated'), p_action, p_target_type,
     p_target_reference, p_outcome, p_reason)
  returning id into v_id;
  return v_id;
end
$$;

-- Enqueue one outbox event, idempotent by event_key (plan.md §8).
create or replace function app.enqueue_outbox(
  p_event_key text,
  p_kind text,
  p_target_type text,
  p_target_reference text,
  p_payload jsonb default '{}'::jsonb,
  p_max_attempts int default 10
) returns public.outbox_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.outbox_events;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  insert into public.outbox_events
    (event_key, kind, target_type, target_reference, payload, max_attempts)
  values
    (p_event_key, p_kind, p_target_type, p_target_reference, p_payload, p_max_attempts)
  on conflict (event_key) do nothing
  returning * into v_row;
  if v_row is null then
    select * into v_row from public.outbox_events where event_key = p_event_key;
  end if;
  return v_row;
end
$$;

-- Claim a bounded batch of due events (FOR UPDATE SKIP LOCKED, plan.md §8).
create or replace function app.claim_outbox(p_batch_size int default 10)
returns setof public.outbox_events
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with claimed as (
    select oe.id
      from public.outbox_events oe
     where oe.status in ('pending', 'processing')
       and oe.next_attempt_at <= now()
     order by oe.next_attempt_at
     limit p_batch_size
       for update skip locked
  )
  update public.outbox_events oe
     set status = 'processing',
         updated_at = now()
    from claimed c
   where oe.id = c.id
  returning oe.*;
end
$$;

-- Mark one event delivered (permanent uniqueness + provider idempotency).
create or replace function app.mark_outbox_delivered(p_event_key text)
returns public.outbox_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.outbox_events;
begin
  update public.outbox_events
     set status = 'delivered',
         delivered_at = now(),
         last_error = null,
         updated_at = now()
   where event_key = p_event_key
  returning * into v_row;
  if v_row is null then
    raise exception 'unknown outbox event key: %', p_event_key;
  end if;
  return v_row;
end
$$;

-- Record a failed attempt; exponential backoff; exhausted work goes to `failed`.
create or replace function app.fail_outbox(p_event_key text, p_error text)
returns public.outbox_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.outbox_events;
begin
  update public.outbox_events
     set attempts = attempts + 1,
         last_error = p_error,
         status = case when attempts + 1 >= max_attempts then 'failed' else 'pending' end,
         next_attempt_at = now() + (interval '1 minute' * power(2, least(attempts, 6))),
         updated_at = now()
   where event_key = p_event_key
  returning * into v_row;
  if v_row is null then
    raise exception 'unknown outbox event key: %', p_event_key;
  end if;
  return v_row;
end
$$;

grant usage on schema app to authenticated;
grant execute on function app.record_audit(text, text, text, text, text, text)
  to authenticated;
grant execute on function app.enqueue_outbox(text, text, text, text, jsonb, int)
  to authenticated;
grant execute on function app.claim_outbox(int) to authenticated;
grant execute on function app.mark_outbox_delivered(text) to authenticated;
grant execute on function app.fail_outbox(text, text) to authenticated;

commit;
