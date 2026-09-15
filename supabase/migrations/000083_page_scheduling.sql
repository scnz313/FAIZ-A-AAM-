-- =============================================================================
-- 000083 — Scheduled public pages publish when due (slice C7 gap)
--
-- A scheduled public page was a dead control in Supabase mode: `notices` was
-- the only place `content_publish_version_v2` stored a schedule, and pages
-- have no notice row. `content_publish_due()` swept only scheduled notices,
-- so the C7 "Schedule" action advanced a page to `scheduled` and nothing ever
-- moved it to `published`. `mapServerPublicPageRow` could not read the
-- effective instant either.
--
-- This migration adds `content_items.scheduled_at` for the page schedule and
-- extends the two latest definitions:
--   * `content_publish_version_v2` (latest was 000082) stores the future
--     instant on the page item, clears it on an immediate publish, and
--     enqueues the same delayed `content.publish` event the notice path uses
--     so the worker sweeps `content_publish_due()` at the effective time.
--     Notice behavior is preserved exactly: `notices.scheduled_at`, audience
--     writes, pinned/review_due projection, the publish email, and the expiry
--     enqueue all keep their existing shape.
--   * `content_publish_due()` (latest was 000029) also sweeps due pages:
--     append and point the published version, clear the item schedule, record
--     the audit row, and enqueue one
--     `content.scheduled_published:<ref>:<version>` event. The item state
--     change makes a second sweep a no-op, and the unique event key keeps the
--     replay from stacking events.
--
-- Signatures, grants, maker/checker rules, and the service-role-only due
-- function are unchanged. All database corrections are forward-only; remote
-- applications remain frozen.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Page schedule lives on the mutable content item
-- ---------------------------------------------------------------------------

alter table public.content_items
  add column if not exists scheduled_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Publish stores the page schedule and enqueues the delayed sweep
--
-- Latest definition is 000082 (pinned/review_due + schedule/expiry enqueue).
-- The notice block is reproduced byte-for-byte; the item update additionally
-- persists the page schedule and the scheduled branch falls back to the item
-- reference for page items that have no notice row.
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
  if v_status='published' and v_notice.id is not null then
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
-- 3. The due sweep publishes scheduled pages as well as notices
--
-- Latest definition is 000029; the notice loop is reproduced byte-for-byte
-- and a page loop follows it. A page has no notice projection, so "published"
-- is the version append/point, the cleared item schedule, the audit row, and
-- one `content.scheduled_published` event.
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
    perform app.enqueue_outbox('content.scheduled_published:'||v_notice.reference||':'||v_next.version,'email.deliver','notice',v_notice.reference,jsonb_build_object('channel','email'));
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
-- 4. Grants (restated; CREATE OR REPLACE preserves them, this keeps the
--    migration self-contained and the due function service-role only)
-- ---------------------------------------------------------------------------

revoke all on function app.content_publish_version_v2(uuid,int,timestamptz,timestamptz,text) from public, anon, authenticated;
grant execute on function app.content_publish_version_v2(uuid,int,timestamptz,timestamptz,text) to authenticated;
revoke all on function app.content_publish_due() from public, anon, authenticated;
grant execute on function app.content_publish_due() to service_role;

commit;
