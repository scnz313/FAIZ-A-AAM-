-- =============================================================================
-- 000082 — Staff content CRUD completion (slice C7)
--
-- Closes the remaining audited content-CRUD gaps:
--   1. `notices.pinned` did not exist, so a pinned notice was demo-only, and
--      `review_due` was never written by any command. Both are now stored on
--      the mutable notice projection from the immutable version metadata
--      (`metadata.pinned`, `metadata.reviewDue`) that the composer saves.
--   2. `content_unpublish_v2` had no idempotency key, so a browser retry of an
--      unpublish could archive the item twice (the item version incremented a
--      second time). `content_unpublish_v3` records the command result keyed by
--      the caller's idempotency key and replays it without a second archive,
--      a second audit row, or a second admin mutation. The v2 signature and
--      its grants stay in place for callers that have not migrated.
--
-- The audience-writing behavior from 000079 and the scheduling/expiry
-- enqueue behavior from 000080 are preserved exactly; this migration only
-- extends those definitions. Signatures, state transitions, versioning, and
-- maker/checker rules are unchanged. All database corrections are forward-only
-- (000082 is the next free number); remote applications remain frozen.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Pin flag on the mutable notice projection
-- ---------------------------------------------------------------------------

alter table public.notices
  add column if not exists pinned boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. Draft save writes pinned / review_due from the immutable draft metadata
--
-- Latest definition is 000079. Reproduced with the metadata projection added;
-- audience writing is byte-for-byte unchanged.
-- ---------------------------------------------------------------------------

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
declare v_item public.content_items%rowtype; v_version public.content_versions%rowtype; v_next int; v_existing public.content_versions%rowtype; v_notice public.notices%rowtype;
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
    select * into v_notice from public.notices where content_item_id=v_item.id;
    if v_notice.id is not null then
      update public.notices
         set pinned=(lower(coalesce(p_body->'metadata'->>'pinned',''))='true'),
             review_due=case when (p_body->'metadata'->>'reviewDue') ~ '^\d{4}-\d{2}-\d{2}$' then (p_body->'metadata'->>'reviewDue')::date else null end
       where id=v_notice.id;
      if not exists (select 1 from public.notice_audiences na where na.notice_id=v_notice.id) then
        if lower(coalesce(p_body->'metadata'->>'audience','')) = 'family' then
          insert into public.notice_audiences(notice_id,audience,role_code) values(v_notice.id,'role','guardian') on conflict do nothing;
        else
          insert into public.notice_audiences(notice_id,audience) values(v_notice.id,'public') on conflict do nothing;
        end if;
      end if;
    end if;
  end if;
  return jsonb_build_object('id',v_item.id,'reference',v_item.reference,'versionId',v_version.id,'version',v_next,'status','draft','replayed',false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Publish writes pinned / review_due from the immutable published metadata
--
-- Latest definition is 000080 (audience + schedule/expiry enqueue). Reproduced
-- with the metadata projection added; every other line is unchanged.
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
  update public.content_items set current_status=v_status,current_version_id=v_next.id,version=v_next.version where id=v_item.id;
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
  if v_notice.id is not null then
    if v_status='scheduled' then
      v_event:=app.enqueue_outbox('content.publish:'||v_notice.reference||':'||v_next.version,'content.publish','notice',v_notice.reference,jsonb_build_object('version',v_next.version,'scheduledAt',p_scheduled_at));
      if v_event.id is not null and v_event.status in ('pending','processing') and p_scheduled_at>now() then
        update public.outbox_events set next_attempt_at=p_scheduled_at where id=v_event.id and status in ('pending','processing');
      end if;
    end if;
    if p_expires_at is not null then
      v_event:=app.enqueue_outbox('content.expire:'||v_notice.reference||':'||p_expires_at::date||':'||v_next.version,'content.expire','notice',v_notice.reference,jsonb_build_object('version',v_next.version,'expiresAt',p_expires_at));
      if v_event.id is not null and v_event.status in ('pending','processing') and p_expires_at>now() then
        update public.outbox_events set next_attempt_at=p_expires_at where id=v_event.id and status in ('pending','processing');
      end if;
    end if;
  end if;
  return jsonb_build_object('id',v_item.id,'reference',v_item.reference,'versionId',v_next.id,'version',v_next.version,'status',v_status,'replayed',v_next.id<>v_version.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Idempotent unpublish (v3)
--
-- v2 has no idempotency key, so a replay could archive twice. v3 records the
-- completed command in `idempotency_records` keyed by the caller's key (the
-- same record mechanics the other content commands use for retry safety) and
-- replays the stored result before touching the item. The archive, audit row,
-- and expiry projection run exactly once. v2 remains untouched below.
-- ---------------------------------------------------------------------------

create or replace function app.content_unpublish_v3(
  p_content_item_id uuid,
  p_reason text,
  p_expected_version int default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.content_items%rowtype;
  v_notice public.notices%rowtype;
  v_record public.idempotency_records%rowtype;
  v_key text;
  v_hash text;
  v_result jsonb;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('content_publisher')) then raise exception 'content publisher role and aal2 required'; end if;
  if p_reason is null or length(btrim(p_reason))<3 then raise exception 'unpublish reason is required'; end if;
  v_key := nullif(btrim(coalesce(p_idempotency_key,'')), '');
  v_hash := md5(p_content_item_id::text||'|'||btrim(p_reason)||'|'||coalesce(p_expected_version::text,''));
  if v_key is not null then
    select * into v_record from public.idempotency_records where operation_key=v_key for update;
    if v_record.id is not null then
      if v_record.request_hash<>v_hash then raise exception 'idempotency key was already used for another request'; end if;
      if v_record.state<>'completed' then raise exception 'operation is already in progress'; end if;
      return coalesce(v_record.result, '{}'::jsonb)||jsonb_build_object('replayed',true);
    end if;
  end if;
  select * into v_item from public.content_items where id=p_content_item_id for update; if v_item.id is null then raise exception 'content item not found'; end if;
  if p_expected_version is not null and v_item.version<>p_expected_version then raise exception 'content version mismatch (expected %, found %)',p_expected_version,v_item.version; end if;
  update public.content_items set current_status='archived',version=version+1 where id=v_item.id;
  update public.notices set status='expired',unpublished_at=now() where content_item_id=v_item.id returning * into v_notice;
  perform app.record_audit('Content unpublished','content_item',v_item.reference,'Success',btrim(p_reason));
  v_result := jsonb_build_object('id',v_item.id,'status','archived','version',v_item.version+1,'replayed',false);
  if v_key is not null then
    insert into public.idempotency_records(operation_key,request_hash,state,result) values(v_key,v_hash,'completed',v_result);
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants (restated; CREATE OR REPLACE preserves existing v2 grants, v3 is
--    authenticated-only and never executable by anon or the public role)
-- ---------------------------------------------------------------------------

revoke all on function app.content_save_draft_v2(uuid,text,text,text,jsonb,int,text) from public, anon, authenticated;
grant execute on function app.content_save_draft_v2(uuid,text,text,text,jsonb,int,text) to authenticated;
revoke all on function app.content_publish_version_v2(uuid,int,timestamptz,timestamptz,text) from public, anon, authenticated;
grant execute on function app.content_publish_version_v2(uuid,int,timestamptz,timestamptz,text) to authenticated;
revoke all on function app.content_unpublish_v3(uuid,text,int,text) from public, anon, authenticated;
grant execute on function app.content_unpublish_v3(uuid,text,int,text) to authenticated;

commit;
