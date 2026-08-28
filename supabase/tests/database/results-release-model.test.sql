-- 000028 result-entry/release and timetable-draft contract tests.
begin;
select plan(29);

select has_table('public', 'result_entry_sheets', 'result entry sheets exist');
select has_table('public', 'result_entry_sheet_rosters', 'entry sheet rosters exist');
select has_table('public', 'result_entry_sheet_components', 'entry sheet components exist');
select has_table('public', 'result_entry_sheet_marks', 'entry sheet marks exist');
select has_table('public', 'result_entry_sheet_versions', 'entry sheet history exists');
select has_table('public', 'result_report_releases', 'report release manifests exist');
select has_table('public', 'result_report_release_items', 'report release snapshots exist');
select has_table('public', 'result_report_release_events', 'report release events exist');

select col_has_check('public', 'result_entry_sheets', 'state', 'entry sheet state is constrained');
select col_has_check('public', 'result_entry_sheet_marks', 'mark_status', 'mark status is explicit');
select col_has_check('public', 'result_report_releases', 'status', 'release state is constrained');
select col_is_unique('public', 'result_entry_sheet_rosters', ARRAY['sheet_id', 'student_id'], 'one roster row per student');
select col_is_unique('public', 'result_entry_sheet_marks', ARRAY['sheet_id', 'roster_id', 'component_id'], 'one mark cell per roster/component');
select col_is_unique('public', 'result_report_release_items', ARRAY['release_id', 'subject_id'], 'one release item per subject');
select col_is_unique('public', 'result_report_releases', ARRAY['student_id', 'academic_year_id', 'term', 'release_version'], 'release versions are append-only');

select has_trigger('public', 'result_entry_sheet_versions', 'result_entry_sheet_versions_no_update', 'entry sheet versions are immutable');
select has_trigger('public', 'result_entry_sheet_versions', 'result_entry_sheet_versions_no_delete', 'entry sheet history cannot be deleted');
select has_trigger('public', 'result_report_release_items', 'result_report_release_items_no_update', 'report snapshots are immutable');
select has_trigger('public', 'result_report_release_items', 'result_report_release_items_no_delete', 'report snapshots cannot be deleted');
select has_index('public', 'result_entry_sheets', 'result_entry_sheets_one_open_uidx', 'one open sheet per exam/section/subject');
select has_index('public', 'result_report_releases', 'result_report_releases_one_live_uidx', 'one live report release per student/term');
select has_index('public', 'timetable_versions', 'timetable_versions_one_draft_uidx', 'one durable timetable draft per section');
select has_index('public', 'exam_schedule_versions', 'exam_schedule_versions_one_draft_uidx', 'one durable date-sheet draft per section');
select is((select count(*)::int from pg_constraint where conrelid = 'public.result_publications'::regclass and conname = 'result_publications_source_required'), 1, 'publication must reference a batch or native entry sheet');

select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'results_entry_sheet_save_draft'), 1, 'full-matrix save command exists');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'results_report_release_publish'), 1, 'report release publish command exists');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'results_approve_correction'), 1, 'independent correction approval exists');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'timetable_save_draft'), 1, 'durable timetable draft save exists');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'exam_schedule_publish'), 1, 'date-sheet publish exists');

rollback;
