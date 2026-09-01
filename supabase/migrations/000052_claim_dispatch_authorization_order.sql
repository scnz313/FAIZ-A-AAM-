-- =============================================================================
-- 000052 — Claim dispatch authorization order fix
--
-- app.guardian_claim_mark_dispatched checked auth.uid() before recognizing
-- the service worker, so the provider worker (no user context) was rejected
-- with 'authenticated actor required'. Reorder: service role passes first.
-- =============================================================================

begin;

create or replace function app.guardian_claim_mark_dispatched(
  p_claim_reference text,
  p_provider_subject uuid,
  p_provider_ref text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_claim public.guardian_claim_invitations%rowtype;
begin
  /* New-style sb_secret_ keys are opaque (not JWTs), so the service worker
     is recognized by session_user as well as the legacy JWT role claim. */
  if session_user <> 'service_role' and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    if auth.uid() is null then
      raise exception 'authenticated actor required';
    end if;
    if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
      raise exception 'claim dispatch requires the service worker or the administrator';
    end if;
  end if;
  select * into v_claim from public.guardian_claim_invitations
   where reference = p_claim_reference for update;
  if v_claim.id is null then raise exception 'guardian claim not found'; end if;
  if v_claim.status not in ('pending', 'dispatched') then
    raise exception 'guardian claim is not dispatchable (state: %)', v_claim.status;
  end if;
  update public.guardian_claim_invitations
     set status = 'dispatched', provider_subject = p_provider_subject
   where id = v_claim.id;
  insert into public.guardian_claim_deliveries (claim_id, channel, state, attempts, last_attempt_at)
  values (v_claim.id, v_claim.channel, 'sent', 1, now());
  perform app.record_audit('Guardian claim dispatched', 'guardian_claim_invitation', v_claim.reference, 'Success');
  return jsonb_build_object('claimRef', v_claim.reference, 'status', 'dispatched',
                            'providerRef', p_provider_ref);
end;
$$;

revoke all on function app.guardian_claim_mark_dispatched(text, uuid, text) from public, anon;
grant execute on function app.guardian_claim_mark_dispatched(text, uuid, text) to authenticated, service_role;

commit;
