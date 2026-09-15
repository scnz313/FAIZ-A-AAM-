-- Phase 11 local-only forward repair. Migrations 000001-000065 are already
-- present on staging and must never be edited in place.
begin;

-- Views execute with their owner privileges by default. This view is exposed
-- through the app schema, so force the caller's RLS policies to remain active.
create or replace view app.timetable_period_teachers
with (security_invoker = true) as
  select
    tp.id as timetable_period_id,
    tp.timetable_version_id,
    tp.day_of_week,
    tp.period_number,
    tp.subject_id,
    tp.room_id,
    tp.kind,
    coalesce(ta.id, legacy_ta.id) as teaching_assignment_id,
    coalesce(ta.staff_member_id, legacy_ta.staff_member_id) as staff_member_id,
    coalesce(ta.academic_year_id, legacy_sa.academic_year_id) as academic_year_id,
    coalesce(ta.grade_section_id, legacy_sa.grade_section_id) as grade_section_id,
    coalesce(ta.subject_id, legacy_sa.subject_id) as effective_subject_id,
    p.display_name as teacher_display_name,
    sm.title as teacher_title,
    case when ta.id is not null then 'teaching_assignment'
         when legacy_sa.id is not null then 'staff_assignment'
         else null end as source
  from public.timetable_periods tp
  left join public.teaching_assignments ta on ta.id = tp.teaching_assignment_id
  left join public.staff_assignments legacy_sa on legacy_sa.id = tp.teacher_assignment_id
  left join public.teaching_assignments legacy_ta
    on legacy_ta.staff_member_id = legacy_sa.staff_member_id
   and legacy_ta.academic_year_id = legacy_sa.academic_year_id
   and legacy_ta.grade_section_id = legacy_sa.grade_section_id
   and legacy_ta.subject_id = legacy_sa.subject_id
  left join public.staff_members sm
    on sm.id = coalesce(ta.staff_member_id, legacy_ta.staff_member_id, legacy_sa.staff_member_id)
  left join public.people p on p.id = sm.person_id;

revoke all on app.timetable_period_teachers from public, anon;
grant select on app.timetable_period_teachers to authenticated;

-- The token hash introduced in 000063 represents the same one-time secret as
-- secret_hash. Keep one canonical hash populated for existing and new claims.
update public.guardian_claim_invitations
   set token_hash = secret_hash
 where token_hash is null;

create unique index if not exists guardian_claim_invitations_token_hash_uidx
  on public.guardian_claim_invitations(token_hash)
  where token_hash is not null;

create or replace function app.guardian_claim_sync_token_hash()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.token_hash := new.secret_hash;
  return new;
end
$$;
revoke all on function app.guardian_claim_sync_token_hash() from public, anon, authenticated;

drop trigger if exists guardian_claim_sync_token_hash on public.guardian_claim_invitations;
create trigger guardian_claim_sync_token_hash
  before insert or update of secret_hash on public.guardian_claim_invitations
  for each row execute function app.guardian_claim_sync_token_hash();

-- Public claim verification is mediated by a rate-limited same-origin server
-- route. Do not expose the SECURITY DEFINER lookup directly to browser roles.
revoke all on function app.guardian_claim_verify_token(text) from public, anon, authenticated;
grant execute on function app.guardian_claim_verify_token(text) to service_role;

-- Direct preference writes must enforce the same active-link invariant as the
-- guardian_switch_active_child command. Otherwise a guardian could persist an
-- arbitrary student UUID even though later projections deny it.
drop policy if exists guardian_preferences_guardian_update on public.guardian_preferences;
create policy guardian_preferences_guardian_update
  on public.guardian_preferences for update to authenticated
  using (
    exists (
      select 1 from public.guardians g
      join public.user_accounts ua on ua.person_id = g.person_id
      where g.id = guardian_preferences.guardian_id and ua.id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.guardians g
      join public.user_accounts ua on ua.person_id = g.person_id
      where g.id = guardian_preferences.guardian_id and ua.id = auth.uid()
    )
    and exists (
      select 1 from public.guardian_student_links l
      where l.guardian_id = guardian_preferences.guardian_id
        and l.student_id = guardian_preferences.active_student_id
        and l.status = 'active'
        and (l.effective_from is null or l.effective_from <= now())
        and (l.effective_to is null or l.effective_to > now())
    )
  );

drop policy if exists guardian_preferences_guardian_insert on public.guardian_preferences;
create policy guardian_preferences_guardian_insert
  on public.guardian_preferences for insert to authenticated
  with check (
    exists (
      select 1 from public.guardians g
      join public.user_accounts ua on ua.person_id = g.person_id
      where g.id = guardian_preferences.guardian_id and ua.id = auth.uid()
    )
    and exists (
      select 1 from public.guardian_student_links l
      where l.guardian_id = guardian_preferences.guardian_id
        and l.student_id = guardian_preferences.active_student_id
        and l.status = 'active'
        and (l.effective_from is null or l.effective_from <= now())
        and (l.effective_to is null or l.effective_to > now())
    )
  );

commit;
