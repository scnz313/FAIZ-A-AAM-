-- 000089 — Timetable teacher-name projection.
--
-- Guardians can read published timetable versions and periods under RLS,
-- but staff_members/people are staff-scoped, so the embedded teacher name
-- resolves to NULL for a family session and the UI fell back to the raw
-- teaching_assignment UUID. This SECURITY DEFINER projection exposes only
-- the teacher display name keyed by period id for the given versions.

begin;

create or replace function app.timetable_teacher_names(p_version_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(x.period_id, x.teacher_name), '{}'::jsonb)
  from (
    select tp.id as period_id, p.display_name as teacher_name
      from public.timetable_periods tp
      join public.teaching_assignments ta on ta.id = tp.teaching_assignment_id
      join public.staff_members sm on sm.id = ta.staff_member_id
      join public.people p on p.id = sm.person_id
     where tp.timetable_version_id = any(p_version_ids)
       and p.display_name is not null
  ) x
$$;

revoke all on function app.timetable_teacher_names(uuid[]) from public, anon;
grant execute on function app.timetable_teacher_names(uuid[]) to authenticated, service_role;

commit;
