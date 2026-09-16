-- =============================================================================
-- 000123 · School configuration RPCs (Slice 3A)
--
-- Academic years, grades, grade sections, subjects, exam terms, and assessment
-- components have only ever been seeded. These RPCs give the Administrator
-- (system_administrator) and Principal (timetable_manager) profiles a guarded,
-- audited write path so the structure can be built from the UI:
--
--   reads   app.school_setup_read
--   writes  app.academic_years_create        app.academic_years_set_status
--           app.grades_upsert                app.grades_add_standard_catalog
--           app.grade_sections_create        app.grade_sections_set_status
--           app.grade_sections_copy_from_year
--           app.subjects_upsert
--           app.exam_terms_create            app.exam_definitions_set_status
--           app.assessment_components_upsert app.assessment_components_delete
--
-- Every function is security definer with a fixed search_path, requires an
-- AAL2 staff session holding system_administrator or timetable_manager, and
-- records an audit row on success. Writes take p_reason (>= 3 characters).
--
-- Note on the role predicate: `app.has_any_role` has carried a carve-out
-- since 000020 that removes 'system_administrator' from multi-role lists
-- (administrators are kept out of business-role operations). Configuration
-- is different — both profiles legitimately configure — so every guard here
-- spells the OR out with two single-role `app.has_role` checks instead.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Read projection
-- ---------------------------------------------------------------------------

create or replace function app.school_setup_read(p_academic_year_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_year_id uuid;
begin
  if not (app.is_staff_aal2() and (app.has_role('system_administrator') or app.has_role('timetable_manager'))) then
    raise exception 'school configuration requires system_administrator or timetable_manager and aal2';
  end if;

  v_year_id := coalesce(
    p_academic_year_id,
    (select id from public.academic_years where status = 'current' order by starts_on desc limit 1),
    (select id from public.academic_years order by starts_on desc limit 1)
  );

  return jsonb_build_object(
    'selectedAcademicYearId', v_year_id,
    'academicYears', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', y.id,
        'reference', y.reference,
        'label', y.label,
        'startsOn', y.starts_on,
        'endsOn', y.ends_on,
        'status', y.status
      ) order by y.starts_on desc)
      from public.academic_years y
    ), '[]'::jsonb),
    'grades', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'code', g.code,
        'label', g.label,
        'sortOrder', g.sort_order,
        'sectionCount', (
          select count(*) from public.grade_sections gs
          where gs.grade_id = g.id and gs.academic_year_id = v_year_id
        ),
        'referenced', exists (
          select 1 from public.grade_sections gs where gs.grade_id = g.id
        )
      ) order by g.sort_order, g.label)
      from public.grades g
    ), '[]'::jsonb),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', gs.id,
        'reference', gs.reference,
        'academicYearId', gs.academic_year_id,
        'gradeId', gs.grade_id,
        'gradeLabel', g.label,
        'sectionLabel', gs.section_label,
        'status', gs.status,
        'enrollmentCount', (
          select count(*) from public.enrollments e
          where e.grade_section_id = gs.id and e.status = 'active'
        ),
        'examCount', (
          select count(*) from public.exam_definitions ed
          where ed.grade_section_id = gs.id
        )
      ) order by g.sort_order, gs.section_label)
      from public.grade_sections gs
      join public.grades g on g.id = gs.grade_id
      where gs.academic_year_id = v_year_id
    ), '[]'::jsonb),
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'code', s.code,
        'name', s.name,
        'componentCount', (
          select count(*) from public.assessment_components ac
          where ac.subject_id = s.id
        ),
        'referenced',
          exists (select 1 from public.assessment_components ac where ac.subject_id = s.id)
          or exists (select 1 from public.teaching_assignments ta where ta.subject_id = s.id)
          or exists (select 1 from public.result_batches rb where rb.subject_id = s.id)
      ) order by s.code)
      from public.subjects s
    ), '[]'::jsonb),
    'exams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ed.id,
        'reference', ed.reference,
        'academicYearId', ed.academic_year_id,
        'gradeSectionId', ed.grade_section_id,
        'sectionLabel', g.label || '-' || gs.section_label,
        'term', ed.term,
        'status', ed.status,
        'components', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', ac.id,
            'subjectId', ac.subject_id,
            'subjectCode', s.code,
            'subjectName', s.name,
            'name', ac.name,
            'maxMarks', ac.max_marks,
            'sortOrder', ac.sort_order,
            'batchCount', (
              select count(*) from public.result_batches rb
              where rb.exam_definition_id = ed.id and rb.subject_id = ac.subject_id
            )
          ) order by ac.sort_order, s.code)
          from public.assessment_components ac
          join public.subjects s on s.id = ac.subject_id
          where ac.exam_definition_id = ed.id
        ), '[]'::jsonb)
      ) order by g.sort_order, gs.section_label, ed.term)
      from public.exam_definitions ed
      join public.grade_sections gs on gs.id = ed.grade_section_id
      join public.grades g on g.id = gs.grade_id
      where ed.academic_year_id = v_year_id
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Academic years
-- ---------------------------------------------------------------------------

create or replace function app.academic_years_create(
  p_label text,
  p_starts_on date,
  p_ends_on date,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year public.academic_years%rowtype;
begin
  if not (app.is_staff_aal2() and (app.has_role('system_administrator') or app.has_role('timetable_manager'))) then
    raise exception 'school configuration requires system_administrator or timetable_manager and aal2';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required';
  end if;
  if p_label is null or btrim(p_label) = '' then
    raise exception 'an academic year label is required';
  end if;
  if p_starts_on is null or p_ends_on is null or p_ends_on <= p_starts_on then
    raise exception 'the academic year must end after it starts';
  end if;
  if exists (select 1 from public.academic_years where label = btrim(p_label)) then
    raise exception 'academic year label already exists';
  end if;

  insert into public.academic_years (label, starts_on, ends_on, status)
  values (btrim(p_label), p_starts_on, p_ends_on, 'upcoming')
  returning * into v_year;

  perform app.record_audit('Academic year created', 'academic_year', v_year.reference,
                           'Success', btrim(p_reason), 'School configuration');

  return jsonb_build_object(
    'id', v_year.id,
    'reference', v_year.reference,
    'label', v_year.label,
    'startsOn', v_year.starts_on,
    'endsOn', v_year.ends_on,
    'status', v_year.status
  );
end;
$$;

create or replace function app.academic_years_set_status(
  p_id uuid,
  p_status text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year public.academic_years%rowtype;
  v_demoted jsonb := '[]'::jsonb;
begin
  if not (app.is_staff_aal2() and (app.has_role('system_administrator') or app.has_role('timetable_manager'))) then
    raise exception 'school configuration requires system_administrator or timetable_manager and aal2';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required';
  end if;

  select * into v_year from public.academic_years where id = p_id for update;
  if v_year.id is null then
    raise exception 'academic year not found';
  end if;

  if v_year.status = 'upcoming' and p_status = 'current' then
    /* One current year at a time: demote the incumbent in the same
       transaction so timetables and enrollments never straddle two. */
    with demoted as (
      update public.academic_years
      set status = 'historical'
      where status = 'current' and id <> p_id
      returning reference
    )
    select coalesce(jsonb_agg(reference), '[]'::jsonb) into v_demoted from demoted;
    update public.academic_years set status = 'current' where id = p_id;
  elsif v_year.status = 'current' and p_status = 'historical' then
    update public.academic_years set status = 'historical' where id = p_id;
  elsif v_year.status = 'historical' and p_status = 'closed' then
    update public.academic_years set status = 'closed' where id = p_id;
  else
    raise exception 'invalid academic year status transition: % to %', v_year.status, p_status;
  end if;

  perform app.record_audit('Academic year status changed', 'academic_year', v_year.reference,
                           'Success', btrim(p_reason) || ' (' || v_year.status || ' to ' || p_status || ')',
                           'School configuration');

  return jsonb_build_object(
    'id', v_year.id,
    'reference', v_year.reference,
    'label', v_year.label,
    'status', p_status,
    'demotedReferences', v_demoted
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grades
-- ---------------------------------------------------------------------------

create or replace function app.grades_upsert(
  p_id uuid default null,
  p_code text default null,
  p_label text default null,
  p_sort_order int default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grade public.grades%rowtype;
  v_code text := lower(btrim(coalesce(p_code, '')));
  v_label text := btrim(coalesce(p_label, ''));
begin
  if not (app.is_staff_aal2() and (app.has_role('system_administrator') or app.has_role('timetable_manager'))) then
    raise exception 'school configuration requires system_administrator or timetable_manager and aal2';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required';
  end if;

  if p_id is null then
    if v_code = '' then
      raise exception 'a grade code is required';
    end if;
    if v_label = '' then
      raise exception 'a grade label is required';
    end if;
    if exists (select 1 from public.grades where code = v_code) then
      raise exception 'grade code already exists';
    end if;
    if exists (select 1 from public.grades where label = v_label) then
      raise exception 'grade label already exists';
    end if;

    insert into public.grades (code, label, sort_order)
    values (v_code, v_label, coalesce(p_sort_order, 0))
    returning * into v_grade;

    perform app.record_audit('Grade created', 'grade', v_grade.code,
                             'Success', btrim(p_reason), 'School configuration');
  else
    select * into v_grade from public.grades where id = p_id for update;
    if v_grade.id is null then
      raise exception 'grade not found';
    end if;
    if p_code is not null and v_code <> '' and v_code <> v_grade.code then
      raise exception 'grade code cannot be changed';
    end if;
    if v_label <> '' and v_label <> v_grade.label
       and exists (select 1 from public.grades where label = v_label and id <> p_id) then
      raise exception 'grade label already exists';
    end if;

    update public.grades
    set label = case when v_label = '' then v_grade.label else v_label end,
        sort_order = coalesce(p_sort_order, v_grade.sort_order)
    where id = p_id
    returning * into v_grade;

    perform app.record_audit('Grade updated', 'grade', v_grade.code,
                             'Success', btrim(p_reason), 'School configuration');
  end if;

  return jsonb_build_object(
    'id', v_grade.id,
    'code', v_grade.code,
    'label', v_grade.label,
    'sortOrder', v_grade.sort_order
  );
end;
$$;

create or replace function app.grades_add_standard_catalog(p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted jsonb;
begin
  if not (app.is_staff_aal2() and (app.has_role('system_administrator') or app.has_role('timetable_manager'))) then
    raise exception 'school configuration requires system_administrator or timetable_manager and aal2';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required';
  end if;

  /* Fixed school catalog: Nursery through Class 10. Rows that already exist
     (by code OR label) are left untouched so an existing '6' never collides
     with a seeded 'Class 6'. */
  with catalog (code, label, sort_order) as (
    values
      ('nursery', 'Nursery', -3),
      ('lkg', 'LKG', -2),
      ('ukg', 'UKG', -1),
      ('1', 'Class 1', 1),
      ('2', 'Class 2', 2),
      ('3', 'Class 3', 3),
      ('4', 'Class 4', 4),
      ('5', 'Class 5', 5),
      ('6', 'Class 6', 6),
      ('7', 'Class 7', 7),
      ('8', 'Class 8', 8),
      ('9', 'Class 9', 9),
      ('10', 'Class 10', 10)
  ),
  inserted as (
    insert into public.grades (code, label, sort_order)
    select c.code, c.label, c.sort_order
    from catalog c
    where not exists (
      select 1 from public.grades g
      where g.code = c.code or g.label = c.label
    )
    order by c.sort_order
    returning id, code, label, sort_order
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'code', i.code, 'label', i.label, 'sortOrder', i.sort_order
  )), '[]'::jsonb)
  into v_inserted
  from inserted i;

  perform app.record_audit('Standard grade catalog applied', 'grade', 'catalog',
                           'Success', btrim(p_reason), 'School configuration');

  return v_inserted;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grade sections
-- ---------------------------------------------------------------------------

create or replace function app.grade_sections_create(
  p_academic_year_id uuid,
  p_grade_id uuid,
  p_section_label text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_section public.grade_sections%rowtype;
  v_label text := upper(btrim(coalesce(p_section_label, '')));
  v_grade_label text;
begin
  if not (app.is_staff_aal2() and (app.has_role('system_administrator') or app.has_role('timetable_manager'))) then
    raise exception 'school configuration requires system_administrator or timetable_manager and aal2';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required';
  end if;
  if length(v_label) < 1 or length(v_label) > 3 then
    raise exception 'a section label must be 1-3 characters';
  end if;
  if not exists (select 1 from public.academic_years where id = p_academic_year_id) then
    raise exception 'academic year not found';
  end if;
  select label into v_grade_label from public.grades where id = p_grade_id;
  if v_grade_label is null then
    raise exception 'grade not found';
  end if;
  if exists (
    select 1 from public.grade_sections
    where academic_year_id = p_academic_year_id
      and grade_id = p_grade_id
      and section_label = v_label
  ) then
    raise exception 'this section already exists for the year';
  end if;

  insert into public.grade_sections (academic_year_id, grade_id, section_label, status)
  values (p_academic_year_id, p_grade_id, v_label, 'planned')
  returning * into v_section;

  perform app.record_audit('Grade section created', 'grade_section', v_section.reference,
                           'Success', btrim(p_reason), 'School configuration');

  return jsonb_build_object(
    'id', v_section.id,
    'reference', v_section.reference,
    'academicYearId', v_section.academic_year_id,
    'gradeId', v_section.grade_id,
    'gradeLabel', v_grade_label,
    'sectionLabel', v_section.section_label,
    'status', v_section.status
  );
end;
$$;

create or replace function app.grade_sections_set_status(
  p_id uuid,
  p_status text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_section public.grade_sections%rowtype;
begin
  if not (app.is_staff_aal2() and (app.has_role('system_administrator') or app.has_role('timetable_manager'))) then
    raise exception 'school configuration requires system_administrator or timetable_manager and aal2';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required';
  end if;

  select * into v_section from public.grade_sections where id = p_id for update;
  if v_section.id is null then
    raise exception 'grade section not found';
  end if;

  if v_section.status = 'planned' and p_status = 'active' then
    update public.grade_sections set status = 'active' where id = p_id;
  elsif v_section.status = 'active' and p_status = 'archived' then
    if exists (
      select 1 from public.enrollments
      where grade_section_id = p_id and status = 'active'
    ) then
      raise exception 'section still has active enrollments';
    end if;
    update public.grade_sections set status = 'archived' where id = p_id;
  elsif v_section.status = 'archived' and p_status = 'active' then
    update public.grade_sections set status = 'active' where id = p_id;
  else
    raise exception 'invalid section status transition: % to %', v_section.status, p_status;
  end if;

  perform app.record_audit('Grade section status changed', 'grade_section', v_section.reference,
                           'Success', btrim(p_reason) || ' (' || v_section.status || ' to ' || p_status || ')',
                           'School configuration');

  return jsonb_build_object(
    'id', v_section.id,
    'reference', v_section.reference,
    'status', p_status
  );
end;
$$;

create or replace function app.grade_sections_copy_from_year(
  p_source_year_id uuid,
  p_target_year_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created jsonb;
begin
  if not (app.is_staff_aal2() and (app.has_role('system_administrator') or app.has_role('timetable_manager'))) then
    raise exception 'school configuration requires system_administrator or timetable_manager and aal2';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required';
  end if;
  if p_source_year_id is null or p_target_year_id is null or p_source_year_id = p_target_year_id then
    raise exception 'a different source and target academic year are required';
  end if;
  if not exists (select 1 from public.academic_years where id = p_source_year_id)
     or not exists (select 1 from public.academic_years where id = p_target_year_id) then
    raise exception 'academic year not found';
  end if;

  with created as (
    insert into public.grade_sections (academic_year_id, grade_id, section_label, status)
    select p_target_year_id, src.grade_id, src.section_label, 'planned'
    from public.grade_sections src
    where src.academic_year_id = p_source_year_id
      and not exists (
        select 1 from public.grade_sections existing
        where existing.academic_year_id = p_target_year_id
          and existing.grade_id = src.grade_id
          and existing.section_label = src.section_label
      )
    order by src.section_label
    returning id, reference, grade_id, section_label
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'reference', c.reference,
    'academicYearId', p_target_year_id,
    'gradeId', c.grade_id,
    'gradeLabel', g.label,
    'sectionLabel', c.section_label,
    'status', 'planned'
  ) order by g.sort_order, c.section_label), '[]'::jsonb)
  into v_created
  from created c
  join public.grades g on g.id = c.grade_id;

  perform app.record_audit('Grade sections copied', 'academic_year',
                           (select reference from public.academic_years where id = p_target_year_id),
                           'Success', btrim(p_reason), 'School configuration');

  return v_created;
end;
$$;

-- ---------------------------------------------------------------------------
-- Subjects
-- ---------------------------------------------------------------------------

create or replace function app.subjects_upsert(
  p_id uuid default null,
  p_code text default null,
  p_name text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject public.subjects%rowtype;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not (app.is_staff_aal2() and (app.has_role('system_administrator') or app.has_role('timetable_manager'))) then
    raise exception 'school configuration requires system_administrator or timetable_manager and aal2';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required';
  end if;

  if p_id is null then
    if v_code = '' then
      raise exception 'a subject code is required';
    end if;
    if v_name = '' then
      raise exception 'a subject name is required';
    end if;
    if exists (select 1 from public.subjects where code = v_code) then
      raise exception 'subject code already exists';
    end if;
    if exists (select 1 from public.subjects where name = v_name) then
      raise exception 'subject name already exists';
    end if;

    insert into public.subjects (code, name)
    values (v_code, v_name)
    returning * into v_subject;

    perform app.record_audit('Subject created', 'subject', v_subject.code,
                             'Success', btrim(p_reason), 'School configuration');
  else
    select * into v_subject from public.subjects where id = p_id for update;
    if v_subject.id is null then
      raise exception 'subject not found';
    end if;
    if p_code is not null and v_code <> '' and v_code <> v_subject.code then
      raise exception 'subject code cannot be changed';
    end if;
    if v_name <> '' and v_name <> v_subject.name
       and exists (select 1 from public.subjects where name = v_name and id <> p_id) then
      raise exception 'subject name already exists';
    end if;

    update public.subjects
    set name = case when v_name = '' then v_subject.name else v_name end
    where id = p_id
    returning * into v_subject;

    perform app.record_audit('Subject updated', 'subject', v_subject.code,
                             'Success', btrim(p_reason), 'School configuration');
  end if;

  return jsonb_build_object(
    'id', v_subject.id,
    'code', v_subject.code,
    'name', v_subject.name
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Exam terms and assessment components
-- ---------------------------------------------------------------------------

create or replace function app.exam_terms_create(
  p_academic_year_id uuid,
  p_term text,
  p_grade_section_ids uuid[],
  p_components jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_term text := lower(btrim(coalesce(p_term, '')));
  v_year public.academic_years%rowtype;
  v_section_id uuid;
  v_section public.grade_sections%rowtype;
  v_exam_id uuid;
  v_exam_ref text;
  v_created jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_component jsonb;
  v_index int := 0;
  v_component_name text;
  v_component_marks numeric;
  v_subject_id uuid;
begin
  if not (app.is_staff_aal2() and (app.has_role('system_administrator') or app.has_role('timetable_manager'))) then
    raise exception 'school configuration requires system_administrator or timetable_manager and aal2';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required';
  end if;
  if length(v_term) < 2 or length(v_term) > 40 then
    raise exception 'an exam term must be 2-40 characters';
  end if;
  if p_grade_section_ids is null or array_length(p_grade_section_ids, 1) is null then
    raise exception 'at least one grade section is required';
  end if;
  if p_components is null or jsonb_typeof(p_components) <> 'array' or jsonb_array_length(p_components) = 0 then
    raise exception 'at least one assessment component is required';
  end if;

  select * into v_year from public.academic_years where id = p_academic_year_id;
  if v_year.id is null then
    raise exception 'academic year not found';
  end if;

  /* Validate every component up front so a bad row never creates half a
     term. */
  for v_component in select * from jsonb_array_elements(p_components) loop
    v_index := v_index + 1;
    if (v_component ->> 'subjectId') is null
       or (v_component ->> 'subjectId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception 'component % needs a subject', v_index;
    end if;
    if not exists (select 1 from public.subjects where id = (v_component ->> 'subjectId')::uuid) then
      raise exception 'component % references an unknown subject', v_index;
    end if;
    v_component_name := btrim(coalesce(v_component ->> 'name', ''));
    if length(v_component_name) < 1 or length(v_component_name) > 40 then
      raise exception 'component % name must be 1-40 characters', v_index;
    end if;
    v_component_marks := (v_component ->> 'maxMarks')::numeric;
    if v_component_marks is null or v_component_marks <= 0 then
      raise exception 'component % maximum marks must be positive', v_index;
    end if;
    if v_component_marks > 1000 then
      raise exception 'component % maximum marks cannot exceed 1000', v_index;
    end if;
  end loop;

  foreach v_section_id in array p_grade_section_ids loop
    select * into v_section from public.grade_sections where id = v_section_id;
    if v_section.id is null or v_section.academic_year_id <> p_academic_year_id then
      raise exception 'a section does not belong to this academic year';
    end if;

    v_exam_id := null;
    v_exam_ref := null;
    select id, reference into v_exam_id, v_exam_ref
    from public.exam_definitions
    where academic_year_id = p_academic_year_id
      and grade_section_id = v_section_id
      and term = v_term;

    if v_exam_id is not null then
      v_skipped := v_skipped || jsonb_build_array(v_exam_ref);
      continue;
    end if;

    insert into public.exam_definitions (academic_year_id, grade_section_id, term, status)
    values (p_academic_year_id, v_section_id, v_term, 'planned')
    returning id, reference into v_exam_id, v_exam_ref;

    v_index := 0;
    for v_component in select * from jsonb_array_elements(p_components) loop
      insert into public.assessment_components
        (exam_definition_id, subject_id, name, max_marks, sort_order)
      values (
        v_exam_id,
        (v_component ->> 'subjectId')::uuid,
        btrim(v_component ->> 'name'),
        (v_component ->> 'maxMarks')::numeric,
        v_index
      );
      v_index := v_index + 1;
    end loop;

    v_created := v_created || jsonb_build_array(v_exam_ref);
  end loop;

  perform app.record_audit('Exam term created', 'exam_term',
                           v_year.reference || ':' || v_term,
                           'Success', btrim(p_reason), 'School configuration');

  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end;
$$;

create or replace function app.assessment_components_upsert(
  p_exam_definition_id uuid,
  p_subject_id uuid,
  p_name text,
  p_max_marks numeric,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_definitions%rowtype;
  v_component public.assessment_components%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not (app.is_staff_aal2() and (app.has_role('system_administrator') or app.has_role('timetable_manager'))) then
    raise exception 'school configuration requires system_administrator or timetable_manager and aal2';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required';
  end if;

  select * into v_exam from public.exam_definitions where id = p_exam_definition_id for update;
  if v_exam.id is null then
    raise exception 'exam definition not found';
  end if;
  if v_exam.status = 'closed' then
    raise exception 'assessment components are locked for a closed exam';
  end if;
  if exists (
    select 1 from public.result_batches
    where exam_definition_id = p_exam_definition_id and subject_id = p_subject_id
  ) then
    raise exception 'marks already exist for this subject in this exam';
  end if;
  if length(v_name) < 1 or length(v_name) > 40 then
    raise exception 'a component name must be 1-40 characters';
  end if;
  if p_max_marks is null or p_max_marks <= 0 then
    raise exception 'component maximum marks must be positive';
  end if;
  if p_max_marks > 1000 then
    raise exception 'component maximum marks cannot exceed 1000';
  end if;
  if not exists (select 1 from public.subjects where id = p_subject_id) then
    raise exception 'subject not found';
  end if;

  /* The live uniqueness key is (exam, subject, lower(name)) — migration
     000028 widened it so one subject may carry several named components
     (e.g. Written + Practical). The upsert therefore keys on the same-name
     component and refreshes its casing and maximum. */
  insert into public.assessment_components (exam_definition_id, subject_id, name, max_marks, sort_order)
  values (
    p_exam_definition_id,
    p_subject_id,
    v_name,
    p_max_marks,
    coalesce((
      select max(sort_order) + 1 from public.assessment_components
      where exam_definition_id = p_exam_definition_id
    ), 0)
  )
  on conflict (exam_definition_id, subject_id, lower(name)) do update
    set name = excluded.name,
        max_marks = excluded.max_marks
  returning * into v_component;

  perform app.record_audit('Assessment component saved', 'exam_definition', v_exam.reference,
                           'Success', btrim(p_reason), 'School configuration');

  return jsonb_build_object(
    'id', v_component.id,
    'examDefinitionId', v_component.exam_definition_id,
    'subjectId', v_component.subject_id,
    'name', v_component.name,
    'maxMarks', v_component.max_marks,
    'sortOrder', v_component.sort_order
  );
end;
$$;

create or replace function app.assessment_components_delete(
  p_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_component public.assessment_components%rowtype;
  v_exam public.exam_definitions%rowtype;
begin
  if not (app.is_staff_aal2() and (app.has_role('system_administrator') or app.has_role('timetable_manager'))) then
    raise exception 'school configuration requires system_administrator or timetable_manager and aal2';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required';
  end if;

  select * into v_component from public.assessment_components where id = p_id for update;
  if v_component.id is null then
    raise exception 'assessment component not found';
  end if;

  select * into v_exam from public.exam_definitions where id = v_component.exam_definition_id;
  if v_exam.status = 'closed' then
    raise exception 'assessment components are locked for a closed exam';
  end if;
  if exists (
    select 1 from public.result_batches
    where exam_definition_id = v_component.exam_definition_id
      and subject_id = v_component.subject_id
  ) then
    raise exception 'marks already exist for this subject in this exam';
  end if;

  delete from public.assessment_components where id = p_id;

  perform app.record_audit('Assessment component removed', 'exam_definition', v_exam.reference,
                           'Success', btrim(p_reason), 'School configuration');

  return jsonb_build_object(
    'id', v_component.id,
    'examDefinitionId', v_component.exam_definition_id,
    'subjectId', v_component.subject_id,
    'deleted', true
  );
end;
$$;

create or replace function app.exam_definitions_set_status(
  p_id uuid,
  p_status text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_definitions%rowtype;
begin
  if not (app.is_staff_aal2() and (app.has_role('system_administrator') or app.has_role('timetable_manager'))) then
    raise exception 'school configuration requires system_administrator or timetable_manager and aal2';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required';
  end if;

  select * into v_exam from public.exam_definitions where id = p_id for update;
  if v_exam.id is null then
    raise exception 'exam definition not found';
  end if;

  if v_exam.status = 'planned' and p_status = 'open' then
    update public.exam_definitions set status = 'open' where id = p_id;
  elsif v_exam.status = 'open' and p_status = 'closed' then
    update public.exam_definitions set status = 'closed' where id = p_id;
  elsif v_exam.status = 'closed' and p_status = 'open' then
    update public.exam_definitions set status = 'open' where id = p_id;
  else
    raise exception 'invalid exam status transition: % to %', v_exam.status, p_status;
  end if;

  perform app.record_audit('Exam status changed', 'exam_definition', v_exam.reference,
                           'Success', btrim(p_reason) || ' (' || v_exam.status || ' to ' || p_status || ')',
                           'School configuration');

  return jsonb_build_object(
    'id', v_exam.id,
    'reference', v_exam.reference,
    'status', p_status
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: staff RPCs are never callable by anonymous sessions.
-- ---------------------------------------------------------------------------

revoke all on function app.school_setup_read(uuid) from public, anon;
revoke all on function app.academic_years_create(text, date, date, text) from public, anon;
revoke all on function app.academic_years_set_status(uuid, text, text) from public, anon;
revoke all on function app.grades_upsert(uuid, text, text, int, text) from public, anon;
revoke all on function app.grades_add_standard_catalog(text) from public, anon;
revoke all on function app.grade_sections_create(uuid, uuid, text, text) from public, anon;
revoke all on function app.grade_sections_set_status(uuid, text, text) from public, anon;
revoke all on function app.grade_sections_copy_from_year(uuid, uuid, text) from public, anon;
revoke all on function app.subjects_upsert(uuid, text, text, text) from public, anon;
revoke all on function app.exam_terms_create(uuid, text, uuid[], jsonb, text) from public, anon;
revoke all on function app.assessment_components_upsert(uuid, uuid, text, numeric, text) from public, anon;
revoke all on function app.assessment_components_delete(uuid, text) from public, anon;
revoke all on function app.exam_definitions_set_status(uuid, text, text) from public, anon;

grant execute on function app.school_setup_read(uuid) to authenticated;
grant execute on function app.academic_years_create(text, date, date, text) to authenticated;
grant execute on function app.academic_years_set_status(uuid, text, text) to authenticated;
grant execute on function app.grades_upsert(uuid, text, text, int, text) to authenticated;
grant execute on function app.grades_add_standard_catalog(text) to authenticated;
grant execute on function app.grade_sections_create(uuid, uuid, text, text) to authenticated;
grant execute on function app.grade_sections_set_status(uuid, text, text) to authenticated;
grant execute on function app.grade_sections_copy_from_year(uuid, uuid, text) to authenticated;
grant execute on function app.subjects_upsert(uuid, text, text, text) to authenticated;
grant execute on function app.exam_terms_create(uuid, text, uuid[], jsonb, text) to authenticated;
grant execute on function app.assessment_components_upsert(uuid, uuid, text, numeric, text) to authenticated;
grant execute on function app.assessment_components_delete(uuid, text) to authenticated;
grant execute on function app.exam_definitions_set_status(uuid, text, text) to authenticated;

commit;
