-- =============================================================================
-- 000048 — Advisor hardening for the consolidation surface
--
-- Forward-only fixes from the linked Security/Performance advisor review
-- after applying 000040–000047:
--   1. Index every foreign key added by the consolidation migrations
--      (advisor: unindexed_foreign_keys).
--   2. Revoke anon EXECUTE on app.profile_role_codes (advisor:
--      anon_security_definer_function_executable). The profile catalog is
--      staff-facing; anon callers use the public site only.
--
-- Accepted-by-disposition (not changed here):
--   * rls_enabled_no_policy on infrastructure + profile catalog tables —
--     intentional deny-by-default; reads go through SECURITY DEFINER
--     commands and direct privileges are revoked.
--   * authenticated_security_definer_function_executable — the app command
--     surface enforces authorization inside each function (auth.uid(),
--     role grants, AAL2, scope); this is the established pattern across
--     000009–000047.
--   * auth_leaked_password_protection — enabled out-of-band via the Auth
--     config API; recorded in PROJECT-STATUS.md.
-- =============================================================================

begin;

-- 1. Foreign-key indexes on consolidation tables.
create index if not exists teaching_assignments_created_by_idx
  on public.teaching_assignments (created_by_account_id);
create index if not exists teaching_assignments_updated_by_idx
  on public.teaching_assignments (updated_by_account_id);
create index if not exists data_import_batches_year_idx
  on public.data_import_batches (academic_year_id);
create index if not exists data_import_batches_creator_idx
  on public.data_import_batches (created_by_account_id);
create index if not exists data_import_batches_document_idx
  on public.data_import_batches (source_document_id);
create index if not exists data_import_issues_row_idx
  on public.data_import_issues (row_id);
create index if not exists data_import_mappings_creator_idx
  on public.data_import_mappings (created_by_account_id);
create index if not exists guardian_campaigns_year_idx
  on public.guardian_campaigns (academic_year_id);
create index if not exists guardian_campaigns_creator_idx
  on public.guardian_campaigns (created_by_account_id);
create index if not exists guardian_claim_invitations_campaign_idx
  on public.guardian_claim_invitations (campaign_id);
create index if not exists guardian_claim_invitations_creator_idx
  on public.guardian_claim_invitations (created_by_account_id);
create index if not exists guardian_claim_invitations_contact_idx
  on public.guardian_claim_invitations (guardian_contact_id);
create index if not exists guardian_claim_links_link_idx
  on public.guardian_claim_links (link_id);
create index if not exists guardian_contact_changes_contact_idx
  on public.guardian_contact_changes (guardian_contact_id);
create index if not exists guardian_contact_changes_decider_idx
  on public.guardian_contact_changes (decided_by_account_id);
create index if not exists data_export_requests_document_idx
  on public.data_export_requests (document_id);
create index if not exists data_export_requests_requester_idx
  on public.data_export_requests (requested_by_account_id);
create index if not exists data_export_events_actor_idx
  on public.data_export_events (actor_account_id);

-- 2. Profile catalog helpers are staff-facing: revoke anon EXECUTE.
revoke execute on function app.profile_role_codes(text) from anon;
revoke execute on function app.auth_claim_phone() from anon;

commit;
