-- 000099 — Guardian link requests must resolve an unlinked student reference.
--
-- `links.request` resolved the office-issued student reference with the
-- caller's RLS client. A guardian can only see students they are already
-- linked to, so the very first link request always failed with
-- "not found". The lookup is now a definer projection that returns only the
-- active student id for the exact reference and only to an active guardian
-- or AAL2 staff session.

begin;

create or replace function app.student_reference_lookup(p_reference text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
    from public.students s
   where upper(s.reference) = upper(btrim(coalesce(p_reference, '')))
     and s.status = 'active'
     and (
       app.is_staff_aal2()
       or exists (
         select 1
           from public.guardians g
           join public.user_accounts ua on ua.person_id = g.person_id
          where ua.id = auth.uid()
            and ua.status = 'active'
            and g.status = 'active'
       )
     )
   limit 1
$$;

revoke all on function app.student_reference_lookup(text) from public, anon;
grant execute on function app.student_reference_lookup(text) to authenticated, service_role;

commit;
