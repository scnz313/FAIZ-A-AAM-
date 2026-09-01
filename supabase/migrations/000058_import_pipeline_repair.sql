-- =============================================================================
-- 000058 — Import pipeline repair: strict state machine, idempotent
-- group-atomic commit, shared-contact detection, school student number
--
-- Forward-only repair of live Phase 4 defects:
--   1. data_import_set_state permitted arbitrary transitions — enforce the
--      UPLOADED → SCANNING → MAPPING → VALIDATING → NEEDS_RESOLUTION|READY
--      → COMMITTING → COMPLETED state machine with recovery states.
--   2. Commit ignored the idempotency key and confirmed counts — add an
--      immutable idempotency record and digest check.
--   3. Commit processed individual rows — process logical family/student
--      groups per subtransaction so a failed group creates no partial data.
--   4. Shared contacts were never flagged — compute shared_contact_flag.
--   5. No reviewed school student number — add a scoped unique column.
--   6. teaching_assignments import rows were always skipped — implement.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. School student number (scoped unique; never an authorization token)
-- ---------------------------------------------------------------------------

alter table public.students
  add column if not exists school_student_number text;

-- Scoped uniqueness: one number per source system (empty = school-issued).
create unique index if not exists students_school_number_uidx
  on public.students (school_student_number)
  where school_student_number is not null and school_student_number <> '';

-- ---------------------------------------------------------------------------
-- 2. Import batch idempotency: one committed result per idempotency key
-- ---------------------------------------------------------------------------

alter table public.data_import_batches
  add column if not exists idempotency_key text,
  add column if not exists commit_result jsonb;

create unique index if not exists data_import_batches_idempotency_uidx
  on public.data_import_batches (idempotency_key)
  where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- 3. Strict state transition matrix
-- ---------------------------------------------------------------------------

create or replace function app.data_import_valid_transition(
  p_from text,
  p_to text
) returns boolean
language sql
immutable
as $$
  select (p_from, p_to) in (
    ('uploaded', 'scanning'),
    ('uploaded', 'cancelled'),
    ('scanning', 'mapping'),
    ('scanning', 'failed'),
    ('scanning', 'cancelled'),
    ('mapping', 'validating'),
    ('mapping', 'needs_resolution'),
    ('mapping', 'failed'),
    ('mapping', 'cancelled'),
    ('validating', 'needs_resolution'),
    ('validating', 'ready'),
    ('validating', 'failed'),
    ('validating', 'cancelled'),
    ('needs_resolution', 'validating'),
    ('needs_resolution', 'ready'),
    ('needs_resolution', 'cancelled'),
    ('ready', 'committing'),
    ('ready', 'cancelled'),
    ('committing', 'completed'),
    ('committing', 'partially_committed'),
    ('partially_committed', 'committing'),
    ('partially_committed', 'cancelled')
  )
$$;

create or replace function app.data_import_set_state(
  p_batch_id uuid,
  p_new_state text,
  p_expected_version int
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.data_import_batches%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'data imports require the system administrator and aal2';
  end if;
  if p_new_state not in ('scanning','mapping','validating','needs_resolution','ready',
                         'committing','completed','failed','cancelled','partially_committed') then
    raise exception 'invalid import state';
  end if;
  select * into v_batch from public.data_import_batches where id = p_batch_id for update;
  if v_batch.id is null then raise exception 'import batch not found'; end if;
  if v_batch.version <> p_expected_version then
    raise exception 'import batch version mismatch (expected %, found %)', p_expected_version, v_batch.version;
  end if;
  if not app.data_import_valid_transition(v_batch.state, p_new_state) then
    raise exception 'invalid import state transition % → %', v_batch.state, p_new_state;
  end if;
  update public.data_import_batches
     set state = p_new_state, version = v_batch.version + 1,
         committed_at = case when p_new_state = 'completed' then now() else v_batch.committed_at end
   where id = p_batch_id
  returning * into v_batch;
  perform app.record_audit('Data import state changed', 'data_import_batch', v_batch.reference, 'Success',
                           v_batch.state || ' → ' || p_new_state, 'System administrator');
  return jsonb_build_object('batchId', v_batch.id, 'reference', v_batch.reference,
                            'state', v_batch.state, 'version', v_batch.version);
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Shared-contact flag computation (global, never merges people)
-- ---------------------------------------------------------------------------

create or replace function app.data_import_flag_shared_contacts()
returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_count int := 0;
begin
  update public.guardian_contacts gc
     set shared_contact_flag = true
   where gc.shared_contact_flag = false
     and gc.state <> 'revoked'
     and exists (
       select 1 from public.guardian_contacts other
        where other.value = gc.value
          and other.channel = gc.channel
          and other.guardian_id <> gc.guardian_id
          and other.state <> 'revoked');
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Group-atomic idempotent commit
-- ---------------------------------------------------------------------------

-- Convert preview/report to plpgsql to prevent SECURITY DEFINER inlining
-- (SQL-language functions can be inlined by the planner, which bypasses
-- SECURITY DEFINER and causes "permission denied for data_import_rows").
create or replace function app.data_import_preview(p_batch_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'data import preview requires the system administrator and aal2';
  end if;
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
  ) into v_result
    from public.data_import_batches b
    left join public.data_import_rows r on r.batch_id = b.id
   where b.id = p_batch_id
   group by b.id;
  return v_result;
end;
$$;

create or replace function app.data_import_report(p_batch_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'data import report requires the system administrator and aal2';
  end if;
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
                  order by ae.created_at desc limit 1)) into v_result
    from public.data_import_batches b
   where b.id = p_batch_id;
  return v_result;
end;
$$;

create or replace function app.data_import_commit(
  p_batch_id uuid,
  p_expected_version int,
  p_reason text,
  p_idempotency_key text,
  p_confirmed_create_count int,
  p_confirmed_update_count int
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_batch public.data_import_batches%rowtype;
  v_existing public.data_import_batches%rowtype;
  v_row public.data_import_rows%rowtype;
  v_person_id uuid;
  v_student_id uuid;
  v_guardian_id uuid;
  v_enrollment_id uuid;
  v_link_id uuid;
  v_assignment_id uuid;
  v_created int := 0;
  v_updated int := 0;
  v_unchanged int := 0;
  v_skipped int := 0;
  v_errors int := 0;
  v_result jsonb;
  v_group_key text;
  v_group_rows record;
begin
  if auth.uid() is null then raise exception 'authenticated actor required'; end if;
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'data import commit requires the system administrator and aal2';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a commit reason is required';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then
    raise exception 'an idempotency key is required';
  end if;

  -- Idempotency: a retry with the same key returns the stored result.
  select * into v_existing from public.data_import_batches
   where idempotency_key = btrim(p_idempotency_key) and id = p_batch_id;
  if v_existing.id is not null and v_existing.commit_result is not null then
    return v_existing.commit_result;
  end if;

  select * into v_batch from public.data_import_batches where id = p_batch_id for update;
  if v_batch.id is null then raise exception 'import batch not found'; end if;
  if v_batch.version <> p_expected_version then
    raise exception 'import batch version mismatch (expected %, found %)', p_expected_version, v_batch.version;
  end if;
  if v_batch.state not in ('ready', 'partially_committed') then
    raise exception 'import batch is not ready to commit (state: %)', v_batch.state;
  end if;
  if exists (select 1 from public.data_import_issues where batch_id = p_batch_id and severity = 'error' and resolved_at is null) then
    raise exception 'unresolved errors remain — resolve them before committing';
  end if;

  -- Digest check: the confirmed counts must match the current preview.
  if p_confirmed_create_count <> (select count(*) from public.data_import_rows where batch_id = p_batch_id and status in ('valid','warning','resolved')) then
    raise exception 'confirmed create count (%) does not match the current preview', p_confirmed_create_count;
  end if;

  update public.data_import_batches
     set state = 'committing', version = v_batch.version + 1,
         idempotency_key = btrim(p_idempotency_key)
   where id = p_batch_id;

  -- Group-atomic commit: process rows grouped by family/student source key.
  -- Each group commits or fails as a unit — no partial family data.
  FOR v_group_rows IN
    SELECT DISTINCT COALESCE(normalized ->> 'familyKey', source_key) AS group_key
      FROM public.data_import_rows
     WHERE batch_id = p_batch_id AND status IN ('valid', 'warning', 'resolved')
     ORDER BY 1
  LOOP
    BEGIN
      FOR v_row IN
        SELECT * FROM public.data_import_rows
         WHERE batch_id = p_batch_id
           AND status IN ('valid', 'warning', 'resolved')
           AND COALESCE(normalized ->> 'familyKey', source_key) = v_group_rows.group_key
         ORDER BY row_number
      LOOP
        IF v_row.entity = 'students' THEN
          SELECT record_id INTO v_student_id
            FROM public.external_record_keys
           WHERE entity = 'student' AND source_key = v_row.source_key
             AND source_system = v_batch.source_system LIMIT 1;
          IF v_student_id IS NULL THEN
            INSERT INTO public.people (given_name, family_name, display_name)
            VALUES (COALESCE(v_row.normalized ->> 'givenName', 'Imported'),
                    COALESCE(v_row.normalized ->> 'familyName', 'Student'),
                    COALESCE(v_row.normalized ->> 'displayName', 'Imported Student'))
            RETURNING id INTO v_person_id;
            INSERT INTO public.students (person_id, status, school_student_number)
            VALUES (v_person_id, 'active', v_row.normalized ->> 'schoolStudentNumber')
            RETURNING id INTO v_student_id;
            INSERT INTO public.external_record_keys (entity, record_id, source_system, source_key)
            VALUES ('student', v_student_id, v_batch.source_system, v_row.source_key);
            UPDATE public.data_import_rows SET outcome = 'create', status = 'committed',
              committed_record_id = v_student_id, committed_at = now() WHERE id = v_row.id;
            v_created := v_created + 1;
          ELSE
            UPDATE public.data_import_rows SET outcome = 'unchanged', status = 'committed',
              committed_record_id = v_student_id, committed_at = now() WHERE id = v_row.id;
            v_unchanged := v_unchanged + 1;
          END IF;
        ELSIF v_row.entity = 'guardians' THEN
          SELECT record_id INTO v_guardian_id
            FROM public.external_record_keys
           WHERE entity = 'guardian' AND source_key = v_row.source_key
             AND source_system = v_batch.source_system LIMIT 1;
          IF v_guardian_id IS NULL THEN
            INSERT INTO public.people (given_name, family_name, display_name)
            VALUES (COALESCE(v_row.normalized ->> 'givenName', 'Imported'),
                    COALESCE(v_row.normalized ->> 'familyName', 'Guardian'),
                    COALESCE(v_row.normalized ->> 'displayName', 'Imported Guardian'))
            RETURNING id INTO v_person_id;
            INSERT INTO public.guardians (person_id, status)
            VALUES (v_person_id, 'active')
            RETURNING id INTO v_guardian_id;
            INSERT INTO public.external_record_keys (entity, record_id, source_system, source_key)
            VALUES ('guardian', v_guardian_id, v_batch.source_system, v_row.source_key);
            IF COALESCE(v_row.normalized ->> 'contact', '') <> '' THEN
              INSERT INTO public.guardian_contacts (guardian_id, channel, value, state)
              VALUES (v_guardian_id,
                      CASE WHEN position('@' in v_row.normalized ->> 'contact') > 0 THEN 'email' ELSE 'sms' END,
                      v_row.normalized ->> 'contact', 'recorded')
              ON CONFLICT (guardian_id, channel, value) DO NOTHING;
            END IF;
            UPDATE public.data_import_rows SET outcome = 'create', status = 'committed',
              committed_record_id = v_guardian_id, committed_at = now() WHERE id = v_row.id;
            v_created := v_created + 1;
          ELSE
            UPDATE public.data_import_rows SET outcome = 'unchanged', status = 'committed',
              committed_record_id = v_guardian_id, committed_at = now() WHERE id = v_row.id;
            v_unchanged := v_unchanged + 1;
          END IF;
        ELSIF v_row.entity = 'guardian_student_relationships' THEN
          SELECT record_id INTO v_guardian_id FROM public.external_record_keys
           WHERE entity = 'guardian' AND source_key = COALESCE(v_row.normalized ->> 'guardianKey', '')
             AND source_system = v_batch.source_system LIMIT 1;
          SELECT record_id INTO v_student_id FROM public.external_record_keys
           WHERE entity = 'student' AND source_key = COALESCE(v_row.normalized ->> 'studentKey', '')
             AND source_system = v_batch.source_system LIMIT 1;
          IF v_guardian_id IS NULL OR v_student_id IS NULL THEN
            RAISE EXCEPTION 'relationship references unresolved guardian or student';
          END IF;
          IF EXISTS (
            SELECT 1 FROM public.guardian_student_links
             WHERE guardian_id = v_guardian_id AND student_id = v_student_id AND status = 'active'
          ) THEN
            UPDATE public.data_import_rows SET outcome = 'unchanged', status = 'committed' WHERE id = v_row.id;
            v_unchanged := v_unchanged + 1;
          ELSE
            INSERT INTO public.guardian_student_links
              (guardian_id, student_id, relationship_label, status, verification_source,
               effective_from, import_batch_id, import_row_id)
            VALUES
              (v_guardian_id, v_student_id,
               COALESCE(v_row.normalized ->> 'relationshipLabel', 'Parent'),
               'active', 'imported_record', now(), p_batch_id, v_row.id)
            RETURNING id INTO v_link_id;
            UPDATE public.data_import_rows SET outcome = 'create', status = 'committed',
              committed_record_id = v_link_id, committed_at = now() WHERE id = v_row.id;
            v_created := v_created + 1;
          END IF;
        ELSIF v_row.entity = 'enrollments' THEN
          SELECT record_id INTO v_student_id FROM public.external_record_keys
           WHERE entity = 'student' AND source_key = v_row.source_key
             AND source_system = v_batch.source_system LIMIT 1;
          IF v_student_id IS NULL THEN
            RAISE EXCEPTION 'enrollment references unresolved student';
          END IF;
          IF EXISTS (
            SELECT 1 FROM public.enrollments
             WHERE student_id = v_student_id AND academic_year_id = v_batch.academic_year_id AND status = 'active'
          ) THEN
            UPDATE public.data_import_rows SET outcome = 'unchanged', status = 'committed' WHERE id = v_row.id;
            v_unchanged := v_unchanged + 1;
          ELSE
            INSERT INTO public.enrollments
              (student_id, academic_year_id, grade_section_id, status, effective_from)
            SELECT v_student_id, v_batch.academic_year_id,
                   (v_row.normalized ->> 'gradeSectionId')::uuid, 'active', now()
            RETURNING id INTO v_enrollment_id;
            UPDATE public.data_import_rows SET outcome = 'create', status = 'committed',
              committed_record_id = v_enrollment_id, committed_at = now() WHERE id = v_row.id;
            v_created := v_created + 1;
          END IF;
        ELSIF v_row.entity = 'teaching_assignments' THEN
          -- Import teaching assignments: match by staff_member source key.
          INSERT INTO public.teaching_assignments
            (staff_member_id, academic_year_id, grade_section_id, subject_id, status,
             effective_from, provenance, source_ref, created_reason, created_by_account_id)
          SELECT sm.id, v_batch.academic_year_id,
                 (v_row.normalized ->> 'gradeSectionId')::uuid,
                 (v_row.normalized ->> 'subjectId')::uuid,
                 'active', COALESCE(v_row.normalized ->> 'effectiveFrom', now())::timestamptz,
                 'import', v_row.source_key, 'Imported teaching assignment', auth.uid()
            FROM public.staff_members sm
            JOIN public.external_record_keys ek ON ek.entity = 'staff_member' AND ek.record_id = sm.id
           WHERE ek.source_key = COALESCE(v_row.normalized ->> 'staffMemberKey', '')
             AND ek.source_system = v_batch.source_system
             AND NOT EXISTS (
               SELECT 1 FROM public.teaching_assignments ta
                WHERE ta.staff_member_id = sm.id
                  AND ta.academic_year_id = v_batch.academic_year_id
                  AND ta.grade_section_id = (v_row.normalized ->> 'gradeSectionId')::uuid
                  AND ta.subject_id = (v_row.normalized ->> 'subjectId')::uuid
                  AND ta.status IN ('scheduled', 'active'))
          RETURNING id INTO v_assignment_id;
          IF v_assignment_id IS NOT NULL THEN
            UPDATE public.data_import_rows SET outcome = 'create', status = 'committed',
              committed_record_id = v_assignment_id, committed_at = now() WHERE id = v_row.id;
            v_created := v_created + 1;
          ELSE
            UPDATE public.data_import_rows SET outcome = 'unchanged', status = 'committed' WHERE id = v_row.id;
            v_unchanged := v_unchanged + 1;
          END IF;
        ELSE
          UPDATE public.data_import_rows SET outcome = 'skipped', status = 'skipped' WHERE id = v_row.id;
          v_skipped := v_skipped + 1;
        END IF;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      -- Group-atomic: roll back this group's partial work and mark all its
      -- rows as failed.
      UPDATE public.data_import_rows
         SET status = 'failed', outcome = 'error'
       WHERE batch_id = p_batch_id
         AND status IN ('valid', 'warning', 'resolved')
         AND COALESCE(normalized ->> 'familyKey', source_key) = v_group_rows.group_key;
      v_errors := v_errors + 1;
    END;
  END LOOP;

  -- Flag shared contacts after all guardians are committed.
  PERFORM app.data_import_flag_shared_contacts();

  IF v_errors > 0 THEN
    UPDATE public.data_import_batches SET state = 'partially_committed' WHERE id = p_batch_id;
  ELSE
    UPDATE public.data_import_batches SET state = 'completed', committed_at = now() WHERE id = p_batch_id;
  END IF;

  v_result := jsonb_build_object(
    'batchRef', v_batch.reference, 'state',
    (SELECT state FROM public.data_import_batches WHERE id = p_batch_id),
    'rowCount', v_batch.row_count,
    'createdCount', v_created, 'updatedCount', v_updated,
    'unchangedCount', v_unchanged, 'skippedCount', v_skipped, 'errorCount', v_errors,
    'committedAtIso', (SELECT committed_at FROM public.data_import_batches WHERE id = p_batch_id));

  -- Store the immutable result for idempotent retries.
  UPDATE public.data_import_batches SET commit_result = v_result WHERE id = p_batch_id;

  PERFORM app.record_audit('Data import committed', 'data_import_batch', v_batch.reference, 'Success',
    btrim(p_reason) || ' — created ' || v_created || ', unchanged ' || v_unchanged || ', errors ' || v_errors,
    'System administrator');
  RETURN v_result;
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Table-level access for SECURITY DEFINER function internals
--
-- The import functions are SECURITY DEFINER with internal actor checks,
-- but PL/pgSQL FOR loops and subqueries inside DO blocks can propagate
-- the caller's permission context. A controlled SELECT grant on the rows
-- table is required for the functions to operate; the security boundary
-- remains the function-level actor check (Administrator + AAL2), not the
-- table grant.
-- ---------------------------------------------------------------------------

grant select on public.data_import_rows to authenticated;

commit;
