-- =============================================================================
-- 000094 — Result exam-definition read path for the batch creation workspace
--
-- The Principal (result_entry_officer) creates result entry sheets through
-- app.results_entry_sheet_create, but exam_definitions has no RLS policy that
-- exposes the selection list to that role: scope_entry_officer_exam_read
-- (000057) requires a legacy staff_assignments row, while sheet creation
-- authorizes through role-grant scope (app.staff_scope_allowed). A profile
-- Principal therefore cannot list the exams they are authorized to create.
--
-- This migration adds a read-only SECURITY DEFINER projection that:
--   * requires staff AAL2 and an active result role (entry, review, publish,
--     or auditor) inside the caller's role-grant scope;
--   * returns only selection fields (term, academic year, grade section) and
--     the caller-scoped subjects configured with assessment components, so
--     the create panel never offers a subject the server would reject;
--   * orders the current academic year first.
--
-- Nothing is applied remotely by this file; it is a forward migration only.
-- =============================================================================

begin;

create or replace function app.results_exam_definition_list()
returns setof jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', ed.id,
    'reference', ed.reference,
    'term', ed.term,
    'status', ed.status,
    'academicYearId', ed.academic_year_id,
    'academicYearLabel', ay.label,
    'academicYearStatus', ay.status,
    'gradeSectionId', ed.grade_section_id,
    'gradeLabel', g.label,
    'sectionLabel', gs.section_label,
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name) order by s.name, s.id)
        from public.assessment_components ac
        join public.subjects s on s.id = ac.subject_id
       where ac.exam_definition_id = ed.id
         and app.staff_scope_allowed(
           array['result_entry_officer', 'exam_reviewer', 'result_publisher', 'auditor'],
           ed.academic_year_id, ed.grade_section_id, ac.subject_id)
    ), '[]'::jsonb)
  )
    from public.exam_definitions ed
    join public.academic_years ay on ay.id = ed.academic_year_id
    join public.grade_sections gs on gs.id = ed.grade_section_id
    join public.grades g on g.id = gs.grade_id
   where app.is_staff_aal2()
     and app.staff_scope_allowed(
       array['result_entry_officer', 'exam_reviewer', 'result_publisher', 'auditor'],
       ed.academic_year_id, ed.grade_section_id, null)
   order by (ay.status <> 'current'), ay.label desc, g.sort_order, gs.section_label, ed.term
$$;

revoke all on function app.results_exam_definition_list() from public;
grant execute on function app.results_exam_definition_list() to authenticated;

commit;
