-- 000088 — Hot-path indexes for confirmed query patterns.
--
-- Findings (read-only performance audit, 11 September 2026): the following
-- foreign keys and filter/sort columns are exercised by current server reads
-- and embedded projections but have no supporting index. All indexes are
-- additive, created with `if not exists`, and never edit earlier migrations.

begin;

-- Correlated per-account subquery in app.users_admin_list() (000042).
create index if not exists account_invitations_account_idx
  on public.account_invitations (account_id);

-- Embedded document projections per owning record (000008 read paths).
create index if not exists admission_documents_application_idx
  on public.admission_documents (application_id);
create index if not exists job_documents_application_idx
  on public.job_documents (application_id);
create index if not exists student_documents_student_idx
  on public.student_documents (student_id);
create index if not exists invoice_documents_invoice_idx
  on public.invoice_documents (invoice_id);
create index if not exists result_documents_publication_idx
  on public.result_documents (publication_id);
create index if not exists support_documents_request_idx
  on public.support_documents (support_request_id);
create index if not exists document_processing_events_document_idx
  on public.document_processing_events (document_id);

-- Careers staff queue embeds scorecards and interviews per application.
create index if not exists job_scorecards_application_idx
  on public.job_scorecards (application_id);
create index if not exists job_interviews_application_idx
  on public.job_interviews (application_id);

-- Result release history per release.
create index if not exists result_report_release_events_release_idx
  on public.result_report_release_events (release_id);

-- Status-first filters and sorts on register reads.
create index if not exists content_items_current_status_idx
  on public.content_items (current_status);
create index if not exists guardian_student_links_status_created_idx
  on public.guardian_student_links (status, created_at desc);
create index if not exists result_publications_status_published_idx
  on public.result_publications (status, published_at desc);

commit;
