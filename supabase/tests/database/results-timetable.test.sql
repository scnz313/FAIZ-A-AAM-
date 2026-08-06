-- =============================================================================
-- B5 results/timetable database tests (pgTAP, `supabase db test`).
-- =============================================================================

begin;
select plan(59);

-- Tables exist.
select has_table('public', 'exam_definitions', 'exam_definitions exists');
select has_table('public', 'assessment_components', 'assessment_components exists');
select has_table('public', 'grade_band_versions', 'grade_band_versions exists');
select has_table('public', 'result_batches', 'result_batches exists');
select has_table('public', 'result_rosters', 'result_rosters exists');
select has_table('public', 'result_batch_versions', 'result_batch_versions exists');
select has_table('public', 'mark_entries', 'mark_entries exists');
select has_table('public', 'result_publications', 'result_publications exists');
select has_table('public', 'result_publication_items', 'result_publication_items exists');
select has_table('public', 'result_correction_requests', 'result_correction_requests exists');
select has_table('public', 'result_events', 'result_events exists');
select has_table('public', 'timetable_versions', 'timetable_versions exists');
select has_table('public', 'timetable_periods', 'timetable_periods exists');
select has_table('public', 'timetable_publications', 'timetable_publications exists');
select has_table('public', 'timetable_overrides', 'timetable_overrides exists');
select has_table('public', 'exam_schedule_versions', 'exam_schedule_versions exists');
select has_table('public', 'exam_schedule_entries', 'exam_schedule_entries exists');

-- Checks: mark integrity, schedule ordering, and status transitions.
select col_has_check('public', 'mark_entries', 'obtained', 'obtained marks cannot be negative');
select is(
  (select count(*)::int
     from pg_constraint c
     join pg_class t on t.oid = c.conrelid
     join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'exam_schedule_entries'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%ends_at > starts_at%'),
  1,
  'exam schedule entries must end after they start'
);
select col_has_check('public', 'exam_definitions', 'status', 'exam definition status check');
select col_has_check('public', 'grade_band_versions', 'status', 'grade band version status check');
select col_has_check('public', 'result_batches', 'status', 'result batch workflow status check');
select col_has_check('public', 'result_publications', 'status', 'publication status check');
select col_has_check('public', 'result_correction_requests', 'status', 'correction request status check');
select col_has_check('public', 'timetable_versions', 'status', 'timetable version status check');
select col_has_check('public', 'exam_schedule_versions', 'status', 'exam schedule version status check');

-- Uniqueness.
select col_is_unique('public', 'exam_definitions', ARRAY['academic_year_id', 'grade_section_id', 'term'], 'one exam definition per year/section/term');
select col_is_unique('public', 'result_rosters', ARRAY['batch_id', 'student_id'], 'one frozen roster row per student');
select col_is_unique('public', 'mark_entries', ARRAY['batch_id', 'roster_id', 'component_id'], 'one mark entry per component');
select col_is_unique('public', 'result_publications', ARRAY['batch_id', 'version'], 'publication versions unique per batch');
select col_is_unique('public', 'result_publication_items', ARRAY['publication_id', 'student_id'], 'one snapshot per student per publication');
select col_is_unique('public', 'timetable_versions', ARRAY['grade_section_id', 'version'], 'timetable versions unique per section');
select col_is_unique('public', 'timetable_periods', ARRAY['timetable_version_id', 'day_of_week', 'period_number'], 'one period per day/slot');
select col_is_unique('public', 'timetable_overrides', ARRAY['grade_section_id', 'override_date', 'period_number'], 'one override per section/date/slot');
select col_is_unique('public', 'exam_schedule_versions', ARRAY['grade_section_id', 'version'], 'exam schedule versions unique per section');
select col_is_unique('public', 'grade_band_versions', 'version', 'grade band versions unique');
select col_is_unique('public', 'result_batch_versions', ARRAY['batch_id', 'version'], 'batch versions unique');

-- Immutable rows: submitted/moderation/correction history is append-only.
select has_trigger('public', 'result_batch_versions', 'result_batch_versions_no_update', 'batch versions cannot be updated');
select has_trigger('public', 'result_batch_versions', 'result_batch_versions_no_delete', 'batch versions cannot be deleted');
select has_trigger('public', 'result_publication_items', 'publication_items_no_update', 'snapshots cannot be updated');
select has_trigger('public', 'result_publication_items', 'publication_items_no_delete', 'snapshots cannot be deleted');
select has_trigger('public', 'result_events', 'result_events_no_update', 'result events cannot be updated');
select has_trigger('public', 'result_events', 'result_events_no_delete', 'result events cannot be deleted');

-- RLS enabled on every B5 table.
select is(
  (select count(*)::int from pg_tables t
    where t.schemaname = 'public'
      and t.tablename in ('exam_definitions', 'assessment_components', 'grade_band_versions',
                          'result_batches', 'result_rosters', 'result_batch_versions', 'mark_entries',
                          'result_publications', 'result_publication_items', 'result_correction_requests',
                          'result_events', 'timetable_versions', 'timetable_periods',
                          'timetable_publications', 'timetable_overrides', 'exam_schedule_versions',
                          'exam_schedule_entries')
      and t.rowsecurity),
  17,
  'all B5 tables have RLS enabled'
);

-- No anonymous access to results or timetables.
select is(
  (select count(*)::int from pg_policies p
    where p.schemaname = 'public'
      and p.tablename in ('exam_definitions', 'assessment_components', 'grade_band_versions',
                          'result_batches', 'result_rosters', 'result_batch_versions', 'mark_entries',
                          'result_publications', 'result_publication_items', 'result_correction_requests',
                          'result_events', 'timetable_versions', 'timetable_periods',
                          'timetable_publications', 'timetable_overrides', 'exam_schedule_versions',
                          'exam_schedule_entries')
      and p.roles = '{anon}'),
  0,
  'no anonymous policies in the B5 slice'
);

-- Guardian portal rule: the published per-student snapshot is the only results
-- surface a guardian reaches; batches and rosters stay teacher/staff-only.
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'result_publication_items'
      and roles = '{authenticated}'),
  3,
  'result_publication_items: guardian snapshot read + staff read/write'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'result_publications'
      and roles = '{authenticated}'),
  4,
  'result_publications: guardian header read + staff read/write/update'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'result_rosters'
      and roles = '{authenticated}'),
  3,
  'result_rosters: teacher + staff policies only (no guardian)'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'result_batches'
      and roles = '{authenticated}'),
  4,
  'result_batches: teacher + staff policies only (no guardian)'
);
select is(
  (select count(*)::int from pg_policies p
    where p.schemaname = 'public'
      and p.tablename in ('result_rosters', 'result_batches')
      and (coalesce(pg_get_expr(p.polqual, p.polrelid), '') like '%is_guardian%'
           or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') like '%is_guardian%')),
  0,
  'no guardian predicate reaches rosters or batches'
);

-- Indexes supporting the hot query paths.
select has_index('public', 'result_batches', 'result_batches_scope_idx', 'batches by section/subject/status');
select has_index('public', 'result_rosters', 'result_rosters_batch_idx', 'rosters by batch');
select has_index('public', 'mark_entries', 'mark_entries_batch_idx', 'mark entries by batch');
select has_index('public', 'result_publications', 'result_publications_batch_idx', 'publications by batch/version');
select has_index('public', 'result_publication_items', 'publication_items_student_idx', 'snapshots by student');
select has_index('public', 'timetable_versions', 'timetable_versions_section_idx', 'timetables by section/status');
select has_index('public', 'timetable_periods', 'timetable_periods_version_idx', 'periods by version');
select has_index('public', 'timetable_overrides', 'timetable_overrides_section_idx', 'overrides by section/date');
select has_index('public', 'exam_schedule_entries', 'exam_schedule_entries_version_idx', 'schedule entries by version');

rollback;
