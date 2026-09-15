-- 000090 — Teaching-assignment teacher-name projection.
--
-- staff_members/people are staff-scoped under RLS, so a timetable manager's
-- config.read saw the assignment reference ("TAS-...") as the teacher name
-- whenever the people embed was hidden; the timetable editor then could not
-- match the assignment back for save/publish. This definer projection exposes
-- only the display name keyed by teaching-assignment id.

begin;

create or replace function app.teaching_assignment_teacher_names(p_assignment_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(x.assignment_id, x.teacher_name), '{}'::jsonb)
  from (
    select ta.id as assignment_id, p.display_name as teacher_name
      from public.teaching_assignments ta
      join public.staff_members sm on sm.id = ta.staff_member_id
      join public.people p on p.id = sm.person_id
     where ta.id = any(p_assignment_ids)
       and p.display_name is not null
  ) x
$$;

revoke all on function app.teaching_assignment_teacher_names(uuid[]) from public, anon;
grant execute on function app.teaching_assignment_teacher_names(uuid[]) to authenticated, service_role;

commit;
