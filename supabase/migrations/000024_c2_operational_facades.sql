-- =============================================================================
-- 000024 — C2.4 remaining operational facades
--
-- Careers, content, support, settings, audit, and notifications are exposed
-- through server-authorized commands/read projections. Public support intake
-- accepts no predictable record lookup and is rate limited by a server key.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Careers: cross-device drafts, withdrawal, version-safe decisions, review
-- assignment, scorecards, and interviews.
-- ---------------------------------------------------------------------------
create table if not exists public.job_application_drafts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.job_applications(id) on delete cascade,
  draft jsonb not null default '{}'::jsonb,
  schema_version int not null default 1,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create trigger job_application_drafts_touch before update on public.job_application_drafts
  for each row execute function app.touch_updated_at();
alter table public.job_application_drafts enable row level security;
revoke all on public.job_application_drafts from anon, authenticated;
create policy job_draft_owner on public.job_application_drafts
  for all to authenticated
  using (application_id in (select id from public.job_applications where owner_account_id = auth.uid()))
  with check (application_id in (select id from public.job_applications where owner_account_id = auth.uid()));
grant select, insert, update on public.job_application_drafts to authenticated;

create or replace function app.jobs_save_draft(
  p_application_id uuid,
  p_draft jsonb,
  p_schema_version int default 1,
  p_expected_version int default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_app public.job_applications%rowtype; v_row public.job_application_drafts%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  select * into v_app from public.job_applications where id = p_application_id;
  if v_app.id is null or v_app.owner_account_id <> auth.uid() then raise exception 'not the application owner'; end if;
  if v_app.current_status not in ('draft','eligibility_review') then raise exception 'application is not in an editable state (%)', v_app.current_status; end if;
  if p_expected_version is not null and v_app.version <> p_expected_version then raise exception 'application version mismatch (expected %, found %)', p_expected_version, v_app.version; end if;
  insert into public.job_application_drafts (application_id, draft, schema_version, expires_at)
  values (p_application_id, coalesce(p_draft,'{}'::jsonb), p_schema_version, now() + interval '90 days')
  on conflict (application_id) do update set draft = excluded.draft, schema_version = excluded.schema_version, expires_at = excluded.expires_at, updated_at = now()
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'applicationId', v_row.application_id, 'version', v_app.version, 'updatedAt', v_row.updated_at);
end $$;

create or replace function app.jobs_withdraw(p_application_id uuid, p_expected_version int default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_app public.job_applications%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  select * into v_app from public.job_applications where id = p_application_id for update;
  if v_app.id is null or v_app.owner_account_id <> auth.uid() then raise exception 'not the application owner'; end if;
  if p_expected_version is not null and v_app.version <> p_expected_version then raise exception 'application version mismatch (expected %, found %)', p_expected_version, v_app.version; end if;
  if v_app.current_status in ('withdrawn','not_selected') then return; end if;
  update public.job_applications set current_status = 'withdrawn', version = v_app.version + 1 where id = p_application_id;
  insert into public.job_events (application_id, event_type, visible_to_applicant, copy) values (p_application_id, 'withdrawn', true, 'Application withdrawn');
  perform app.record_audit('Job application withdrawn', 'job_application', v_app.reference, 'Success');
end $$;

create or replace function app.jobs_assign_reviewer(p_application_id uuid, p_reviewer_account_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_assignment public.job_review_assignments%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['hr_approver'])) then raise exception 'HR approver role and aal2 required'; end if;
  if p_reviewer_account_id = auth.uid() then raise exception 'approver cannot assign themselves as reviewer'; end if;
  insert into public.job_review_assignments (application_id, reviewer_account_id)
  values (p_application_id, p_reviewer_account_id)
  on conflict (application_id, reviewer_account_id) do update set status = 'assigned'
  returning * into v_assignment;
  return v_assignment.id::text;
end $$;

create or replace function app.jobs_save_scorecard(p_application_id uuid, p_score numeric, p_notes text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_row public.job_scorecards%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['hr_reviewer'])) then raise exception 'HR reviewer role and aal2 required'; end if;
  if p_score is null or p_score < 0 then raise exception 'score must be non-negative'; end if;
  if not exists (select 1 from public.job_review_assignments where application_id = p_application_id and reviewer_account_id = auth.uid() and status in ('assigned','accepted')) then raise exception 'reviewer assignment required'; end if;
  insert into public.job_scorecards (application_id, reviewer_account_id, score, notes) values (p_application_id, auth.uid(), p_score, p_notes) returning * into v_row;
  update public.job_review_assignments set status = 'completed' where application_id = p_application_id and reviewer_account_id = auth.uid();
  return v_row.id::text;
end $$;

create or replace function app.jobs_decide_v2(
  p_application_id uuid, p_action text, p_reason text default null,
  p_private_note text default null, p_scheduled_at timestamptz default null,
  p_expected_version int default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_app public.job_applications%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['hr_reviewer','hr_approver'])) then raise exception 'HR role and aal2 required'; end if;
  select * into v_app from public.job_applications where id = p_application_id for update;
  if v_app.id is null then raise exception 'application not found'; end if;
  if p_expected_version is not null and v_app.version <> p_expected_version then raise exception 'application version mismatch (expected %, found %)', p_expected_version, v_app.version; end if;
  if v_app.owner_account_id = auth.uid() then raise exception 'an HR reviewer cannot decide their own application'; end if;
  if p_action not in ('shortlist','interview','offer','not_selected') then raise exception 'invalid decision action'; end if;
  if p_action = 'interview' and p_scheduled_at is null then raise exception 'interview requires a scheduled time'; end if;
  update public.job_applications set current_status = case p_action when 'shortlist' then 'shortlisted' when 'interview' then 'interview' when 'offer' then 'offered' else 'not_selected' end, version = v_app.version + 1 where id = p_application_id;
  if p_action = 'interview' then insert into public.job_interviews (application_id, scheduled_at, outcome, notes) values (p_application_id, p_scheduled_at, 'pending', p_private_note); end if;
  insert into public.job_events (application_id, event_type, visible_to_applicant, copy) values (p_application_id, p_action, true, coalesce(p_reason, initcap(replace(p_action,'_',' '))));
  perform app.record_audit('Job decision: ' || p_action, 'job_application', v_app.reference, 'Success');
  return jsonb_build_object('applicationId', p_application_id, 'status', case p_action when 'shortlist' then 'shortlisted' when 'interview' then 'interview' when 'offer' then 'offered' else 'not_selected' end, 'version', v_app.version + 1);
end $$;

-- ---------------------------------------------------------------------------
-- Content: immutable draft versions with editor/publisher separation.
-- ---------------------------------------------------------------------------
create or replace function app.content_save_draft(
  p_content_item_id uuid, p_kind text, p_slug text, p_title text, p_body jsonb, p_expected_version int default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_item public.content_items%rowtype; v_version public.content_versions%rowtype; v_next int;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['content_editor'])) then raise exception 'content editor role and aal2 required'; end if;
  if p_content_item_id is null then
    insert into public.content_items (kind, slug, current_status) values (coalesce(p_kind,'notice'), p_slug, 'draft') returning * into v_item;
  else
    select * into v_item from public.content_items where id = p_content_item_id for update;
    if v_item.id is null then raise exception 'content item not found'; end if;
    if p_expected_version is not null and (select count(*) from public.content_versions where content_item_id = v_item.id) <> p_expected_version then raise exception 'content version mismatch'; end if;
  end if;
  select coalesce(max(version),0)+1 into v_next from public.content_versions where content_item_id = v_item.id;
  insert into public.content_versions (content_item_id, version, title, body, author_account_id, review_status) values (v_item.id, v_next, p_title, coalesce(p_body,'{}'::jsonb), auth.uid(), 'draft') returning * into v_version;
  update public.content_items set current_status = 'draft' where id = v_item.id;
  return jsonb_build_object('id', v_item.id, 'reference', v_item.reference, 'versionId', v_version.id, 'version', v_next, 'status', 'draft');
end $$;

create or replace function app.content_review_version(p_version_id uuid, p_outcome text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_version public.content_versions%rowtype; v_next int;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['content_editor'])) then raise exception 'content editor role and aal2 required'; end if;
  if p_outcome not in ('in_review','approved') then raise exception 'invalid content review outcome'; end if;
  select * into v_version from public.content_versions where id = p_version_id;
  if v_version.id is null then raise exception 'content version not found'; end if;
  select coalesce(max(version),0)+1 into v_next from public.content_versions where content_item_id = v_version.content_item_id;
  insert into public.content_versions (content_item_id, version, title, body, author_account_id, review_status)
  values (v_version.content_item_id, v_next, v_version.title, v_version.body, v_version.author_account_id, p_outcome);
end $$;

create or replace function app.content_publish_version(p_version_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_version public.content_versions%rowtype; v_next int;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['content_publisher'])) then raise exception 'content publisher role and aal2 required'; end if;
  select * into v_version from public.content_versions where id = p_version_id;
  if v_version.id is null then raise exception 'content version not found'; end if;
  if v_version.author_account_id = auth.uid() then raise exception 'publisher cannot publish their own edited version'; end if;
  if v_version.review_status not in ('approved','published') then raise exception 'content version is not approved'; end if;
  select coalesce(max(version),0)+1 into v_next from public.content_versions where content_item_id = v_version.content_item_id;
  insert into public.content_versions (content_item_id, version, title, body, author_account_id, review_status, published_at)
  values (v_version.content_item_id, v_next, v_version.title, v_version.body, v_version.author_account_id, 'published', now());
  update public.content_items set current_status = 'published' where id = v_version.content_item_id;
end $$;

create or replace function app.content_unpublish(p_content_item_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['content_publisher'])) then raise exception 'content publisher role and aal2 required'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'unpublish reason is required'; end if;
  update public.content_items set current_status = 'archived' where id = p_content_item_id;
end $$;

-- ---------------------------------------------------------------------------
-- Support: authenticated threads, private notes, and anonymous grievance
-- intake. Public records never expose a lookup endpoint.
-- ---------------------------------------------------------------------------
alter table public.support_requests
  alter column requester_account_id drop not null,
  add column if not exists requester_name text,
  add column if not exists requester_contact text,
  add column if not exists public_intake_key text,
  add column if not exists last_public_intake_at timestamptz;
create index if not exists support_public_intake_idx on public.support_requests (public_intake_key, created_at desc);

create or replace function app.support_create(
  p_category text, p_subject text, p_body text, p_priority text default 'normal'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_request public.support_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if length(trim(coalesce(p_subject,''))) = 0 or length(trim(coalesce(p_body,''))) = 0 then raise exception 'support subject and message are required'; end if;
  insert into public.support_requests (requester_account_id, category, subject, priority) values (auth.uid(), trim(p_category), trim(p_subject), coalesce(p_priority,'normal')) returning * into v_request;
  insert into public.support_messages (support_request_id, author_account_id, body, is_staff) values (v_request.id, auth.uid(), trim(p_body), false);
  return jsonb_build_object('id', v_request.id, 'reference', v_request.reference, 'status', v_request.status, 'version', v_request.version);
end $$;

create or replace function app.support_public_intake(
  p_category text, p_subject text, p_body text, p_contact text, p_requester_name text default null, p_intake_key text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_request public.support_requests%rowtype;
begin
  if length(trim(coalesce(p_subject,''))) = 0 or length(trim(coalesce(p_body,''))) = 0 then raise exception 'support subject and message are required'; end if;
  if length(trim(coalesce(p_contact,''))) < 5 then raise exception 'a safe contact is required'; end if;
  if p_intake_key is not null and (select count(*) from public.support_requests where public_intake_key = p_intake_key and created_at > now() - interval '1 hour') >= 5 then raise exception 'public support rate limit reached'; end if;
  insert into public.support_requests (requester_account_id, requester_name, requester_contact, public_intake_key, category, subject)
  values (auth.uid(), nullif(trim(p_requester_name),''), trim(p_contact), p_intake_key, trim(p_category), trim(p_subject)) returning * into v_request;
  -- Anonymous intake has no user_account id for a message author; keep the
  -- safe initial content in a support event instead of manufacturing identity.
  insert into public.support_events (support_request_id, event_type, detail) values (v_request.id, 'public_intake', trim(p_body));
  return jsonb_build_object('reference', v_request.reference, 'status', v_request.status);
end $$;

create or replace function app.support_reopen(p_request_id uuid, p_expected_version int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_request public.support_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  select * into v_request from public.support_requests where id = p_request_id for update;
  if v_request.id is null then raise exception 'request not found'; end if;
  if v_request.requester_account_id <> auth.uid() and not (app.is_staff_aal2() and app.has_any_role(array['support_officer'])) then raise exception 'not the request owner'; end if;
  if v_request.version <> p_expected_version then raise exception 'support version mismatch'; end if;
  update public.support_requests set status = 'open', resolved_at = null, version = version + 1 where id = p_request_id;
end $$;

create or replace function app.support_assign(p_request_id uuid, p_assignee_account_id uuid, p_expected_version int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_any_role(array['support_officer'])) then raise exception 'support officer role and aal2 required'; end if;
  update public.support_requests set assignee_account_id = p_assignee_account_id, status = 'assigned', version = version + 1 where id = p_request_id and version = p_expected_version;
  if not found then raise exception 'support version mismatch or request not found'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Settings and audit read projection.
-- ---------------------------------------------------------------------------
create or replace function app.settings_save(p_policy jsonb, p_reason text, p_expected_version int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_latest public.settings_versions%rowtype; v_new public.settings_versions%rowtype;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_any_role(array['system_administrator'])) then raise exception 'system administrator role and aal2 required'; end if;
  select * into v_latest from public.settings_versions order by version desc limit 1 for update;
  if coalesce(v_latest.version,0) <> p_expected_version then raise exception 'settings version mismatch (expected %, found %)', p_expected_version, coalesce(v_latest.version,0); end if;
  insert into public.settings_versions (version, status, policy, changed_by_account_id, change_reason) values (coalesce(v_latest.version,0)+1, 'draft', coalesce(p_policy,'{}'::jsonb), auth.uid(), trim(p_reason)) returning * into v_new;
  return jsonb_build_object('reference', v_new.reference, 'version', v_new.version, 'status', v_new.status);
end $$;

create or replace function app.audit_list(p_limit int default 100)
returns setof public.audit_events language sql security definer set search_path = '' as $$
  select ae.* from public.audit_events ae
   where app.is_staff_aal2()
     and (app.has_any_role(array['auditor']) or app.has_any_role(array['system_administrator']))
   order by ae.created_at desc limit least(greatest(coalesce(p_limit,100),1),500)
$$;

-- Account notifications are intentionally exposed through RLS only: the
-- recipient account can read and mark its own rows, never another account.
grant select, update on public.in_app_notifications to authenticated;

revoke all on function app.jobs_save_draft(uuid,jsonb,int,int) from public;
revoke all on function app.jobs_withdraw(uuid,int) from public;
revoke all on function app.jobs_assign_reviewer(uuid,uuid) from public;
revoke all on function app.jobs_save_scorecard(uuid,numeric,text) from public;
revoke all on function app.jobs_decide_v2(uuid,text,text,text,timestamptz,int) from public;
revoke all on function app.content_save_draft(uuid,text,text,text,jsonb,int) from public;
revoke all on function app.content_review_version(uuid,text) from public;
revoke all on function app.content_publish_version(uuid) from public;
revoke all on function app.content_unpublish(uuid,text) from public;
revoke all on function app.support_create(text,text,text,text) from public;
revoke all on function app.support_public_intake(text,text,text,text,text,text) from public;
revoke all on function app.support_reopen(uuid,int) from public;
revoke all on function app.support_assign(uuid,uuid,int) from public;
revoke all on function app.settings_save(jsonb,text,int) from public;
revoke all on function app.audit_list(int) from public;
grant execute on function app.jobs_save_draft(uuid,jsonb,int,int) to authenticated;
grant execute on function app.jobs_withdraw(uuid,int) to authenticated;
grant execute on function app.jobs_assign_reviewer(uuid,uuid) to authenticated;
grant execute on function app.jobs_save_scorecard(uuid,numeric,text) to authenticated;
grant execute on function app.jobs_decide_v2(uuid,text,text,text,timestamptz,int) to authenticated;
grant execute on function app.content_save_draft(uuid,text,text,text,jsonb,int) to authenticated;
grant execute on function app.content_review_version(uuid,text) to authenticated;
grant execute on function app.content_publish_version(uuid) to authenticated;
grant execute on function app.content_unpublish(uuid,text) to authenticated;
grant execute on function app.support_create(text,text,text,text) to authenticated;
grant execute on function app.support_public_intake(text,text,text,text,text,text) to anon, authenticated;
grant execute on function app.support_reopen(uuid,int) to authenticated;
grant execute on function app.support_assign(uuid,uuid,int) to authenticated;
grant execute on function app.settings_save(jsonb,text,int) to authenticated;
grant execute on function app.audit_list(int) to authenticated;

commit;
