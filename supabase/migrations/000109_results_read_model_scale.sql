-- =============================================================================
-- 000109 — Results read model scale: queue counts, single-sheet detail
--
-- From the 4k-student scale audit (15 September 2026), re-measured on a
-- synthetic scratch database (4,000 students · 80 sheets · 16,000 roster rows
-- · 48,000 marks):
--
--   1. `app.results_entry_sheet_get(p_sheet_id)` (000028) filtered the output
--      of `app.results_entry_sheet_list()` in SQL, so opening ONE sheet
--      computed every in-scope sheet with its full roster and every mark.
--      Measured before: ~1.0–1.7 s and 119k shared buffers for one detail
--      read, ~11.76 MB of computed JSON. The detail read now selects the one
--      sheet directly (`where res.id = p_sheet_id`), keeping the exact JSON
--      field names, subselects, ordering, and grants.
--
--   2. `app.results_entry_sheet_list()` shipped the full roster and every
--      mark (147 KB per sheet at the audit scale) although the staff queue
--      renders only reference/class/subject/term/state/version plus the
--      entered/total counts. The list projection now returns four counts
--      (`componentCount`, `rosterCount`, `enteredCount`, `incompleteCount`)
--      and no roster/component arrays. Count semantics match the previous
--      client mapping exactly:
--        · roster rows × components = every presentation cell;
--        · enteredCount = cells carrying a non-null `obtained`;
--        · incompleteCount = cells that are missing or still `pending`.
--      The entry workspace and the batch detail page keep the full matrix
--      through `results_entry_sheet_get`.
--
-- Read-only projection changes; no table or data changes, no authorization
-- changes, identical result keys for the detail read. Forward-only from
-- 000108. Validated and applied by the central process.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Queue projection: counts for the queue, no rosters or marks
-- ---------------------------------------------------------------------------
create or replace function app.results_entry_sheet_list()
returns setof jsonb
language sql
security definer
set search_path = ''
as $$
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
   where app.result_entry_sheet_scope(res.id, array['teacher','exam_reviewer','result_publisher','auditor'])
   order by res.updated_at desc, res.id;
$$;

-- ---------------------------------------------------------------------------
-- 2. Detail projection: read the one sheet directly
-- ---------------------------------------------------------------------------
create or replace function app.results_entry_sheet_get(p_sheet_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
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
   where res.id = p_sheet_id
     and app.result_entry_sheet_scope(res.id, array['teacher','exam_reviewer','result_publisher','auditor']);
$$;

revoke all on function app.results_entry_sheet_list(), app.results_entry_sheet_get(uuid) from public;
grant execute on function app.results_entry_sheet_list(), app.results_entry_sheet_get(uuid) to authenticated;

commit;
