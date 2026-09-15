-- Slice 6 provider-job integrity assertions. Synthetic schema checks only;
-- no provider, Storage, Resend, or Vercel connection is used.

do $$
begin
  assert to_regclass('public.document_generation_records') is not null, 'PDF generation record exists';
  assert to_regclass('public.provider_jobs') is not null, 'service-only provider jobs exist';
  assert to_regclass('public.storage_orphan_records') is not null, 'storage orphan record exists';
  assert to_regprocedure('app.claim_provider_jobs(integer)') is not null, 'provider jobs claim is available';
  assert to_regprocedure('app.complete_provider_job(uuid,jsonb)') is not null, 'provider job completion is available';
  assert to_regprocedure('app.fail_provider_job(uuid,text,boolean)') is not null, 'provider job failure is available';
  assert to_regprocedure('app.documents_retention_candidates(integer)') is not null, 'retention candidates are service-only';
  assert to_regprocedure('app.documents_mark_deleted(uuid,text)') is not null, 'retention deletion marker is service-only';
  assert to_regprocedure('app.documents_finalize_upload(uuid,text,bigint,text)') is not null, 'server byte finalisation exists';
  assert to_regprocedure('app.documents_apply_scan(uuid,text,text)') is not null, 'scanner state projection exists';
  assert to_regprocedure('app.enqueue_pdf_generation(text,text)') is not null, 'PDF generation enqueue command exists';
  assert exists (select 1 from pg_trigger where tgrelid='public.receipts'::regclass and tgname='receipts_pdf_generation_outbox'), 'receipt PDF trigger exists';
  assert exists (select 1 from pg_trigger where tgrelid='public.result_report_releases'::regclass and tgname='result_report_releases_pdf_generation_outbox'), 'report PDF trigger exists';
  assert (select relrowsecurity from pg_class where oid='public.provider_jobs'::regclass), 'provider jobs enforce RLS';
  assert (select relrowsecurity from pg_class where oid='public.document_generation_records'::regclass), 'generation records enforce RLS';
  assert not has_table_privilege('authenticated', 'public.provider_jobs', 'SELECT'), 'browser cannot read provider jobs';
  assert not has_table_privilege('authenticated', 'public.document_generation_records', 'INSERT'), 'browser cannot create generation records';
  assert exists (select 1 from pg_constraint where conrelid='public.notification_deliveries'::regclass and conname='notification_deliveries_status_check'), 'delivery supports explicit failure/suppression state';
  assert exists (select 1 from pg_constraint where conrelid='public.resend_webhook_events'::regclass and conname='resend_webhook_events_status_check'), 'webhook state machine exists';
  assert exists (select 1 from pg_attribute where attrelid='public.documents'::regclass and attname='storage_bucket' and not attisdropped), 'document bucket is explicit';
  assert exists (select 1 from pg_attribute where attrelid='public.documents'::regclass and attname='storage_stat_at' and not attisdropped), 'server storage stat timestamp is explicit';
  assert exists (select 1 from pg_attribute where attrelid='public.documents'::regclass and attname='retention_until' and not attisdropped), 'document retention deadline is explicit';
  assert exists (select 1 from pg_attribute where attrelid='public.timetable_overrides'::regclass and attname='grade_section_id' and not attisdropped), 'override notification scope uses grade section';
  assert exists (select 1 from pg_attribute where attrelid='public.exam_schedule_versions'::regclass and attname='grade_section_id' and not attisdropped), 'exam notification scope uses schedule version section';
end
$$;

-- 000085: the outbox state machine is service-role only. Browser roles hold
-- no EXECUTE grant, the worker role does, and all three remain SECURITY
-- DEFINER so the worker never needs direct table access.
do $$
begin
  assert not has_function_privilege('anon', 'app.claim_outbox(integer)', 'EXECUTE'), 'anon cannot claim outbox events';
  assert not has_function_privilege('authenticated', 'app.claim_outbox(integer)', 'EXECUTE'), 'browser cannot claim outbox events';
  assert not has_function_privilege('anon', 'app.mark_outbox_delivered(text)', 'EXECUTE'), 'anon cannot mark outbox work delivered';
  assert not has_function_privilege('authenticated', 'app.mark_outbox_delivered(text)', 'EXECUTE'), 'browser cannot mark outbox work delivered';
  assert not has_function_privilege('anon', 'app.fail_outbox(text,text)', 'EXECUTE'), 'anon cannot fail outbox work';
  assert not has_function_privilege('authenticated', 'app.fail_outbox(text,text)', 'EXECUTE'), 'browser cannot fail outbox work';
  assert has_function_privilege('service_role', 'app.claim_outbox(integer)', 'EXECUTE'), 'service worker claims outbox events';
  assert has_function_privilege('service_role', 'app.mark_outbox_delivered(text)', 'EXECUTE'), 'service worker marks outbox work delivered';
  assert has_function_privilege('service_role', 'app.fail_outbox(text,text)', 'EXECUTE'), 'service worker fails outbox work';
  assert (select prosecdef from pg_proc where oid='app.claim_outbox(integer)'::regprocedure), 'claim_outbox is security definer';
  assert (select prosecdef from pg_proc where oid='app.mark_outbox_delivered(text)'::regprocedure), 'mark_outbox_delivered is security definer';
  assert (select prosecdef from pg_proc where oid='app.fail_outbox(text,text)'::regprocedure), 'fail_outbox is security definer';
end
$$;

-- Defense in depth: even a session holding the service-role database role is
-- refused when its JWT role is not service_role.
select set_config('request.jwt.claims', '{"role":"authenticated"}', false);
set role service_role;
do $$
declare v_failed boolean := false;
begin
  begin perform app.claim_outbox(1); exception when others then v_failed:=true; end;
  assert v_failed, 'non-service JWT cannot claim outbox events';
  v_failed:=false;
  begin perform app.mark_outbox_delivered('slice6-guard'); exception when others then v_failed:=true; end;
  assert v_failed, 'non-service JWT cannot mark outbox work delivered';
  v_failed:=false;
  begin perform app.fail_outbox('slice6-guard','boom'); exception when others then v_failed:=true; end;
  assert v_failed, 'non-service JWT cannot fail outbox work';
end
$$;
reset role;

-- The same source can be queued repeatedly, but its provider event is one
-- durable idempotency key. Existing Slice 4/RPC fixtures supply these refs.
reset role;
do $$
declare v_receipt text; v_release text; v_count int;
begin
  select reference into v_receipt from public.receipts order by created_at desc limit 1;
  assert v_receipt is not null, 'Slice 4/RPC fixtures include a receipt source';
  perform app.enqueue_pdf_generation('receipt', v_receipt);
  perform app.enqueue_pdf_generation('receipt', v_receipt);
  select count(*) into v_count from public.outbox_events where event_key='pdf.generate:'||v_receipt;
  assert v_count=1, 'receipt PDF enqueue is idempotent';
  select reference into v_release from public.result_report_releases where status='published' order by published_at desc limit 1;
  assert v_release is not null, 'Slice 4 fixtures include a report release source';
  perform app.enqueue_pdf_generation('report_card', v_release);
  perform app.enqueue_pdf_generation('report_card', v_release);
  select count(*) into v_count from public.outbox_events where event_key='pdf.generate:'||v_release;
  assert v_count=1, 'report-card PDF enqueue is idempotent';
end
$$;
reset role;

-- Execute the provider notification projection against a sheet-native result
-- publication (batch_id is null). A missing source-sheet fallback or a wrong
-- timetable/exam join must fail this test instead of being swallowed.
do $$
declare v_pub text; v_event uuid; v_count int;
begin
  select reference into v_pub from public.result_publications order by published_at desc limit 1;
  assert v_pub is not null, 'Slice 4 fixtures include a result publication source';
  insert into public.outbox_events(event_key,kind,target_type,target_reference,payload)
  values('slice6-result-notification','email.deliver','result_publication',v_pub,'{}'::jsonb)
  returning id into v_event;
  perform app.project_notification_event_provider(v_event);
  perform app.project_notification_event_provider(v_event);
  select count(*) into v_count from public.in_app_notifications where source_event_id=v_event;
  assert v_count > 0, 'sheet-native result publication reaches linked families';
end
$$;

-- Permanent outbox errors remain failed and cannot later be marked delivered.
-- The worker functions require the service-role claim (000085).
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
do $$
declare v_status text; v_failed boolean := false;
begin
  insert into public.outbox_events(event_key, kind, target_type, target_reference)
  values ('slice6-permanent-outbox', 'email.deliver', 'support_request', 'SR-SLICE6');
  select status into v_status from app.fail_outbox('slice6-permanent-outbox', 'Permanent: invalid recipient');
  assert v_status='failed', 'permanent outbox failures remain visible as failed';
  begin perform app.mark_outbox_delivered('slice6-permanent-outbox'); exception when others then v_failed:=true; end;
  assert v_failed, 'failed outbox work cannot be marked delivered';
end
$$;

-- Provider jobs are claimable/completable only through the service role.
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;
do $$
declare v_job uuid; v_claimed int; v_status text;
begin
  insert into public.provider_jobs(job_kind,target_type,target_reference,idempotency_key)
  values('settings_effective','settings',null,'slice6-provider-job') returning id into v_job;
  select count(*) into v_claimed from app.claim_provider_jobs(10) where id=v_job;
  assert v_claimed=1, 'service worker claims provider job';
  select status into v_status from app.complete_provider_job(v_job,'{}'::jsonb);
  assert v_status='succeeded', 'service worker completes provider job';
end
$$;
reset role;

-- 000085: a notice whose only audience is the general public enqueues no
-- email; an addressable audience (role/student/grade_section/academic_year)
-- does. Synthetic author/publisher accounts keep maker/checker intact.
insert into auth.users (id) values
  ('e0000000-0000-4000-8000-000000000085'),
  ('e0000000-0000-4000-8000-000000000086');
insert into public.people (id, given_name, family_name, display_name) values
  ('f0000000-0000-4000-8000-000000000085', 'Nadia', 'Qureshi', 'Nadia Qureshi'),
  ('f0000000-0000-4000-8000-000000000086', 'Imran', 'Wani', 'Imran Wani');
insert into public.user_accounts (id, person_id, status, verified_contact) values
  ('e0000000-0000-4000-8000-000000000085', 'f0000000-0000-4000-8000-000000000085', 'active', 'content.author.085@example.in'),
  ('e0000000-0000-4000-8000-000000000086', 'f0000000-0000-4000-8000-000000000086', 'active', 'content.publisher.085@example.in');
insert into public.role_grants (account_id, role_code, status, effective_from) values
  ('e0000000-0000-4000-8000-000000000086', 'content_publisher', 'active', now());

insert into public.content_items (kind, slug, current_status) values
  ('notice', 'slice6-public-only-notice', 'draft'),
  ('notice', 'slice6-role-audience-notice', 'draft');
insert into public.content_versions (content_item_id, version, title, body, author_account_id, review_status)
select ci.id, 1, 'Slice 6 '||ci.slug, '{"blocks":[]}'::jsonb, 'e0000000-0000-4000-8000-000000000085', 'approved'
  from public.content_items ci
 where ci.slug in ('slice6-public-only-notice', 'slice6-role-audience-notice');
insert into public.notices (content_item_id, status)
select ci.id, 'draft' from public.content_items ci
 where ci.slug in ('slice6-public-only-notice', 'slice6-role-audience-notice');
insert into public.notice_audiences (notice_id, audience)
select n.id, 'public' from public.notices n
  join public.content_items ci on ci.id = n.content_item_id
 where ci.slug = 'slice6-public-only-notice';
insert into public.notice_audiences (notice_id, audience, role_code)
select n.id, 'role', 'guardian' from public.notices n
  join public.content_items ci on ci.id = n.content_item_id
 where ci.slug = 'slice6-role-audience-notice';

set role authenticated;
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000086', false);
select set_config('request.jwt.claims', '{"aal":"aal2","role":"authenticated"}', false);
do $$
declare v_result jsonb;
begin
  select app.content_publish_version_v2(v.id, 1, null, null, 'slice6-public-notice-publish') into v_result
    from public.content_versions v
    join public.content_items ci on ci.id = v.content_item_id
   where ci.slug = 'slice6-public-only-notice' and v.version = 1;
  assert (v_result->>'status') = 'published', 'public-only notice publishes';
  select app.content_publish_version_v2(v.id, 1, null, null, 'slice6-role-notice-publish') into v_result
    from public.content_versions v
    join public.content_items ci on ci.id = v.content_item_id
   where ci.slug = 'slice6-role-audience-notice' and v.version = 1;
  assert (v_result->>'status') = 'published', 'role-audience notice publishes';
end
$$;
reset role;

do $$
begin
  assert not exists (
    select 1 from public.outbox_events oe
      join public.notices n on n.reference = oe.target_reference
      join public.content_items ci on ci.id = n.content_item_id
     where ci.slug = 'slice6-public-only-notice'
       and oe.event_key like 'email.notice_published:%'
  ), 'a public-only notice publish enqueues no email event';
  assert (
    select count(*) from public.outbox_events oe
      join public.notices n on n.reference = oe.target_reference
      join public.content_items ci on ci.id = n.content_item_id
     where ci.slug = 'slice6-role-audience-notice'
       and oe.event_key like 'email.notice_published:%'
  ) = 1, 'a role-audience notice publish enqueues exactly one email event';
end
$$;

-- 000085: the scheduled sweep applies the same audience rule, so a scheduled
-- public-only notice publishes without an email event.
insert into public.content_items (kind, slug, current_status) values
  ('notice', 'slice6-scheduled-public-notice', 'draft');
insert into public.content_versions (content_item_id, version, title, body, author_account_id, review_status)
select ci.id, 1, 'Slice 6 '||ci.slug, '{"blocks":[]}'::jsonb, 'e0000000-0000-4000-8000-000000000085', 'approved'
  from public.content_items ci where ci.slug = 'slice6-scheduled-public-notice';
insert into public.notices (content_item_id, status)
select ci.id, 'draft' from public.content_items ci where ci.slug = 'slice6-scheduled-public-notice';
insert into public.notice_audiences (notice_id, audience)
select n.id, 'public' from public.notices n
  join public.content_items ci on ci.id = n.content_item_id
 where ci.slug = 'slice6-scheduled-public-notice'
   and not exists (select 1 from public.notice_audiences na where na.notice_id = n.id);

set role authenticated;
select set_config('request.jwt.claim.sub', 'e0000000-0000-4000-8000-000000000086', false);
select set_config('request.jwt.claims', '{"aal":"aal2","role":"authenticated"}', false);
do $$
declare v_result jsonb;
begin
  select app.content_publish_version_v2(v.id, 1, now()+interval '1 hour', null, 'slice6-scheduled-public-publish') into v_result
    from public.content_versions v
    join public.content_items ci on ci.id = v.content_item_id
   where ci.slug = 'slice6-scheduled-public-notice' and v.version = 1;
  assert (v_result->>'status') = 'scheduled', 'public-only notice schedules';
end
$$;
reset role;

update public.notices set scheduled_at=now()-interval '1 minute'
 where content_item_id=(select id from public.content_items where slug='slice6-scheduled-public-notice');

select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;
select app.content_publish_due();
reset role;

do $$
begin
  assert (
    select status from public.notices n
      join public.content_items ci on ci.id = n.content_item_id
     where ci.slug = 'slice6-scheduled-public-notice'
  ) = 'published', 'the scheduled public-only notice publishes';
  assert not exists (
    select 1 from public.outbox_events oe
      join public.notices n on n.reference = oe.target_reference
      join public.content_items ci on ci.id = n.content_item_id
     where ci.slug = 'slice6-scheduled-public-notice'
       and oe.event_key like 'content.scheduled_published:%'
  ), 'the publish sweep enqueues no email event for a public-only notice';
end
$$;
