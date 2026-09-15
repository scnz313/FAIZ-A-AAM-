-- 000098 — Import commit dependency ordering.
--
-- The group-atomic commit ordered family/student groups by source key, so a
-- CSV whose relationship rows sort before student groups (for example
-- REL-* before STU-*) failed those relationship rows with "unresolved
-- guardian or student" and left the batch partially committed. Groups now
-- order identity rows (students, guardians, teaching assignments) before
-- dependent rows, and the same order applies inside a group. Group atomicity
-- and the digest/idempotency checks are unchanged.

begin;

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
    SELECT COALESCE(normalized ->> 'familyKey', source_key) AS group_key
      FROM public.data_import_rows
     WHERE batch_id = p_batch_id AND status IN ('valid', 'warning', 'resolved')
     GROUP BY 1
     /* Dependency order: identity rows (students, guardians, teaching
        assignments) commit before rows that reference them (relationships,
        enrollments), regardless of the source keys. */
     ORDER BY MIN(CASE WHEN entity IN ('students','guardians','teaching_assignments') THEN 1 ELSE 2 END), 1
  LOOP
    BEGIN
      FOR v_row IN
        SELECT * FROM public.data_import_rows
         WHERE batch_id = p_batch_id
           AND status IN ('valid', 'warning', 'resolved')
           AND COALESCE(normalized ->> 'familyKey', source_key) = v_group_rows.group_key
         /* Stable dependency order inside a family group as well. */
         ORDER BY CASE WHEN entity IN ('students','guardians','teaching_assignments') THEN 1 ELSE 2 END, row_number
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

commit;
