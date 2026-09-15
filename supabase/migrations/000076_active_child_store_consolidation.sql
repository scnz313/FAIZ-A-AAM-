-- ---------------------------------------------------------------------------
-- 000076 — consolidate the guardian active-child store
--
-- Two stores held the active child: account_context_preferences (written by
-- context_family_select, and still used for the staff workspace grant) and
-- guardian_preferences (written by guardian_switch_active_child, audited and
-- hardened in 000066). The family portal read the first and ignored the
-- second, so the two could disagree. This migration makes
-- guardian_preferences the single family store: context_family_select keeps
-- its signature, validation, and return shape but writes the guardian-keyed
-- row, and every existing selection is backfilled so no family's active
-- child changes. account_context_preferences remains in place for the staff
-- workspace pref until a later removal.
-- ---------------------------------------------------------------------------

create or replace function app.context_family_select(
  p_student_id uuid,
  p_expected_version int default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid := auth.uid();
  v_guardian_id uuid;
  v_pref public.guardian_preferences%rowtype;
  v_link public.guardian_student_links%rowtype;
begin
  if v_account is null then raise exception 'authenticated actor required'; end if;
  select g.id into v_guardian_id
    from public.guardians g join public.user_accounts ua on ua.person_id = g.person_id
   where ua.id = v_account and ua.status = 'active' and g.status = 'active';
  if v_guardian_id is null then raise exception 'family context is not available to this account'; end if;
  select * into v_link from public.guardian_student_links
   where guardian_id = v_guardian_id and student_id = p_student_id and status = 'active'
     and (effective_from is null or effective_from <= now()) and (effective_to is null or effective_to > now());
  if v_link.id is null then raise exception 'that student is not linked to this family account'; end if;

  select * into v_pref from public.guardian_preferences where guardian_id = v_guardian_id for update;
  if p_expected_version is not null and v_pref.version is not null and v_pref.version <> p_expected_version then
    raise exception 'family context version mismatch (expected %, found %)', p_expected_version, v_pref.version;
  end if;
  insert into public.guardian_preferences (guardian_id, active_student_id, version)
  values (v_guardian_id, p_student_id, 1)
  on conflict (guardian_id) do update set active_student_id = excluded.active_student_id,
                                         version = public.guardian_preferences.version + 1
  returning * into v_pref;

  return jsonb_build_object('accountId', v_account, 'activeStudentId', v_pref.active_student_id,
                            'activeRoleGrantId', null, 'version', v_pref.version);
end
$$;

revoke all on function app.context_family_select(uuid, int) from public;
grant execute on function app.context_family_select(uuid, int) to authenticated;

-- Backfill every existing family selection when the link is still active.
insert into public.guardian_preferences (guardian_id, active_student_id, version)
select g.id, acp.active_student_id, 1
  from public.account_context_preferences acp
  join public.user_accounts ua on ua.id = acp.account_id
  join public.guardians g on g.person_id = ua.person_id
 where acp.active_student_id is not null
   and exists (
     select 1 from public.guardian_student_links l
      where l.guardian_id = g.id and l.student_id = acp.active_student_id and l.status = 'active'
   )
on conflict (guardian_id) do nothing;
