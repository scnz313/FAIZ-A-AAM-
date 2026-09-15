-- =============================================================================
-- 000078 - guardian link restore
--
-- Restricting an active guardian/student link pauses access pending review.
-- This migration adds the inverse command: app.links_restore returns a
-- restricted link to the active set with a recorded reason. Authorization,
-- locking, version checking, audit, and outbox behavior mirror
-- app.links_restrict (000026); revoking a link remains final. Migrations
-- 000001-000077 are frozen; this is a local-only forward migration that the
-- owner applies.
-- =============================================================================

begin;

create or replace function app.links_restore(
  p_link_id uuid,
  p_reason text,
  p_expected_version int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.guardian_student_links%rowtype;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_any_role(array['system_administrator'])) then
    raise exception 'link verification role and aal2 required';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'restoration reason is required';
  end if;
  select * into v_link from public.guardian_student_links where id = p_link_id for update;
  if v_link.id is null then raise exception 'link not found'; end if;
  if v_link.version <> p_expected_version then
    raise exception 'link version mismatch (expected %, found %)', p_expected_version, v_link.version;
  end if;
  if v_link.status <> 'restricted' then
    raise exception 'only restricted links can be restored';
  end if;
  update public.guardian_student_links
     set status = 'active', restriction_reason = null, version = v_link.version + 1
   where id = p_link_id;
  perform app.record_audit('Guardian link restored', 'guardian_student_link', v_link.reference,
                           'Success', btrim(p_reason));
  perform app.enqueue_outbox(
    'security.link_restored:' || v_link.reference || ':' || (v_link.version + 1),
    'security.link_restored', 'guardian_student_link', v_link.reference,
    jsonb_build_object('reason', btrim(p_reason)));
  return jsonb_build_object(
    'linkId', p_link_id,
    'reference', v_link.reference,
    'status', 'active',
    'version', v_link.version + 1
  );
end;
$$;

revoke all on function app.links_restore(uuid, text, int) from public;
grant execute on function app.links_restore(uuid, text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Align the remaining link decisions with the application matrix.
--
-- 000042 made link activation Administrator-only and removed links.verify from
-- support_officer, but the 000026 definitions of restrict, revoke, and
-- capability changes still allowed support_officer. The server must not be
-- broader than the UI: all four link decisions now require the system
-- administrator.
-- ---------------------------------------------------------------------------

create or replace function app.links_restrict(p_link_id uuid, p_reason text, p_expected_version int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_link public.guardian_student_links%rowtype;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_any_role(array['system_administrator'])) then raise exception 'link verification role and aal2 required'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'restriction reason is required'; end if;
  select * into v_link from public.guardian_student_links where id = p_link_id for update;
  if v_link.id is null then raise exception 'link not found'; end if;
  if v_link.version <> p_expected_version then raise exception 'link version mismatch (expected %, found %)', p_expected_version, v_link.version; end if;
  if v_link.status = 'restricted' then return; end if;
  if v_link.status <> 'active' then raise exception 'link cannot be restricted in state (%)', v_link.status; end if;
  update public.guardian_student_links set status = 'restricted', restriction_reason = btrim(p_reason), version = v_link.version + 1 where id = p_link_id;
  perform app.record_audit('Guardian link restricted', 'guardian_student_link', v_link.reference, 'Success', btrim(p_reason));
  perform app.enqueue_outbox('security.link_restricted:' || v_link.reference || ':' || (v_link.version + 1), 'security.link_restricted', 'guardian_student_link', v_link.reference, jsonb_build_object('reason',btrim(p_reason)));
end; $$;

create or replace function app.links_revoke(p_link_id uuid, p_reason text, p_expected_version int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_link public.guardian_student_links%rowtype;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_any_role(array['system_administrator'])) then raise exception 'link verification role and aal2 required'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'revocation reason is required'; end if;
  select * into v_link from public.guardian_student_links where id = p_link_id for update;
  if v_link.id is null then raise exception 'link not found'; end if;
  if v_link.version <> p_expected_version then raise exception 'link version mismatch (expected %, found %)', p_expected_version, v_link.version; end if;
  if v_link.status = 'ended' then return; end if;
  if v_link.status not in ('active','restricted') then raise exception 'link cannot be revoked in state (%)', v_link.status; end if;
  update public.guardian_student_links set status = 'ended', effective_to = now(), restriction_reason = coalesce(restriction_reason, btrim(p_reason)), version = v_link.version + 1 where id = p_link_id;
  perform app.record_audit('Guardian link revoked', 'guardian_student_link', v_link.reference, 'Success', btrim(p_reason));
  perform app.enqueue_outbox('security.link_revoked:' || v_link.reference || ':' || (v_link.version + 1), 'security.link_revoked', 'guardian_student_link', v_link.reference, jsonb_build_object('reason',btrim(p_reason)));
end; $$;

create or replace function app.links_capabilities_set(p_link_id uuid, p_capabilities text[], p_expected_version int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_link public.guardian_student_links%rowtype; v_cap text;
begin
  if auth.uid() is null or not (app.is_staff_aal2() and app.has_any_role(array['system_administrator'])) then raise exception 'link verification role and aal2 required'; end if;
  select * into v_link from public.guardian_student_links where id = p_link_id for update;
  if v_link.id is null then raise exception 'link not found'; end if;
  if v_link.version <> p_expected_version then raise exception 'link version mismatch (expected %, found %)', p_expected_version, v_link.version; end if;
  if v_link.status not in ('active','restricted') then raise exception 'link capabilities require an active or restricted link'; end if;
  foreach v_cap in array coalesce(p_capabilities, '{}') loop
    if v_cap not in ('academics','finance','documents','notices','profile') then raise exception 'invalid guardian capability'; end if;
  end loop;
  delete from public.guardian_link_capabilities where link_id = p_link_id;
  insert into public.guardian_link_capabilities (link_id, capability)
  select p_link_id, value from unnest(coalesce(p_capabilities, '{}')) value on conflict do nothing;
  update public.guardian_student_links set version = v_link.version + 1 where id = p_link_id;
  perform app.record_audit('Guardian link capabilities changed', 'guardian_student_link', v_link.reference, 'Success');
  perform app.enqueue_outbox('security.link_capabilities:' || v_link.reference || ':' || (v_link.version + 1), 'security.link_capabilities_changed', 'guardian_student_link', v_link.reference, jsonb_build_object('capabilities',coalesce(p_capabilities,'{}')));
end; $$;

revoke all on function app.links_restrict(uuid, text, int), app.links_revoke(uuid, text, int), app.links_capabilities_set(uuid, text[], int) from public;
grant execute on function app.links_restrict(uuid, text, int), app.links_revoke(uuid, text, int), app.links_capabilities_set(uuid, text[], int) to authenticated;

commit;
