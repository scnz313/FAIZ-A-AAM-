-- =============================================================================
-- 000124 delivery operations assertions.
--
-- The Deliveries workspace RPCs let a system administrator (aal2) see the
-- outbox with masked recipients and requeue failed work through the worker's
-- own state machine. This suite locks the contract on the local scratch
-- instance:
--   * anonymous sessions can never execute the functions, authenticated can;
--   * every function requires aal2 plus the system_administrator grant;
--   * deliveries_admin_list returns masked recipients + the queue summary;
--   * delivery_retry keeps status='failed' but flips failure_class to
--     'transient' with next_attempt_at=now() (exactly the state dispatchEvent
--     re-attempts) and requeues the parent event without touching attempts;
--   * outbox_event_retry requeues a failed event with max_attempts=attempts+3
--     and requeues failed provider jobs sharing the event target;
--   * both writes audit.
-- Row assertions run outside `authenticated` because notification_deliveries
-- RLS reads are scoped to support_officer/auditor and provider_jobs is
-- revoked from authenticated entirely — the RPCs are security definer.
-- Run by scripts/validate-db-local.sh.
-- =============================================================================

\set ON_ERROR_STOP on

create or replace function auth.uid() returns uuid language sql as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

begin;

insert into auth.users (id) values
  ('10000000-0000-4000-8000-000000000301'),
  ('10000000-0000-4000-8000-000000000302'),
  ('10000000-0000-4000-8000-000000000311');

insert into public.people (id, given_name, family_name, display_name) values
  ('20000000-0000-4000-8000-000000000301', 'Delivery', 'Admin', 'Delivery Admin'),
  ('20000000-0000-4000-8000-000000000302', 'Delivery', 'Staff', 'Delivery Staff'),
  ('20000000-0000-4000-8000-000000000311', 'Recipient', 'Guardian', 'Recipient Guardian');

insert into public.user_accounts (id, person_id, status, verified_contact) values
  ('10000000-0000-4000-8000-000000000301', '20000000-0000-4000-8000-000000000301', 'active', 'delivery.admin@example.test'),
  ('10000000-0000-4000-8000-000000000302', '20000000-0000-4000-8000-000000000302', 'active', 'delivery.staff@example.test'),
  ('10000000-0000-4000-8000-000000000311', '20000000-0000-4000-8000-000000000311', 'active', 'parent.guardian@example.test');

insert into public.role_grants (account_id, role_code, status, effective_from) values
  ('10000000-0000-4000-8000-000000000301', 'system_administrator', 'active', now()),
  ('10000000-0000-4000-8000-000000000302', 'support_officer', 'active', now());

-- Outbox fixtures: one failed event with a permanently failed delivery, one
-- delivered event with a delivered delivery, one pending event.
insert into public.outbox_events
  (id, event_key, kind, target_type, target_reference, status, attempts, max_attempts, next_attempt_at, last_error, delivered_at)
values
  ('30000000-0000-4000-8000-000000000001', 'email.notice:NTC-T-1:v1', 'email.deliver', 'notice', 'NTC-T-1',
   'failed', 10, 10, now(), 'Permanent: sender rejected', null),
  ('30000000-0000-4000-8000-000000000002', 'email.notice:NTC-T-2:v1', 'email.deliver', 'notice', 'NTC-T-2',
   'delivered', 1, 10, now(), null, now()),
  ('30000000-0000-4000-8000-000000000003', 'email.notice:NTC-T-3:v1', 'email.deliver', 'notice', 'NTC-T-3',
   'pending', 0, 10, now() + interval '1 hour', null, null);

insert into public.notification_deliveries
  (id, event_id, recipient_account_id, recipient_contact, channel, template_version, status, failure_class, attempts, last_error)
values
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000311', null, 'email', 'v1', 'failed', 'permanent', 10, 'Mailbox unavailable'),
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002',
   '10000000-0000-4000-8000-000000000311', null, 'email', 'v1', 'delivered', null, 1, null),
  ('40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003',
   null, 'applicant@example.test', 'email', 'v1', 'pending', null, 0, null);

-- A failed provider job sharing the failed event's target.
insert into public.provider_jobs
  (id, job_kind, target_type, target_reference, idempotency_key, status, attempts, max_attempts, next_attempt_at)
values
  ('50000000-0000-4000-8000-000000000001', 'storage_finalize', 'notice', 'NTC-T-1', 'test:job:1',
   'failed', 10, 10, now());

-- ---------------------------------------------------------------------------
-- Privilege boundary: anon never executes, authenticated does; definer only.
-- ---------------------------------------------------------------------------
do $$
begin
  assert not has_function_privilege('anon', 'app.deliveries_admin_list(text, integer)', 'EXECUTE'),
    'anonymous callers must never list deliveries';
  assert not has_function_privilege('anon', 'app.delivery_retry(uuid, text)', 'EXECUTE'),
    'anonymous callers must never retry deliveries';
  assert not has_function_privilege('anon', 'app.outbox_event_retry(uuid, text)', 'EXECUTE'),
    'anonymous callers must never requeue events';
  assert has_function_privilege('authenticated', 'app.deliveries_admin_list(text, integer)', 'EXECUTE'),
    'authenticated staff execute the admin list';
  assert has_function_privilege('authenticated', 'app.delivery_retry(uuid, text)', 'EXECUTE'),
    'authenticated staff execute the delivery retry';
  assert has_function_privilege('authenticated', 'app.outbox_event_retry(uuid, text)', 'EXECUTE'),
    'authenticated staff execute the event retry';
  assert (
    select bool_and(p.prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'
       and p.proname in ('deliveries_admin_list', 'delivery_retry', 'outbox_event_retry')
  ), 'delivery operations must run security definer';
end
$$;

-- ---------------------------------------------------------------------------
-- Guard: aal1 refused, wrong role refused, missing reason refused.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000301', true);
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal1"}', true);
do $$
declare v_denied boolean := false;
begin
  begin perform app.deliveries_admin_list(null, 10);
  exception when others then v_denied := true; end;
  assert v_denied, 'aal1 administrator must be refused the delivery list';
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000302', true);
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal2"}', true);
do $$
declare v_denied boolean := false;
begin
  begin perform app.deliveries_admin_list(null, 10);
  exception when others then v_denied := true; end;
  assert v_denied, 'non-administrator aal2 staff must be refused the delivery list';
  v_denied := false;
  begin perform app.outbox_event_retry('30000000-0000-4000-8000-000000000001', 'retrying');
  exception when others then v_denied := true; end;
  assert v_denied, 'non-administrator aal2 staff must be refused the event retry';
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000301', true);
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal2"}', true);
do $$
declare v_denied boolean := false;
begin
  begin perform app.delivery_retry('40000000-0000-4000-8000-000000000001', 'no');
  exception when others then v_denied := true; end;
  assert v_denied, 'a reason under three characters must be refused';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- Read projection: masked recipients, summary, status filter.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000301', true);
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal2"}', true);
do $$
declare
  v_board jsonb;
  v_failed jsonb;
begin
  v_board := app.deliveries_admin_list(null, 100);
  assert jsonb_array_length(v_board -> 'events') >= 3, 'all events listed';
  assert (v_board -> 'summary' ->> 'failed')::int >= 1, 'summary counts failed events';
  assert (v_board -> 'summary' ->> 'deliveriesFailedPermanent')::int >= 1,
    'summary counts permanently failed deliveries';
  assert (
    select (d ->> 'recipientMasked') = 'pa***@example.test'
      from jsonb_array_elements(v_board -> 'events') e
      cross join lateral jsonb_array_elements(e -> 'deliveries') d
     where (d ->> 'deliveryId') = '40000000-0000-4000-8000-000000000001'
  ), 'account-bound recipient is masked from the verified contact';
  assert not exists (
    select 1
      from jsonb_array_elements(v_board -> 'events') e
      cross join lateral jsonb_array_elements(e -> 'deliveries') d
     where (d ->> 'recipientMasked') like '%parent.guardian%'
        or (d ->> 'recipientMasked') like '%applicant@%'
  ), 'no raw recipient address may appear in the projection';
  assert (
    select (d ->> 'recipientMasked') = 'ap***@example.test'
      from jsonb_array_elements(v_board -> 'events') e
      cross join lateral jsonb_array_elements(e -> 'deliveries') d
     where (d ->> 'deliveryId') = '40000000-0000-4000-8000-000000000003'
  ), 'accountless recipient is masked from recipient_contact';
  assert exists (
    select 1 from jsonb_array_elements(v_board -> 'events') e
     where (e ->> 'eventId') = '30000000-0000-4000-8000-000000000001'
       and jsonb_array_length(e -> 'providerJobs') = 1
  ), 'provider jobs sharing the event target are reported';

  v_failed := app.deliveries_admin_list('failed', 100);
  assert (
    select bool_and((e ->> 'status') = 'failed')
      from jsonb_array_elements(v_failed -> 'events') e
  ), 'the status filter returns only failed events';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- delivery_retry: refuses terminal deliveries; on a failed delivery flips
-- failure_class to transient and requeues the parent event (authenticated).
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000301', true);
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal2"}', true);
do $$
declare
  v_result jsonb;
  v_denied boolean := false;
begin
  /* A delivered delivery is terminal and cannot be retried. */
  begin
    perform app.delivery_retry('40000000-0000-4000-8000-000000000002', 'already delivered');
  exception when others then v_denied := true; end;
  assert v_denied, 'a delivered delivery must refuse retry';

  v_result := app.delivery_retry('40000000-0000-4000-8000-000000000001', 'sender configuration repaired');
  assert (v_result -> 'delivery' ->> 'failureClass') = 'transient', 'the new delivery state is returned';
  assert (v_result -> 'event' ->> 'status') = 'pending', 'the new event state is returned';
end
$$;
reset role;

-- Row assertions as the owner role (RLS hides these tables from
-- authenticated callers; the RPCs ran as definer).
do $$
declare
  v_delivery public.notification_deliveries%rowtype;
  v_event public.outbox_events%rowtype;
begin
  select * into v_delivery from public.notification_deliveries
   where id = '40000000-0000-4000-8000-000000000001';
  assert v_delivery.status = 'failed',
    'the worker re-attempts failed deliveries — status stays failed';
  assert v_delivery.failure_class = 'transient', 'retry resets the failure class to transient';
  assert v_delivery.next_attempt_at <= now(), 'retry makes the attempt due now';
  assert v_delivery.attempts = 10, 'attempt history is preserved';

  select * into v_event from public.outbox_events
   where id = '30000000-0000-4000-8000-000000000001';
  assert v_event.status = 'pending', 'the parent event is claimable again';
  assert v_event.attempts = 10, 'event attempts are preserved';
  assert v_event.max_attempts = 13, 'a failed event gains the three-attempt extension';
  assert v_event.next_attempt_at <= now(), 'the event is due immediately';

  assert exists (
    select 1 from public.audit_events
     where action = 'Notification delivery retried'
       and target_type = 'notification_delivery'
       and target_reference = '40000000-0000-4000-8000-000000000001'
  ), 'the retry is audited';
end
$$;

-- ---------------------------------------------------------------------------
-- outbox_event_retry: failed event requeued with a three-attempt extension;
-- the failed provider job sharing its target is requeued too.
-- ---------------------------------------------------------------------------
do $$
begin
  /* The event was already requeued by the delivery retry above; re-fail it
     to exercise outbox_event_retry on a genuinely failed row. */
  update public.outbox_events
     set status = 'failed', attempts = 13, max_attempts = 13, last_error = 'exhausted again'
   where id = '30000000-0000-4000-8000-000000000001';
  /* The provider job was likewise requeued; fail it again. */
  update public.provider_jobs
     set status = 'failed', attempts = 13, max_attempts = 13
   where id = '50000000-0000-4000-8000-000000000001';
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000301', true);
select set_config('request.jwt.claims', '{"role":"authenticated","aal":"aal2"}', true);
do $$
declare
  v_result jsonb;
  v_denied boolean := false;
begin
  /* A pending event cannot be requeued. */
  begin
    perform app.outbox_event_retry('30000000-0000-4000-8000-000000000003', 'not failed yet');
  exception when others then v_denied := true; end;
  assert v_denied, 'a pending event must refuse requeue';

  v_result := app.outbox_event_retry('30000000-0000-4000-8000-000000000001', 'provider recovered');
  assert (v_result ->> 'providerJobsRequeued')::int = 1, 'the requeue count is returned';
end
$$;
reset role;

do $$
declare
  v_event public.outbox_events%rowtype;
  v_job public.provider_jobs%rowtype;
begin
  select * into v_event from public.outbox_events
   where id = '30000000-0000-4000-8000-000000000001';
  assert v_event.status = 'pending', 'the event is claimable again';
  assert v_event.attempts = 13, 'attempt history is preserved';
  assert v_event.max_attempts = 16, 'the event gains exactly three more attempts';
  assert v_event.next_attempt_at <= now(), 'the event is due immediately';

  select * into v_job from public.provider_jobs
   where id = '50000000-0000-4000-8000-000000000001';
  assert v_job.status = 'pending', 'the sibling provider job is claimable again';
  assert v_job.max_attempts = 16, 'the provider job gains the same extension';

  assert exists (
    select 1 from public.audit_events
     where action = 'Outbox event requeued'
       and target_type = 'outbox_event'
       and target_reference = 'email.notice:NTC-T-1:v1'
  ), 'the requeue is audited';
end
$$;

select 'DELIVERY OPERATIONS PASSED' as result;

rollback;
