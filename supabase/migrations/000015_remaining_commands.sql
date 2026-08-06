-- =============================================================================
-- B1–B6 remaining transactional commands (plan.md §8, BACKEND-HANDOFF-MATRIX
-- rows: links, support, content, careers, results marks/moderation/correction).
--
-- Same contract as 000009: SECURITY DEFINER, search_path = '', auth.uid()
-- verified, role/aal2 checks, optimistic versions, audit + outbox in the
-- same transaction, idempotent retries where the matrix requires them.
-- =============================================================================
begin;

-- ---------------------------------------------------------------------------
-- Guardian links: approve / reject (links.verify scope — support_officer /
-- system_administrator, aal2). Revocation ends access immediately because the
-- RLS policies read link status; the revalidation marker also bumps the
-- guardian's security version (plan.md §4).
-- ---------------------------------------------------------------------------
create or replace function app.links_approve(
  p_link_id uuid,
  p_expected_version int
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.guardian_student_links%rowtype;
  v_guardian_account uuid;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not (app.is_staff_aal2() and app.has_any_role(
      array['support_officer', 'system_administrator'])) then
    raise exception 'link verification role and aal2 required';
  end if;
  select * into v_link from public.guardian_student_links where id = p_link_id;
  if v_link.id is null then
    raise exception 'link not found';
  end if;
  if v_link.version <> p_expected_version then
    raise exception 'link version mismatch (expected %, found %)', p_expected_version, v_link.version;
  end if;
  if v_link.status = 'active' then
    return;                                    -- idempotent
  end if;
  if v_link.status <> 'pending_verification' then
    raise exception 'link cannot be approved in state (%)', v_link.status;
  end if;

  update public.guardian_student_links
     set status = 'active', approved_by_account_id = auth.uid(),
         approved_at = now(), effective_from = now(), effective_to = null,
         version = v_link.version + 1
   where id = p_link_id;

  select ua.id into v_guardian_account
    from public.guardians g
    join public.user_accounts ua on ua.person_id = g.person_id
   where g.id = v_link.guardian_id;
  if v_guardian_account is not null then
    perform app.bump_access_revalidation(v_guardian_account);
  end if;

  perform app.record_audit('Guardian link approved', 'guardian_student_link',
                           v_link.reference, 'Success',
                           'verification_source=' || v_link.verification_source);
  perform app.enqueue_outbox(
    'email.link_approved:' || v_link.reference, 'email.deliver',
    'guardian_student_link', v_link.reference, jsonb_build_object('channel', 'email'));
end
$$;

create or replace function app.links_reject(
  p_link_id uuid,
  p_reason text,
  p_expected_version int
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.guardian_student_links%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not (app.is_staff_aal2() and app.has_any_role(
      array['support_officer', 'system_administrator'])) then
    raise exception 'link verification role and aal2 required';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'rejection reason is required';
  end if;
  select * into v_link from public.guardian_student_links where id = p_link_id;
  if v_link.id is null then
    raise exception 'link not found';
  end if;
  if v_link.version <> p_expected_version then
    raise exception 'link version mismatch (expected %, found %)', p_expected_version, v_link.version;
  end if;
  if v_link.status <> 'pending_verification' then
    raise exception 'link cannot be rejected in state (%)', v_link.status;
  end if;

  update public.guardian_student_links
     set status = 'rejected', rejection_reason = p_reason,
         version = v_link.version + 1
   where id = p_link_id;

  perform app.record_audit('Guardian link rejected', 'guardian_student_link',
                           v_link.reference, 'Success', 'reason=' || p_reason);
  perform app.enqueue_outbox(
    'email.link_rejected:' || v_link.reference, 'email.deliver',
    'guardian_student_link', v_link.reference, jsonb_build_object('channel', 'email'));
end
$$;

-- ---------------------------------------------------------------------------
-- Support: requester replies to their own thread; support staff respond or
-- attach a private note (never rendered to the requester — plan.md §6.14).
-- ---------------------------------------------------------------------------
create or replace function app.support_respond(
  p_request_id uuid,
  p_body text,
  p_private boolean default false
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.support_requests%rowtype;
  v_staff boolean;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if p_body is null or length(trim(p_body)) = 0 then
    raise exception 'message body is required';
  end if;
  select * into v_request from public.support_requests where id = p_request_id;
  if v_request.id is null then
    raise exception 'request not found';
  end if;

  v_staff := app.is_staff_aal2() and app.has_any_role(array['support_officer', 'system_administrator']);

  if p_private then
    if not v_staff then
      raise exception 'only support staff may add private notes';
    end if;
    insert into public.support_private_notes (support_request_id, author_account_id, body)
    values (p_request_id, auth.uid(), p_body);
    perform app.record_audit('Support private note added', 'support_request',
                             v_request.reference, 'Success');
    return;
  end if;

  if not v_staff and v_request.requester_account_id <> auth.uid() then
    raise exception 'not the request owner';
  end if;

  insert into public.support_messages (support_request_id, author_account_id, body, is_staff)
  values (p_request_id, auth.uid(), p_body, v_staff);

  if v_staff then
    update public.support_requests set status = 'in_progress' where id = p_request_id;
  end if;

  insert into public.support_events (support_request_id, event_type, detail, actor_account_id)
  values (p_request_id, 'responded', case when v_staff then 'staff reply' else 'requester reply' end,
          auth.uid());

  perform app.record_audit('Support responded', 'support_request', v_request.reference, 'Success');
  if not p_private then
    perform app.enqueue_outbox(
      'email.support:' || v_request.reference || ':' || v_request.version,
      'email.deliver', 'support_request', v_request.reference,
      jsonb_build_object('channel', 'email'));
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Content: publisher releases a notice (draft/scheduled → published) with
-- audience intact; the notice stays append-only versioned through events.
-- ---------------------------------------------------------------------------
create or replace function app.content_publish_notice(p_notice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notice public.notices%rowtype;
  v_item public.content_items%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not (app.is_staff_aal2() and app.has_any_role(
      array['content_publisher', 'system_administrator'])) then
    raise exception 'content publisher role and aal2 required';
  end if;
  select * into v_notice from public.notices where id = p_notice_id;
  if v_notice.id is null then
    raise exception 'notice not found';
  end if;
  if v_notice.status = 'published' then
    return;                                    -- idempotent
  end if;
  if v_notice.status not in ('draft', 'scheduled') then
    raise exception 'notice cannot be published in state (%)', v_notice.status;
  end if;

  update public.notices
     set status = 'published', published_at = now()
   where id = p_notice_id;

  update public.content_items set current_status = 'published' where id = v_notice.content_item_id;
  select * into v_item from public.content_items where id = v_notice.content_item_id;

  perform app.record_audit('Notice published', 'notice', v_notice.reference, 'Success');
  perform app.enqueue_outbox(
    'email.notice_published:' || v_notice.reference, 'email.deliver',
    'notice', v_notice.reference, jsonb_build_object('channel', 'email'));
end
$$;

-- ---------------------------------------------------------------------------
-- Careers: applicant submits (idempotent, append-only version).
-- ---------------------------------------------------------------------------
create or replace function app.jobs_submit(
  p_application_id uuid,
  p_snapshot jsonb,
  p_expected_version int default 0
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.job_applications%rowtype;
  v_next int;
  v_version_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  select * into v_app from public.job_applications where id = p_application_id;
  if v_app.id is null then
    raise exception 'application not found';
  end if;
  if v_app.owner_account_id <> auth.uid() then
    raise exception 'not the application owner';
  end if;

  v_next := p_expected_version + 1;
  select id into v_version_id from public.job_application_versions
   where application_id = p_application_id and version = v_next;
  if v_version_id is not null then
    return v_version_id;                       -- idempotent retry
  end if;

  if v_app.version <> p_expected_version then
    raise exception 'application version mismatch (expected %, found %)',
                    p_expected_version, v_app.version;
  end if;
  if v_app.current_status not in ('draft', 'eligibility_review') then
    raise exception 'application is not in an editable state (%)', v_app.current_status;
  end if;

  insert into public.job_application_versions
    (application_id, version, snapshot, submitted_by_account_id)
  values (p_application_id, v_next, p_snapshot, auth.uid())
  returning id into v_version_id;

  update public.job_applications
     set version = v_next, current_status = 'submitted'
   where id = p_application_id;

  insert into public.job_events (application_id, event_type, visible_to_applicant, copy)
  values (p_application_id, 'submitted', true, 'Application submitted');

  perform app.record_audit('Job application submitted', 'job_application',
                           v_app.reference, 'Success');
  perform app.enqueue_outbox(
    'email.job_submitted:' || v_app.reference, 'email.deliver',
    'job_application', v_app.reference, jsonb_build_object('channel', 'email'));
  return v_version_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Careers: HR decides (shortlist / interview / offer / not_selected).
-- ---------------------------------------------------------------------------
create or replace function app.jobs_decide(
  p_application_id uuid,
  p_action text,
  p_reason text default null,
  p_private_note text default null,
  p_scheduled_at timestamptz default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.job_applications%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not (app.is_staff_aal2() and app.has_any_role(
      array['hr_reviewer', 'hr_approver', 'system_administrator'])) then
    raise exception 'HR role and aal2 required';
  end if;
  if p_action not in ('shortlist', 'interview', 'offer', 'not_selected') then
    raise exception 'invalid decision action';
  end if;
  select * into v_app from public.job_applications where id = p_application_id;
  if v_app.id is null then
    raise exception 'application not found';
  end if;
  if v_app.owner_account_id = auth.uid() then
    raise exception 'an HR reviewer cannot decide their own application';
  end if;

  if p_action = 'shortlist' then
    update public.job_applications set current_status = 'shortlisted' where id = p_application_id;
    insert into public.job_events (application_id, event_type, visible_to_applicant, copy)
    values (p_application_id, 'shortlisted', true, 'Shortlisted');
  elsif p_action = 'interview' then
    if p_scheduled_at is null then
      raise exception 'interview requires a scheduled time';
    end if;
    update public.job_applications set current_status = 'interview' where id = p_application_id;
    insert into public.job_interviews (application_id, scheduled_at, outcome, notes)
    values (p_application_id, p_scheduled_at, 'pending', p_private_note);
    insert into public.job_events (application_id, event_type, visible_to_applicant, copy)
    values (p_application_id, 'interview', true, 'Interview scheduled');
  elsif p_action = 'offer' then
    update public.job_applications set current_status = 'offered' where id = p_application_id;
    insert into public.job_events (application_id, event_type, visible_to_applicant, copy)
    values (p_application_id, 'offered', true, 'Offer extended');
    perform app.enqueue_outbox(
      'email.job_offer:' || v_app.reference, 'email.deliver',
      'job_application', v_app.reference, jsonb_build_object('channel', 'email'));
  else
    update public.job_applications set current_status = 'not_selected' where id = p_application_id;
    insert into public.job_events (application_id, event_type, visible_to_applicant, copy)
    values (p_application_id, 'not_selected', true,
            'Application closed: ' || coalesce(p_reason, 'no reason given'));
  end if;

  perform app.record_audit('Job decision: ' || p_action, 'job_application',
                           v_app.reference, 'Success');
end
$$;

-- ---------------------------------------------------------------------------
-- Results: teacher submits marks for their EXACT assignment scope
-- (year/class/subject active assignment; plan.md §6.7). p_marks is an array
-- of {rosterId, componentId, obtained?, absent?, remark?}; every roster
-- student must be present. Batch → submitted (entry locked); a version row is
-- appended (immutable).
-- ---------------------------------------------------------------------------
create or replace function app.results_submit_marks(
  p_batch_id uuid,
  p_marks jsonb,
  p_expected_version int
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.result_batches%rowtype;
  v_assigned boolean;
  v_roster_count int;
  v_covered int;
  v_mark jsonb;
  v_component_max numeric;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not app.is_staff_aal2() then
    raise exception 'staff aal2 required';
  end if;
  select * into v_batch from public.result_batches where id = p_batch_id;
  if v_batch.id is null then
    raise exception 'batch not found';
  end if;
  if v_batch.version <> p_expected_version then
    raise exception 'batch version mismatch (expected %, found %)', p_expected_version, v_batch.version;
  end if;
  if v_batch.status not in ('draft', 'returned') then
    raise exception 'batch is not open for entry (state: %)', v_batch.status;
  end if;

  -- Exact assignment scope: active year/class/subject for the session.
  select exists (
    select 1
      from public.staff_assignments sa
      join public.staff_members sm on sm.id = sa.staff_member_id
      join public.user_accounts ua on ua.person_id = sm.person_id
     where ua.id = auth.uid()
       and sa.status = 'active'
       and sa.academic_year_id = (select academic_year_id from public.exam_definitions where id = v_batch.exam_definition_id)
       and sa.grade_section_id = v_batch.grade_section_id
       and sa.subject_id = v_batch.subject_id
       and sa.effective_from <= now()
       and (sa.effective_to is null or sa.effective_to > now())
  ) into v_assigned;
  if not v_assigned then
    raise exception 'no active assignment for this batch (class/subject scope)';
  end if;

  select count(*) into v_roster_count from public.result_rosters where batch_id = p_batch_id;
  if v_roster_count = 0 then
    raise exception 'batch has no roster';
  end if;

  -- Validate and upsert each mark.
  for v_mark in select * from jsonb_array_elements(p_marks)
  loop
    select max_marks into v_component_max
      from public.assessment_components ac
      join public.result_rosters r on r.id = (v_mark ->> 'rosterId')::uuid
      join public.result_batches b on b.id = r.batch_id
      join public.exam_definitions ed on ed.id = b.exam_definition_id
     where ac.id = (v_mark ->> 'componentId')::uuid
       and ac.exam_definition_id = ed.id;
    if v_component_max is null then
      raise exception 'invalid component for the batch roster';
    end if;
    if (v_mark ->> 'obtained') is not null
       and ((v_mark ->> 'obtained')::numeric < 0 or (v_mark ->> 'obtained')::numeric > v_component_max) then
      raise exception 'mark exceeds the component maximum (%)', v_component_max;
    end if;

    insert into public.mark_entries
      (batch_id, roster_id, component_id, obtained, absent, remark)
    values
      (p_batch_id, (v_mark ->> 'rosterId')::uuid, (v_mark ->> 'componentId')::uuid,
       nullif(v_mark ->> 'obtained', '')::numeric,
       coalesce((v_mark ->> 'absent')::boolean, false),
       v_mark ->> 'remark')
    on conflict (batch_id, roster_id, component_id)
    do update set obtained = excluded.obtained, absent = excluded.absent,
                  remark = excluded.remark, updated_at = now();
  end loop;

  -- Every roster student must be covered by at least one entry.
  select count(distinct roster_id) into v_covered
    from public.mark_entries where batch_id = p_batch_id;
  if v_covered < v_roster_count then
    raise exception 'marks missing for % of % roster students', v_roster_count - v_covered, v_roster_count;
  end if;

  insert into public.result_batch_versions (batch_id, version, status, note, created_by_account_id)
  values (p_batch_id, v_batch.version + 1, 'submitted', 'marks submitted', auth.uid());

  update public.result_batches
     set status = 'submitted', version = v_batch.version + 1
   where id = p_batch_id;

  insert into public.result_events (batch_id, event_type, visible_to_family, copy)
  values (p_batch_id, 'submitted', false, 'Marks submitted');

  perform app.record_audit('Marks submitted', 'result_batch', v_batch.reference, 'Success');
  perform app.enqueue_outbox(
    'email.marks_submitted:' || v_batch.reference || ':v' || (v_batch.version + 1),
    'email.deliver', 'result_batch', v_batch.reference, jsonb_build_object('channel', 'email'));
end
$$;

-- ---------------------------------------------------------------------------
-- Results: moderator approves or returns a submitted batch.
-- ---------------------------------------------------------------------------
create or replace function app.results_moderate(
  p_batch_id uuid,
  p_outcome text,
  p_note text default null,
  p_expected_version int default 1
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.result_batches%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not (app.is_staff_aal2() and app.has_any_role(
      array['exam_reviewer', 'system_administrator'])) then
    raise exception 'exam reviewer role and aal2 required';
  end if;
  if p_outcome not in ('approved', 'returned') then
    raise exception 'invalid moderation outcome';
  end if;
  select * into v_batch from public.result_batches where id = p_batch_id;
  if v_batch.id is null then
    raise exception 'batch not found';
  end if;
  if v_batch.version <> p_expected_version then
    raise exception 'batch version mismatch (expected %, found %)', p_expected_version, v_batch.version;
  end if;
  if v_batch.status <> 'submitted' then
    raise exception 'only submitted batches can be moderated (state: %)', v_batch.status;
  end if;

  insert into public.result_batch_versions (batch_id, version, status, note, created_by_account_id)
  values (p_batch_id, v_batch.version + 1, p_outcome, p_note, auth.uid());

  update public.result_batches
     set status = p_outcome, version = v_batch.version + 1
   where id = p_batch_id;

  insert into public.result_events (batch_id, event_type, visible_to_family, copy)
  values (p_batch_id, p_outcome, false, coalesce(p_note, 'Batch ' || p_outcome));

  perform app.record_audit('Results moderated: ' || p_outcome, 'result_batch',
                           v_batch.reference, 'Success');
  perform app.enqueue_outbox(
    'email.marks_moderated:' || v_batch.reference || ':v' || (v_batch.version + 1),
    'email.deliver', 'result_batch', v_batch.reference, jsonb_build_object('channel', 'email'));
end
$$;

-- ---------------------------------------------------------------------------
-- Results: publisher withdraws a publication (append-only; the published
-- record stays on file) or requests a correction (new snapshot version is a
-- future batch — plan.md §6.7 correction flow).
-- ---------------------------------------------------------------------------
create or replace function app.results_withdraw(
  p_publication_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_publication public.result_publications%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not (app.is_staff_aal2() and app.has_any_role(
      array['result_publisher', 'system_administrator'])) then
    raise exception 'result publisher role and aal2 required';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'withdrawal reason is required';
  end if;
  select * into v_publication from public.result_publications where id = p_publication_id;
  if v_publication.id is null then
    raise exception 'publication not found';
  end if;
  if v_publication.status = 'withdrawn' then
    return;                                    -- idempotent
  end if;

  update public.result_publications
     set status = 'withdrawn', withdrawn_at = now(), withdrawal_reason = p_reason
   where id = p_publication_id;

  insert into public.result_events
    (batch_id, event_type, visible_to_family, copy)
  select batch_id, 'withdrawn', true, p_reason
    from public.result_publications where id = p_publication_id;

  perform app.record_audit('Results withdrawn', 'result_publication',
                           v_publication.reference, 'Success', 'reason=' || p_reason);
  perform app.enqueue_outbox(
    'email.results_withdrawn:' || v_publication.reference, 'email.deliver',
    'result_publication', v_publication.reference, jsonb_build_object('channel', 'email'));
end
$$;

create or replace function app.results_correction_request(
  p_publication_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not (app.is_staff_aal2() and app.has_any_role(
      array['result_publisher', 'system_administrator'])) then
    raise exception 'result publisher role and aal2 required';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'correction reason is required';
  end if;
  if not exists (select 1 from public.result_publications where id = p_publication_id) then
    raise exception 'publication not found';
  end if;

  insert into public.result_correction_requests (publication_id, requested_by_account_id, reason)
  values (p_publication_id, auth.uid(), p_reason);

  perform app.record_audit('Result correction requested', 'result_publication',
                           (select reference from public.result_publications where id = p_publication_id),
                           'Success', 'reason=' || p_reason);
end
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function app.links_approve(uuid, int) from public;
revoke all on function app.links_reject(uuid, text, int) from public;
revoke all on function app.support_respond(uuid, text, boolean) from public;
revoke all on function app.content_publish_notice(uuid) from public;
revoke all on function app.jobs_submit(uuid, jsonb, int) from public;
revoke all on function app.jobs_decide(uuid, text, text, text, timestamptz) from public;
revoke all on function app.results_submit_marks(uuid, jsonb, int) from public;
revoke all on function app.results_moderate(uuid, text, text, int) from public;
revoke all on function app.results_withdraw(uuid, text) from public;
revoke all on function app.results_correction_request(uuid, text) from public;

grant execute on function app.links_approve(uuid, int) to authenticated;
grant execute on function app.links_reject(uuid, text, int) to authenticated;
grant execute on function app.support_respond(uuid, text, boolean) to authenticated;
grant execute on function app.content_publish_notice(uuid) to authenticated;
grant execute on function app.jobs_submit(uuid, jsonb, int) to authenticated;
grant execute on function app.jobs_decide(uuid, text, text, text, timestamptz) to authenticated;
grant execute on function app.results_submit_marks(uuid, jsonb, int) to authenticated;
grant execute on function app.results_moderate(uuid, text, text, int) to authenticated;
grant execute on function app.results_withdraw(uuid, text) to authenticated;
grant execute on function app.results_correction_request(uuid, text) to authenticated;

commit;
