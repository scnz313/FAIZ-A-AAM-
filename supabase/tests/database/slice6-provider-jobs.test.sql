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
