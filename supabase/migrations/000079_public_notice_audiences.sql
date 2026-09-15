-- =============================================================================
-- 000079 — Public notices become readable end to end (slice C1)
--
-- Closes two audited defects:
--   1. `notice_audiences` had no writer. A notice created through the content
--      workflow never received an audience row, so `app.public_notice_ids()`
--      stayed empty and anonymous readers could not see it.
--   2. Anonymous SELECT on `content_items`/`content_versions` covered pages
--      only, so even a public notice body was unreadable on the public site.
--
-- Audience mapping (the commands receive the reviewed audience through the
-- immutable version body metadata):
--   * metadata.audience = 'family'  -> ('role', role_code 'guardian')
--   * anything else (including no metadata) -> ('public')
-- Family notices are never given a public audience row, so the anon policies
-- below cannot expose a non-public audience. The commands only add a row when
-- the notice has none; existing rows are never rewritten or removed.
--
-- All database corrections are forward-only. Remote applications are frozen.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Content commands write the audience row
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
    if v_notice.id is not null and not exists (select 1 from public.notice_audiences na where na.notice_id=v_notice.id) then
      if lower(coalesce(p_body->'metadata'->>'audience','')) = 'family' then
        insert into public.notice_audiences(notice_id,audience,role_code) values(v_notice.id,'role','guardian') on conflict do nothing;
      else
        insert into public.notice_audiences(notice_id,audience) values(v_notice.id,'public') on conflict do nothing;
      end if;
    end if;
  end if;
  return jsonb_build_object('id',v_item.id,'reference',v_item.reference,'versionId',v_version.id,'version',v_next,'status','draft','replayed',false);
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
  return jsonb_build_object('id',v_item.id,'reference',v_item.reference,'versionId',v_next.id,'version',v_next.version,'status',v_status,'replayed',v_next.id<>v_version.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Backfill existing published/scheduled notices without an audience row
-- ---------------------------------------------------------------------------

insert into public.notice_audiences (notice_id, audience, role_code)
select n.id,
       case when exists (
              select 1 from public.content_versions cv
               where cv.content_item_id = n.content_item_id
                 and lower(coalesce(cv.body->'metadata'->>'audience','')) = 'family'
            ) then 'role' else 'public' end,
       case when exists (
              select 1 from public.content_versions cv
               where cv.content_item_id = n.content_item_id
                 and lower(coalesce(cv.body->'metadata'->>'audience','')) = 'family'
            ) then 'guardian' else null end
  from public.notices n
 where n.status in ('published', 'scheduled')
   and not exists (select 1 from public.notice_audiences na where na.notice_id = n.id)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Anonymous reads for published, public-audience notices only
-- ---------------------------------------------------------------------------

drop policy if exists anon_read_published_notice_items on public.content_items;
create policy anon_read_published_notice_items on public.content_items
  for select to anon
  using (kind = 'notice' and current_status = 'published'
         and id in (select n.content_item_id
                      from public.notices n
                     where n.status = 'published'
                       and n.id = any(app.public_notice_ids())));

drop policy if exists anon_read_published_notice_versions on public.content_versions;
create policy anon_read_published_notice_versions on public.content_versions
  for select to anon
  using (content_item_id in (select id from public.content_items
         where kind = 'notice' and current_status = 'published'
           and id in (select n.content_item_id
                        from public.notices n
                       where n.status = 'published'
                         and n.id = any(app.public_notice_ids()))));

/* Grants already exist from 000008; restated so the migration is self-contained. */
grant select on public.content_items, public.content_versions, public.notices to anon;

commit;
