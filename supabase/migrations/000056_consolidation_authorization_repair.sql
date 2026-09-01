-- =============================================================================
-- 000056 — Consolidation authorization and profile repair
--
-- Forward-only repair of live defects found in the Phase 10 audit:
--   1. SECURITY DEFINER reads without internal actor checks
--      (teaching_staff_list, legacy_teacher_access_report,
--      data_import_preview, data_import_report, staff_profiles_list).
--   2. roles_grant still permitted individually adding a role inside a
--      profiled account's bundle; the plan requires ALL individual
--      grant/revoke against profiled accounts to be denied.
--   3. staff_profile_change rejected legacy accounts instead of providing
--      the version-checked adoption/reconciliation path.
--   4. Last-Administrator checks had no serialization lock despite
--      comments claiming one; two concurrent demotions could race.
--   5. context_staff_select accepted profile accounts (server-side switch
--      denial was only in the React provider).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Internal actor checks on exposed reads
-- ---------------------------------------------------------------------------

-- Teaching staff list: Principal/AAL2 (timetable_manager) or Administrator.
create or replace function app.teaching_staff_list()
returns setof jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'staffMemberId', sm.id, 'staffRef', sm.reference, 'title', sm.title,
    'employmentStatus', sm.employment_status,
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ta.id, 'reference', ta.reference, 'academicYearId', ta.academic_year_id,
        'gradeSectionId', ta.grade_section_id, 'subjectId', ta.subject_id,
        'status', ta.status, 'effectiveFromIso', ta.effective_from, 'effectiveToIso', ta.effective_to,
        'version', ta.version, 'provenance', ta.provenance,
        'gradeLabel', g.label, 'sectionLabel', gs.section_label, 'subjectName', s.name)
        order by ta.created_at)
      from public.teaching_assignments ta
      left join public.grade_sections gs on gs.id = ta.grade_section_id
      left join public.grades g on g.id = gs.grade_id
      left join public.subjects s on s.id = ta.subject_id
     where ta.staff_member_id = sm.id), '[]'::jsonb)
  )
    from public.staff_members sm
   where app.is_staff_aal2()
     and (app.has_any_role(array['timetable_manager', 'auditor', 'exam_reviewer', 'result_publisher'])
          or app.has_role('system_administrator'))
     and (sm.person_id is null
          or not exists (
            select 1 from public.user_accounts ua
             where ua.person_id = sm.person_id
               and exists (select 1 from public.role_grants rg
                            where rg.account_id = ua.id and rg.status = 'active'
                              and rg.role_code not in ('guardian', 'student'))))
$$;

-- Masked legacy teacher inventory: Administrator + AAL2 only.
create or replace function app.legacy_teacher_access_report()
returns setof jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'grantRef', rg.reference,
    'accountId', rg.account_id,
    'grantVersion', rg.version,
    'hasGuardianGrant', exists (
      select 1 from public.role_grants g2
       where g2.account_id = rg.account_id and g2.role_code = 'guardian' and g2.status = 'active'),
    'otherActiveStaffGrants', (select count(*) from public.role_grants g3
       where g3.account_id = rg.account_id and g3.status = 'active'
         and g3.role_code not in ('teacher', 'guardian', 'student')),
    'legacyAssignments', (select count(*) from public.staff_assignments sa
       where sa.role_grant_id = rg.id),
    'timetablePeriodReferences', (select count(*) from public.timetable_periods tp
       where tp.teacher_assignment_id in (select sa.id from public.staff_assignments sa where sa.role_grant_id = rg.id)),
    'overrideReferences', (select count(*) from public.timetable_overrides to_
       where to_.substitute_teacher_assignment_id in (select sa.id from public.staff_assignments sa where sa.role_grant_id = rg.id)),
    'activeTeachingAssignments', (select count(*) from public.teaching_assignments ta
       join public.staff_members sm on sm.id = ta.staff_member_id
       join public.user_accounts ua on ua.person_id = sm.person_id
      where ua.id = rg.account_id and ta.status in ('scheduled', 'active'))
  )
    from public.role_grants rg
   where rg.role_code = 'teacher' and rg.status = 'active'
     and app.is_staff_aal2() and app.has_role('system_administrator')
   order by rg.reference
$$;

-- Import preview/report: Administrator + AAL2 only.
create or replace function app.data_import_preview(p_batch_id uuid)
returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'batchId', b.id,
    'createCount', coalesce(sum(case when r.status in ('valid','warning','resolved') then 1 else 0 end), 0),
    'updateCount', 0,
    'unchangedCount', coalesce(sum(case when r.status = 'committed' then 1 else 0 end), 0),
    'skippedCount', coalesce(sum(case when r.status = 'skipped' then 1 else 0 end), 0),
    'errorCount', coalesce(sum(case when r.status in ('error','failed') then 1 else 0 end), 0),
    'warningCount', coalesce(sum(case when r.status = 'warning' then 1 else 0 end), 0),
    'familyGroupCount', (select count(distinct normalized ->> 'familyKey')
                          from public.data_import_rows where batch_id = b.id)
  )
    from public.data_import_batches b
    left join public.data_import_rows r on r.batch_id = b.id
   where b.id = p_batch_id
     and app.is_staff_aal2() and app.has_role('system_administrator')
   group by b.id
$$;

create or replace function app.data_import_report(p_batch_id uuid)
returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'batchRef', b.reference, 'state', b.state, 'rowCount', b.row_count,
    'createdCount', (select count(*) from public.data_import_rows r where r.batch_id = b.id and r.outcome = 'create'),
    'updatedCount', (select count(*) from public.data_import_rows r where r.batch_id = b.id and r.outcome = 'update'),
    'unchangedCount', (select count(*) from public.data_import_rows r where r.batch_id = b.id and r.outcome = 'unchanged'),
    'skippedCount', (select count(*) from public.data_import_rows r where r.batch_id = b.id and r.outcome = 'skipped'),
    'errorCount', (select count(*) from public.data_import_rows r where r.batch_id = b.id and r.status in ('error','failed')),
    'committedAtIso', b.committed_at,
    'auditRef', (select ae.target_reference from public.audit_events ae
                  where ae.target_type = 'data_import_batch' and ae.target_reference = b.reference
                  order by ae.created_at desc limit 1))
    from public.data_import_batches b
   where b.id = p_batch_id
     and app.is_staff_aal2() and app.has_role('system_administrator')
$$;

-- Profile catalog: authenticated AAL2 staff only.
create or replace function app.staff_profiles_list()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_data order by row_data->>'code'), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'code', sp.code,
        'label', sp.label,
        'description', sp.description,
        'version', sp.version,
        'roles', app.profile_role_codes(sp.code)
      ) as row_data
        from public.staff_access_profiles sp
       where sp.is_active
         and app.is_staff_aal2()
    ) rows
$$;

-- ---------------------------------------------------------------------------
-- 2. Export/import completion functions are service-role only
-- ---------------------------------------------------------------------------

create or replace function app.data_export_mark_ready(
  p_request_reference text,
  p_row_count int,
  p_document_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.data_export_requests%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'export completion requires the service worker';
  end if;
  select * into v_request from public.data_export_requests where reference = p_request_reference for update;
  if v_request.id is null then raise exception 'export request not found'; end if;
  if v_request.state not in ('requested', 'generating') then
    raise exception 'export request is not generatable (state: %)', v_request.state;
  end if;
  if p_document_id is null then
    raise exception 'a ready export requires a generated private document';
  end if;
  update public.data_export_requests
     set state = 'ready', row_count = p_row_count, document_id = p_document_id,
         expires_at = now() + interval '24 hours', completed_at = now(), version = v_request.version + 1
   where id = v_request.id;
  insert into public.data_export_events (request_id, event_type, detail)
  values (v_request.id, 'ready', p_row_count || ' rows');
  perform app.record_audit('Data export ready', 'data_export_request', v_request.reference, 'Success',
                           p_row_count || ' rows');
  return jsonb_build_object('reference', v_request.reference, 'state', 'ready',
                            'expiresAt', (select expires_at from public.data_export_requests where id = v_request.id));
end;
$$;

create or replace function app.data_export_mark_failed(
  p_request_reference text,
  p_error text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.data_export_requests%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'export failure recording requires the service worker';
  end if;
  select * into v_request from public.data_export_requests where reference = p_request_reference for update;
  if v_request.id is null then raise exception 'export request not found'; end if;
  update public.data_export_requests set state = 'failed', version = v_request.version + 1 where id = v_request.id;
  insert into public.data_export_events (request_id, event_type, detail)
  values (v_request.id, 'failed', left(coalesce(p_error, 'export failed'), 500));
  perform app.record_audit('Data export failed', 'data_export_request', v_request.reference, 'Failed',
                           left(coalesce(p_error, 'export failed'), 500));
  return jsonb_build_object('reference', v_request.reference, 'state', 'failed');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Profile bundle invariants: deny ALL individual grant/revoke against
--    profiled accounts (including roles inside the bundle).
-- ---------------------------------------------------------------------------

create or replace function app.roles_grant(
  p_account_id uuid,
  p_role_code text,
  p_reason text,
  p_academic_year_ids uuid[] default '{}',
  p_grade_section_ids uuid[] default '{}',
  p_subject_ids uuid[] default '{}'
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant_id uuid;
  v_reference text;
  v_version int;
  v_definition record;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['system_administrator'])) then
    raise exception 'role administration requires system_administrator and aal2';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'invalid grant: a recorded reason is required';
  end if;
  select is_active, is_assignable into v_definition from public.role_definitions where code = p_role_code;
  if v_definition.is_active is null then
    raise exception 'role not found';
  end if;
  if not v_definition.is_active then
    raise exception 'role not found or inactive';
  end if;
  if not v_definition.is_assignable then
    raise exception 'role % is legacy/non-assignable and cannot be granted', p_role_code;
  end if;
  if not exists (select 1 from public.user_accounts where id = p_account_id) then
    raise exception 'account not found';
  end if;
  -- Profile invariant: provisioned accounts are bundle-locked. Individual
  -- grants are denied even for roles inside the bundle — use
  -- app.staff_profile_change.
  if exists (
    select 1
      from public.staff_members sm
      join public.user_accounts ua on ua.person_id = sm.person_id
     where ua.id = p_account_id and sm.access_profile_code is not null
  ) then
    raise exception 'profiled accounts are managed through app.staff_profile_change';
  end if;
  if exists (
    select 1 from public.role_grants
     where account_id = p_account_id and role_code = p_role_code and status = 'active'
  ) then
    raise exception 'duplicate active grant for this account and role';
  end if;

  insert into public.role_grants (
    account_id, role_code, status, granted_by_account_id,
    reason, effective_from, effective_to, version
  ) values (
    p_account_id, p_role_code, 'active', auth.uid(),
    btrim(p_reason), now(), null, 1
  )
  returning id, reference, version into v_grant_id, v_reference, v_version;

  insert into public.role_grant_academic_years (role_grant_id, academic_year_id)
  select v_grant_id, year_id from unnest(p_academic_year_ids) as year_id
   where exists (select 1 from public.academic_years where id = year_id);
  insert into public.role_grant_grade_sections (role_grant_id, grade_section_id)
  select v_grant_id, section_id from unnest(p_grade_section_ids) as section_id
   where exists (select 1 from public.grade_sections where id = section_id);
  insert into public.role_grant_subjects (role_grant_id, subject_id)
  select v_grant_id, subject_id from unnest(p_subject_ids) as subject_id
   where exists (select 1 from public.subjects where id = subject_id);

  perform app.record_audit('Role granted', 'role_grant', v_reference, 'Success', btrim(p_reason), 'system_administrator');
  perform app.enqueue_outbox(
    'security.role_granted:' || v_reference || ':' || v_version,
    'security.role_granted', 'user_account', p_account_id,
    jsonb_build_object('grantRef', v_reference, 'roleCode', p_role_code)
  );
  return v_reference;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Legacy profile adoption: a version-checked reconciliation path for
--    accounts without a profile marker. The operator confirms the account's
--    current active staff grants exactly match the target profile bundle
--    (or the account holds no staff grants at all); the command then stamps
--    the profile marker and bumps the version.
-- ---------------------------------------------------------------------------

create or replace function app.staff_profile_adopt(
  p_account_id uuid,
  p_profile_code text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.staff_members%rowtype;
  v_roles text[] := '{}';
  v_active text[] := '{}';
  v_role text;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['system_administrator'])) then
    raise exception 'profile adoption requires system_administrator and aal2';
  end if;
  if p_account_id is null or p_account_id = auth.uid() then
    raise exception 'administrator cannot change the current account profile';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'an adoption reason of at least 10 characters is required';
  end if;
  if p_profile_code is null or not exists (
    select 1 from public.staff_access_profiles where code = p_profile_code and is_active
  ) then
    raise exception 'invalid staff profile';
  end if;

  select sm.* into v_member
    from public.staff_members sm
    join public.user_accounts ua on ua.person_id = sm.person_id
   where ua.id = p_account_id
   for update of sm;
  if v_member.id is null then raise exception 'staff member not found for this account'; end if;
  if v_member.access_profile_code is not null then
    raise exception 'account already carries an access profile — use app.staff_profile_change';
  end if;

  v_roles := app.profile_role_codes(p_profile_code);
  select coalesce(array_agg(rg.role_code order by rg.role_code), '{}') into v_active
    from public.role_grants rg
   where rg.account_id = p_account_id and rg.status = 'active'
     and rg.role_code in (select code from public.role_definitions where is_assignable)
     and rg.role_code <> 'guardian';

  -- The account's current assignable staff grants must be exactly the
  -- profile bundle or empty (a pure legacy fixture with no staff grants).
  if coalesce(array_length(v_active, 1), 0) > 0 and (
    coalesce(array_length(v_roles, 1), 0) <> coalesce(array_length(v_active, 1), 0)
    or exists (select 1 from unnest(v_active) r where not (r = any(v_roles)))
    or exists (select 1 from unnest(v_roles) r where not (r = any(v_active)))
  ) then
    raise exception 'account grants do not match the % profile bundle — reconcile grants first', p_profile_code;
  end if;

  -- Grant any missing bundle roles (recorded as adoption grants).
  foreach v_role in array v_roles loop
    if not exists (
      select 1 from public.role_grants
       where account_id = p_account_id and role_code = v_role and status = 'active'
    ) then
      insert into public.role_grants (account_id, role_code, status, granted_by_account_id, reason)
      values (p_account_id, v_role, 'active', auth.uid(), 'Profile adoption: ' || btrim(p_reason));
    end if;
  end loop;

  update public.staff_members
     set access_profile_code = p_profile_code,
         access_profile_version = 1
   where id = v_member.id;

  perform app.bump_access_revalidation(p_account_id);
  perform app.record_audit('Staff profile adopted', 'user_account',
    (select reference from public.people where id = v_member.person_id),
    'Success', btrim(p_reason), 'System administrator');
  return jsonb_build_object('accountId', p_account_id, 'profileCode', p_profile_code,
                            'profileVersion', 1, 'roles', v_roles);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Serialize last-Administrator checks with a transaction advisory lock.
--    Both staff_profile_change and accounts_suspend take the same lock key
--    before counting active administrators, so two concurrent demotions or
--    a demotion+suspension race cannot remove the last one.
-- ---------------------------------------------------------------------------

create or replace function app.staff_profile_change(
  p_account_id uuid,
  p_profile_code text,
  p_reason text,
  p_expected_version int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.staff_members%rowtype;
  v_staff_ref text;
  v_current_profile text;
  v_current_version int;
  v_grant public.role_grants%rowtype;
  v_role text;
  v_roles text[] := '{}';
  v_new_grant uuid;
  v_new_grant_ref text;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_any_role(array['system_administrator'])) then
    raise exception 'profile administration requires system_administrator and aal2';
  end if;
  if p_account_id is null or p_account_id = auth.uid() then
    raise exception 'administrator cannot change the current account profile';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'profile change reason is required';
  end if;
  if p_profile_code is null or not exists (
    select 1 from public.staff_access_profiles where code = p_profile_code and is_active
  ) then
    raise exception 'invalid staff profile';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'expected profile version is required';
  end if;

  -- Serialize concurrent last-administrator decisions.
  perform pg_advisory_xact_lock(860001);

  select sm.* into v_member
    from public.staff_members sm
    join public.user_accounts ua on ua.person_id = sm.person_id
   where ua.id = p_account_id
   for update of sm;
  if v_member.id is null then raise exception 'staff member not found for this account'; end if;

  v_current_profile := v_member.access_profile_code;
  v_current_version := coalesce(v_member.access_profile_version, 0);
  if v_current_profile is null then
    raise exception 'legacy account has no access profile — reconcile its grants before changing it';
  end if;
  if v_current_version <> p_expected_version then
    raise exception 'profile version mismatch (expected %, found %)', p_expected_version, v_current_version;
  end if;

  if v_current_profile = 'administrator' and p_profile_code <> 'administrator' then
    if (select count(*) from public.role_grants rg
          join public.staff_members sm on sm.id = v_member.id
          join public.user_accounts ua on ua.person_id = sm.person_id
         where rg.account_id = ua.id and rg.role_code = 'system_administrator' and rg.status = 'active') > 0
       and (select count(distinct ua.id)
              from public.role_grants rg
              join public.user_accounts ua on ua.id = rg.account_id
             where rg.role_code = 'system_administrator' and rg.status = 'active'
               and ua.status = 'active'
               and ua.id <> p_account_id) = 0 then
      raise exception 'cannot demote the last active administrator';
    end if;
  end if;

  select p.reference into v_staff_ref from public.people p where p.id = v_member.person_id;

  for v_grant in
    select rg.* from public.role_grants rg
     where rg.account_id = p_account_id and rg.status = 'active'
       and not exists (select 1 from public.staff_access_profile_roles spr
                        where spr.profile_code = p_profile_code and spr.role_code = rg.role_code)
  loop
    update public.role_grants
       set status = 'revoked', effective_to = now(), version = v_grant.version + 1
     where id = v_grant.id;
    update public.staff_assignments
       set status = 'ended', effective_to = coalesce(effective_to, now()), version = version + 1
     where role_grant_id = v_grant.id and status in ('scheduled', 'active');
  end loop;

  v_roles := app.profile_role_codes(p_profile_code);
  foreach v_role in array v_roles loop
    select id, reference into v_new_grant, v_new_grant_ref
      from public.role_grants
     where account_id = p_account_id and role_code = v_role and status = 'active';
    if v_new_grant is null then
      insert into public.role_grants (account_id, role_code, status, granted_by_account_id, reason)
      values (p_account_id, v_role, 'active', auth.uid(), btrim(p_reason))
      returning id, reference into v_new_grant, v_new_grant_ref;
    end if;
  end loop;

  update public.staff_members
     set access_profile_code = p_profile_code,
         access_profile_version = v_current_version + 1
   where id = v_member.id;

  perform app.bump_access_revalidation(p_account_id);
  perform app.record_audit('Staff profile changed', 'user_account', v_staff_ref,
                           'Success', btrim(p_reason), 'System administrator');
  insert into public.outbox_events (event_key, kind, target_type, target_reference, payload)
  values ('security.staff_profile_changed:' || p_account_id::text || ':' || (v_current_version + 1),
          'security.staff_profile_changed', 'user_account', v_staff_ref,
          jsonb_build_object('accountId', p_account_id, 'fromProfile', v_current_profile,
                             'toProfile', p_profile_code, 'roles', v_roles))
  on conflict (event_key) do nothing;

  return jsonb_build_object(
    'accountId', p_account_id,
    'staffMemberId', v_member.id,
    'profileCode', p_profile_code,
    'profileVersion', v_current_version + 1,
    'roles', v_roles
  );
end;
$$;

create or replace function app.accounts_suspend(
  p_account_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_target_ref text;
  v_is_admin boolean;
begin
  if not (app.is_staff_aal2() and app.has_any_role(array['system_administrator'])) then
    raise exception 'account suspension requires system_administrator and aal2';
  end if;
  if p_account_id is null or p_account_id = auth.uid() then
    raise exception 'administrator cannot suspend the current account';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'suspension reason is required';
  end if;

  -- Serialize concurrent last-administrator decisions.
  perform pg_advisory_xact_lock(860001);

  select ua.status, p.reference into v_status, v_target_ref
    from public.user_accounts ua
    join public.people p on p.id = ua.person_id
   where ua.id = p_account_id
   for update;
  if v_status is null then raise exception 'account not found'; end if;
  if v_status = 'closed' then raise exception 'closed account cannot be suspended'; end if;
  if v_status = 'suspended' then return; end if;

  select exists (
    select 1 from public.role_grants
     where account_id = p_account_id and role_code = 'system_administrator' and status = 'active'
  ) into v_is_admin;
  if v_is_admin and (
    select count(distinct ua.id)
      from public.role_grants rg
      join public.user_accounts ua on ua.id = rg.account_id
     where rg.role_code = 'system_administrator' and rg.status = 'active'
       and ua.status = 'active' and ua.id <> p_account_id
  ) = 0 then
    raise exception 'cannot suspend the last active administrator';
  end if;

  update public.user_accounts set status = 'suspended' where id = p_account_id;
  update public.role_grants
     set status = 'revoked', effective_to = coalesce(effective_to, now()), version = version + 1
   where account_id = p_account_id and status = 'active';
  update public.staff_members sm
     set employment_status = 'inactive'
    from public.user_accounts ua
    join public.people p on p.id = ua.person_id
   where sm.person_id = p.id and ua.id = p_account_id and sm.employment_status = 'active';
  perform app.bump_access_revalidation(p_account_id);
  perform app.record_audit('Account suspended', 'user_account', v_target_ref, 'Success', btrim(p_reason), 'System administrator');
  insert into public.outbox_events (event_key, kind, target_type, target_reference, payload)
  values ('security.account_suspended:' || p_account_id::text, 'security.account_suspended',
          'user_account', v_target_ref,
          jsonb_build_object('accountId', p_account_id, 'reason', btrim(p_reason)))
  on conflict (event_key) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. context_staff_select rejects profile accounts server-side.
-- ---------------------------------------------------------------------------

create or replace function app.context_staff_select(
  p_role_grant_id uuid,
  p_expected_version int default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid := auth.uid();
  v_pref public.account_context_preferences%rowtype;
begin
  if v_account is null or (auth.jwt() ->> 'aal') <> 'aal2' then raise exception 'staff aal2 required'; end if;

  -- Profile accounts hold the exact bundle; granular selection is
  -- legacy-account-only and denied server-side.
  if exists (
    select 1
      from public.staff_members sm
      join public.user_accounts ua on ua.person_id = sm.person_id
     where ua.id = v_account and sm.access_profile_code is not null
  ) then
    raise exception 'workspace switching is not available for access-profile accounts';
  end if;

  if not exists (
    select 1 from public.role_grants where id = p_role_grant_id and account_id = v_account and status = 'active'
      and effective_from <= now() and (effective_to is null or effective_to > now())
  ) then raise exception 'that staff workspace is not granted to this account'; end if;
  select * into v_pref from public.account_context_preferences where account_id = v_account for update;
  if p_expected_version is not null and v_pref.version is not null and v_pref.version <> p_expected_version then
    raise exception 'staff context version mismatch (expected %, found %)', p_expected_version, v_pref.version;
  end if;
  insert into public.account_context_preferences (account_id, active_role_grant_id, version)
  values (v_account, p_role_grant_id, 1)
  on conflict (account_id) do update set active_role_grant_id = excluded.active_role_grant_id,
                                        version = public.account_context_preferences.version + 1;
  select * into v_pref from public.account_context_preferences where account_id = v_account;
  return jsonb_build_object('accountId', v_account, 'activeStudentId', v_pref.active_student_id,
                            'activeRoleGrantId', v_pref.active_role_grant_id, 'version', v_pref.version);
end;
$$;

-- ---------------------------------------------------------------------------
-- Execution surface
-- ---------------------------------------------------------------------------

revoke all on function app.teaching_staff_list() from public, anon;
revoke all on function app.legacy_teacher_access_report() from public, anon;
revoke all on function app.staff_profiles_list() from public, anon;
revoke all on function app.staff_profile_adopt(uuid, text, text) from public, anon;
revoke all on function app.context_staff_select(uuid, int) from public, anon;

grant execute on function app.teaching_staff_list() to authenticated;
grant execute on function app.legacy_teacher_access_report() to authenticated;
grant execute on function app.staff_profiles_list() to authenticated;
grant execute on function app.staff_profile_adopt(uuid, text, text) to authenticated;
grant execute on function app.context_staff_select(uuid, int) to authenticated;

commit;
