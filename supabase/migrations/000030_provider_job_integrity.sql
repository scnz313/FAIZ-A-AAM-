-- =============================================================================
-- 000030 — provider job integrity (Slice 6)
--
-- Provider work is deliberately service-only.  Browser sessions may create an
-- upload intent, but only the storage/scanner worker can attest to bytes,
-- type, size, checksum, scan state, and generated-document readiness.  The
-- same rule applies to PDF generation, retention, orphan cleanup, and
-- notification delivery.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Storage/document evidence and service jobs
-- ---------------------------------------------------------------------------

alter table public.documents
  add column if not exists storage_bucket text not null default 'fass-private-documents',
  add column if not exists storage_etag text,
  add column if not exists storage_stat_at timestamptz,
  add column if not exists retention_until timestamptz,
  add column if not exists legal_hold_until timestamptz,
  add column if not exists deleted_at timestamptz;

alter table public.documents
  drop constraint if exists documents_storage_bucket_check;
alter table public.documents
  add constraint documents_storage_bucket_check
  check (storage_bucket in ('fass-private-documents', 'fass-generated-documents'));

alter table public.document_processing_events
  add column if not exists idempotency_key text;
drop index if exists document_processing_events_idempotency_idx;
create unique index document_processing_events_idempotency_idx
  on public.document_processing_events(idempotency_key);

-- One row per immutable source/template/checksum.  The object key is reserved
-- once and reused on every retry, so a retry cannot create another object or
-- another document metadata row.
create table if not exists public.document_generation_records (
  id                    uuid primary key default gen_random_uuid(),
  reference             text not null unique default app.new_ref('DGEN'),
  source_domain         text not null,
  source_record_id      uuid not null,
  source_reference      text not null,
  document_type         text not null check (document_type in ('receipt', 'report_card', 'application_acknowledgement')),
  template_version      text not null,
  source_checksum       text not null check (source_checksum ~ '^[0-9a-fA-F]{64}$'),
  content_checksum      text,
  storage_bucket        text not null default 'fass-generated-documents',
  object_key             text not null unique,
  document_id            uuid unique references public.documents(id) on delete restrict,
  status                 text not null default 'pending'
                         check (status in ('pending', 'uploading', 'ready', 'failed')),
  attempts               int not null default 0 check (attempts >= 0),
  max_attempts           int not null default 10 check (max_attempts > 0),
  last_error             text,
  next_attempt_at        timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  ready_at               timestamptz,
  unique (source_record_id, document_type, template_version, source_checksum)
);
create index if not exists document_generation_status_idx
  on public.document_generation_records(status, next_attempt_at);
create trigger document_generation_records_touch before update
  on public.document_generation_records for each row execute function app.touch_updated_at();

create table if not exists public.provider_jobs (
  id                    uuid primary key default gen_random_uuid(),
  reference             text not null unique default app.new_ref('PJOB'),
  job_kind              text not null check (job_kind in (
    'storage_finalize', 'storage_scan', 'storage_orphan_cleanup',
    'document_retention', 'pdf_generate', 'email_delivery',
    'content_publish', 'settings_effective'
  )),
  target_type           text,
  target_reference      text,
  document_id           uuid references public.documents(id) on delete restrict,
  idempotency_key       text not null unique,
  status                text not null default 'pending'
                         check (status in ('pending', 'processing', 'succeeded', 'failed')),
  attempts              int not null default 0 check (attempts >= 0),
  max_attempts          int not null default 10 check (max_attempts > 0),
  next_attempt_at       timestamptz not null default now(),
  last_error             text,
  correlation_id         uuid,
  started_at             timestamptz,
  finished_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists provider_jobs_claim_idx
  on public.provider_jobs(status, next_attempt_at);
create trigger provider_jobs_touch before update
  on public.provider_jobs for each row execute function app.touch_updated_at();

create table if not exists public.storage_orphan_records (
  id                    uuid primary key default gen_random_uuid(),
  bucket                text not null,
  object_key            text not null,
  discovered_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  status                text not null default 'discovered'
                         check (status in ('discovered', 'deleted', 'retained', 'failed')),
  detail                text,
  unique (bucket, object_key)
);
create index if not exists storage_orphan_status_idx
  on public.storage_orphan_records(status, discovered_at);

create or replace function app.enqueue_document_storage_finalize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.scan_status = 'pending_scan' and new.storage_bucket = 'fass-private-documents' then
    insert into public.outbox_events(event_key,kind,target_type,target_reference,payload)
    values('storage.finalize:'||new.reference,'storage.finalize','document',new.reference,jsonb_build_object('documentId',new.id))
    on conflict (event_key) do nothing;
  end if;
  return new;
end
$$;
drop trigger if exists documents_storage_finalize_outbox on public.documents;
create trigger documents_storage_finalize_outbox after insert on public.documents
for each row execute function app.enqueue_document_storage_finalize();

-- Provider work is queued from authoritative rows, never from a browser
-- success screen. Both functions are idempotent by the durable event key.
create or replace function app.enqueue_pdf_generation(p_document_type text, p_source_reference text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_event public.outbox_events%rowtype; v_key text;
begin
  if p_document_type not in ('receipt','report_card') or p_source_reference is null or length(btrim(p_source_reference)) = 0 then
    raise exception 'invalid PDF generation source';
  end if;
  if p_document_type = 'receipt' and not exists (select 1 from public.receipts where reference=btrim(p_source_reference)) then
    raise exception 'receipt source not found';
  end if;
  if p_document_type = 'report_card' and not exists (select 1 from public.result_report_releases where reference=btrim(p_source_reference) and status='published') then
    raise exception 'report release source not found';
  end if;
  v_key:='pdf.generate:'||btrim(p_source_reference);
  insert into public.outbox_events(event_key,kind,target_type,target_reference,payload)
  values(v_key,'pdf.generate',case when p_document_type='receipt' then 'receipt' else 'result_report_release' end,btrim(p_source_reference),jsonb_build_object('documentType',p_document_type))
  on conflict (event_key) do nothing
  returning * into v_event;
  if v_event.id is null then select * into v_event from public.outbox_events where event_key=v_key; end if;
  return v_event.id;
end
$$;

create or replace function app.enqueue_receipt_pdf_generation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.enqueue_pdf_generation('receipt', new.reference);
  return new;
end
$$;
drop trigger if exists receipts_pdf_generation_outbox on public.receipts;
create trigger receipts_pdf_generation_outbox after insert on public.receipts
for each row execute function app.enqueue_receipt_pdf_generation();

create or replace function app.enqueue_report_pdf_generation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status='published' then
    if tg_op='INSERT' then
      perform app.enqueue_pdf_generation('report_card', new.reference);
    elsif old.status is distinct from new.status then
      perform app.enqueue_pdf_generation('report_card', new.reference);
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists result_report_releases_pdf_generation_outbox on public.result_report_releases;
create trigger result_report_releases_pdf_generation_outbox after insert or update of status on public.result_report_releases
for each row execute function app.enqueue_report_pdf_generation();

alter table public.document_generation_records enable row level security;
alter table public.provider_jobs enable row level security;
alter table public.storage_orphan_records enable row level security;
revoke all on public.document_generation_records, public.provider_jobs, public.storage_orphan_records from anon, authenticated;
grant select, insert, update on public.document_generation_records, public.provider_jobs, public.storage_orphan_records to service_role;
create policy provider_jobs_service_role on public.provider_jobs
  for all to service_role using (true) with check (true);
create policy document_generation_service_role on public.document_generation_records
  for all to service_role using (true) with check (true);
create policy storage_orphans_service_role on public.storage_orphan_records
  for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Delivery/webhook state needed for retry and monotonic projections
-- ---------------------------------------------------------------------------

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_status_check;
alter table public.notification_deliveries
  add constraint notification_deliveries_status_check
  check (status in ('pending', 'sent', 'delivered', 'bounced', 'complained', 'suppressed', 'failed'));
alter table public.notification_deliveries
  add column if not exists failure_class text,
  add column if not exists provider_event_at timestamptz,
  add column if not exists provider_event_rank int not null default 0,
  add column if not exists next_attempt_at timestamptz;

alter table public.resend_webhook_events
  add column if not exists status text not null default 'received',
  add column if not exists attempts int not null default 0,
  add column if not exists last_error text,
  add column if not exists received_at timestamptz not null default now(),
  add column if not exists processed_at timestamptz,
  add column if not exists next_attempt_at timestamptz;
alter table public.resend_webhook_events
  drop constraint if exists resend_webhook_events_status_check;
alter table public.resend_webhook_events
  add constraint resend_webhook_events_status_check
  check (status in ('received', 'processing', 'processed', 'failed'));
create index if not exists resend_webhook_events_status_idx
  on public.resend_webhook_events(status, next_attempt_at);

-- ---------------------------------------------------------------------------
-- Service-only job helpers
-- ---------------------------------------------------------------------------

create or replace function app.claim_provider_jobs(p_batch_size int default 20)
returns setof public.provider_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if session_user <> 'service_role' and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'provider jobs require the storage/service worker';
  end if;
  return query
  with claimed as (
    select pj.id
      from public.provider_jobs pj
     where pj.status in ('pending', 'processing')
       and pj.next_attempt_at <= now()
     order by pj.next_attempt_at, pj.id
     limit least(greatest(coalesce(p_batch_size, 20), 1), 100)
       for update skip locked
  )
  update public.provider_jobs pj
     set status = 'processing', started_at = coalesce(pj.started_at, now()), updated_at = now()
    from claimed c
   where pj.id = c.id
  returning pj.*;
end
$$;

create or replace function app.complete_provider_job(p_job_id uuid, p_outcome jsonb default '{}'::jsonb)
returns public.provider_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.provider_jobs;
begin
  if session_user <> 'service_role' and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'provider jobs require the storage/service worker';
  end if;
  update public.provider_jobs
     set status = 'succeeded', finished_at = now(), last_error = null, updated_at = now()
   where id = p_job_id
  returning * into v_row;
  if v_row.id is null then raise exception 'provider job not found'; end if;
  return v_row;
end
$$;

create or replace function app.fail_provider_job(p_job_id uuid, p_error text, p_permanent boolean default false)
returns public.provider_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.provider_jobs;
begin
  if session_user <> 'service_role' and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'provider jobs require the storage/service worker';
  end if;
  update public.provider_jobs
     set attempts = attempts + 1,
         last_error = left(coalesce(p_error, 'provider job failed'), 500),
         status = case when p_permanent or attempts + 1 >= max_attempts then 'failed' else 'pending' end,
         next_attempt_at = case when p_permanent or attempts + 1 >= max_attempts then now() else now() + (interval '1 minute' * power(2, least(attempts, 6))) end,
         finished_at = case when p_permanent or attempts + 1 >= max_attempts then now() else null end,
         updated_at = now()
   where id = p_job_id
  returning * into v_row;
  if v_row.id is null then raise exception 'provider job not found'; end if;
  return v_row;
end
$$;

-- The worker can create a durable service job without allowing browser roles
-- to call the provider directly.  Duplicate calls return the same job.
create or replace function app.enqueue_provider_job(
  p_job_kind text,
  p_target_type text default null,
  p_target_reference text default null,
  p_document_id uuid default null,
  p_idempotency_key text default null,
  p_correlation_id uuid default null
) returns public.provider_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.provider_jobs;
begin
  if session_user <> 'service_role' and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'provider jobs require the storage/service worker';
  end if;
  if p_job_kind is null or p_idempotency_key is null or length(btrim(p_idempotency_key)) < 3 then
    raise exception 'provider job kind and idempotency key are required';
  end if;
  insert into public.provider_jobs(job_kind,target_type,target_reference,document_id,idempotency_key,correlation_id)
  values (p_job_kind,p_target_type,p_target_reference,p_document_id,btrim(p_idempotency_key),p_correlation_id)
  on conflict (idempotency_key) do nothing
  returning * into v_row;
  if v_row.id is null then select * into v_row from public.provider_jobs where idempotency_key=btrim(p_idempotency_key); end if;
  return v_row;
end
$$;

-- ---------------------------------------------------------------------------
-- Idempotent storage finalisation/scanning and retention candidates
-- ---------------------------------------------------------------------------

create or replace function app.documents_finalize_upload(
  p_document_id uuid,
  p_actual_mime_type text,
  p_actual_size bigint,
  p_checksum text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_doc public.documents%rowtype;
begin
  if session_user <> 'service_role' and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'document finalisation requires the storage service';
  end if;
  select * into v_doc from public.documents where id=p_document_id for update;
  if v_doc.id is null then raise exception 'document not found'; end if;
  if v_doc.scan_status in ('ready','clean') and v_doc.checksum_verified then
    return jsonb_build_object('reference',v_doc.reference,'status',v_doc.scan_status,'checksumVerified',true,'replayed',true);
  end if;
  if v_doc.scan_status not in ('pending_scan','failed') then raise exception 'document is not awaiting finalisation'; end if;
  if p_actual_size <= 0 or p_actual_size > v_doc.max_bytes or p_actual_size <> v_doc.size_bytes then
    raise exception 'uploaded file size does not match the authorized size';
  end if;
  if p_actual_mime_type is null or not (p_actual_mime_type = any(v_doc.allowed_mime_types)) or p_actual_mime_type <> coalesce(v_doc.declared_mime_type,v_doc.mime_type) then
    raise exception 'uploaded file type is not allowed';
  end if;
  if p_checksum is null or lower(p_checksum) !~ '^[0-9a-f]{64}$' then raise exception 'sha256 checksum is required'; end if;
  update public.documents
     set actual_mime_type=p_actual_mime_type, actual_size_bytes=p_actual_size,
         checksum=lower(p_checksum), checksum_verified=true, finalized_at=now(),
         storage_stat_at=now(), scan_status='pending_scan', deleted_at=null
   where id=v_doc.id;
  insert into public.document_processing_events(document_id,event_type,detail,idempotency_key)
  values(v_doc.id,'upload_finalized','server byte stat and SHA-256 verified','finalize:'||v_doc.id::text||':'||lower(p_checksum))
  on conflict (idempotency_key) do nothing;
  return jsonb_build_object('reference',v_doc.reference,'status','pending_scan','checksumVerified',true,'replayed',false);
end
$$;

create or replace function app.documents_apply_scan(
  p_document_id uuid,
  p_status text,
  p_detail text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_doc public.documents%rowtype; v_next text; v_rank int; v_current_rank int;
begin
  if session_user <> 'service_role' and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'document scanner authority required';
  end if;
  if p_status not in ('ready','quarantined','failed') then raise exception 'invalid document scan state'; end if;
  select * into v_doc from public.documents where id=p_document_id for update;
  if v_doc.id is null or v_doc.finalized_at is null then raise exception 'document has not been finalized'; end if;
  v_rank:=case p_status when 'failed' then 3 when 'quarantined' then 3 else 2 end;
  v_current_rank:=case v_doc.scan_status when 'failed' then 3 when 'quarantined' then 3 when 'ready' then 2 when 'clean' then 2 else 1 end;
  if v_current_rank >= v_rank and v_doc.scan_status in ('ready','clean','quarantined','failed') then
    return jsonb_build_object('reference',v_doc.reference,'status',v_doc.scan_status,'replayed',true);
  end if;
  v_next:=case when p_status='ready' then 'ready' else p_status end;
  update public.documents set scan_status=v_next where id=v_doc.id;
  insert into public.document_processing_events(document_id,event_type,detail,idempotency_key)
  values(v_doc.id,'scan_'||p_status,left(p_detail,500),'scan:'||v_doc.id::text||':'||p_status)
  on conflict (idempotency_key) do nothing;
  return jsonb_build_object('reference',v_doc.reference,'status',v_next,'replayed',false);
end
$$;

create or replace function app.documents_retention_candidates(p_limit int default 100)
returns setof public.documents
language sql
security definer
set search_path = ''
as $$
  select d.* from public.documents d
   where d.deleted_at is null
     and d.retention_until is not null
     and d.retention_until <= now()
     and (d.legal_hold_until is null or d.legal_hold_until <= now())
   order by d.retention_until, d.id
   limit least(greatest(coalesce(p_limit,100),1),500)
$$;

create or replace function app.documents_mark_deleted(p_document_id uuid, p_detail text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_doc public.documents%rowtype;
begin
  if session_user <> 'service_role' and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then raise exception 'retention worker required'; end if;
  select * into v_doc from public.documents where id=p_document_id for update;
  if v_doc.id is null then raise exception 'document not found'; end if;
  if v_doc.deleted_at is null then
    update public.documents set deleted_at=now(), scan_status='failed', updated_at=now() where id=v_doc.id;
    insert into public.document_processing_events(document_id,event_type,detail,idempotency_key)
    values(v_doc.id,'retention_deleted',left(coalesce(p_detail,'retention policy reached'),500),'retention:'||v_doc.id::text)
    on conflict (idempotency_key) do nothing;
  end if;
  return jsonb_build_object('reference',v_doc.reference,'deleted',true,'replayed',v_doc.deleted_at is not null);
end
$$;

-- Extend the existing idempotent in-app projection to provider-originated
-- targets that were introduced by the result/timetable release models.  The
-- legacy projection remains the source for admission/job/support/account
-- targets; this companion is intentionally additive and conflict-safe.
create or replace function app.project_notification_event_provider(p_event_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.outbox_events%rowtype;
  v_recipient uuid;
  v_recipients uuid[] := '{}';
  v_title text := 'School record update';
  v_body text := 'A school record has a new update. Sign in to review the current status.';
  v_count int := 0;
begin
  select * into v_event from public.outbox_events where id=p_event_id;
  if v_event.id is null or v_event.kind like 'pdf.%' then return 0; end if;

  if v_event.target_type in ('result_publication','result_publications') then
    select coalesce(array_agg(distinct ua.id),'{}') into v_recipients
      from public.result_publications rp
      left join public.result_batches rb on rb.id=rp.batch_id
      left join public.result_entry_sheets res on res.id=rp.source_entry_sheet_id
      join public.enrollments e on e.grade_section_id=coalesce(rb.grade_section_id,res.grade_section_id) and e.status='active'
      join public.guardian_student_links l on l.student_id=e.student_id and l.status='active'
      join public.guardians g on g.id=l.guardian_id
      join public.user_accounts ua on ua.person_id=g.person_id
     where rp.reference=v_event.target_reference;
    v_title:='Results update'; v_body:='A results record has a new update. Sign in to review the published snapshot.';
  elsif v_event.target_type in ('result_entry_sheet','result_entry_sheets') then
    select coalesce(array_agg(distinct ua.id),'{}') into v_recipients
      from public.result_entry_sheets rs
      join public.result_entry_sheet_rosters rr on rr.sheet_id=rs.id
      join public.guardian_student_links l on l.student_id=rr.student_id and l.status='active'
      join public.guardians g on g.id=l.guardian_id
      join public.user_accounts ua on ua.person_id=g.person_id
     where rs.reference=v_event.target_reference;
    v_title:='Results update'; v_body:='A results entry has a new update. Sign in to review the current status.';
  elsif v_event.target_type in ('timetable_publication','timetable_publications') then
    select coalesce(array_agg(distinct ua.id),'{}') into v_recipients
      from public.timetable_publications tp
      join public.timetable_versions tv on tv.id=tp.timetable_version_id
      join public.enrollments e on e.grade_section_id=tv.grade_section_id and e.status='active'
      join public.guardian_student_links l on l.student_id=e.student_id and l.status='active'
      join public.guardians g on g.id=l.guardian_id
      join public.user_accounts ua on ua.person_id=g.person_id
     where tp.reference=v_event.target_reference;
    v_title:='Timetable update'; v_body:='A class timetable has a new update. Sign in to review the current schedule.';
  elsif v_event.target_type in ('timetable_override','timetable_overrides') then
    select coalesce(array_agg(distinct ua.id),'{}') into v_recipients
      from public.timetable_overrides tovr
      join public.enrollments e on e.grade_section_id=tovr.grade_section_id and e.status='active'
      join public.guardian_student_links l on l.student_id=e.student_id and l.status='active'
      join public.guardians g on g.id=l.guardian_id
      join public.user_accounts ua on ua.person_id=g.person_id
     where tovr.reference=v_event.target_reference;
    v_title:='Timetable update'; v_body:='A date-specific timetable change has a new update. Sign in to review the schedule.';
  elsif v_event.target_type in ('exam_schedule_version','exam_schedule_versions') then
    select coalesce(array_agg(distinct ua.id),'{}') into v_recipients
      from public.exam_schedule_versions esv
      join public.enrollments e on e.grade_section_id=esv.grade_section_id and e.status='active'
      join public.guardian_student_links l on l.student_id=e.student_id and l.status='active'
      join public.guardians g on g.id=l.guardian_id
      join public.user_accounts ua on ua.person_id=g.person_id
     where esv.reference=v_event.target_reference;
    v_title:='Exam schedule update'; v_body:='An exam date sheet has a new update. Sign in to review the published schedule.';
  elsif v_event.target_type in ('receipt','receipts') then
    select coalesce(array_agg(distinct ua.id),'{}') into v_recipients
      from public.receipts r
      join public.invoices i on i.id=r.invoice_id
      left join public.guardian_student_links l on l.student_id=i.student_id and l.status='active'
      left join public.guardians g on g.id=l.guardian_id
      left join public.user_accounts ua on ua.person_id=g.person_id
     where r.reference=v_event.target_reference and ua.id is not null;
    v_title:='Finance update'; v_body:='A payment receipt has a new update. Sign in to review the current record.';
  elsif v_event.target_type in ('enrollment','enrollments') then
    select coalesce(array_agg(distinct ua.id),'{}') into v_recipients
      from public.enrollments e
      join public.guardian_student_links l on l.student_id=e.student_id and l.status='active'
      join public.guardians g on g.id=l.guardian_id
      join public.user_accounts ua on ua.person_id=g.person_id
     where (e.id::text=v_event.target_reference or e.reference=v_event.target_reference);
    v_title:='Enrollment update'; v_body:='An enrollment record has a new update. Sign in to review the family portal.';
  end if;

  foreach v_recipient in array v_recipients loop
    if v_recipient is null then continue; end if;
    insert into public.in_app_notifications(recipient_account_id,kind,title,body,target_type,target_reference,source_event_id,idempotency_key)
    values(v_recipient,v_event.kind,v_title,v_body,v_event.target_type,v_event.target_reference,p_event_id,'in_app:'||p_event_id::text||':'||v_recipient::text)
    on conflict do nothing;
    if found then v_count:=v_count+1; end if;
  end loop;
  return v_count;
end
$$;

create or replace function app.project_provider_notification_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.project_notification_event_provider(new.id);
  return new;
end
$$;
drop trigger if exists outbox_project_provider_notifications on public.outbox_events;
create trigger outbox_project_provider_notifications after insert on public.outbox_events
for each row execute function app.project_provider_notification_trigger();

-- ---------------------------------------------------------------------------
-- Outbox retry semantics: permanent failures stay visible as failed work.
-- ---------------------------------------------------------------------------

create or replace function app.mark_outbox_delivered(p_event_key text)
returns public.outbox_events
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.outbox_events;
begin
  update public.outbox_events
     set status='delivered', delivered_at=now(), last_error=null, updated_at=now()
   where event_key=p_event_key and status in ('pending','processing')
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.outbox_events where event_key=p_event_key;
    if v_row.id is null then raise exception 'unknown outbox event key: %',p_event_key; end if;
    if v_row.status='failed' then raise exception 'failed outbox event cannot be marked delivered: %',p_event_key; end if;
  end if;
  return v_row;
end
$$;

create or replace function app.fail_outbox(p_event_key text, p_error text)
returns public.outbox_events
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.outbox_events; v_permanent boolean := left(coalesce(p_error,''),10)='Permanent:';
begin
  update public.outbox_events
     set attempts=attempts+1,
         last_error=left(coalesce(p_error,'outbox work failed'),500),
         status=case when v_permanent or attempts+1>=max_attempts then 'failed' else 'pending' end,
         next_attempt_at=case when v_permanent or attempts+1>=max_attempts then now() else now()+(interval '1 minute'*power(2,least(attempts,6))) end,
         updated_at=now()
   where event_key=p_event_key
  returning * into v_row;
  if v_row.id is null then raise exception 'unknown outbox event key: %',p_event_key; end if;
  return v_row;
end
$$;

grant execute on function app.claim_provider_jobs(int), app.complete_provider_job(uuid,jsonb), app.fail_provider_job(uuid,text,boolean), app.enqueue_provider_job(text,text,text,uuid,text,uuid), app.documents_retention_candidates(int), app.documents_mark_deleted(uuid,text) to service_role;
grant execute on function app.documents_finalize_upload(uuid,text,bigint,text), app.documents_apply_scan(uuid,text,text) to service_role;
grant execute on function app.project_notification_event_provider(uuid) to service_role;
revoke all on function app.enqueue_pdf_generation(text,text) from public, anon, authenticated;
grant execute on function app.enqueue_pdf_generation(text,text) to service_role;

commit;
