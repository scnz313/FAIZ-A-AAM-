-- =============================================================================
-- 000080 — Scheduled notice publication and expiry become real work (slice C2)
--
-- Closes two audited defects:
--   1. `content_publish_due()`/`content_expire_due()` existed but nothing
--      ever enqueued them, so a scheduled notice never published and an
--      expired notice stayed published until someone ran the function by
--      hand. The worker already dispatched `content.publish` but no handler
--      existed for expiry, and 000037 removed the outbox event 000029 wrote
--      when a notice expired.
--   2. `provider_jobs.job_kind` did not allowlist an expiry job kind.
--
-- The publish command now writes two idempotent outbox events:
--   * `content.publish:<notice>:<version>` (kind `content.publish`) when the
--     requested schedule is in the future, delayed to the effective time so
--     the worker sweeps `content_publish_due()` when the notice is due.
--   * `content.expire:<notice>:<expires-on>:<version>` (kind `content.expire`)
--     when the publish carries an expiry, delayed to the expiry time so the
--     worker sweeps `content_expire_due()` when it is due.
-- Both keys are unique, so a replay of the same command (`on conflict do
-- nothing`) never stacks duplicate events. The event row that already exists
-- is returned and is never resurrected once delivered.
--
-- `content_expire_due()` once again records the `Notice expired` audit row
-- and enqueues one `content.expired:<notice>:<version>` event (kind
-- `content.expired`, target the notice) per expired notice, restoring the
-- 000029 fan-out that 000037 removed. The in-app projection trigger reads
-- that event; the worker acknowledges it without provider work.
--
-- Signatures, state transitions, versioning, maker/checker rules, and grants
-- are unchanged. All database corrections are forward-only; remote
-- applications are frozen.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Allowlist the expiry job kind
-- ---------------------------------------------------------------------------

alter table public.provider_jobs drop constraint if exists provider_jobs_job_kind_check;
alter table public.provider_jobs
  add constraint provider_jobs_job_kind_check check (job_kind in (
    'storage_finalize', 'storage_scan', 'storage_orphan_cleanup',
    'document_retention', 'pdf_generate', 'email_delivery',
    'content_publish', 'settings_effective',
    'data_export_generate', 'data_import_parse',
    'content_expire', 'content.expire'
  ));

-- ---------------------------------------------------------------------------
-- 2. The publish command enqueues the schedule and expiry sweeps
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
    update public.notices set status=v_status,scheduled_at=p_scheduled_at,expires_at=p_expires_at,published_at=case when v_status='published' then now() else null end,published_by_account_id=case when v_status='published' then auth.uid() else null end where id=v_notice.id;
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
-- 3. Expiry restores its audit row and its domain event
-- ---------------------------------------------------------------------------

-- `content.expire` is only the scheduler trigger for the sweep: the notice is
-- still published when it is enqueued, so it must not project an in-app
-- notification. The real expiry event (`content.expired`) is enqueued by
-- `content_expire_due()` when the notice actually expires and still projects.
create or replace function app.project_notification_event_v2_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if new.kind <> 'content.expire' then
      perform app.project_notification_event_v2(new.id);
    end if;
  exception when others then
    null;
  end;
  return new;
end
$$;

create or replace function app.content_expire_due()
returns int language plpgsql security definer set search_path = '' as $$
declare v_count int:=0; v_notice public.notices%rowtype; v_item public.content_items%rowtype;
begin
  for v_notice in select * from public.notices where status='published' and expires_at is not null and expires_at<=now() for update loop
    update public.notices set status='expired' where id=v_notice.id;
    update public.content_items set current_status='expired' where id=v_notice.content_item_id returning * into v_item;
    insert into public.audit_events(actor_label,action,target_type,target_reference,outcome,reason) values('Content scheduler','Notice expired','notice',v_notice.reference,'Success','Expiry reached');
    perform app.enqueue_outbox('content.expired:'||v_notice.reference||':'||v_item.version,'content.expired','notice',v_notice.reference);
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants (restated; CREATE OR REPLACE preserves them, this keeps the
--    migration self-contained and the due functions service-role only)
-- ---------------------------------------------------------------------------

revoke all on function app.content_publish_version_v2(uuid,int,timestamptz,timestamptz,text) from public, anon, authenticated;
grant execute on function app.content_publish_version_v2(uuid,int,timestamptz,timestamptz,text) to authenticated;
revoke all on function app.content_expire_due() from public, anon, authenticated;
grant execute on function app.content_expire_due() to service_role;

commit;
