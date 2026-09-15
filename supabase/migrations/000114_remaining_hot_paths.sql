-- =============================================================================
-- 000114 — Remaining hot paths: guardian-link queues, staff documents, and the
--          per-sheet results scope
--
-- From the 4k-student read audit (15 September 2026), re-measured on a
-- synthetic scratch PostgreSQL 17 model (4,000 students · 5,400 guardian links
-- · 8,250 documents · 80 result sheets). Measured before this migration:
--
--   1. `/staff/link-requests` reads all three guardian-link queues directly
--      from PostgREST with embedded names and capabilities. At 4,000 active /
--      1,000 pending / 400 restricted links the page downloads ~4.4 MiB of
--      JSON and parses 5,400 rows (active 3.4 MiB, pending 747 KiB, restricted
--      296 KiB). Two paged reads are added — `app.guardian_link_requests_list_
--      paginated(status, limit, offset)` and `app.guardian_link_get(link_id)` —
--      returning `{rows, total, nextOffset}` with the exact field names and
--      name composition the application already maps, under the same staff
--      read predicate as the `scope_staff_links_read` policy (000042).
--
--   2. `app.documents_projection_list()` returns every authorized document:
--      8,000 rows / 4.69 MiB for one staff reader at audit scale, computed in
--      ~3.2 s (the same query without JSON construction still costs ~3.1 s in
--      the per-row `app.document_actor_allowed` predicate). The public-register
--      visibility command also re-read that full set to find ONE reference
--      (~9.5 s in the audit model). Three changes:
--        · `app.documents_projection_list_paginated(owner_domain, owner_record,
--          limit, offset)` returns `{rows, total, nextOffset}` with the exact
--          projection of the existing function, which is left untouched;
--        · `app.documents_projection_get(reference)` reads one row by its
--          unique reference for the visibility command;
--        · the per-student branch of the projection's access predicate is
--          evaluated with the snapshot below, so a page no longer pays the
--          per-row `app.staff_scope_allowed` plan/executor cost. The branch is
--          semantically identical: `app.guardian_has_capability` for actual
--          guardians (short-circuited by a once-per-request guardian check)
--          and the same enrollment+scope test for staff.
--
--   3. `app.results_entry_sheet_list()` evaluates
--      `app.result_entry_sheet_scope(sheet, roles)` per candidate sheet. At 80
--      sheets the list costs 62.4 ms of which 45.3 ms is the scope predicate
--      (scope alone: 28.6 ms for 80 calls; the same list projection without
--      scope: 17.1 ms). The predicate is exactly "has role? then that role's
--      scope, else the other roles' scope" over the caller's active role
--      grants. `app.staff_scope_boxes` snapshots those grants as per-dimension
--      restriction boxes once per statement and
--      `app.staff_scope_boxes_allowed` evaluates a sheet's
--      (year, section, subject) against them without table access. Both
--      `results_entry_sheet_list` and `results_entry_sheet_get` keep their
--      signatures, output shape, per-sheet semantics, and grants.
--
--   4. Supporting indexes: `enrollments (student_id)` (only a partial
--      active-only unique index led with student_id, so every generic
--      per-student enrollment probe fell back to a sequential scan) and
--      `documents (created_at desc, id desc)` for the paged register order.
--
--   5. Hardening found while testing: `app.is_staff_aal2()` returned NULL when
--      a token carried no `aal` claim, and every `if not (is_staff_aal2() and
--      ...) then raise` guard silently passed on NULL. The check is now
--      coalesced to false so malformed tokens deny.
--
-- No table or data changes beyond the two indexes. All functions keep
-- SECURITY DEFINER and `search_path = ''`; new authenticated reads restate
-- their grants; the snapshot helpers stay service-internal. Forward-only from
-- 000113. Validated and applied by the central process.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Supporting indexes
-- ---------------------------------------------------------------------------

-- `enrollments_active_unique (student_id, academic_year_id) where status =
-- 'active'` cannot serve a generic `student_id = ?` probe. The shared
-- `app.document_staff_allowed('student', ...)` and other per-student reads
-- then scanned the table once per candidate row.
create index if not exists enrollments_student_idx
  on public.enrollments (student_id);

-- The document projections order by created_at desc, id desc; no existing
-- index serves that ordering (`documents_owner_idx` leads with owner_domain).
create index if not exists documents_created_idx
  on public.documents (created_at desc, id desc);

-- ---------------------------------------------------------------------------
-- 2. NULL-safe AAL2 check
--
-- `(auth.jwt() ->> 'aal') = 'aal2'` is NULL when a token carries no `aal`
-- claim, so `app.is_staff_aal2()` could return NULL and `not (NULL and ...)`
-- skipped every guard that reads it (`if not (...) then raise` does not fire
-- on NULL). Real Supabase tokens carry `aal`, so this only hardens malformed
-- or foreign tokens, and it can only ever turn a NULL into `false` (deny).
-- The body is otherwise identical to 000020/000042.
-- ---------------------------------------------------------------------------

create or replace function app.is_staff_aal2()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
     and exists (
       select 1
         from public.role_grants rg
        where rg.account_id = auth.uid()
          and rg.status = 'active'
          and rg.effective_from <= now()
          and (rg.effective_to is null or rg.effective_to > now())
          and rg.role_code in (
            'content_editor', 'content_publisher',
            'admissions_officer', 'admissions_approver',
            'finance_officer', 'finance_approver',
            'hr_reviewer', 'hr_approver',
            'teacher', 'result_entry_officer', 'exam_reviewer', 'result_publisher',
            'timetable_manager', 'support_officer',
            'auditor', 'system_administrator'
          )
     )
$$;

-- ---------------------------------------------------------------------------
-- 3. Per-statement staff scope snapshot
--
-- `app.staff_scope_allowed(roles, year, section, subject)` is EXISTS over the
-- caller's matching active grants, where each grant allows a dimension when it
-- carries no restriction rows for it or carries a matching row. The snapshot
-- stores exactly those restriction boxes (one per matching grant); the
-- per-row predicate below is the same EXISTS over boxes. This is not an
-- approximation: it is the same disjunction, with the grant lookup resolved
-- once per statement instead of once per candidate row.
-- ---------------------------------------------------------------------------

create or replace function app.staff_scope_boxes(p_roles text[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null or (auth.jwt() ->> 'aal') is distinct from 'aal2' then '[]'::jsonb
    else coalesce(jsonb_agg(jsonb_build_object(
      'yearUnrestricted', not exists (select 1 from public.role_grant_academic_years x where x.role_grant_id = rg.id),
      'years', coalesce((select jsonb_agg(x.academic_year_id) from public.role_grant_academic_years x where x.role_grant_id = rg.id), '[]'::jsonb),
      'sectionUnrestricted', not exists (select 1 from public.role_grant_grade_sections x where x.role_grant_id = rg.id),
      'sections', coalesce((select jsonb_agg(x.grade_section_id) from public.role_grant_grade_sections x where x.role_grant_id = rg.id), '[]'::jsonb),
      'subjectUnrestricted', not exists (select 1 from public.role_grant_subjects x where x.role_grant_id = rg.id),
      'subjects', coalesce((select jsonb_agg(x.subject_id) from public.role_grant_subjects x where x.role_grant_id = rg.id), '[]'::jsonb)
    )), '[]'::jsonb)
  end
  from public.role_grants rg
 where rg.account_id = auth.uid()
   and rg.role_code = any(p_roles)
   and rg.status = 'active'
   and rg.effective_from <= now()
   and (rg.effective_to is null or rg.effective_to > now())
$$;

create or replace function app.staff_scope_boxes_allowed(
  p_boxes jsonb,
  p_academic_year_id uuid,
  p_grade_section_id uuid,
  p_subject_id uuid
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1
      from jsonb_array_elements(p_boxes) box
     where (p_academic_year_id is null
            or (box ->> 'yearUnrestricted')::boolean
            or box -> 'years' ? p_academic_year_id::text)
       and (p_grade_section_id is null
            or (box ->> 'sectionUnrestricted')::boolean
            or box -> 'sections' ? p_grade_section_id::text)
       and (p_subject_id is null
            or (box ->> 'subjectUnrestricted')::boolean
            or box -> 'subjects' ? p_subject_id::text)
  )
$$;

revoke all on function app.staff_scope_boxes(text[]), app.staff_scope_boxes_allowed(jsonb, uuid, uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- 4. Results list and detail: resolve the scope once per statement
--
-- The scope decision is unchanged:
--   · a result_entry_officer is judged only by that role's grant scope;
--   · everyone else by the remaining roles
--     (array_remove(['teacher','exam_reviewer','result_publisher','auditor'],
--     'teacher') as in 000057).
-- ---------------------------------------------------------------------------

create or replace function app.results_entry_sheet_list()
returns setof jsonb
language sql
security definer
set search_path = ''
as $$
  with scope as (
    select
      app.has_role('result_entry_officer') as officer,
      app.staff_scope_boxes(array['result_entry_officer']) as officer_boxes,
      app.staff_scope_boxes(array['exam_reviewer','result_publisher','auditor']) as other_boxes
  )
  select jsonb_build_object(
    'id', res.id, 'reference', res.reference, 'examDefinitionId', res.exam_definition_id,
    'academicYearId', res.academic_year_id, 'gradeSectionId', res.grade_section_id,
    'subjectId', res.subject_id, 'state', res.state, 'version', res.version,
    'examTerm', ed.term, 'gradeLabel', g.label, 'sectionLabel', gs.section_label,
    'subjectName', s.name, 'updatedAt', res.updated_at,
    'componentCount', counters.component_count,
    'rosterCount', counters.roster_count,
    'enteredCount', counters.entered_count,
    'incompleteCount', greatest(counters.roster_count * counters.component_count - counters.complete_count, 0)
  )
    from public.result_entry_sheets res
    join public.exam_definitions ed on ed.id = res.exam_definition_id
    join public.grade_sections gs on gs.id = res.grade_section_id
    join public.grades g on g.id = gs.grade_id
    join public.subjects s on s.id = res.subject_id
    cross join scope
    cross join lateral (
      select
        (select count(*)::int
           from public.result_entry_sheet_components rec
          where rec.sheet_id = res.id) as component_count,
        (select count(*)::int
           from public.result_entry_sheet_rosters rer
          where rer.sheet_id = res.id) as roster_count,
        m.entered_count,
        m.complete_count
      from (
        select
          (count(*) filter (where rem.obtained is not null))::int as entered_count,
          (count(*) filter (where rem.mark_status <> 'pending'))::int as complete_count
        from public.result_entry_sheet_marks rem
        where rem.sheet_id = res.id
      ) m
    ) counters
   where case when scope.officer
              then app.staff_scope_boxes_allowed(scope.officer_boxes, res.academic_year_id, res.grade_section_id, res.subject_id)
              else app.staff_scope_boxes_allowed(scope.other_boxes, res.academic_year_id, res.grade_section_id, res.subject_id)
         end
   order by res.updated_at desc, res.id;
$$;

create or replace function app.results_entry_sheet_get(p_sheet_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with scope as (
    select
      app.has_role('result_entry_officer') as officer,
      app.staff_scope_boxes(array['result_entry_officer']) as officer_boxes,
      app.staff_scope_boxes(array['exam_reviewer','result_publisher','auditor']) as other_boxes
  )
  select jsonb_build_object(
    'id', res.id, 'reference', res.reference, 'examDefinitionId', res.exam_definition_id,
    'academicYearId', res.academic_year_id, 'gradeSectionId', res.grade_section_id,
    'subjectId', res.subject_id, 'state', res.state, 'version', res.version,
    'examTerm', ed.term, 'gradeLabel', g.label, 'sectionLabel', gs.section_label,
    'subjectName', s.name, 'updatedAt', res.updated_at,
    'components', coalesce((select jsonb_agg(jsonb_build_object('id', rec.id, 'reference', rec.reference, 'name', rec.name, 'maxMarks', rec.max_marks, 'weight', rec.weight, 'order', rec.component_order) order by rec.component_order, rec.id) from public.result_entry_sheet_components rec where rec.sheet_id = res.id), '[]'::jsonb),
    'roster', coalesce((select jsonb_agg(jsonb_build_object('id', rer.id, 'reference', rer.reference, 'studentId', rer.student_id, 'enrollmentId', rer.enrollment_id, 'studentName', p.display_name, 'order', rer.roster_order, 'marks', coalesce((select jsonb_agg(jsonb_build_object('id', rem.id, 'componentId', rem.component_id, 'obtained', rem.obtained, 'markStatus', rem.mark_status, 'remark', rem.remark) order by rem.component_id) from public.result_entry_sheet_marks rem where rem.sheet_id = res.id and rem.roster_id = rer.id), '[]'::jsonb)) order by rer.roster_order, rer.id) from public.result_entry_sheet_rosters rer join public.students st on st.id = rer.student_id join public.people p on p.id = st.person_id where rer.sheet_id = res.id), '[]'::jsonb)
  )
    from public.result_entry_sheets res
    join public.exam_definitions ed on ed.id = res.exam_definition_id
    join public.grade_sections gs on gs.id = res.grade_section_id
    join public.grades g on g.id = gs.grade_id
    join public.subjects s on s.id = res.subject_id
    cross join scope
   where res.id = p_sheet_id
     and case when scope.officer
              then app.staff_scope_boxes_allowed(scope.officer_boxes, res.academic_year_id, res.grade_section_id, res.subject_id)
              else app.staff_scope_boxes_allowed(scope.other_boxes, res.academic_year_id, res.grade_section_id, res.subject_id)
         end;
$$;

revoke all on function app.results_entry_sheet_list(), app.results_entry_sheet_get(uuid) from public;
grant execute on function app.results_entry_sheet_list(), app.results_entry_sheet_get(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Guardian-link queue: paged staff projection + single-link read
--
-- Same projection the application maps today (flat column names plus composed
-- guardian/student names, the student reference, and the capability array),
-- under the exact `scope_staff_links_read` predicate from 000042.
-- ---------------------------------------------------------------------------

create or replace function app.guardian_link_requests_list_paginated(
  p_status text,
  p_limit int default 50,
  p_offset int default 0
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_rows jsonb;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and (
    app.has_any_role(array['admissions_officer','admissions_approver','finance_officer','finance_approver','teacher','exam_reviewer','result_publisher','timetable_manager','support_officer','auditor'])
    or app.has_role('system_administrator'))) then
    raise exception 'guardian link queues require a staff read role and aal2';
  end if;
  if p_status is null or p_status not in ('pending_verification', 'active', 'restricted') then
    raise exception 'unsupported guardian link status';
  end if;

  select count(*) into v_total
    from public.guardian_student_links l
   where l.status = p_status;

  select coalesce(jsonb_agg(row order by page.created_at asc, page.id asc), '[]'::jsonb) into v_rows
    from (
      select l.created_at, l.id, jsonb_build_object(
        'id', l.id,
        'reference', l.reference,
        'guardian_id', l.guardian_id,
        'student_id', l.student_id,
        'relationship_label', l.relationship_label,
        'status', l.status,
        'verification_source', l.verification_source,
        'approved_at', l.approved_at,
        'effective_from', l.effective_from,
        'effective_to', l.effective_to,
        'restriction_reason', l.restriction_reason,
        'rejection_reason', l.rejection_reason,
        'contact_priority', l.contact_priority,
        'is_emergency_contact', l.is_emergency_contact,
        'is_billing_contact', l.is_billing_contact,
        'version', l.version,
        'created_at', l.created_at,
        'guardian_name', coalesce(
          nullif(btrim(gp.display_name), ''),
          nullif(btrim(concat_ws(' ', nullif(btrim(gp.given_name), ''), nullif(btrim(gp.family_name), ''))), '')),
        'student_name', coalesce(
          nullif(btrim(sp.display_name), ''),
          nullif(btrim(concat_ws(' ', nullif(btrim(sp.given_name), ''), nullif(btrim(sp.family_name), ''))), '')),
        'student_reference', st.reference,
        'guardian_link_capabilities', coalesce((
          select jsonb_agg(jsonb_build_object('capability', c.capability) order by c.capability)
            from public.guardian_link_capabilities c
           where c.link_id = l.id), '[]'::jsonb)
      ) as row
        from public.guardian_student_links l
        join public.guardians g on g.id = l.guardian_id
        join public.people gp on gp.id = g.person_id
        join public.students st on st.id = l.student_id
        join public.people sp on sp.id = st.person_id
       where l.status = p_status
       order by l.created_at asc, l.id asc
       limit v_limit offset v_offset
    ) page;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'nextOffset', case when v_offset + v_limit < v_total then v_offset + v_limit else null end);
end;
$$;

create or replace function app.guardian_link_get(p_link_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', l.id,
    'reference', l.reference,
    'guardian_id', l.guardian_id,
    'student_id', l.student_id,
    'relationship_label', l.relationship_label,
    'status', l.status,
    'verification_source', l.verification_source,
    'approved_at', l.approved_at,
    'effective_from', l.effective_from,
    'effective_to', l.effective_to,
    'restriction_reason', l.restriction_reason,
    'rejection_reason', l.rejection_reason,
    'contact_priority', l.contact_priority,
    'is_emergency_contact', l.is_emergency_contact,
    'is_billing_contact', l.is_billing_contact,
    'version', l.version,
    'created_at', l.created_at,
    'guardian_name', coalesce(
      nullif(btrim(gp.display_name), ''),
      nullif(btrim(concat_ws(' ', nullif(btrim(gp.given_name), ''), nullif(btrim(gp.family_name), ''))), '')),
    'student_name', coalesce(
      nullif(btrim(sp.display_name), ''),
      nullif(btrim(concat_ws(' ', nullif(btrim(sp.given_name), ''), nullif(btrim(sp.family_name), ''))), '')),
    'student_reference', st.reference,
    'guardian_link_capabilities', coalesce((
      select jsonb_agg(jsonb_build_object('capability', c.capability) order by c.capability)
        from public.guardian_link_capabilities c
       where c.link_id = l.id), '[]'::jsonb)
  )
    from public.guardian_student_links l
    join public.guardians g on g.id = l.guardian_id
    join public.people gp on gp.id = g.person_id
    join public.students st on st.id = l.student_id
    join public.people sp on sp.id = st.person_id
   where l.id = p_link_id
     and app.is_staff_aal2() and (
       app.has_any_role(array['admissions_officer','admissions_approver','finance_officer','finance_approver','teacher','exam_reviewer','result_publisher','timetable_manager','support_officer','auditor'])
       or app.has_role('system_administrator'))
$$;

revoke all on function app.guardian_link_requests_list_paginated(text, int, int), app.guardian_link_get(uuid) from public, anon;
grant execute on function app.guardian_link_requests_list_paginated(text, int, int), app.guardian_link_get(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Staff document projection: paged list + single-row reference read
--
-- The projection mirrors `app.documents_projection_list` (000081) field for
-- field. The student branch of the access predicate keeps exactly the
-- semantics of `app.guardian_has_capability(...) or
-- app.document_staff_allowed('student', ...)`; the guardian capability check
-- runs only when the caller is actually a guardian (a once-per-request check),
-- and the staff scope is evaluated from the snapshot boxes.
-- ---------------------------------------------------------------------------

create or replace function app.documents_projection_list_paginated(
  p_owner_domain text default null,
  p_owner_record_id uuid default null,
  p_limit int default 50,
  p_offset int default 0
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_rows jsonb;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;

  select count(*) into v_total
    from public.documents document
    cross join lateral (
      select
        app.staff_scope_boxes(array['finance_officer','finance_approver','auditor']) as finance_boxes,
        exists (
          select 1 from public.guardians g
            join public.user_accounts ua on ua.person_id = g.person_id
           where ua.id = auth.uid()) as is_guardian
    ) snapshot
   where (p_owner_domain is null or document.owner_domain = p_owner_domain)
     and (p_owner_record_id is null or document.owner_record_id = p_owner_record_id)
     and case when document.owner_domain = 'student' then
           (snapshot.is_guardian and app.guardian_has_capability(document.owner_record_id, 'documents'))
           or exists (
             select 1
               from public.enrollments e
              where e.student_id = document.owner_record_id
                and (app.staff_scope_boxes_allowed(snapshot.finance_boxes, e.academic_year_id, null, null)
                     or app.teacher_section_allowed(e.grade_section_id)))
         else app.document_actor_allowed(document.owner_domain, document.owner_record_id)
         end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', document.id,
    'reference', document.reference,
    'ownerDomain', document.owner_domain,
    'ownerReference', case
      when document.owner_domain = 'student' then (select student.reference from public.students student where student.id = document.owner_record_id)
      when document.owner_domain = 'invoice' then (select invoice.reference from public.invoices invoice where invoice.id = document.owner_record_id)
      when document.owner_domain = 'admission_application' then (select application.reference from public.admission_applications application where application.id = document.owner_record_id)
      when document.owner_domain = 'job_application' then (select application.reference from public.job_applications application where application.id = document.owner_record_id)
      when document.owner_domain = 'result_publication' then (select publication.reference from public.result_publications publication where publication.id = document.owner_record_id)
      else document.reference
    end,
    'attachmentCode', document.attachment_code,
    'category', document.category,
    'filename', document.safe_filename,
    'mimeType', document.mime_type,
    'sizeBytes', document.size_bytes,
    'visibility', document.visibility,
    'status', case
      when document.deleted_at is not null
        or (
          document.retention_until is not null
          and document.retention_until <= now()
          and (document.legal_hold_until is null or document.legal_hold_until <= now())
        ) then 'expired'
      when document.scan_status = 'clean' then 'ready'
      else document.scan_status
    end,
    'scanState', case when document.scan_status = 'clean' then 'ready' else document.scan_status end,
    'finalizationState', case
      when document.finalized_at is not null and document.checksum_verified then 'verified'
      when document.scan_status = 'failed' then 'failed'
      else 'pending'
    end,
    'checksumVerified', document.checksum_verified,
    'finalizedAt', document.finalized_at,
    'retentionUntil', document.retention_until,
    'version', document.version,
    'createdAt', document.created_at,
    'updatedAt', document.updated_at
  ) order by document.created_at desc, document.id desc), '[]'::jsonb) into v_rows
    from (
      select document.*
        from public.documents document
        cross join lateral (
          select
            app.staff_scope_boxes(array['finance_officer','finance_approver','auditor']) as finance_boxes,
            exists (
              select 1 from public.guardians g
                join public.user_accounts ua on ua.person_id = g.person_id
               where ua.id = auth.uid()) as is_guardian
        ) snapshot
       where (p_owner_domain is null or document.owner_domain = p_owner_domain)
         and (p_owner_record_id is null or document.owner_record_id = p_owner_record_id)
         and case when document.owner_domain = 'student' then
               (snapshot.is_guardian and app.guardian_has_capability(document.owner_record_id, 'documents'))
               or exists (
                 select 1
                   from public.enrollments e
                  where e.student_id = document.owner_record_id
                    and (app.staff_scope_boxes_allowed(snapshot.finance_boxes, e.academic_year_id, null, null)
                         or app.teacher_section_allowed(e.grade_section_id)))
             else app.document_actor_allowed(document.owner_domain, document.owner_record_id)
             end
       order by document.created_at desc, document.id desc
       limit v_limit offset v_offset
    ) document;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'nextOffset', case when v_offset + v_limit < v_total then v_offset + v_limit else null end);
end;
$$;

create or replace function app.documents_projection_get(p_reference text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select (
    select jsonb_build_object(
      'id', document.id,
      'reference', document.reference,
      'ownerDomain', document.owner_domain,
      'ownerReference', case
        when document.owner_domain = 'student' then (select student.reference from public.students student where student.id = document.owner_record_id)
        when document.owner_domain = 'invoice' then (select invoice.reference from public.invoices invoice where invoice.id = document.owner_record_id)
        when document.owner_domain = 'admission_application' then (select application.reference from public.admission_applications application where application.id = document.owner_record_id)
        when document.owner_domain = 'job_application' then (select application.reference from public.job_applications application where application.id = document.owner_record_id)
        when document.owner_domain = 'result_publication' then (select publication.reference from public.result_publications publication where publication.id = document.owner_record_id)
        else document.reference
      end,
      'attachmentCode', document.attachment_code,
      'category', document.category,
      'filename', document.safe_filename,
      'mimeType', document.mime_type,
      'sizeBytes', document.size_bytes,
      'visibility', document.visibility,
      'status', case
        when document.deleted_at is not null
          or (
            document.retention_until is not null
            and document.retention_until <= now()
            and (document.legal_hold_until is null or document.legal_hold_until <= now())
          ) then 'expired'
        when document.scan_status = 'clean' then 'ready'
        else document.scan_status
      end,
      'scanState', case when document.scan_status = 'clean' then 'ready' else document.scan_status end,
      'finalizationState', case
        when document.finalized_at is not null and document.checksum_verified then 'verified'
        when document.scan_status = 'failed' then 'failed'
        else 'pending'
      end,
      'checksumVerified', document.checksum_verified,
      'finalizedAt', document.finalized_at,
      'retentionUntil', document.retention_until,
      'version', document.version,
      'createdAt', document.created_at,
      'updatedAt', document.updated_at
    )
      from public.documents document
     where document.reference = p_reference
       and app.document_actor_allowed(document.owner_domain, document.owner_record_id)
  )
$$;

revoke all on function app.documents_projection_list_paginated(text, uuid, int, int), app.documents_projection_get(text) from public, anon;
grant execute on function app.documents_projection_list_paginated(text, uuid, int, int), app.documents_projection_get(text) to authenticated;

commit;
