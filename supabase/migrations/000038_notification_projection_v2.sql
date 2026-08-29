begin;

create or replace function app.project_notification_event_v2(p_event_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.outbox_events%rowtype;
  v_recipient uuid;
  v_recipients uuid[] := '{}';
  v_count int := 0;
  v_kind text := 'School';
  v_title text := 'School record update';
  v_body text := 'A school record has a new update. Sign in to review the current status.';
begin
  select * into v_event from public.outbox_events where id=p_event_id;
  if v_event.id is null or v_event.kind like 'pdf.%' or v_event.kind like 'storage.%' or v_event.kind in ('content.publish','settings.effective','document.retention') then return 0; end if;

  if v_event.target_type in ('admission_application','admission_applications') then
    select owner_account_id into v_recipient from public.admission_applications where reference=v_event.target_reference;
    if v_recipient is not null then v_recipients:=array_append(v_recipients,v_recipient); end if;
  elsif v_event.target_type in ('job_application','job_applications') then
    select owner_account_id into v_recipient from public.job_applications where reference=v_event.target_reference;
    if v_recipient is not null then v_recipients:=array_append(v_recipients,v_recipient); end if;
  elsif v_event.target_type in ('support_request','support_requests') then
    if v_event.event_key like 'email.support:%' then
      select requester_account_id into v_recipient from public.support_requests where reference=v_event.target_reference;
      if v_recipient is not null then v_recipients:=array_append(v_recipients,v_recipient); end if;
    else
      select coalesce(array_agg(distinct account_id),'{}') into v_recipients
      from (
        select requester_account_id account_id from public.support_requests where reference=v_event.target_reference
        union all
        select assignee_account_id from public.support_requests where reference=v_event.target_reference
      ) recipients where account_id is not null;
    end if;
  elsif v_event.target_type in ('guardian','guardians') then
    select ua.id into v_recipient from public.guardians g join public.user_accounts ua on ua.person_id=g.person_id where g.reference=v_event.target_reference;
    if v_recipient is not null then v_recipients:=array_append(v_recipients,v_recipient); end if;
  elsif v_event.target_type in ('guardian_student_link','guardian_links','guardian_student_links') then
    select ua.id into v_recipient from public.guardian_student_links l join public.guardians g on g.id=l.guardian_id join public.user_accounts ua on ua.person_id=g.person_id where l.reference=v_event.target_reference;
    if v_recipient is not null then v_recipients:=array_append(v_recipients,v_recipient); end if;
  elsif v_event.target_type in ('student','students') then
    select coalesce(array_agg(distinct ua.id),'{}') into v_recipients
      from public.students s join public.guardian_student_links l on l.student_id=s.id and l.status='active'
      join public.guardians g on g.id=l.guardian_id join public.user_accounts ua on ua.person_id=g.person_id
     where s.reference=v_event.target_reference;
  elsif v_event.target_type in ('result_report_release','result_report_releases') then
    select coalesce(array_agg(distinct ua.id),'{}') into v_recipients
      from public.result_report_releases r join public.guardian_student_links l on l.student_id=r.student_id and l.status='active'
      join public.guardians g on g.id=l.guardian_id join public.user_accounts ua on ua.person_id=g.person_id
     where r.reference=v_event.target_reference;
  elsif v_event.target_type in ('invoice','invoices') then
    select coalesce(array_agg(distinct account_id),'{}') into v_recipients
    from (
      select ua.id account_id from public.invoices i join public.guardian_student_links l on l.student_id=i.student_id and l.status='active' join public.guardians g on g.id=l.guardian_id join public.user_accounts ua on ua.person_id=g.person_id where i.reference=v_event.target_reference
      union all
      select aa.owner_account_id from public.invoices i join public.admission_applications aa on aa.reference=i.applicant_ref where i.reference=v_event.target_reference
    ) recipients where account_id is not null;
  elsif v_event.target_type in ('receipt','receipts') then
    select coalesce(array_agg(distinct account_id),'{}') into v_recipients
    from (
      select ua.id account_id from public.receipts r join public.invoices i on i.id=r.invoice_id join public.guardian_student_links l on l.student_id=i.student_id and l.status='active' join public.guardians g on g.id=l.guardian_id join public.user_accounts ua on ua.person_id=g.person_id where r.reference=v_event.target_reference
      union all
      select aa.owner_account_id from public.receipts r join public.invoices i on i.id=r.invoice_id join public.admission_applications aa on aa.reference=i.applicant_ref where r.reference=v_event.target_reference
    ) recipients where account_id is not null;
  elsif v_event.target_type in ('refund_request','refund_requests') then
    select coalesce(array_agg(distinct account_id),'{}') into v_recipients
    from (
      select ua.id account_id from public.refund_requests rr join public.payment_allocations pa on pa.payment_id=rr.payment_id join public.invoices i on i.id=pa.invoice_id join public.guardian_student_links l on l.student_id=i.student_id and l.status='active' join public.guardians g on g.id=l.guardian_id join public.user_accounts ua on ua.person_id=g.person_id where rr.reference=v_event.target_reference
      union all
      select aa.owner_account_id from public.refund_requests rr join public.payment_allocations pa on pa.payment_id=rr.payment_id join public.invoices i on i.id=pa.invoice_id join public.admission_applications aa on aa.reference=i.applicant_ref where rr.reference=v_event.target_reference
    ) recipients where account_id is not null;
  elsif v_event.target_type in ('user_account','user_accounts','staff_requester','applicant_identity','staff_assignment') then
    if (v_event.payload->>'accountId') ~* '^[0-9a-f-]{36}$' then
      v_recipients:=array_append(v_recipients,(v_event.payload->>'accountId')::uuid);
    elsif v_event.target_type in ('user_account','user_accounts') and v_event.target_reference ~* '^[0-9a-f-]{36}$' then
      v_recipients:=array_append(v_recipients,v_event.target_reference::uuid);
    end if;
  elsif v_event.target_type in ('account_invitation','account_invitations') then
    select coalesce(array_agg(distinct account_id),'{}') into v_recipients
    from (
      select account_id from public.account_invitations where reference=v_event.target_reference
      union all
      select created_by_account_id from public.account_invitations where reference=v_event.target_reference
    ) recipients where account_id is not null;
  elsif v_event.target_type in ('notice','notices','content_item') then
    select coalesce(array_agg(distinct account_id),'{}') into v_recipients
    from (
      select rg.account_id from public.notices n join public.notice_audiences na on na.notice_id=n.id join public.role_grants rg on rg.role_code=na.role_code and rg.status='active' where n.reference=v_event.target_reference and na.audience='role'
      union all
      select ua.id from public.notices n join public.notice_audiences na on na.notice_id=n.id join public.enrollments e on e.academic_year_id=na.academic_year_id and e.status='active' join public.guardian_student_links l on l.student_id=e.student_id and l.status='active' join public.guardians g on g.id=l.guardian_id join public.user_accounts ua on ua.person_id=g.person_id where n.reference=v_event.target_reference and na.audience='academic_year'
      union all
      select ua.id from public.notices n join public.notice_audiences na on na.notice_id=n.id join public.enrollments e on e.grade_section_id=na.grade_section_id and e.status='active' join public.guardian_student_links l on l.student_id=e.student_id and l.status='active' join public.guardians g on g.id=l.guardian_id join public.user_accounts ua on ua.person_id=g.person_id where n.reference=v_event.target_reference and na.audience='grade_section'
      union all
      select ua.id from public.notices n join public.notice_audiences na on na.notice_id=n.id join public.guardian_student_links l on l.student_id=na.student_id and l.status='active' join public.guardians g on g.id=l.guardian_id join public.user_accounts ua on ua.person_id=g.person_id where n.reference=v_event.target_reference and na.audience='student'
    ) recipients where account_id is not null;
  elsif v_event.target_type in ('result_publication','result_publications') then
    select coalesce(array_agg(distinct ua.id),'{}') into v_recipients
      from public.result_publications rp
      left join public.result_batches rb on rb.id=rp.batch_id
      left join public.result_entry_sheets res on res.id=rp.source_entry_sheet_id
      join public.enrollments e on e.grade_section_id=coalesce(rb.grade_section_id,res.grade_section_id) and e.status='active'
      join public.guardian_student_links l on l.student_id=e.student_id and l.status='active'
      join public.guardians g on g.id=l.guardian_id join public.user_accounts ua on ua.person_id=g.person_id
     where rp.reference=v_event.target_reference;
  elsif v_event.target_type in ('result_entry_sheet','result_entry_sheets','result_batch','result_batches') then
    select coalesce(array_agg(distinct rg.account_id),'{}') into v_recipients from public.role_grants rg where rg.status='active' and rg.role_code in ('exam_reviewer','result_publisher');
  elsif v_event.target_type in ('timetable_publication','timetable_publications') then
    select coalesce(array_agg(distinct ua.id),'{}') into v_recipients
      from public.timetable_publications tp join public.timetable_versions tv on tv.id=tp.timetable_version_id
      join public.enrollments e on e.grade_section_id=tv.grade_section_id and e.status='active'
      join public.guardian_student_links l on l.student_id=e.student_id and l.status='active'
      join public.guardians g on g.id=l.guardian_id join public.user_accounts ua on ua.person_id=g.person_id
     where tp.reference=v_event.target_reference;
  elsif v_event.target_type in ('timetable_override','timetable_overrides') then
    select coalesce(array_agg(distinct ua.id),'{}') into v_recipients
      from public.timetable_overrides o join public.enrollments e on e.grade_section_id=o.grade_section_id and e.status='active'
      join public.guardian_student_links l on l.student_id=e.student_id and l.status='active'
      join public.guardians g on g.id=l.guardian_id join public.user_accounts ua on ua.person_id=g.person_id
     where o.reference=v_event.target_reference;
  elsif v_event.target_type in ('exam_schedule_version','exam_schedule_versions') then
    select coalesce(array_agg(distinct ua.id),'{}') into v_recipients
      from public.exam_schedule_versions esv join public.enrollments e on e.grade_section_id=esv.grade_section_id and e.status='active'
      join public.guardian_student_links l on l.student_id=e.student_id and l.status='active'
      join public.guardians g on g.id=l.guardian_id join public.user_accounts ua on ua.person_id=g.person_id
     where esv.reference=v_event.target_reference;
  elsif v_event.target_type in ('enrollment','enrollments') then
    select coalesce(array_agg(distinct ua.id),'{}') into v_recipients
      from public.enrollments e join public.guardian_student_links l on l.student_id=e.student_id and l.status='active'
      join public.guardians g on g.id=l.guardian_id join public.user_accounts ua on ua.person_id=g.person_id
     where e.id::text=v_event.target_reference or e.reference=v_event.target_reference;
  end if;

  if v_event.event_key like 'email.application_%' or v_event.event_key like 'email.offer:%' then
    v_kind:='Admissions'; v_title:='Admissions update'; v_body:='Your application has a new update. Sign in to review the current status.';
  elsif v_event.event_key like 'email.job_%' then
    v_kind:='Careers'; v_title:='Careers update'; v_body:='Your job application has a new update. Sign in to review the current status.';
  elsif v_event.event_key like 'email.support:%' then
    v_kind:='Support'; v_title:='Support response'; v_body:='Your support request has a new reply. Sign in to read it.';
  elsif v_event.event_key like 'email.link_%' or v_event.event_key like 'security.link_%' then
    v_kind:='Security'; v_title:='Family access update'; v_body:='Your family access status has changed. Sign in to review it.';
  elsif v_event.event_key like 'security.%' then
    v_kind:='Security'; v_title:='Account security update'; v_body:='Your account access or security status has changed. Sign in to review it.';
  elsif v_event.event_key like 'email.invoice_%' or v_event.event_key like 'email.receipt:%' or v_event.event_key like 'email.refund_%' or v_event.event_key like 'email.payment_%' then
    v_kind:='Finance'; v_title:='Finance update'; v_body:='A payment, invoice, receipt, or refund record has a new update. Sign in to review the ledger.';
  elsif v_event.event_key like 'email.result_%' or v_event.event_key like 'email.results_%' or v_event.event_key like 'email.marks_%' then
    v_kind:='Results'; v_title:='Results update'; v_body:='A results workflow or published record has a new update. Sign in to review it.';
  elsif v_event.event_key like 'email.timetable_%' or v_event.event_key like 'email.exam_%' then
    v_kind:='Timetable'; v_title:='Schedule update'; v_body:='A timetable or exam schedule has a new update. Sign in to review it.';
  elsif v_event.event_key like 'email.notice_%' or v_event.event_key like 'content.%' then
    v_kind:='Notice'; v_title:='School notice'; v_body:='A school notice is available. Sign in to read it.';
  elsif v_event.event_key like 'email.enrollment_%' then
    v_kind:='Enrollment'; v_title:='Enrollment update'; v_body:='Enrollment has a new update. Sign in to open the family portal.';
  end if;

  foreach v_recipient in array v_recipients loop
    if v_recipient is null then continue; end if;
    insert into public.in_app_notifications(recipient_account_id,kind,title,body,target_type,target_reference,source_event_id,idempotency_key)
    values(v_recipient,v_kind,v_title,v_body,v_event.target_type,v_event.target_reference,p_event_id,'in_app:'||p_event_id::text||':'||v_recipient::text)
    on conflict do nothing;
    if found then v_count:=v_count+1; end if;
  end loop;
  return v_count;
end
$$;

create or replace function app.project_notification_event_v2_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform app.project_notification_event_v2(new.id);
  exception when others then
    null;
  end;
  return new;
end
$$;

drop trigger if exists outbox_project_notifications on public.outbox_events;
drop trigger if exists outbox_project_provider_notifications on public.outbox_events;
drop trigger if exists outbox_project_notifications_v2 on public.outbox_events;
create trigger outbox_project_notifications_v2 after insert on public.outbox_events for each row execute function app.project_notification_event_v2_trigger();

revoke all on function app.project_notification_event_v2(uuid), app.project_notification_event_v2_trigger() from public, anon, authenticated;
grant execute on function app.project_notification_event_v2(uuid) to service_role;

commit;
