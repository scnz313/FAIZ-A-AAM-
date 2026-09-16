-- =============================================================================
-- 000124 — Delivery operations: administrator visibility + bounded requeue
--
-- The outbox worker previously ran only from the daily Vercel cron, so a
-- permanently failed delivery could wait 24h before anyone even saw it.
-- This migration adds three system-administrator (aal2) functions behind the
-- /administrator/deliveries workspace:
--
--   1. app.deliveries_admin_list — outbox events newest-first with nested
--      notification_deliveries (masked recipients) and a queue summary.
--      provider_jobs carry NO foreign key to outbox_events; the only honest
--      correlation is (target_type, target_reference), so each event reports
--      provider jobs sharing that target as `providerJobs`.
--   2. app.delivery_retry — returns one 'failed' delivery to the worker's
--      retryable state: status stays 'failed' but failure_class becomes
--      'transient' and next_attempt_at becomes now(), exactly the state
--      dispatchEvent() re-attempts; the parent event is re-queued to
--      'pending'/now() so the worker picks it up (a 'failed' event also gets
--      max_attempts = attempts + 3, matching app.outbox_event_retry).
--   3. app.outbox_event_retry — requeues a 'failed' event as 'pending' with
--      max_attempts = attempts + 3 and requeues any 'failed' provider job
--      sharing its target the same way.
--
-- Neither retry touches a delivery that is already terminal (sent/delivered/
-- bounced/complained/suppressed) or pending; historical failures stay
-- visible until an administrator retries them. Both writes audit.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Recipient masking helper (first two characters + *** + domain)
-- ---------------------------------------------------------------------------

create or replace function app.delivery_recipient_masked(p_contact text, p_verified_contact text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_contact, p_verified_contact) is null then 'unknown recipient'
    when position('@' in coalesce(p_contact, p_verified_contact)) > 1
      then left(coalesce(p_contact, p_verified_contact), least(2, position('@' in coalesce(p_contact, p_verified_contact)) - 1))
           || '***' || substr(coalesce(p_contact, p_verified_contact), position('@' in coalesce(p_contact, p_verified_contact)))
    else left(coalesce(p_contact, p_verified_contact), 2) || '***'
  end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Administrator read projection
-- ---------------------------------------------------------------------------

create or replace function app.deliveries_admin_list(
  p_status text default null,
  p_limit int default 100
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_events jsonb;
  v_summary jsonb;
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'system administrator role and aal2 required';
  end if;
  if p_status is not null and p_status not in ('pending', 'processing', 'delivered', 'failed') then
    raise exception 'invalid event status filter';
  end if;

  select coalesce(jsonb_agg(event_row order by event_created_at desc), '[]'::jsonb)
    into v_events
    from (
      select
        oe.created_at as event_created_at,
        jsonb_build_object(
          'eventId', oe.id,
          'eventKey', oe.event_key,
          'kind', oe.kind,
          'targetType', oe.target_type,
          'targetReference', oe.target_reference,
          'status', oe.status,
          'attempts', oe.attempts,
          'maxAttempts', oe.max_attempts,
          'nextAttemptAt', oe.next_attempt_at,
          'lastError', oe.last_error,
          'createdAt', oe.created_at,
          'deliveredAt', oe.delivered_at,
          'deliveries', coalesce((
            select jsonb_agg(jsonb_build_object(
              'deliveryId', nd.id,
              'recipientMasked', app.delivery_recipient_masked(nd.recipient_contact, ua.verified_contact),
              'channel', nd.channel,
              'status', nd.status,
              'failureClass', nd.failure_class,
              'attempts', nd.attempts,
              'lastError', nd.last_error,
              'providerMessageId', nd.provider_message_id,
              'updatedAt', nd.updated_at
            ) order by nd.created_at)
            from public.notification_deliveries nd
            left join public.user_accounts ua on ua.id = nd.recipient_account_id
            where nd.event_id = oe.id
          ), '[]'::jsonb),
          'providerJobs', coalesce((
            select jsonb_agg(jsonb_build_object(
              'jobId', pj.id,
              'jobKind', pj.job_kind,
              'status', pj.status,
              'attempts', pj.attempts,
              'nextAttemptAt', pj.next_attempt_at,
              'lastError', pj.last_error
            ) order by pj.created_at)
            from public.provider_jobs pj
            where pj.target_type = oe.target_type
              and pj.target_reference = oe.target_reference
          ), '[]'::jsonb)
        ) as event_row
      from public.outbox_events oe
      where p_status is null or oe.status = p_status
      order by oe.created_at desc
      limit v_limit
    ) listed;

  select jsonb_build_object(
    'pending', count(*) filter (where status = 'pending'),
    'processing', count(*) filter (where status = 'processing'),
    'delivered', count(*) filter (where status = 'delivered'),
    'failed', count(*) filter (where status = 'failed'),
    'deliveriesFailedPermanent', (
      select count(*)
        from public.notification_deliveries
       where status = 'failed' and failure_class = 'permanent'
    )
  ) into v_summary
  from public.outbox_events;

  return jsonb_build_object('events', coalesce(v_events, '[]'::jsonb), 'summary', v_summary);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Retry one failed delivery (worker state machine: failed + transient +
--    next_attempt_at elapsed is re-attempted when the event is processed)
-- ---------------------------------------------------------------------------

create or replace function app.delivery_retry(
  p_delivery_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.notification_deliveries%rowtype;
  v_event public.outbox_events%rowtype;
  v_jobs int := 0;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'system administrator role and aal2 required';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required';
  end if;

  select * into v_delivery from public.notification_deliveries where id = p_delivery_id for update;
  if v_delivery.id is null then raise exception 'delivery not found'; end if;
  if v_delivery.status <> 'failed' then
    raise exception 'only a failed delivery can be retried';
  end if;

  update public.notification_deliveries
     set failure_class = 'transient',
         next_attempt_at = now(),
         updated_at = now()
   where id = v_delivery.id
  returning * into v_delivery;

  /* Requeue the parent event so the worker re-processes it. A permanently
     failed event gets the same three-attempt extension as outbox_event_retry;
     attempts are preserved in every case. */
  update public.outbox_events
     set status = 'pending',
         next_attempt_at = now(),
         delivered_at = null,
         max_attempts = case when status = 'failed' then attempts + 3 else max_attempts end,
         updated_at = now()
   where id = v_delivery.event_id
     and status in ('failed', 'delivered')
  returning * into v_event;
  if v_event.id is null then
    select * into v_event from public.outbox_events where id = v_delivery.event_id;
  end if;

  /* A failed provider job sharing the event target is requeued the same way
     as outbox_event_retry so sibling document/storage work is not left
     behind; in practice email.deliver events have no provider job rows. */
  update public.provider_jobs
     set status = 'pending',
         next_attempt_at = now(),
         finished_at = null,
         max_attempts = attempts + 3,
         updated_at = now()
   where target_type = v_event.target_type
     and target_reference = v_event.target_reference
     and status = 'failed';
  get diagnostics v_jobs = row_count;

  perform app.record_audit('Notification delivery retried', 'notification_delivery',
                           v_delivery.id::text, 'Success', btrim(p_reason), 'Delivery operations');

  return jsonb_build_object(
    'delivery', jsonb_build_object(
      'deliveryId', v_delivery.id,
      'status', v_delivery.status,
      'failureClass', v_delivery.failure_class,
      'attempts', v_delivery.attempts,
      'nextAttemptAt', v_delivery.next_attempt_at
    ),
    'event', jsonb_build_object(
      'eventId', v_event.id,
      'status', v_event.status,
      'attempts', v_event.attempts,
      'maxAttempts', v_event.max_attempts,
      'nextAttemptAt', v_event.next_attempt_at
    ),
    'providerJobsRequeued', v_jobs
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Requeue a failed outbox event (max-attempts exhausted)
-- ---------------------------------------------------------------------------

create or replace function app.outbox_event_retry(
  p_event_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.outbox_events%rowtype;
  v_jobs int := 0;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'system administrator role and aal2 required';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required';
  end if;

  select * into v_event from public.outbox_events where id = p_event_id for update;
  if v_event.id is null then raise exception 'outbox event not found'; end if;
  if v_event.status <> 'failed' then
    raise exception 'only a failed outbox event can be requeued';
  end if;

  update public.outbox_events
     set status = 'pending',
         next_attempt_at = now(),
         delivered_at = null,
         max_attempts = attempts + 3,
         updated_at = now()
   where id = v_event.id
  returning * into v_event;

  /* Provider jobs are a sibling queue keyed only by target correlation; any
     failed job for the same target is requeued with the same three-attempt
     extension so it can run again on the next claim. */
  update public.provider_jobs
     set status = 'pending',
         next_attempt_at = now(),
         finished_at = null,
         max_attempts = attempts + 3,
         updated_at = now()
   where target_type = v_event.target_type
     and target_reference = v_event.target_reference
     and status = 'failed';
  get diagnostics v_jobs = row_count;

  perform app.record_audit('Outbox event requeued', 'outbox_event',
                           v_event.event_key, 'Success', btrim(p_reason), 'Delivery operations');

  return jsonb_build_object(
    'eventId', v_event.id,
    'eventKey', v_event.event_key,
    'status', v_event.status,
    'attempts', v_event.attempts,
    'maxAttempts', v_event.max_attempts,
    'nextAttemptAt', v_event.next_attempt_at,
    'providerJobsRequeued', v_jobs
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants: reads/writes are administrator-authenticated only
-- ---------------------------------------------------------------------------

revoke all on function app.deliveries_admin_list(text, int) from public, anon;
revoke all on function app.delivery_retry(uuid, text) from public, anon;
revoke all on function app.outbox_event_retry(uuid, text) from public, anon;
revoke all on function app.delivery_recipient_masked(text, text) from public, anon;
grant execute on function app.deliveries_admin_list(text, int) to authenticated;
grant execute on function app.delivery_retry(uuid, text) to authenticated;
grant execute on function app.outbox_event_retry(uuid, text) to authenticated;
grant execute on function app.delivery_recipient_masked(text, text) to authenticated;

commit;
