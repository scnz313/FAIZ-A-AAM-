-- 000016: server-generated documents (plan.md §6 Documents).
--
-- Generated PDFs (receipts, report cards) are produced by the outbox worker,
-- not uploaded by a user account. `uploaded_by_account_id` becomes nullable
-- for these rows; generated documents are 'clean' by construction because
-- their bytes come from authoritative records, never from user input.
-- Forward-only: no existing row is modified.

alter table public.documents
  alter column uploaded_by_account_id drop not null;

comment on column public.documents.uploaded_by_account_id is
  'Account that uploaded the object; null for server-generated documents (receipts, report cards).';
