-- Outbox due-time scheduling assertions (migrations 000080/000083 schedule
-- content.publish/content.expire to their effective time; 000085 defines the
-- service-only claim).
--
-- Proves the claim query itself honors `next_attempt_at`: a scheduled event is
-- invisible to app.claim_outbox before its due time and claimable once due.
-- Run by scripts/validate-db-local.sh after the RPC suite; never against a
-- remote database.

do $$
declare
  v_future_publish uuid;
  v_future_expire uuid;
  v_claimed int;
begin
  -- The outbox state machine requires the service worker (000085).
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);

  insert into public.outbox_events (event_key, kind, target_type, target_reference, next_attempt_at)
  values ('content.publish:OUTBOX-SCHED:1', 'content.publish', 'notice', 'OUTBOX-SCHED', now() + interval '2 hours')
  returning id into v_future_publish;
  insert into public.outbox_events (event_key, kind, target_type, target_reference, next_attempt_at)
  values ('content.expire:OUTBOX-SCHED:2099-01-01:1', 'content.expire', 'notice', 'OUTBOX-SCHED', now() + interval '2 hours')
  returning id into v_future_expire;

  select count(*) into v_claimed
    from app.claim_outbox(10)
   where id in (v_future_publish, v_future_expire);
  assert v_claimed = 0, 'scheduled outbox events are not claimed before their due time';

  update public.outbox_events
     set next_attempt_at = now() - interval '1 day'
   where id in (v_future_publish, v_future_expire);

  select count(*) into v_claimed
    from app.claim_outbox(10)
   where id in (v_future_publish, v_future_expire);
  assert v_claimed = 2, 'scheduled outbox events become claimable once due';

  perform app.mark_outbox_delivered('content.publish:OUTBOX-SCHED:1');
  perform app.mark_outbox_delivered('content.expire:OUTBOX-SCHED:2099-01-01:1');
end
$$;

do $$
begin
  assert (select count(*) from public.outbox_events
           where event_key = 'content.publish:OUTBOX-SCHED:1' and status = 'delivered') = 1,
    'the scheduled publish event is delivered after the due-time check';
  assert (select count(*) from public.outbox_events
           where event_key = 'content.expire:OUTBOX-SCHED:2099-01-01:1' and status = 'delivered') = 1,
    'the scheduled expiry event is delivered after the due-time check';
end
$$;
