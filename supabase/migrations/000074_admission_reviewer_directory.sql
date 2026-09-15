-- ---------------------------------------------------------------------------
-- 000074 — admission review officer directory
--
-- Admission review rows store only the officer's account id, so the staff
-- application workspace rendered a raw UUID where a name belongs. The review
-- and identity tables are scope-gated separately, and the workspace must not
-- read user_accounts directly to translate the id. This function returns the
-- display-name directory for one application under the same AAL2 and
-- admissions scope as the application read, and refuses an out-of-scope or
-- unauthenticated caller.
-- ---------------------------------------------------------------------------

create or replace function app.admission_reviewer_directory(p_application_id uuid)
returns setof jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (app.is_staff_aal2() and app.admission_staff_scope(
      p_application_id,
      array['admissions_officer', 'admissions_approver', 'auditor'])) then
    raise exception 'admission reviewer directory is outside the staff scope';
  end if;

  return query
  select jsonb_build_object('accountId', ua.id, 'displayName', p.display_name)
    from public.admission_reviews ar
    join public.user_accounts ua on ua.id = ar.officer_account_id
    join public.people p on p.id = ua.person_id
   where ar.application_id = p_application_id
   group by ua.id, p.display_name
   order by p.display_name, ua.id;
end
$$;

revoke all on function app.admission_reviewer_directory(uuid) from public;
grant execute on function app.admission_reviewer_directory(uuid) to authenticated;
