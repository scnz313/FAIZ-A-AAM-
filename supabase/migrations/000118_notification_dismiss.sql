-- =============================================================================
-- 000118 — Notification dismissal: an account can clear its in-app notices
--
-- The bell can mark notices read but never remove them. Once
-- `app.project_notification_event*` writes a row, it stays in the account's
-- list forever, so a busy week of timetable or finance events leaves a list
-- that only a read marker can quiet. This forward migration adds a soft
-- dismissal (`dismissed_at`) and two account-scoped commands:
--
--   · `app.notifications_dismiss(p_notification_id, p_expected_version)`
--     dismisses one owned notification. It follows the
--     `notifications_mark_read` contract: the row must belong to the caller,
--     the version must match, and a replay at the stored version is
--     idempotent (no version bump). Dismissal implies read — `read_at` is
--     filled when unset — so the unread projection and the list projection
--     can never disagree about a cleared row.
--   · `app.notifications_dismiss_all()` dismisses every non-dismissed owned
--     row and returns the count changed. Like `notifications_mark_all` it
--     has no version guard (a batch cannot have one) and is idempotent.
--
-- Rows are never hard-deleted. The projection's unique
-- `(source_event_id, recipient_account_id)` idempotency key must survive a
-- dismissal so a replayed outbox event can never re-create a cleared
-- notification, and the recipient history of the row is preserved. The
-- application list and unread projections exclude `dismissed_at is not null`
-- rows; the row stays owner-readable through RLS, nothing else can see it.
--
-- The partial index keeps the active list scan on the non-dismissed set.
-- Only `authenticated` may execute the two commands; `anon` and `public` are
-- revoked. Forward-only from 000117 (reference entropy). Validated on the
-- local scratch chain and applied to staging by the central process.
-- =============================================================================

begin;

alter table public.in_app_notifications
  add column if not exists dismissed_at timestamptz;

create index if not exists in_app_notifications_active_recipient_idx
  on public.in_app_notifications (recipient_account_id, created_at desc)
  where dismissed_at is null;

create or replace function app.notifications_dismiss(p_notification_id uuid,p_expected_version int default 1)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.in_app_notifications%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  select * into v_row from public.in_app_notifications where id=p_notification_id and recipient_account_id=auth.uid() for update;
  if v_row.id is null then raise exception 'notification not found'; end if;
  if v_row.version<>coalesce(p_expected_version,1) then raise exception 'notification version mismatch (expected %, found %)',p_expected_version,v_row.version; end if;
  if v_row.dismissed_at is null then
    update public.in_app_notifications
       set dismissed_at=now(),read_at=coalesce(read_at,now()),version=version+1
     where id=v_row.id
    returning * into v_row;
  end if;
  return jsonb_build_object('id',v_row.id,'dismissedAt',v_row.dismissed_at,'readAt',v_row.read_at,'version',v_row.version);
end;
$$;

create or replace function app.notifications_dismiss_all()
returns int language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  update public.in_app_notifications
     set dismissed_at=now(),read_at=coalesce(read_at,now()),version=version+1
   where recipient_account_id=auth.uid() and dismissed_at is null;
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

revoke all on function app.notifications_dismiss(uuid,int) from public, anon, authenticated;
revoke all on function app.notifications_dismiss_all() from public, anon, authenticated;
grant execute on function app.notifications_dismiss(uuid,int), app.notifications_dismiss_all() to authenticated;

commit;
