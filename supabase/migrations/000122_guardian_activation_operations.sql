begin;

create or replace function app.guardians_admin_list()
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'guardianId', g.id,
    'personId', g.person_id,
    'displayName', p.display_name,
    'givenName', p.given_name,
    'familyName', p.family_name,
    'status', g.status,
    'contacts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'contactId', gc.id,
        'channel', gc.channel,
        'value', gc.value,
        'state', gc.state,
        'verifiedAt', gc.verified_at
      ) order by gc.created_at)
      from public.guardian_contacts gc
      where gc.guardian_id = g.id
    ), '[]'::jsonb),
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
        'studentId', s.id,
        'displayName', sp.display_name,
        'classLabel', coalesce((
          select gr.label || '-' || gs.section_label
          from public.enrollments e
          join public.grade_sections gs on gs.id = e.grade_section_id
          join public.grades gr on gr.id = gs.grade_id
          where e.student_id = s.id and e.status = 'active'
          order by e.effective_from desc
          limit 1
        ), 'No active class'),
        'linkId', gsl.id,
        'linkStatus', gsl.status
      ) order by sp.display_name)
      from public.guardian_student_links gsl
      join public.students s on s.id = gsl.student_id
      join public.people sp on sp.id = s.person_id
      where gsl.guardian_id = g.id
    ), '[]'::jsonb),
    'account', case when ua.id is null then null else jsonb_build_object(
      'accountId', ua.id,
      'status', ua.status,
      'lastSignInAt', null
    ) end,
    'claim', case when claim.id is null then null else jsonb_build_object(
      'claimId', claim.id,
      'reference', claim.reference,
      'status', claim.status,
      'channel', claim.channel,
      'contactValue', claim.contact_value,
      'expiresAt', claim.expires_at,
      'dispatchedAt', claim.dispatched_at,
      'claimedAt', claim.claimed_at,
      'lastDeliveryState', claim.delivery_state,
      'lastDeliveryError', claim.delivery_error
    ) end
  )
  from public.guardians g
  join public.people p on p.id = g.person_id
  left join lateral (
    select account.id, account.status
    from public.user_accounts account
    where account.person_id = g.person_id
    order by account.created_at desc
    limit 1
  ) ua on true
  left join lateral (
    select invitation.id, invitation.reference, invitation.status, invitation.channel,
           contact.value as contact_value, invitation.expires_at, invitation.claimed_at,
           delivery.last_attempt_at as dispatched_at, delivery.state as delivery_state,
           delivery.last_error as delivery_error
    from public.guardian_claim_invitations invitation
    join public.guardian_contacts contact on contact.id = invitation.guardian_contact_id
    left join lateral (
      select d.state, d.last_attempt_at, d.last_error
      from public.guardian_claim_deliveries d
      where d.claim_id = invitation.id
      order by d.created_at desc
      limit 1
    ) delivery on true
    where invitation.guardian_id = g.id
    order by invitation.created_at desc
    limit 1
  ) claim on true
  where app.is_staff_aal2() and app.has_role('system_administrator')
  order by p.display_name, g.id
$$;

create or replace function app.guardian_contact_record(
  p_guardian_id uuid,
  p_channel text,
  p_value text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guardian public.guardians%rowtype;
  v_contact public.guardian_contacts%rowtype;
  v_value text := app.normalize_identity_contact(p_value);
  v_shared boolean;
begin
  if not (app.is_staff_aal2() and app.has_role('system_administrator')) then
    raise exception 'guardian contact recording requires system_administrator and aal2';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a contact reason is required';
  end if;
  if p_channel = 'sms' then
    raise exception 'sms contacts are recorded through imports until a provider is registered';
  end if;
  if p_channel <> 'email' then
    raise exception 'guardian contact channel must be email';
  end if;
  if v_value = '' or position('@' in v_value) = 0 then
    raise exception 'a valid guardian email is required';
  end if;

  select * into v_guardian
  from public.guardians
  where id = p_guardian_id
  for update;
  if v_guardian.id is null or v_guardian.status <> 'active' then
    raise exception 'the guardian record is not active';
  end if;

  select exists (
    select 1
    from public.guardian_contacts other
    where other.guardian_id <> p_guardian_id
      and other.channel = 'email'
      and app.normalize_identity_contact(other.value) = v_value
      and other.state <> 'revoked'
  ) into v_shared;

  insert into public.guardian_contacts
    (guardian_id, channel, value, state, shared_contact_flag)
  values
    (p_guardian_id, 'email', v_value, 'recorded', v_shared)
  on conflict (guardian_id, channel, value) do update
    set state = case
          when public.guardian_contacts.state = 'revoked' then 'recorded'
          else public.guardian_contacts.state
        end,
        shared_contact_flag = v_shared,
        version = case
          when public.guardian_contacts.state = 'revoked' then public.guardian_contacts.version + 1
          else public.guardian_contacts.version
        end
  returning * into v_contact;

  perform app.record_audit('Guardian contact recorded', 'guardian', v_guardian.reference,
                           'Success', btrim(p_reason), 'System administrator');

  return jsonb_build_object(
    'contactId', v_contact.id,
    'channel', v_contact.channel,
    'value', v_contact.value,
    'state', v_contact.state,
    'sharedContactFlag', v_contact.shared_contact_flag
  );
end;
$$;

create or replace function app.guardian_claim_preview(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_claim public.guardian_claim_invitations%rowtype;
  v_guardian public.guardians%rowtype;
  v_person public.people%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  if p_token is null or btrim(p_token) = '' then
    return jsonb_build_object('valid', false, 'reason', 'token is required');
  end if;

  v_hash := app.hash_invitation_secret(p_token);
  select * into v_claim
  from public.guardian_claim_invitations
  where token_hash = v_hash
  limit 1;

  if v_claim.id is null or v_claim.provider_subject is null or v_claim.provider_subject <> auth.uid() then
    return jsonb_build_object('valid', false, 'reason', 'claim not found');
  end if;
  if v_claim.status = 'claimed' then
    return jsonb_build_object('valid', false, 'reason', 'claim has already been used');
  end if;
  if v_claim.status = 'revoked' then
    return jsonb_build_object('valid', false, 'reason', 'claim has been revoked');
  end if;
  if v_claim.status not in ('pending', 'dispatched') then
    return jsonb_build_object('valid', false, 'reason', 'claim is not claimable');
  end if;
  if v_claim.expires_at <= now() then
    update public.guardian_claim_invitations set status = 'expired' where id = v_claim.id;
    return jsonb_build_object('valid', false, 'reason', 'claim has expired');
  end if;

  select * into v_guardian from public.guardians where id = v_claim.guardian_id;
  select * into v_person from public.people where id = v_guardian.person_id;

  return jsonb_build_object(
    'valid', true,
    'claimReference', v_claim.reference,
    'givenName', v_person.given_name,
    'familyName', v_person.family_name,
    'guardianDisplayName', v_person.display_name,
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
        'displayName', student_person.display_name,
        'classLabel', coalesce((
          select grade.label || '-' || section.section_label
          from public.enrollments enrollment
          join public.grade_sections section on section.id = enrollment.grade_section_id
          join public.grades grade on grade.id = section.grade_id
          where enrollment.student_id = student.id and enrollment.status = 'active'
          order by enrollment.effective_from desc
          limit 1
        ), 'No active class')
      ) order by student_person.display_name)
      from public.guardian_claim_links claim_link
      join public.guardian_student_links guardian_link on guardian_link.id = claim_link.link_id
      join public.students student on student.id = guardian_link.student_id
      join public.people student_person on student_person.id = student.person_id
      where claim_link.claim_id = v_claim.id
    ), '[]'::jsonb),
    'expiresAt', v_claim.expires_at
  );
end;
$$;

revoke all on function app.guardians_admin_list() from public, anon;
revoke all on function app.guardian_contact_record(uuid, text, text, text) from public, anon;
revoke all on function app.guardian_claim_preview(text) from public, anon;
grant execute on function app.guardians_admin_list() to authenticated;
grant execute on function app.guardian_contact_record(uuid, text, text, text) to authenticated;
grant execute on function app.guardian_claim_preview(text) to authenticated;

commit;
