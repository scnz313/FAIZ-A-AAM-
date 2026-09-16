-- ---------------------------------------------------------------------------
-- 000127 — content version author directory
--
-- Content versions store only the author's account id, so the page editor's
-- status strip rendered "Last saved by staff" where a name belongs. The
-- identity tables are scope-gated separately: `staff_read_accounts` /
-- `staff_read_people` were retired by the scope hardening (000025), leaving
-- content staff unable to read another account's user_accounts row — the
-- PostgREST author embed on content.list therefore resolves only for the
-- caller's own account or for system administrators.
--
-- This function returns the display-name directory for one content item's
-- version authors under the same AAL2 + content scope as the item read, and
-- refuses an out-of-scope or unauthenticated caller. It mirrors
-- app.admission_reviewer_directory (000074).
-- ---------------------------------------------------------------------------

create or replace function app.content_author_directory(p_content_item_id uuid)
returns setof jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (app.is_staff_aal2() and app.has_any_role(array['content_editor', 'content_publisher', 'auditor'])) then
    raise exception 'content author directory is outside the staff scope';
  end if;

  return query
  select jsonb_build_object('accountId', ua.id, 'displayName', p.display_name)
    from public.content_versions cv
    join public.user_accounts ua on ua.id = cv.author_account_id
    join public.people p on p.id = ua.person_id
   where cv.content_item_id = p_content_item_id
   group by ua.id, p.display_name
   order by p.display_name, ua.id;
end
$$;

revoke all on function app.content_author_directory(uuid) from public, anon;
grant execute on function app.content_author_directory(uuid) to authenticated;
