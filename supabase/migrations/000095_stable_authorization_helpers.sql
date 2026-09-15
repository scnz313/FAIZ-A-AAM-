-- 000095 — Mark hot read-only authorization helpers STABLE.
--
-- These helpers are called from RLS policies per candidate row. They only
-- read within the current statement (auth claims and role/link tables), so
-- declaring them STABLE lets the planner cache their result per statement
-- instead of assuming a volatile function and re-evaluating it per row.
-- Bodies are unchanged from their latest definitions (000004/000010/000025/
-- 000042); only the volatility marker is added.

begin;

create or replace function app.has_any_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.role_grants rg
     where rg.account_id = auth.uid()
       and rg.role_code = any(
         case
           when coalesce(array_length(p_roles, 1), 0) > 1
             and 'system_administrator' = any(p_roles)
             then array_remove(p_roles, 'system_administrator')
           else p_roles
         end
       )
       and rg.status = 'active'
       and rg.effective_from <= now()
       and (rg.effective_to is null or rg.effective_to > now())
  )
$$;

create or replace function app.is_staff_aal2()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and (auth.jwt() ->> 'aal') = 'aal2'
     and exists (
       select 1
         from public.role_grants rg
        where rg.account_id = auth.uid()
          and rg.status = 'active'
          and rg.effective_from <= now()
          and (rg.effective_to is null or rg.effective_to > now())
          and rg.role_code in (
            'content_editor', 'content_publisher',
            'admissions_officer', 'admissions_approver',
            'finance_officer', 'finance_approver',
            'hr_reviewer', 'hr_approver',
            /* teacher remains for legacy sessions until the Phase-3
               retirement; result_entry_officer is the Principal entry role. */
            'teacher', 'result_entry_officer', 'exam_reviewer', 'result_publisher',
            'timetable_manager', 'support_officer',
            'auditor', 'system_administrator'
          )
     )
$$;

create or replace function app.is_pure_teacher()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and exists (
       select 1 from public.role_grants rg
        where rg.account_id = auth.uid()
          and rg.role_code = 'teacher'
          and rg.status = 'active'
          and rg.effective_from <= now()
          and (rg.effective_to is null or rg.effective_to > now())
     )
     and not exists (
       select 1 from public.role_grants rg
        where rg.account_id = auth.uid()
          and rg.role_code in (
            'content_editor', 'content_publisher',
            'admissions_officer', 'admissions_approver',
            'finance_officer', 'finance_approver',
            'hr_reviewer', 'hr_approver',
            'exam_reviewer', 'result_publisher',
            'timetable_manager', 'support_officer',
            'auditor', 'system_administrator'
          )
          and rg.status = 'active'
          and rg.effective_from <= now()
          and (rg.effective_to is null or rg.effective_to > now())
     )
$$;

create or replace function app.guardian_publication_allowed(p_publication_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.result_publication_items pi
     where pi.publication_id = p_publication_id
       and app.guardian_has_capability(pi.student_id, 'academics')
  )
$$;

create or replace function app.active_publication_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(select id from public.result_publications where status <> 'withdrawn')
$$;

commit;
