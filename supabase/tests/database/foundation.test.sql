-- =============================================================================
-- B0 foundation database tests (pgTAP, run with `supabase db test`).
-- Plan.md §12: every check, uniqueness, index, and RLS/append-only behavior.
-- =============================================================================

begin;
select plan(22);

-- ---------------------------------------------------------------------------
-- Reference generation
-- ---------------------------------------------------------------------------
select matches(
  app.new_ref('APP'),
  '^APP-\d{4}-[0-9A-F]{6}$',
  'new_ref produces PREFIX-YYYY-XXXXXX'
);
select matches(
  app.new_ref('APP', 2026),
  '^APP-2026-[0-9A-F]{6}$',
  'new_ref honours an explicit year'
);
select is(
  (select count(distinct r) from (select app.new_ref('X') as r from generate_series(1, 5)) s),
  5,
  'new_ref values are distinct'
);

-- ---------------------------------------------------------------------------
-- audit_events: schema, append-only, indexes
-- ---------------------------------------------------------------------------
select has_table('public', 'audit_events', 'audit_events exists');
select col_not_null('public', 'audit_events', 'action');
select col_has_check('public', 'audit_events', 'outcome', 'outcome check constraint');
select has_index('public', 'audit_events', 'audit_events_created_idx', 'created_at index');
select has_trigger('public', 'audit_events', 'audit_events_no_update', 'update is blocked');
select has_trigger('public', 'audit_events', 'audit_events_no_delete', 'delete is blocked');

-- Append-only: an UPDATE must raise.
select throws_ok(
  $$ update public.audit_events set action = 'Changed' where false or true $$,
  'append-only table: rows cannot be updated or deleted',
  'audit rows cannot be updated'
);

-- ---------------------------------------------------------------------------
-- outbox_events: claim index, idempotent enqueue, claim, deliver, fail
-- ---------------------------------------------------------------------------
select has_index('public', 'outbox_events', 'outbox_events_claim_idx', 'claim index exists');
select col_is_unique('public', 'outbox_events', 'event_key', 'event_key unique (permanent idempotency)');

insert into public.outbox_events (event_key, kind, target_type, target_reference)
values ('email.deliver:app-1:v1', 'email.deliver', 'admission_application', 'APP-2026-TEST01');
select is(
  (select count(*)::int from public.outbox_events where event_key = 'email.deliver:app-1:v1'),
  1,
  'enqueue inserts one row'
);
insert into public.outbox_events (event_key, kind, target_type, target_reference)
values ('email.deliver:app-1:v1', 'email.deliver', 'admission_application', 'APP-2026-TEST01')
on conflict (event_key) do nothing;
select is(
  (select count(*)::int from public.outbox_events where event_key = 'email.deliver:app-1:v1'),
  1,
  'duplicate event_key never creates a second row'
);

insert into public.outbox_events (event_key, kind, target_type, target_reference)
values ('pdf.generate:rc-1:v1', 'pdf.generate', 'receipt', 'RC-2026-TEST01');

-- 000085: the outbox state machine is service-role only. The synthetic
-- service-role claim stands in for the worker's admin client.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select is(
  (select count(*)::int from app.claim_outbox(10)),
  2,
  'claim_outbox claims due pending events'
);
select is(
  (select count(*)::int from app.claim_outbox(10)),
  0,
  'claim_outbox skips already-claimed rows'
);

select is(
  (select status from app.mark_outbox_delivered('email.deliver:app-1:v1')),
  'delivered',
  'mark_outbox_delivered transitions to delivered'
);
select is(
  (select status from app.fail_outbox('pdf.generate:rc-1:v1', 'boom')),
  'pending',
  'fail_outbox keeps retryable work pending'
);
select is(
  (select attempts from public.outbox_events where event_key = 'pdf.generate:rc-1:v1'),
  1,
  'fail_outbox counts the attempt'
);
select throws_ok(
  $$ select app.mark_outbox_delivered('missing:key') $$,
  'unknown outbox event key: missing:key',
  'unknown event keys raise a recoverable error'
);

-- ---------------------------------------------------------------------------
-- idempotency_records: unique operation key
-- ---------------------------------------------------------------------------
select col_is_unique('public', 'idempotency_records', 'operation_key', 'operation_key unique');
select col_has_check('public', 'idempotency_records', 'state', 'state check constraint');

-- ---------------------------------------------------------------------------
-- webhook receipts: unique (provider, event_id)
-- ---------------------------------------------------------------------------
select col_is_unique('public', 'webhook_receipts', ARRAY['provider', 'event_id'], 'provider event id unique');
select col_is_unique('public', 'resend_webhook_events', 'svix_id', 'svix_id unique');

-- ---------------------------------------------------------------------------
-- rate_limit_buckets: unique window bucket
-- ---------------------------------------------------------------------------
select col_is_unique('public', 'rate_limit_buckets', ARRAY['subject_hash', 'action', 'window_start'], 'window bucket unique');

-- ---------------------------------------------------------------------------
-- job_runs and role_definitions
-- ---------------------------------------------------------------------------
select col_has_check('public', 'job_runs', 'status', 'job status check constraint');
select col_is_unique('public', 'role_definitions', 'code', 'role code unique');
select is(
  (select count(*)::int from public.role_definitions),
  17,
  'seed loads the 17 canonical role codes'
);

-- ---------------------------------------------------------------------------
-- RLS is enabled everywhere in the foundation slice
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_tables t
    where t.schemaname = 'public'
      and t.tablename in ('audit_events', 'outbox_events', 'idempotency_records',
                          'webhook_receipts', 'resend_webhook_events', 'rate_limit_buckets',
                          'job_runs', 'role_definitions')
      and t.rowsecurity),
  8,
  'all foundation tables have RLS enabled'
);

-- ---------------------------------------------------------------------------
-- Privileged helpers require an authenticated actor
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select app.record_audit('Login', 'session', '—', 'Success') $$,
  'authenticated actor required',
  'record_audit requires auth.uid()'
);
select throws_ok(
  $$ select app.enqueue_outbox('k:1', 'email.deliver', 'x', 'y') $$,
  'authenticated actor required',
  'enqueue_outbox requires auth.uid()'
);

rollback;
