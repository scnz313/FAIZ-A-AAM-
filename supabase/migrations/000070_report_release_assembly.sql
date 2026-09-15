-- ---------------------------------------------------------------------------
-- 000070 — report release assembly
--
-- Publishing a result entry sheet writes immutable per-subject publications,
-- but guardians read `result_report_releases`: a per-student manifest that
-- bundles every published subject snapshot for one academic year and term.
-- Until now no command assembled that manifest, so staff could publish and
-- still leave families with nothing to read. This migration adds the two
-- server-authoritative commands the staff workspace needs:
--
--   * app.results_report_release_candidates(sheet) — per-roster-student JSON
--     with the published subject publications for the sheet's term/year and
--     the student's current release (if any).
--   * app.results_report_release_publish_batch(sheet, student_ids, key) —
--     publishes one release per eligible student by delegating to the
--     existing per-student command, capturing per-student failures so one
--     bad row cannot abort the whole cohort.
--
-- Existing per-release immutability, audit, outbox, and idempotency behavior
-- is inherited unchanged from app.results_report_release_publish.
-- ---------------------------------------------------------------------------

create or replace function app.results_report_release_candidates(p_sheet_id uuid)
returns setof jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_academic_year_id uuid;
  v_term text;
begin
  if not (app.is_staff_aal2() and app.has_any_role(array['result_publisher','system_administrator','exam_reviewer','auditor'])) then
    raise exception 'result publisher role and aal2 required';
  end if;

  select res.academic_year_id, ed.term
    into v_academic_year_id, v_term
    from public.result_entry_sheets res
    join public.exam_definitions ed on ed.id = res.exam_definition_id
   where res.id = p_sheet_id;
  if v_academic_year_id is null then
    raise exception 'result entry sheet not found';
  end if;

  return query
  select jsonb_build_object(
    'studentId', rer.student_id,
    'enrollmentId', rer.enrollment_id,
    'studentName', p.display_name,
    'publications', coalesce((
      /* The newest non-withdrawn publication per subject: a corrected subject
         must contribute exactly one snapshot to the release manifest. */
      select jsonb_agg(jsonb_build_object('publicationId', picked.id, 'reference', picked.reference)
                       order by picked.published_at, picked.id)
        from (
          select distinct on (coalesce(src.subject_id, rb.subject_id))
                 rp.id, rp.reference, rp.published_at
            from public.result_publications rp
            join public.result_publication_items rpi
              on rpi.publication_id = rp.id and rpi.student_id = rer.student_id
            left join public.result_entry_sheets src on src.id = rp.source_entry_sheet_id
            left join public.result_batches rb on rb.id = rp.batch_id
            join public.exam_definitions ed on ed.id = coalesce(src.exam_definition_id, rb.exam_definition_id)
           where rp.status <> 'withdrawn'
             and ed.academic_year_id = v_academic_year_id
             and ed.term = v_term
             and app.result_publication_scope(rp.id, array['result_publisher','system_administrator'])
           order by coalesce(src.subject_id, rb.subject_id), rp.published_at desc, rp.id desc
        ) picked
    ), '[]'::jsonb),
    'release', (
      select jsonb_build_object(
               'releaseId', r.id,
               'reference', r.reference,
               'version', r.release_version,
               'status', r.status)
        from public.result_report_releases r
       where r.student_id = rer.student_id
         and r.academic_year_id = v_academic_year_id
         and r.term = v_term
       order by r.release_version desc
       limit 1
    )
  )
  from public.result_entry_sheet_rosters rer
  join public.students st on st.id = rer.student_id
  join public.people p on p.id = st.person_id
  where rer.sheet_id = p_sheet_id
  order by rer.roster_order, rer.id;
end
$$;

create or replace function app.results_report_release_publish_batch(
  p_sheet_id uuid,
  p_student_ids uuid[] default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_academic_year_id uuid;
  v_term text;
  v_candidate jsonb;
  v_student_id uuid;
  v_enrollment_id uuid;
  v_publication_ids jsonb;
  v_released int := 0;
  v_skipped int := 0;
  v_failed jsonb := '[]'::jsonb;
begin
  if not (app.is_staff_aal2() and app.has_any_role(array['result_publisher'])) then
    raise exception 'result publisher role and aal2 required';
  end if;

  select res.academic_year_id, ed.term
    into v_academic_year_id, v_term
    from public.result_entry_sheets res
    join public.exam_definitions ed on ed.id = res.exam_definition_id
   where res.id = p_sheet_id;
  if v_academic_year_id is null then
    raise exception 'result entry sheet not found';
  end if;

  for v_candidate in select value from app.results_report_release_candidates(p_sheet_id) value loop
    v_student_id := (v_candidate ->> 'studentId')::uuid;
    if p_student_ids is not null and not (v_student_id = any(p_student_ids)) then
      continue;
    end if;
    v_enrollment_id := (v_candidate ->> 'enrollmentId')::uuid;
    v_publication_ids := coalesce(v_candidate -> 'publications', '[]'::jsonb);
    if jsonb_array_length(v_publication_ids) = 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    begin
      perform app.results_report_release_publish(
        v_student_id,
        v_enrollment_id,
        v_academic_year_id,
        v_term,
        v_publication_ids,
        null,
        case when p_idempotency_key is null
             then null
             else p_idempotency_key || ':' || v_student_id::text || ':' || md5(v_publication_ids::text)
        end
      );
      v_released := v_released + 1;
    exception when others then
      v_failed := v_failed || jsonb_build_array(
        jsonb_build_object('studentId', v_student_id, 'message', sqlerrm)
      );
    end;
  end loop;

  return jsonb_build_object(
    'released', v_released,
    'skipped', v_skipped,
    'failed', v_failed
  );
end
$$;

revoke all on function app.results_report_release_candidates(uuid) from public;
revoke all on function app.results_report_release_publish_batch(uuid,uuid[],text) from public;
grant execute on function app.results_report_release_candidates(uuid) to authenticated;
grant execute on function app.results_report_release_publish_batch(uuid,uuid[],text) to authenticated;
