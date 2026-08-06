-- =============================================================================
-- Forward-only RLS fixes found by the local RLS/RPC suites after 000004–000008
-- were applied to the live project.
--
-- 1. B4: pre-conversion admission invoices (student_id NULL, applicant_ref
--    set) must be visible to their OWNER so the applicant can see and pay
--    them; the same scope flows through invoice items and receipts.
-- 2. B5: the two guardian result policies referenced each other (policy
--    recursion); the withdrawn-publication check now goes through a
--    SECURITY DEFINER helper.
-- =============================================================================
begin;

-- ---------------------------------------------------------------------------
-- B4 — guardian finance scope includes applicant-owned admission invoices
-- ---------------------------------------------------------------------------
drop policy if exists guardian_read_invoices on public.invoices;
create policy guardian_read_invoices on public.invoices
  for select to authenticated
  using (
    app.is_guardian()
    and (
      student_id in (
        select l.student_id
          from public.guardian_student_links l
          join public.guardians g on g.id = l.guardian_id
          join public.user_accounts ua on ua.person_id = g.person_id
         where ua.id = auth.uid()
           and l.status = 'active'
      )
      or applicant_ref in (
        select reference from public.admission_applications
         where owner_account_id = auth.uid()
      )
    )
  );

drop policy if exists guardian_read_invoice_items on public.invoice_items;
create policy guardian_read_invoice_items on public.invoice_items
  for select to authenticated
  using (invoice_id in (select id from public.invoices
         where app.is_guardian() and (
           student_id in (
             select l.student_id
               from public.guardian_student_links l
               join public.guardians g on g.id = l.guardian_id
               join public.user_accounts ua on ua.person_id = g.person_id
              where ua.id = auth.uid() and l.status = 'active')
           or applicant_ref in (select reference from public.admission_applications
                                 where owner_account_id = auth.uid())
         )));

drop policy if exists guardian_read_receipts on public.receipts;
create policy guardian_read_receipts on public.receipts
  for select to authenticated
  using (invoice_id in (select id from public.invoices
         where app.is_guardian() and (
           student_id in (
             select l.student_id
               from public.guardian_student_links l
               join public.guardians g on g.id = l.guardian_id
               join public.user_accounts ua on ua.person_id = g.person_id
              where ua.id = auth.uid() and l.status = 'active')
           or applicant_ref in (select reference from public.admission_applications
                                 where owner_account_id = auth.uid())
         )));

-- ---------------------------------------------------------------------------
-- B5 — recursion guard for the guardian result policies
-- ---------------------------------------------------------------------------
create or replace function app.active_publication_ids()
returns uuid[]
language sql
security definer
set search_path = ''
as $$
  select array(select id from public.result_publications where status <> 'withdrawn')
$$;
revoke all on function app.active_publication_ids() from public;
grant execute on function app.active_publication_ids() to authenticated;

drop policy if exists guardian_read_publication_items on public.result_publication_items;
create policy guardian_read_publication_items on public.result_publication_items
  for select to authenticated
  using (
    app.is_guardian()
    and publication_id = any(app.active_publication_ids())
    and student_id in (
      select l.student_id
        from public.guardian_student_links l
        join public.guardians g on g.id = l.guardian_id
        join public.user_accounts ua on ua.person_id = g.person_id
       where ua.id = auth.uid() and l.status = 'active'
    )
  );

commit;
