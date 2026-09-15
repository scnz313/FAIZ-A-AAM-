-- =============================================================================
-- 000120 — A published notice never carries a stale unpublished_at
--
-- Verified defect (demo reconciliation, 15 September 2026): notice
-- `NTC-2026-583F16E84C` ended up `status = published` with
-- `unpublished_at` set from an earlier unpublish, because
-- `app.content_publish_version_v2` (000085) and the scheduled-publish sweep
-- `app.content_publish_due()` set `status/published_at` but never cleared
-- `unpublished_at`. The UI does not render the column today, so the
-- contradiction was only visible in SQL, but the row was wrong.
--
-- Forward-only from 000119. Validated and applied by the central process.
-- =============================================================================

begin;

create or replace function app.clear_notice_unpublished_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'published' then
    new.unpublished_at := null;
  end if;
  return new;
end
$$;

drop trigger if exists notices_clear_unpublished_at on public.notices;
create trigger notices_clear_unpublished_at
  before update on public.notices
  for each row execute function app.clear_notice_unpublished_at();

-- Repair any existing published rows carrying a stale timestamp.
update public.notices
   set unpublished_at = null
 where status = 'published'
   and unpublished_at is not null;

commit;
