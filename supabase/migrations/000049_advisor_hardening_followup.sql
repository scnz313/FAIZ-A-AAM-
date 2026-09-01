-- =============================================================================
-- 000049 — Advisor hardening follow-up
--
-- Residuals from the post-000048 advisor re-read:
--   1. Index staff_access_profile_roles.role_code → role_definitions.code
--      (the one consolidation FK missed by 000048).
--   2. Functions grant EXECUTE to PUBLIC by default, so revoking from anon
--      alone does not close anon access. Revoke from PUBLIC and re-grant to
--      authenticated explicitly for the two staff-facing helpers.
-- =============================================================================

begin;

create index if not exists staff_access_profile_roles_role_code_idx
  on public.staff_access_profile_roles (role_code);

revoke execute on function app.profile_role_codes(text) from public, anon;
revoke execute on function app.auth_claim_phone() from public, anon;
grant execute on function app.profile_role_codes(text) to authenticated;
grant execute on function app.auth_claim_phone() to authenticated;

commit;
