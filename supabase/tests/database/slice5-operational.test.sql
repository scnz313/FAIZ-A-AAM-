-- Slice 5 operational facade smoke/RLS assertions.
-- This runs after the existing local RLS/RPC suites with synthetic actors only.

do $$
begin
  assert to_regclass('public.finance_adjustment_requests') is not null, 'finance adjustment request table exists';
  assert to_regclass('public.reconciliation_evidence') is not null, 'reconciliation evidence table exists';
  assert to_regclass('public.in_app_notifications') is not null, 'notification projection exists';
  assert (select relrowsecurity from pg_class where oid='public.finance_adjustment_requests'::regclass), 'finance adjustments enforce RLS';
  assert (select relrowsecurity from pg_class where oid='public.reconciliation_evidence'::regclass), 'reconciliation evidence enforces RLS';
  assert to_regprocedure('app.finance_create_attempt_v2(text,bigint,text,text,text)') is not null, 'provider-neutral attempt command exists';
  assert to_regprocedure('app.finance_actor_invoice_allowed(uuid)') is not null, 'finance invoice scope helper exists';
  assert to_regprocedure('app.finance_request_adjustment(uuid,bigint,text,text,integer,text)') is not null, 'adjustment maker command exists';
  assert to_regprocedure('app.finance_approve_adjustment(uuid,integer,boolean,text)') is not null, 'adjustment checker command exists';
  assert to_regprocedure('app.finance_post_refund(uuid,integer,text)') is not null, 'refund posting command exists';
  assert to_regprocedure('app.finance_reconciliation_import(uuid,jsonb,integer,text)') is not null, 'reconciliation import command exists';
  assert to_regprocedure('app.content_approve_version(uuid,integer,text)') is not null, 'content checker command exists';
  assert to_regprocedure('app.support_public_intake_v2(text,text,text,text,text,text,text,timestamptz)') is not null, 'public support intake command exists';
  assert to_regprocedure('app.settings_read_effective()') is not null, 'effective settings projection exists';
  assert to_regprocedure('app.users_admin_list()') is not null, 'authoritative user projection exists';
  assert to_regprocedure('app.audit_list_page(integer,timestamptz,uuid,text,text,text)') is not null, 'paginated audit projection exists';
  assert to_regprocedure('app.documents_projection_list(text,uuid)') is not null, 'document processing projection exists';
  assert to_regprocedure('app.project_notification_event(uuid)') is not null, 'notification projection command exists';
  assert to_regprocedure('app.accounts_mark_mfa_verified()') is not null, 'authoritative MFA command exists';
  assert not has_function_privilege('authenticated','app.settings_effective_due()','EXECUTE'), 'effective settings worker is service-role only';
end
$$;

-- Documents: pure support/teacher and wrong guardian are denied; authorized
-- guardian receives only clean/ready metadata with a public owner reference.
do $$
declare
  v_student uuid;
  v_wrong_guardian uuid:='50000000-0000-4000-8000-000000000001';
  v_doc jsonb;
  v_count int;
begin
  select id into v_student from public.students where person_id='20000000-0000-4000-8000-000000000003';
  insert into auth.users(id) values(v_wrong_guardian) on conflict do nothing;
  insert into public.people(id,given_name,family_name,display_name) values('50000000-0000-4000-8000-000000000101','Wrong','Guardian','Wrong Guardian') on conflict do nothing;
  insert into public.user_accounts(id,person_id,status,verified_contact) values(v_wrong_guardian,'50000000-0000-4000-8000-000000000101','active','wrong.guardian@example.in') on conflict do nothing;
  insert into public.role_grants(account_id,role_code,status) values(v_wrong_guardian,'guardian','active') on conflict do nothing;
  insert into public.guardians(person_id,status) values('50000000-0000-4000-8000-000000000101','active') on conflict do nothing;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000015',true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  assert (select count(*) from app.documents_projection_list('invoice',(select id from public.invoices where student_id=v_student limit 1)))=0, 'support officer cannot read student documents';
  perform set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000011',true);
  assert (select count(*) from app.documents_projection_list('invoice',(select id from public.invoices where student_id=v_student limit 1)))=0, 'teacher cannot read student documents';
  perform set_config('request.jwt.claim.sub',v_wrong_guardian::text,true);
  assert (select count(*) from app.documents_projection_list('invoice',(select id from public.invoices where student_id=(select id from public.students where person_id='20000000-0000-4000-8000-000000000005') limit 1)))=0, 'wrong guardian cannot read another student document';
  perform set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',true);
  select count(*) into v_count from app.documents_projection_list('invoice',(select id from public.invoices where student_id=v_student limit 1));
  select projection into v_doc from app.documents_projection_list('invoice',(select id from public.invoices where student_id=v_student limit 1)) as rows(projection) limit 1;
  assert v_count>0, 'linked guardian with documents capability reads metadata';
  assert not (v_doc ? 'ownerRecordId'), 'document projection omits internal owner id';
  assert (v_doc ? 'ownerReference'), 'document projection includes public owner reference';
  assert (v_doc->>'status') in ('ready','clean'), 'guardian sees only ready document state';
end
$$;
reset role;

-- Scheduled content activation and expiry are service-role jobs; authenticated
-- publishers can schedule but cannot run the clock/expiry workers.
set role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000003',false);
select set_config('request.jwt.claims','{"aal":"aal2"}',false);
do $$
declare v_draft jsonb; v_review jsonb; v_approval jsonb; v_scheduled jsonb; v_item uuid;
begin
  v_draft:=app.content_save_draft_v2(null,'notice','slice5-scheduled-state','Slice 5 scheduled state','{"blocks":[{"type":"paragraph","text":"Scheduled test"}]}'::jsonb,null,'slice5-scheduled-draft');
  v_item:=(v_draft->>'id')::uuid;
  v_review:=app.content_request_review((v_draft->>'versionId')::uuid,1,'slice5-scheduled-review');
  perform set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000004',false);
  v_approval:=app.content_approve_version((v_review->>'id')::uuid,(v_review->>'version')::int,'slice5-scheduled-approval');
  v_scheduled:=app.content_publish_version_v2((v_approval->>'id')::uuid,(v_approval->>'version')::int,now()+interval '1 hour',null,'slice5-scheduled-publish');
  perform set_config('slice5.scheduled_item',v_item::text,false);
  assert (v_scheduled->>'status')='scheduled', 'publisher schedules an approved content version';
  assert (select current_status from public.content_items where id=v_item)='scheduled', 'scheduled content remains scheduled until due';
end
$$;
do $$
declare v_failed boolean:=false;
begin
  begin perform app.content_publish_due(); exception when others then v_failed:=true; end;
  assert v_failed, 'authenticated publisher cannot run scheduled activation';
  v_failed:=false;
  begin perform app.content_expire_due(); exception when others then v_failed:=true; end;
  assert v_failed, 'authenticated publisher cannot run expiry worker';
end
$$;
reset role;
update public.notices set scheduled_at=now()-interval '1 minute' where content_item_id=current_setting('slice5.scheduled_item')::uuid;
set role service_role;
select app.content_publish_due();
select app.content_expire_due();
reset role;

-- Refund and reconciliation idempotency keys are durable and reject
-- conflicting requests.
do $$
declare
  v_payment uuid;
  v_refund jsonb;
  v_refund_retry jsonb;
  v_failed boolean:=false;
  v_run jsonb;
  v_run_retry jsonb;
  v_import jsonb;
  v_import_retry jsonb;
begin
  select id into v_payment from public.payments limit 1;
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',false);
  v_refund:=app.finance_request_refund_v2(v_payment,1,'Slice 5 refund','1','slice5-refund-key');
  v_refund_retry:=app.finance_request_refund_v2(v_payment,1,'Slice 5 refund','1','slice5-refund-key');
  assert (v_refund->>'id')=(v_refund_retry->>'id'), 'refund idempotency replays the same request';
  begin
    perform app.finance_request_refund_v2(v_payment,1,'Conflicting refund','1','slice5-refund-key');
  exception when others then v_failed:=true;
  end;
  assert v_failed, 'conflicting refund idempotency request is rejected';
  perform set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000007',false);
  v_run:=app.finance_reconciliation_start('slice5-reconciliation-key');
  v_run_retry:=app.finance_reconciliation_start('slice5-reconciliation-key');
  assert (v_run->>'id')=(v_run_retry->>'id'), 'reconciliation start idempotency replays the same run';
  v_import:=app.finance_reconciliation_import((v_run->>'id')::uuid,'[{"providerEventId":"slice5-event","amountPaise":1,"state":"pending"}]'::jsonb,1,'slice5-import-key');
  v_import_retry:=app.finance_reconciliation_import((v_run->>'id')::uuid,'[{"providerEventId":"slice5-event","amountPaise":1,"state":"pending"}]'::jsonb,1,'slice5-import-key');
  assert (v_import->>'id')=(v_import_retry->>'id'), 'reconciliation import idempotency replays the same result';
  v_failed:=false;
  begin
    perform app.finance_reconciliation_import((v_run->>'id')::uuid,'[{"providerEventId":"slice5-other","amountPaise":2,"state":"pending"}]'::jsonb,1,'slice5-import-key');
  exception when others then v_failed:=true;
  end;
  assert v_failed, 'conflicting reconciliation idempotency request is rejected';
end
$$;

-- In-app projection is idempotent, resolves the target account, and keeps
-- sensitive event payloads out of the notification body.
do $$
declare v_event uuid; v_after int;
begin
  insert into public.outbox_events(event_key,kind,target_type,target_reference,payload)
  values('slice5-notification-event','email.deliver','user_account','ACC-SLICE5','{"accountId":"30000000-0000-4000-8000-000000000001","secret":"must-not-render"}'::jsonb)
  returning id into v_event;
  perform set_config('slice5.notification_event',v_event::text,false);
  perform app.project_notification_event(v_event);
  perform app.project_notification_event(v_event);
  select count(*) into v_after from public.in_app_notifications where source_event_id=v_event;
  assert v_after=1, 'notification projection is idempotent';
  assert not exists (select 1 from public.in_app_notifications where source_event_id=v_event and body like '%must-not-render%'), 'notification body excludes sensitive payload';
end
$$;

set role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"aal":"aal2"}',false);
do $$
begin
  assert (select count(*) from public.in_app_notifications where source_event_id=current_setting('slice5.notification_event')::uuid)=1, 'recipient sees projected notification';
end
$$;
reset role;

-- Future settings approval keeps the current effective row live.
do $$
declare v_draft jsonb; v_id uuid; v_old int; v_effective int;
begin
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',false);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',false);
  select max(version) into v_old from public.settings_versions;
  select version into v_effective from public.settings_versions where status='effective' order by version desc limit 1;
  v_draft:=app.settings_save_v2('{"resultsPolicy":{"gradingScheme":"Slice5"}}'::jsonb,'Slice 5 future settings',v_old);
  v_id:=(v_draft->>'id')::uuid;
  perform set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000017',false);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',false);
  perform app.settings_approve(v_id,(v_draft->>'version')::int,now()+interval '1 day');
  assert (select status from public.settings_versions where id=v_id)='approved', 'future settings remain approved';
  assert (select version from public.settings_versions where status='effective' order by version desc limit 1)=v_effective, 'current effective settings remain live';
end
$$;

-- The effective-date worker is not callable by an authenticated role.
set role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000017',false);
select set_config('request.jwt.claims','{"aal":"aal2"}',false);
do $$
declare v_failed boolean:=false;
begin
  begin perform app.settings_effective_due(); exception when others then v_failed:=true; end;
  assert v_failed, 'authenticated settings caller cannot run effective-date worker';
end
$$;
reset role;

-- Content review remains draft/in_review until publisher scheduling/publishing.
set role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000003',false);
select set_config('request.jwt.claims','{"aal":"aal2"}',false);
do $$
declare v_draft jsonb; v_review jsonb; v_item uuid; v_version uuid; v_review_version uuid;
begin
  v_draft:=app.content_save_draft_v2(null,'notice','slice5-review-state','Slice 5 review state','{"blocks":[{"type":"paragraph","text":"Review state test"}]}'::jsonb,null,'slice5-review-state');
  v_item:=(v_draft->>'id')::uuid; v_version:=(v_draft->>'versionId')::uuid;
  v_review:=app.content_request_review(v_version,1,'slice5-review-request');
  v_review_version:=(v_review->>'id')::uuid;
  assert (select current_status from public.content_items where id=v_item)='draft', 'review request does not schedule content';
  assert (select review_status from public.content_versions where id=v_review_version)='in_review', 'review request enters in_review';
end
$$;
reset role;

-- Anonymous callers cannot read operational projections or mutate finance.
set role anon;
do $$
begin
  assert not has_table_privilege('anon', 'public.finance_adjustment_requests', 'SELECT'), 'anonymous finance adjustment read denied';
  assert not has_table_privilege('anon', 'public.reconciliation_evidence', 'SELECT'), 'anonymous reconciliation evidence read denied';
end
$$;
reset role;

-- Scoped finance denial: a finance grant limited to the historical year may
-- not create an attempt for the current-year invoice.
do $$
declare
  v_invoice uuid;
  v_grant uuid;
  v_failed boolean := false;
begin
  select i.id into v_invoice from public.invoices i join public.academic_years ay on ay.id=i.academic_year_id where ay.status='current' limit 1;
  select id into v_grant from public.role_grants where account_id='30000000-0000-4000-8000-000000000007' and role_code='finance_officer' and status='active' limit 1;
  insert into public.role_grant_academic_years(role_grant_id,academic_year_id)
  select v_grant,id from public.academic_years where status='historical' limit 1;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000007',true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  begin
    perform app.finance_create_attempt_v2((select reference from public.invoices where id=v_invoice),app.invoice_balance(v_invoice),'UPI','slice5-wrong-scope');
  exception when others then v_failed:=true;
  end;
  assert v_failed, 'finance attempt denies wrong academic-year scope';
  reset role;
  delete from public.role_grant_academic_years where role_grant_id=v_grant;
end
$$;

-- Guardian finance capability and wrong-student denial.
do $$
declare
  v_invoice uuid;
  v_cap_invoice uuid;
  v_link uuid;
  v_failed boolean := false;
begin
  select i.id into v_invoice from public.invoices i where i.student_id=(select id from public.students where person_id='20000000-0000-4000-8000-000000000005') limit 1;
  select i.id into v_cap_invoice from public.invoices i where i.student_id=(select id from public.students where person_id='20000000-0000-4000-8000-000000000003') limit 1;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  begin
    perform app.finance_create_attempt_v2((select reference from public.invoices where id=v_invoice),app.invoice_balance(v_invoice),'UPI','slice5-wrong-guardian');
  exception when others then v_failed:=true;
  end;
  assert v_failed, 'wrong guardian cannot create finance attempt';
  reset role;
  select l.id into v_link from public.guardian_student_links l join public.guardians g on g.id=l.guardian_id join public.user_accounts ua on ua.person_id=g.person_id where ua.id='30000000-0000-4000-8000-000000000001' and l.student_id=(select student_id from public.invoices where id=v_cap_invoice) limit 1;
  delete from public.guardian_link_capabilities where link_id=v_link and capability='finance';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claims','{"aal":"aal2"}',true);
  v_failed:=false;
  begin
    perform app.finance_create_attempt_v2((select reference from public.invoices where id=v_cap_invoice),app.invoice_balance(v_cap_invoice),'UPI','slice5-capability-denial');
  exception when others then v_failed:=true;
  end;
  assert v_failed, 'guardian without finance capability cannot create attempt';
  reset role;
  insert into public.guardian_link_capabilities(link_id,capability) values(v_link,'finance') on conflict do nothing;
end
$$;

-- A pure system administrator cannot substitute for finance/content business
-- roles, while the operation remains callable only through its server RPC.
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
do $$
declare v_failed boolean := false;
begin
  begin
    perform app.finance_reconciliation_start('slice5-admin-denial');
  exception when others then
    v_failed := true;
  end;
  assert v_failed, 'system administrator cannot run finance reconciliation';
  assert app.has_any_role(array['content_publisher','system_administrator']) = false, 'system administrator cannot substitute for publisher';
end
$$;
reset role;

-- MFA requires an AAL2 claim; the successful route/RPC path records status.
set role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000007',false);
select set_config('request.jwt.claims','{"aal":"aal1"}',false);
do $$
declare v_failed boolean:=false;
begin
  begin perform app.accounts_mark_mfa_verified(); exception when others then v_failed:=true; end;
  assert v_failed, 'MFA status cannot be recorded at AAL1';
end
$$;
select set_config('request.jwt.claims','{"aal":"aal2"}',false);
select app.accounts_mark_mfa_verified();
reset role;

select 'SLICE 5 OPERATIONAL SUITE PASSED' as result;
