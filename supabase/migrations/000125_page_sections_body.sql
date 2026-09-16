-- =============================================================================
-- 000125 — Structured page-sections bodies + publisher page drafting
--
-- The public `/school-life` page becomes a managed page: a `content_items`
-- row (kind 'page', slug 'school-life') whose immutable version body is a
-- structured page-sections document (intro / programmes / facilities /
-- gallery / note) instead of the paragraph `blocks` array.
--
--   1. `app.content_validate_body` accepts EITHER the existing blocks shape
--      OR the page-sections shape. It stays immutable and returns the body;
--      malformed structures raise user-safe errors.
--   2. `app.content_save_draft_v2` (latest: 000082, reproduced verbatim)
--      widens its role guard so a `content_publisher` may also draft items of
--      kind 'page'. Notices stay editor-only. Self-publish remains refused by
--      `content_publish_version_v2` (`publisher cannot publish their own
--      edited version`), which is unchanged.
--   3. `app.content_request_review` (latest: 000029) gains the matching
--      page-aware guard: without it a publisher-authored page draft could
--      never be submitted — the author check would deny an editor and the
--      role check would deny the publishing author.
--
-- All database corrections are forward-only; remote applications are frozen.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Body validation: blocks OR page sections
-- ---------------------------------------------------------------------------

create or replace function app.content_validate_body(p_body jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
begin
  if p_body is null or jsonb_typeof(p_body) <> 'object' then raise exception 'content body must be a JSON object'; end if;

  /* Structured page body: schema marker + the four section arrays. Any body
     that declares the markers is validated fully as a page — a partial shape
     never falls through to the blocks branch. */
  if p_body ? 'schemaVersion' and p_body ? 'page' then
    if jsonb_typeof(p_body->'intro') is distinct from 'object'
       or length(btrim(coalesce(p_body->'intro'->>'title',''))) = 0 then
      raise exception 'page body must include an intro with a title';
    end if;
    if jsonb_typeof(p_body->'programmes') is distinct from 'array'
       or jsonb_array_length(p_body->'programmes') < 1
       or jsonb_array_length(p_body->'programmes') > 8 then
      raise exception 'page programmes must be an array of 1 to 8 items';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_body->'programmes') item
       where jsonb_typeof(item) <> 'object'
          or length(btrim(coalesce(item->>'title',''))) = 0
          or length(btrim(coalesce(item->>'line',''))) = 0
          or length(btrim(coalesce(item->>'icon',''))) = 0
    ) then raise exception 'page programmes require icon, title and line'; end if;
    if jsonb_typeof(p_body->'facilities') is distinct from 'array'
       or jsonb_array_length(p_body->'facilities') < 1
       or jsonb_array_length(p_body->'facilities') > 8 then
      raise exception 'page facilities must be an array of 1 to 8 items';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_body->'facilities') item
       where jsonb_typeof(item) <> 'object'
          or length(btrim(coalesce(item->>'title',''))) = 0
          or length(btrim(coalesce(item->>'line',''))) = 0
    ) then raise exception 'page facilities require title and line'; end if;
    if jsonb_typeof(p_body->'gallery') is distinct from 'array'
       or jsonb_array_length(p_body->'gallery') < 1
       or jsonb_array_length(p_body->'gallery') > 6 then
      raise exception 'page gallery must be an array of 1 to 6 items';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_body->'gallery') item
       where jsonb_typeof(item) <> 'object'
          or length(btrim(coalesce(item->>'caption',''))) = 0
          or length(btrim(coalesce(item->>'art',''))) = 0
    ) then raise exception 'page gallery items require art and caption'; end if;
    return p_body;
  end if;

  if not (p_body ? 'blocks') then raise exception 'content body must include blocks'; end if;
  if jsonb_typeof(p_body->'blocks') <> 'array' then raise exception 'content blocks must be an array'; end if;
  if exists (select 1 from jsonb_array_elements(p_body->'blocks') block where jsonb_typeof(block)<>'object' or not (block ? 'type') or not (block ? 'text')) then raise exception 'content blocks require type and text'; end if;
  return p_body;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Draft save: content_publisher may draft items of kind 'page'
--
-- Latest definition is 000082 (audience writing from 000079, pinned /
-- review_due projection). Reproduced verbatim except the role guard.
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
  if auth.uid() is null or not (app.is_staff_aal2() and (app.has_role('content_editor') or (coalesce(p_kind,'notice') = 'page' and app.has_role('content_publisher')))) then raise exception 'content editor role and aal2 required'; end if;
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
-- 3. Request review: page items accept the publisher who authored them
--
-- Latest definition is 000029. The author check is unchanged; only the role
-- guard becomes page-aware so a publisher-authored page draft is not stuck
-- in a state nobody can submit.
-- ---------------------------------------------------------------------------

create or replace function app.content_request_review(
  p_version_id uuid,
  p_expected_version int default null,
  p_idempotency_key text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_version public.content_versions%rowtype; v_item public.content_items%rowtype; v_next public.content_versions%rowtype; v_next_number int;
begin
  if auth.uid() is null or not app.is_staff_aal2() then raise exception 'content editor role and aal2 required'; end if;
  select * into v_version from public.content_versions where id=p_version_id; if v_version.id is null then raise exception 'content version not found'; end if;
  if p_expected_version is not null and v_version.version<>p_expected_version then raise exception 'content version mismatch (expected %, found %)',p_expected_version,v_version.version; end if;
  select * into v_item from public.content_items where id=v_version.content_item_id for update;
  if not (app.has_role('content_editor') or (v_item.kind='page' and app.has_role('content_publisher'))) then raise exception 'content editor role and aal2 required'; end if;
  if v_version.author_account_id<>auth.uid() and not app.has_role('system_administrator') then raise exception 'only the content editor may request review'; end if;
  if p_idempotency_key is not null then select * into v_next from public.content_versions where idempotency_key=p_idempotency_key; end if;
  if v_next.id is null then
    select coalesce(max(version),0)+1 into v_next_number from public.content_versions where content_item_id=v_version.content_item_id;
    insert into public.content_versions(content_item_id,version,title,body,author_account_id,review_status,idempotency_key)
    values(v_version.content_item_id,v_next_number,v_version.title,v_version.body,v_version.author_account_id,'in_review',nullif(btrim(p_idempotency_key),'')) returning * into v_next;
  end if;
  update public.content_items set current_status='draft',version=v_next.version,current_version_id=v_next.id where id=v_item.id;
  perform app.record_audit('Content review requested','content_item',v_item.reference,'Success');
  return jsonb_build_object('id',v_next.id,'status','in_review','version',v_next.version,'replayed',v_next.id<>v_version.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants (restated; CREATE OR REPLACE preserves existing grants, and the
--    functions remain authenticated-only — never executable by anon/public)
-- ---------------------------------------------------------------------------

revoke all on function app.content_validate_body(jsonb) from public, anon;
grant execute on function app.content_validate_body(jsonb) to authenticated;
revoke all on function app.content_save_draft_v2(uuid,text,text,text,jsonb,int,text) from public, anon, authenticated;
grant execute on function app.content_save_draft_v2(uuid,text,text,text,jsonb,int,text) to authenticated;
revoke all on function app.content_request_review(uuid,int,text) from public, anon, authenticated;
grant execute on function app.content_request_review(uuid,int,text) to authenticated;

commit;
