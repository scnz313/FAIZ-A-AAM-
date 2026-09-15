-- =============================================================================
-- 000085 — Outbox state machine is service-only; public notices stop emailing
--
-- Closes two audited defects:
--   1. `app.claim_outbox`, `app.mark_outbox_delivered`, and `app.fail_outbox`
--      were EXECUTE-granted to `authenticated` by 000001.  Any signed-in JWT
--      could therefore claim every pending event (payloads can carry contact
--      details and reasons), mark work delivered, or force permanent failure.
--      The service-role guard pattern already used by `claim_provider_jobs`
--      (000037) is now applied to all three functions, and their EXECUTE
--      grants are revoked from public/anon/authenticated and held only by
--      service_role (000012 originally granted service_role, restated here).
--   2. `content_publish_version_v2` enqueued an `email.deliver` event for
--      every published notice, including notices whose only audience is the
--      general public.  A public audience has no addressable recipients, so
--      the worker retired the event as a permanent "no verified recipients"
--      failure.  The email is now enqueued only when at least one addressable
--      audience row exists (`role`, `student`, `grade_section`,
--      `academic_year`); `content_publish_due` applies the same rule to the
--      scheduled-notice sweep.
--
-- The latest definitions are reproduced exactly: `claim_outbox` from 000037,
-- `mark_outbox_delivered`/`fail_outbox` from 000030, and
-- `content_publish_version_v2`/`content_publish_due` from 000083 (audience
-- writes, scheduled/expiry events, pinned/review_due, and page scheduled_at
-- are byte-for-byte unchanged apart from the audience guard).  Signatures,
-- worker behavior, and grants are unchanged apart from the authorization
-- boundary.  All database corrections are forward-only (000085 is the next
-- free number); remote applications remain frozen.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. claim_outbox: service-role guard (latest definition is 000037)
-- ---------------------------------------------------------------------------

create or replace function app.claim_outbox(p_batch_size int default 10)
returns setof public.outbox_events
language plpgsql
security definer
set search_path = ''
as $$
begin
  if session_user <> 'service_role' and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'outbox dispatch requires the service worker';
  end if;
  return query
  with claimed as (
    select oe.id
      from public.outbox_events oe
     where oe.status in ('pending', 'processing')
       and oe.next_attempt_at <= now()
     order by oe.next_attempt_at
     limit least(greatest(coalesce(p_batch_size, 10), 1), 100)
       for update skip locked
  )
  update public.outbox_events oe
     set status = 'processing',
         next_attempt_at = now() + interval '5 minutes',
         updated_at = now()
    from claimed c
   where oe.id = c.id
  returning oe.*;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. mark_outbox_delivered: service-role guard (latest definition is 000030)
-- ---------------------------------------------------------------------------

create or replace function app.mark_outbox_delivered(p_event_key text)
returns public.outbox_events
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.outbox_events;
begin
  if session_user <> 'service_role' and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'outbox dispatch requires the service worker';
  end if;
  update public.outbox_events
     set status='delivered', delivered_at=now(), last_error=null, updated_at=now()
   where event_key=p_event_key and status in ('pending','processing')
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.outbox_events where event_key=p_event_key;
    if v_row.id is null then raise exception 'unknown outbox event key: %',p_event_key; end if;
    if v_row.status='failed' then raise exception 'failed outbox event cannot be marked delivered: %',p_event_key; end if;
  end if;
  return v_row;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. fail_outbox: service-role guard (latest definition is 000030)
-- ---------------------------------------------------------------------------

create or replace function app.fail_outbox(p_event_key text, p_error text)
returns public.outbox_events
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.outbox_events; v_permanent boolean := left(coalesce(p_error,''),10)='Permanent:';
begin
  if session_user <> 'service_role' and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'outbox dispatch requires the service worker';
  end if;
  update public.outbox_events
     set attempts=attempts+1,
         last_error=left(coalesce(p_error,'outbox work failed'),500),
         status=case when v_permanent or attempts+1>=max_attempts then 'failed' else 'pending' end,
         next_attempt_at=case when v_permanent or attempts+1>=max_attempts then now() else now()+(interval '1 minute'*power(2,least(attempts,6))) end,
         updated_at=now()
   where event_key=p_event_key
  returning * into v_row;
  if v_row.id is null then raise exception 'unknown outbox event key: %',p_event_key; end if;
  return v_row;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Only an addressable audience earns a notice email
--
-- Latest definition is 000083.  The only change is the publish-email guard:
-- a notice whose sole audience is the general public (or `application`, which
-- the worker cannot resolve) has no recipients, so it enqueues no
-- `email.notice_published` event.  Audience writes, the page schedule, the
-- `content.publish`/`content.expire` enqueues, and the pinned/review_due
-- projection are reproduced byte-for-byte.
-- ---------------------------------------------------------------------------

create or replace function app.content_publish_version_v2(
  p_version_id uuid,
  p_expected_version int default null,
  p_scheduled_at timestamptz default null,
  p_expires_at timestamptz default null,
  p_idempotency_key text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_version public.content_versions%rowtype; v_item public.content_items%rowtype; v_notice public.notices%rowtype; v_next public.content_versions%rowtype; v_next_number int; v_status text; v_event public.outbox_events%rowtype;
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
  update public.content_items set
    current_status=v_status,
    current_version_id=v_next.id,
    version=v_next.version,
    scheduled_at=case when v_item.kind='page' and v_status='scheduled' then p_scheduled_at else null end
  where id=v_item.id;
  select * into v_notice from public.notices where content_item_id=v_item.id for update;
  if v_notice.id is not null then
    update public.notices set
      status=v_status,
      scheduled_at=p_scheduled_at,
      expires_at=p_expires_at,
      published_at=case when v_status='published' then now() else null end,
      published_by_account_id=case when v_status='published' then auth.uid() else null end,
      pinned=(lower(coalesce(v_next.body->'metadata'->>'pinned',''))='true'),
      review_due=case when (v_next.body->'metadata'->>'reviewDue') ~ '^\d{4}-\d{2}-\d{2}$' then (v_next.body->'metadata'->>'reviewDue')::date else null end
    where id=v_notice.id;
    if not exists (select 1 from public.notice_audiences na where na.notice_id=v_notice.id) then
      if lower(coalesce(v_next.body->'metadata'->>'audience','')) = 'family' then
        insert into public.notice_audiences(notice_id,audience,role_code) values(v_notice.id,'role','guardian') on conflict do nothing;
      else
        insert into public.notice_audiences(notice_id,audience) values(v_notice.id,'public') on conflict do nothing;
      end if;
    end if;
  end if;
  perform app.record_audit(case when v_status='published' then 'Content published' else 'Content scheduled' end,'content_item',v_item.reference,'Success');
  if v_status='published' and v_notice.id is not null
     and exists (select 1 from public.notice_audiences na
                  where na.notice_id=v_notice.id
                    and na.audience in ('role','student','grade_section','academic_year')) then
    perform app.enqueue_outbox('email.notice_published:'||v_notice.reference||':v'||v_next.version,'email.deliver','notice',v_notice.reference,jsonb_build_object('channel','email'));
  end if;
  if v_status='scheduled' then
    if v_notice.id is not null then
      v_event:=app.enqueue_outbox('content.publish:'||v_notice.reference||':'||v_next.version,'content.publish','notice',v_notice.reference,jsonb_build_object('version',v_next.version,'scheduledAt',p_scheduled_at));
    elsif v_item.kind='page' then
      v_event:=app.enqueue_outbox('content.publish:'||v_item.reference||':'||v_next.version,'content.publish','content_item',v_item.reference,jsonb_build_object('version',v_next.version,'scheduledAt',p_scheduled_at));
    end if;
    if v_event.id is not null and v_event.status in ('pending','processing') and p_scheduled_at>now() then
      update public.outbox_events set next_attempt_at=p_scheduled_at where id=v_event.id and status in ('pending','processing');
    end if;
  end if;
  if v_notice.id is not null and p_expires_at is not null then
    v_event:=app.enqueue_outbox('content.expire:'||v_notice.reference||':'||p_expires_at::date||':'||v_next.version,'content.expire','notice',v_notice.reference,jsonb_build_object('version',v_next.version,'expiresAt',p_expires_at));
    if v_event.id is not null and v_event.status in ('pending','processing') and p_expires_at>now() then
      update public.outbox_events set next_attempt_at=p_expires_at where id=v_event.id and status in ('pending','processing');
    end if;
  end if;
  return jsonb_build_object('id',v_item.id,'reference',v_item.reference,'versionId',v_next.id,'version',v_next.version,'status',v_status,'replayed',v_next.id<>v_version.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The due sweep applies the same audience rule to scheduled notices
--
-- Latest definition is 000083.  The notice loop is reproduced byte-for-byte
-- except for the same addressable-audience guard, so a scheduled public-only
-- notice no longer enqueues a `content.scheduled_published` email event the
-- worker would retire as "no verified recipients".  The page loop is
-- unchanged: pages have no audience definition and the worker explicitly
-- acknowledges their empty recipient set.
-- ---------------------------------------------------------------------------

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
    if exists (select 1 from public.notice_audiences na
                where na.notice_id=v_notice.id
                  and na.audience in ('role','student','grade_section','academic_year')) then
      perform app.enqueue_outbox('content.scheduled_published:'||v_notice.reference||':'||v_next.version,'email.deliver','notice',v_notice.reference,jsonb_build_object('channel','email'));
    end if;
    v_count:=v_count+1;
  end loop;
  for v_item in select * from public.content_items where kind='page' and current_status='scheduled' and scheduled_at is not null and scheduled_at<=now() for update loop
    select * into v_source from public.content_versions where id=v_item.current_version_id;
    if v_source.id is null or v_source.review_status not in ('approved','published') then continue; end if;
    select coalesce(max(version),0)+1 into v_next_number from public.content_versions where content_item_id=v_item.id;
    insert into public.content_versions(content_item_id,version,title,body,author_account_id,review_status,published_at)
    values(v_item.id,v_next_number,v_source.title,v_source.body,v_source.author_account_id,'published',now()) returning * into v_next;
    update public.content_items set current_status='published',current_version_id=v_next.id,version=v_next.version,scheduled_at=null where id=v_item.id;
    insert into public.audit_events(actor_label,action,target_type,target_reference,outcome,reason) values('Content scheduler','Content published','content_item',v_item.reference,'Success','Scheduled publication reached its effective time');
    perform app.enqueue_outbox('content.scheduled_published:'||v_item.reference||':'||v_next.version,'email.deliver','content_item',v_item.reference,jsonb_build_object('channel','email'));
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants: the outbox state machine is service-role only
--
-- `app.enqueue_outbox` stays available to authenticated domain commands and
-- the service worker; the claim/deliver/fail boundary is the worker's.
-- CREATE OR REPLACE preserves existing grants, so the revokes are explicit.
-- ---------------------------------------------------------------------------

revoke all on function app.claim_outbox(int) from public, anon, authenticated;
revoke all on function app.mark_outbox_delivered(text) from public, anon, authenticated;
revoke all on function app.fail_outbox(text, text) from public, anon, authenticated;
grant execute on function app.claim_outbox(int) to service_role;
grant execute on function app.mark_outbox_delivered(text) to service_role;
grant execute on function app.fail_outbox(text, text) to service_role;

revoke all on function app.content_publish_version_v2(uuid,int,timestamptz,timestamptz,text) from public, anon, authenticated;
grant execute on function app.content_publish_version_v2(uuid,int,timestamptz,timestamptz,text) to authenticated;
revoke all on function app.content_publish_due() from public, anon, authenticated;
grant execute on function app.content_publish_due() to service_role;

commit;
