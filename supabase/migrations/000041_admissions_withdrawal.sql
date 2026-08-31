-- =============================================================================
-- 000041 — Applicant withdrawal with version checking and idempotency
--
-- Adds a version-checked, idempotent withdrawal command so an applicant can
-- withdraw a non-terminal application through the adapter. The application
-- status moves to 'withdrawn', a visible timeline event is appended, and one
-- audit + one outbox event are written in the same transaction.
-- =============================================================================

begin;

create or replace function app.admissions_withdraw(
  p_application_id uuid,
  p_expected_version int default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.admission_applications%rowtype;
  v_next int;
  v_hash text;
  v_cached jsonb;
begin
  if auth.uid() is null then
    raise exception 'authenticated actor required';
  end if;
  v_hash := p_application_id::text || '|' || coalesce(p_expected_version::text, '') || '|' || coalesce(btrim(p_idempotency_key), '');

  -- Idempotent replay: return the existing result if the same key was used.
  if p_idempotency_key is not null then
    select result from public.admission_idempotency_records
      where idempotency_key = btrim(p_idempotency_key)
      limit 1
      into v_cached;
    if v_cached is not null then
      if (v_cached ->> 'request_hash') = v_hash then
        return v_cached - 'request_hash';
      end if;
      raise exception 'idempotency key was already used for another withdrawal';
    end if;
  end if;

  select * into v_app from public.admission_applications
    where id = p_application_id and owner_account_id = auth.uid()
    for update;

  if v_app.id is null then
    raise exception 'application not found or not owned by this account';
  end if;

  if v_app.current_status in ('offered', 'waitlisted', 'declined', 'enrolled', 'withdrawn') then
    raise exception 'application in state (%) cannot be withdrawn', v_app.current_status;
  end if;

  if p_expected_version is not null and v_app.version <> p_expected_version then
    raise exception 'application version mismatch (expected %, found %)', p_expected_version, v_app.version;
  end if;

  v_next := v_app.version + 1;

  update public.admission_applications
     set current_status = 'withdrawn', version = v_next
   where id = p_application_id;

  insert into public.admission_events (application_id, event_type, visible_to_applicant, copy)
  values (p_application_id, 'withdrawn', true, 'Application withdrawn by the applicant');

  perform app.record_audit('Admission application withdrawn', 'admission_application', v_app.reference, 'Success');

  perform app.enqueue_outbox(
    'email.application_withdrawn:' || v_app.reference || ':v' || v_next::text,
    'email.deliver', 'admission_application', v_app.reference,
    jsonb_build_object('channel', 'email')
  );

  declare
    v_result jsonb;
  begin
    v_result := jsonb_build_object(
      'id', v_app.id,
      'reference', v_app.reference,
      'status', 'withdrawn',
      'version', v_next,
      'replayed', false
    );

    if p_idempotency_key is not null then
      insert into public.admission_idempotency_records (idempotency_key, request_hash, result)
      values (btrim(p_idempotency_key), v_hash, v_result || jsonb_build_object('request_hash', v_hash))
      on conflict (idempotency_key) do nothing;
    end if;

    return v_result;
  end;
end;
$$;

revoke all on function app.admissions_withdraw(uuid, int, text) from public, anon;
grant execute on function app.admissions_withdraw(uuid, int, text) to authenticated;

-- Idempotency records for admission commands (used by withdrawal and future V2 commands).
create table if not exists public.admission_idempotency_records (
  id              uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  request_hash    text not null,
  result          jsonb not null,
  created_at      timestamptz not null default now()
);

alter table public.admission_idempotency_records enable row level security;
revoke all on public.admission_idempotency_records from anon, authenticated;
grant select, insert on public.admission_idempotency_records to authenticated;
create policy admission_idempotency_owner_insert on public.admission_idempotency_records
  for insert to authenticated with check (true);
create policy admission_idempotency_owner_read on public.admission_idempotency_records
  for select to authenticated using (true);

commit;
