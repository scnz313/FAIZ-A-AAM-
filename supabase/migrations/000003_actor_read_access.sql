-- =============================================================================
-- B1 — server actor read access (plan.md §4, §7)
--
-- The server actor resolver (apps/web/lib/auth/actor.ts) validates identity
-- with getUser() and then reads the account holder's OWN identity records to
-- build the authorized context. `access_revalidation` had no read path yet;
-- this adds the owner-scoped policy plus the base privilege (the new Supabase
-- default grants nothing to new tables). All other rows of the security
-- version table stay inaccessible to non-service roles.
-- =============================================================================

begin;

create policy own_revalidation on public.access_revalidation
  for select to authenticated
  using (account_id = auth.uid());

grant select on public.access_revalidation to authenticated;

commit;
