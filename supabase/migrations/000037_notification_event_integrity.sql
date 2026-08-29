begin;

create or replace function app.claim_outbox(p_batch_size int default 10)
returns setof public.outbox_events
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with claimed as (
    select oe.id
      from public.outbox_events oe
     where oe.status in ('pending', 'processing')
       and oe.next_attempt_at <= now()
     order by oe.next_attempt_at
     limit least(greatest(coalesce(p_batch_size, 10), 1), 100)
       for update skip locked
  )
  update public.outbox_events oe
     set status = 'processing',
         next_attempt_at = now() + interval '5 minutes',
         updated_at = now()
    from claimed c
   where oe.id = c.id
  returning oe.*;
end
$$;

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
     set status = 'processing',
         started_at = coalesce(pj.started_at, now()),
         next_attempt_at = now() + interval '5 minutes',
         updated_at = now()
    from claimed c
   where pj.id = c.id
  returning pj.*;
end
$$;

create or replace function app.admissions_decide_v2(
  p_application_id uuid, p_action text, p_visible_reason text default null,
  p_private_note text default null, p_conditions jsonb default '{}'::jsonb,
  p_expires_at timestamptz default null, p_expected_version int default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_app public.admission_applications%rowtype; v_next int; v_offer public.admission_offers%rowtype;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('admissions_approver')) then raise exception 'admissions approver role and aal2 required'; end if;
  if p_action not in ('offer','waitlist','decline') then raise exception 'invalid decision action'; end if;
  select * into v_app from public.admission_applications where id = p_application_id for update;
  if v_app.id is null then raise exception 'application not found'; end if;
  if p_expected_version is not null and v_app.version <> p_expected_version then raise exception 'application version mismatch (expected %, found %)', p_expected_version, v_app.version; end if;
  if not app.admission_staff_scope(p_application_id, array['admissions_approver']) then raise exception 'application is outside the approver scope'; end if;
  if v_app.owner_account_id = auth.uid() then raise exception 'an approver cannot decide their own application'; end if;
  if not exists (select 1 from public.admission_reviews ar where ar.application_id = p_application_id and ar.officer_account_id <> auth.uid() and ar.action in ('reviewed','moved_to_assessment','requested_changes')) then raise exception 'a separate admissions reviewer step is required'; end if;
  if v_app.current_status not in ('under_review','assessment') then raise exception 'application cannot be decided in state (%)', v_app.current_status; end if;
  v_next := v_app.version + 1;
  if p_action = 'offer' then
    insert into public.admission_offers (application_id, grade_id, academic_year_id, conditions, expires_at, decided_by_account_id, final_approved_by_account_id, final_approved_at)
    values (p_application_id, v_app.grade_id, v_app.academic_year_id, coalesce(p_conditions,'{}'::jsonb), coalesce(p_expires_at, now() + interval '14 days'), auth.uid(), auth.uid(), now())
    returning * into v_offer;
    update public.admission_applications set current_status = 'offered', version = v_next where id = p_application_id;
    insert into public.admission_events (application_id, event_type, visible_to_applicant, copy) values (p_application_id, 'offered', true, 'Offer extended');
    perform app.enqueue_outbox('email.offer:' || v_app.reference, 'email.deliver', 'admission_application', v_app.reference, jsonb_build_object('channel','email'));
  elsif p_action = 'waitlist' then
    update public.admission_applications set current_status = 'waitlisted', version = v_next where id = p_application_id;
    insert into public.admission_events (application_id, event_type, visible_to_applicant, copy) values (p_application_id, 'waitlisted', true, 'Placed on the waitlist');
    perform app.enqueue_outbox('email.application_decision:' || v_app.reference || ':v' || v_next, 'email.deliver', 'admission_application', v_app.reference, jsonb_build_object('channel','email','decision','waitlisted'));
  else
    update public.admission_applications set current_status = 'declined', version = v_next where id = p_application_id;
    insert into public.admission_events (application_id, event_type, visible_to_applicant, copy) values (p_application_id, 'declined', true, 'Application declined: ' || coalesce(p_visible_reason, 'no reason given'));
    perform app.enqueue_outbox('email.application_decision:' || v_app.reference || ':v' || v_next, 'email.deliver', 'admission_application', v_app.reference, jsonb_build_object('channel','email','decision','declined'));
  end if;
  insert into public.admission_reviews (application_id, officer_account_id, action, visible_reason, private_note) values (p_application_id, auth.uid(), 'reviewed', p_visible_reason, p_private_note);
  perform app.record_audit('Admission decision: ' || p_action, 'admission_application', v_app.reference, 'Success');
  return jsonb_build_object('applicationId', v_app.id, 'reference', v_app.reference, 'status', case p_action when 'offer' then 'offered' when 'waitlist' then 'waitlisted' else 'declined' end, 'version', v_next);
end
$$;

create or replace function app.jobs_decide_v2(
  p_application_id uuid, p_action text, p_reason text default null,
  p_private_note text default null, p_scheduled_at timestamptz default null,
  p_expected_version int default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_app public.job_applications%rowtype; v_next int; v_status text; v_role text;
begin
  if auth.uid() is null or not app.is_staff_aal2() then raise exception 'HR role and aal2 required'; end if;
  if p_action not in ('shortlist','interview','offer','not_selected') then raise exception 'invalid decision action'; end if;
  if p_action in ('shortlist','interview') then v_role := 'hr_reviewer'; else v_role := 'hr_approver'; end if;
  if not app.has_role(v_role) then raise exception 'required HR role and aal2 required'; end if;
  select * into v_app from public.job_applications where id = p_application_id for update;
  if v_app.id is null then raise exception 'application not found'; end if;
  if p_expected_version is not null and v_app.version <> p_expected_version then raise exception 'application version mismatch (expected %, found %)', p_expected_version, v_app.version; end if;
  if v_app.owner_account_id = auth.uid() then raise exception 'HR reviewer cannot decide their own application'; end if;
  if p_action in ('shortlist','interview') and not exists (select 1 from public.job_review_assignments where application_id = p_application_id and reviewer_account_id = auth.uid() and status in ('assigned','accepted','completed')) then raise exception 'reviewer assignment required'; end if;
  if p_action in ('offer','not_selected') and not exists (select 1 from public.job_application_decisions where application_id = p_application_id and action in ('shortlist','interview') and actor_account_id <> auth.uid()) then raise exception 'separate HR reviewer decision is required'; end if;
  if p_action in ('offer','not_selected') and length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'HR decision reason is required'; end if;
  if p_action = 'interview' and p_scheduled_at is null then raise exception 'interview requires a scheduled time'; end if;
  v_status := case p_action when 'shortlist' then 'shortlisted' when 'interview' then 'interview' when 'offer' then 'offered' else 'not_selected' end;
  v_next := v_app.version + 1;
  update public.job_applications set current_status = v_status, version = v_next where id = p_application_id;
  if p_action = 'interview' then insert into public.job_interviews (application_id, scheduled_at, outcome, notes) values (p_application_id, p_scheduled_at, 'pending', p_private_note); end if;
  insert into public.job_application_decisions (application_id, actor_account_id, action, from_status, to_status, reason, private_note, version) values (p_application_id, auth.uid(), p_action, v_app.current_status, v_status, p_reason, p_private_note, v_next);
  insert into public.job_events (application_id, event_type, visible_to_applicant, copy) values (p_application_id, p_action, true, coalesce(nullif(btrim(p_reason),''), initcap(replace(p_action,'_',' '))));
  perform app.record_audit('Job decision: ' || p_action, 'job_application', v_app.reference, 'Success');
  perform app.enqueue_outbox('email.job_status:' || v_app.reference || ':v' || v_next, 'email.deliver', 'job_application', v_app.reference, jsonb_build_object('channel','email','status',v_status));
  return jsonb_build_object('applicationId', v_app.id, 'reference', v_app.reference, 'status', v_status, 'version', v_next);
end
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
  if v_notice.id is not null then update public.notices set status=v_status,scheduled_at=p_scheduled_at,expires_at=p_expires_at,published_at=case when v_status='published' then now() else null end,published_by_account_id=case when v_status='published' then auth.uid() else null end where id=v_notice.id; end if;
  perform app.record_audit(case when v_status='published' then 'Content published' else 'Content scheduled' end,'content_item',v_item.reference,'Success');
  if v_status='published' and v_notice.id is not null then
    perform app.enqueue_outbox('email.notice_published:'||v_notice.reference||':v'||v_next.version,'email.deliver','notice',v_notice.reference,jsonb_build_object('channel','email'));
  end if;
  return jsonb_build_object('id',v_item.id,'reference',v_item.reference,'versionId',v_next.id,'version',v_next.version,'status',v_status,'replayed',v_next.id<>v_version.id);
end;
$$;

create or replace function app.content_expire_due()
returns int language plpgsql security definer set search_path = '' as $$
declare v_count int:=0; v_notice public.notices%rowtype; v_item public.content_items%rowtype;
begin
  for v_notice in select * from public.notices where status='published' and expires_at is not null and expires_at<=now() for update loop
    update public.notices set status='expired' where id=v_notice.id;
    update public.content_items set current_status='expired' where id=v_notice.content_item_id returning * into v_item;
    insert into public.audit_events(actor_label,action,target_type,target_reference,outcome,reason) values('Content scheduler','Notice expired','notice',v_notice.reference,'Success','Expiry reached');
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

alter table public.support_messages add column if not exists idempotency_key text;
alter table public.support_private_notes add column if not exists idempotency_key text;
create unique index if not exists support_messages_idempotency_idx on public.support_messages(support_request_id,idempotency_key) where idempotency_key is not null;
create unique index if not exists support_private_notes_idempotency_idx on public.support_private_notes(support_request_id,idempotency_key) where idempotency_key is not null;

create or replace function app.support_respond_v2(p_request_id uuid,p_body text,p_private boolean default false,p_expected_version int default null,p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_request public.support_requests%rowtype; v_existing_body text; v_existing_actor uuid; v_staff boolean;
begin
  if auth.uid() is null or p_body is null or length(btrim(p_body))=0 then raise exception 'message body is required'; end if;
  select * into v_request from public.support_requests where id=p_request_id for update; if v_request.id is null then raise exception 'request not found'; end if;
  if p_idempotency_key is not null then
    if p_private then
      select body,author_account_id into v_existing_body,v_existing_actor from public.support_private_notes where support_request_id=p_request_id and idempotency_key=p_idempotency_key;
    else
      select body,author_account_id into v_existing_body,v_existing_actor from public.support_messages where support_request_id=p_request_id and idempotency_key=p_idempotency_key;
    end if;
    if v_existing_body is not null then
      if v_existing_body<>btrim(p_body) or v_existing_actor<>auth.uid() then raise exception 'support idempotency key mismatch'; end if;
      return jsonb_build_object('id',v_request.id,'reference',v_request.reference,'status',v_request.status,'version',v_request.version,'replayed',true);
    end if;
  end if;
  if p_expected_version is not null and v_request.version<>p_expected_version then raise exception 'support version mismatch'; end if;
  v_staff:=app.is_staff_aal2() and app.has_role('support_officer');
  if p_private then
    if not v_staff then raise exception 'support officer role and aal2 required'; end if;
    insert into public.support_private_notes(support_request_id,author_account_id,body,idempotency_key) values(p_request_id,auth.uid(),btrim(p_body),nullif(btrim(p_idempotency_key),''));
  else
    if not ((v_request.requester_account_id=auth.uid()) or v_staff) then raise exception 'not the request owner'; end if;
    insert into public.support_messages(support_request_id,author_account_id,author_label,body,is_staff,visibility,idempotency_key) values(p_request_id,auth.uid(),case when v_staff then 'School support' else 'Requester' end,btrim(p_body),v_staff,'requester',nullif(btrim(p_idempotency_key),''));
  end if;
  update public.support_requests set status=case when p_private then status when v_staff then 'in_progress' else 'open' end,version=version+1,updated_at=now() where id=p_request_id returning * into v_request;
  perform app.record_audit(case when p_private then 'Support private note added' else 'Support responded' end,'support_request',v_request.reference,'Success');
  if not p_private and v_staff then
    perform app.enqueue_outbox('email.support:'||v_request.reference||':v'||v_request.version,'email.deliver','support_request',v_request.reference,jsonb_build_object('channel','email'));
  end if;
  return jsonb_build_object('id',v_request.id,'reference',v_request.reference,'status',v_request.status,'version',v_request.version,'replayed',false);
end;
$$;

create or replace function app.finance_post_refund(
  p_refund_request_id uuid,
  p_expected_version int,
  p_provider_ref text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_request public.refund_requests%rowtype; v_refund public.refunds%rowtype; v_payment public.payments%rowtype; v_alloc public.payment_allocations%rowtype; v_ledger public.ledger_entries%rowtype; v_invoice_id uuid;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_role('finance_officer')) then raise exception 'finance officer role and aal2 required'; end if;
  select * into v_request from public.refund_requests where id=p_refund_request_id for update;
  if v_request.id is null then raise exception 'refund request not found'; end if;
  if not exists (select 1 from public.payment_allocations pa where pa.payment_id=v_request.payment_id and app.finance_invoice_scope(pa.invoice_id)) then raise exception 'refund is outside the assigned academic-year scope'; end if;
  select * into v_refund from public.refunds where refund_request_id=v_request.id;
  if v_refund.id is not null and v_refund.status='confirmed' then
    perform app.enqueue_outbox('email.refund_status:'||v_request.reference||':v'||v_request.version,'email.deliver','refund_request',v_request.reference,jsonb_build_object('channel','email'));
    return jsonb_build_object('id',v_refund.id,'reference',v_refund.reference,'status',v_refund.status,'version',v_request.version,'replayed',true);
  end if;
  if v_request.version<>p_expected_version then raise exception 'refund request version mismatch (expected %, found %)',p_expected_version,v_request.version; end if;
  if v_request.status<>'approved' then raise exception 'refund is not approved'; end if;
  select * into v_payment from public.payments where id=v_request.payment_id;
  select * into v_alloc from public.payment_allocations where payment_id=v_payment.id limit 1;
  v_invoice_id:=v_alloc.invoice_id;
  if v_refund.id is null then insert into public.refunds(refund_request_id,amount_paise,provider_ref,status) values(v_request.id,v_request.amount_paise,p_provider_ref,'confirmed') returning * into v_refund; else update public.refunds set status='confirmed',provider_ref=coalesce(p_provider_ref,provider_ref),updated_at=now() where id=v_refund.id returning * into v_refund; end if;
  insert into public.ledger_entries(invoice_id,entry_type,amount_paise,reason,created_by_account_id) values(v_invoice_id,'refund',v_request.amount_paise,v_request.reference || ': ' || v_request.reason,auth.uid()) returning * into v_ledger;
  update public.refund_requests set status='processed',version=version+1,updated_at=now() where id=v_request.id returning * into v_request;
  perform app.record_audit('Refund posted','refund_request',v_request.reference,'Success',v_request.reason);
  perform app.enqueue_outbox('email.refund_status:'||v_request.reference||':v'||v_request.version,'email.deliver','refund_request',v_request.reference,jsonb_build_object('channel','email'));
  return jsonb_build_object('id',v_refund.id,'reference',v_refund.reference,'status',v_refund.status,'version',v_request.version,'ledgerReference',v_ledger.reference,'replayed',false);
end;
$$;

commit;
