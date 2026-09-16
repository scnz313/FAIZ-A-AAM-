-- 000126: keep published page versions reachable while newer drafts exist.
--
-- content_save_draft_v2 / content_request_review move the item's
-- current_status to 'draft' and current_version_id to the newest version.
-- The anonymous RLS policies (anon_read_published_pages /
-- anon_read_published_versions, 000008) require current_status='published',
-- so a single new draft would take a previously published page offline even
-- though an older published version still exists.
--
-- This function gives the anonymous/public surface a stable read path: it
-- returns the title + body of the LATEST version whose review_status is
-- 'published' for a page slug, regardless of the item's current_status.
-- Staff flows are untouched: drafts, review, approval and publish keep their
-- existing state machine and the public page swaps only on publish; an
-- archived item is never served.

create or replace function app.public_page_body(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_version public.content_versions%rowtype;
begin
  if p_slug is null or btrim(p_slug) = '' then return null; end if;

  select cv.* into v_version
    from public.content_versions cv
    join public.content_items ci on ci.id = cv.content_item_id
   where ci.kind = 'page'
     and ci.slug = btrim(p_slug)
     and ci.current_status <> 'archived'
     and cv.review_status = 'published'
   order by cv.version desc
   limit 1;

  if v_version.id is null then return null; end if;

  return jsonb_build_object(
    'title', v_version.title,
    'body', v_version.body,
    'version', v_version.version,
    'publishedAt', v_version.published_at
  );
end;
$$;

revoke all on function app.public_page_body(text) from public;
grant execute on function app.public_page_body(text) to anon, authenticated;
