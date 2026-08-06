-- =============================================================================
-- B6 content/documents database tests (pgTAP, `supabase db test`).
-- =============================================================================

begin;
select plan(64);

-- Tables exist.
select has_table('public', 'content_items', 'content_items exists');
select has_table('public', 'content_versions', 'content_versions exists');
select has_table('public', 'notices', 'notices exists');
select has_table('public', 'notice_audiences', 'notice_audiences exists');
select has_table('public', 'content_documents', 'content_documents exists');
select has_table('public', 'documents', 'documents exists');
select has_table('public', 'admission_documents', 'admission_documents exists');
select has_table('public', 'job_documents', 'job_documents exists');
select has_table('public', 'student_documents', 'student_documents exists');
select has_table('public', 'invoice_documents', 'invoice_documents exists');
select has_table('public', 'result_documents', 'result_documents exists');
select has_table('public', 'support_documents', 'support_documents exists');
select has_table('public', 'document_processing_events', 'document_processing_events exists');
select has_table('public', 'support_requests', 'support_requests exists');
select has_table('public', 'support_messages', 'support_messages exists');
select has_table('public', 'support_private_notes', 'support_private_notes exists');
select has_table('public', 'support_events', 'support_events exists');
select has_table('public', 'in_app_notifications', 'in_app_notifications exists');
select has_table('public', 'notification_deliveries', 'notification_deliveries exists');
select has_table('public', 'email_suppressions', 'email_suppressions exists');

-- Checks: document hygiene, message integrity, and workflow transitions.
select col_has_check('public', 'documents', 'size_bytes', 'document size cannot be negative');
select col_has_check('public', 'documents', 'scan_status', 'scan status check');
select col_has_check('public', 'documents', 'visibility', 'visibility check');
select col_has_check('public', 'support_messages', 'body', 'support messages cannot be blank');
select col_has_check('public', 'support_requests', 'status', 'support request status check');
select col_has_check('public', 'support_requests', 'priority', 'support request priority check');
select col_has_check('public', 'notification_deliveries', 'channel', 'delivery channel check');
select col_has_check('public', 'notification_deliveries', 'status', 'delivery status check');
select col_has_check('public', 'email_suppressions', 'reason', 'suppression reason check');

-- Uniqueness.
select col_is_unique('public', 'content_versions', ARRAY['content_item_id', 'version'], 'content versions unique per item');
select col_is_unique('public', 'notice_audiences', ARRAY['notice_id', 'audience', 'role_code', 'academic_year_id', 'grade_section_id', 'student_id'], 'audience definition unique per notice');
select col_is_unique('public', 'documents', 'reference', 'document reference unique');
select col_is_unique('public', 'documents', 'object_key', 'object keys are never reused');
select col_is_unique('public', 'admission_documents', 'document_id', 'one document per admission attachment');
select col_is_unique('public', 'job_documents', 'document_id', 'one document per job attachment');
select col_is_unique('public', 'student_documents', 'document_id', 'one document per student attachment');
select col_is_unique('public', 'invoice_documents', 'document_id', 'one document per invoice attachment');
select col_is_unique('public', 'result_documents', 'document_id', 'one document per result attachment');
select col_is_unique('public', 'support_documents', 'document_id', 'one document per support attachment');
select col_is_unique('public', 'notification_deliveries', ARRAY['event_id', 'recipient_account_id', 'channel', 'template_version'], 'one delivery per event/recipient/channel/template');
select col_is_unique('public', 'email_suppressions', 'email_hash', 'one suppression per hashed address');
select col_is_unique('public', 'content_documents', ARRAY['content_item_id', 'document_id'], 'one document per content item');

-- Immutable rows: version history, processing trails, threads, and suppressions
-- are append-only.
select has_trigger('public', 'content_versions', 'content_versions_no_update', 'content versions cannot be updated');
select has_trigger('public', 'content_versions', 'content_versions_no_delete', 'content versions cannot be deleted');
select has_trigger('public', 'document_processing_events', 'document_processing_events_no_update', 'processing events cannot be updated');
select has_trigger('public', 'document_processing_events', 'document_processing_events_no_delete', 'processing events cannot be deleted');
select has_trigger('public', 'support_messages', 'support_messages_no_update', 'support messages cannot be updated');
select has_trigger('public', 'support_messages', 'support_messages_no_delete', 'support messages cannot be deleted');
select has_trigger('public', 'support_private_notes', 'support_notes_no_update', 'private notes cannot be updated');
select has_trigger('public', 'support_private_notes', 'support_notes_no_delete', 'private notes cannot be deleted');
select has_trigger('public', 'support_events', 'support_events_no_update', 'support events cannot be updated');
select has_trigger('public', 'support_events', 'support_events_no_delete', 'support events cannot be deleted');
select has_trigger('public', 'email_suppressions', 'suppressions_no_update', 'suppressions cannot be updated');
select has_trigger('public', 'email_suppressions', 'suppressions_no_delete', 'suppressions cannot be deleted');

-- RLS enabled on every B6 table.
select is(
  (select count(*)::int from pg_tables t
    where t.schemaname = 'public'
      and t.tablename in ('content_items', 'content_versions', 'notices', 'notice_audiences',
                          'content_documents', 'documents', 'admission_documents', 'job_documents',
                          'student_documents', 'invoice_documents', 'result_documents',
                          'support_documents', 'document_processing_events', 'support_requests',
                          'support_messages', 'support_private_notes', 'support_events',
                          'in_app_notifications', 'notification_deliveries', 'email_suppressions')
      and t.rowsecurity),
  20,
  'all B6 tables have RLS enabled'
);

-- Anonymous sees only published pages, their published versions, published
-- public-audience notices, and clean public-approved documents.
select is(
  (select count(*)::int from pg_policies p
    where p.schemaname = 'public'
      and p.tablename in ('content_items', 'content_versions', 'notices', 'notice_audiences',
                          'content_documents', 'documents', 'admission_documents', 'job_documents',
                          'student_documents', 'invoice_documents', 'result_documents',
                          'support_documents', 'document_processing_events', 'support_requests',
                          'support_messages', 'support_private_notes', 'support_events',
                          'in_app_notifications', 'notification_deliveries', 'email_suppressions')
      and p.roles = '{anon}'),
  4,
  'four anonymous policies exist across the B6 slice'
);
select is(
  (select count(*)::int from pg_policies p
    where p.schemaname = 'public'
      and p.tablename in ('content_items', 'content_versions', 'notices', 'documents')
      and p.roles = '{anon}'),
  4,
  'anonymous policies sit only on content_items, content_versions, notices, documents'
);
select is(
  (select count(*)::int from pg_policies p
    where p.schemaname = 'public'
      and p.tablename in ('notice_audiences', 'content_documents', 'admission_documents',
                          'job_documents', 'student_documents', 'invoice_documents',
                          'result_documents', 'support_documents', 'document_processing_events',
                          'support_requests', 'support_messages', 'support_private_notes',
                          'support_events', 'in_app_notifications', 'notification_deliveries',
                          'email_suppressions')
      and p.roles = '{anon}'),
  0,
  'job, admission, student, invoice, result, and support data is never anonymous'
);

-- Indexes supporting the hot query paths.
select has_index('public', 'documents', 'documents_owner_idx', 'documents by owner domain/record');
select has_index('public', 'support_requests', 'support_requests_status_idx', 'requests by status recency');
select has_index('public', 'in_app_notifications', 'notifications_recipient_idx', 'notifications by recipient');
select has_index('public', 'notification_deliveries', 'deliveries_status_idx', 'deliveries by status/retry');

-- Support privacy: private notes are staff-only (aal2), never the requester.
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'support_private_notes'),
  2,
  'support_private_notes carries exactly two staff policies'
);
select is(
  (select count(*)::int from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'support_private_notes'
      and (coalesce(pg_get_expr(p.polqual, p.polrelid), '') not like '%is_staff_aal2%'
           and coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') not like '%is_staff_aal2%')),
  0,
  'every support_private_notes policy gates on app.is_staff_aal2()'
);

rollback;
