-- 000087 — Security authorization repairs (suspended accounts, public intake,
-- idempotency exposure, public admission configuration).
--
-- Findings (read-only security audit, 11 September 2026):
--   1. Guardian scope helpers ignored the account status, so a suspended
--      guardian kept database read access with a still-valid JWT.
--   2. `app.support_public_intake_v2` was executable by anon/authenticated
--      with self-asserted CAPTCHA fields, bypassing the server route.
--   3. `public.admission_idempotency_records` was readable/writable by any
--      authenticated session; only the SECURITY DEFINER commands need it.
--   4. `app.admission_public_configuration` returned non-public admission
--      window states and the latest (possibly draft) settings policy version.
--
-- This migration is additive and forward-only; it never edits earlier files.

begin;

-- ---------------------------------------------------------------------------
-- 1. Suspended accounts lose guardian scope at the database layer
-- ---------------------------------------------------------------------------

create or replace function app.is_guardian()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.guardians g
      join public.user_accounts ua on ua.person_id = g.person_id
     where ua.id = auth.uid()
       and ua.status = 'active'
       and g.status = 'active'
  )
$$;

create or replace function app.guardian_has_capability(p_student_id uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.guardian_student_links l
      join public.guardians g on g.id = l.guardian_id
      join public.user_accounts ua on ua.person_id = g.person_id
      join public.guardian_link_capabilities c on c.link_id = l.id
     where ua.id = auth.uid()
       and ua.status = 'active'
       and l.student_id = p_student_id
       and l.status = 'active'
       and (l.effective_from is null or l.effective_from <= now())
       and (l.effective_to is null or l.effective_to > now())
       and c.capability = p_capability
  )
$$;

-- ---------------------------------------------------------------------------
-- 2. Public support intake is a service-role-only command
-- ---------------------------------------------------------------------------

revoke all on function app.support_public_intake_v2(text, text, text, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function app.support_public_intake_v2(text, text, text, text, text, text, text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Admission idempotency records are internal to the commands
-- ---------------------------------------------------------------------------

drop policy if exists admission_idempotency_owner_insert on public.admission_idempotency_records;
drop policy if exists admission_idempotency_owner_read on public.admission_idempotency_records;
revoke all on public.admission_idempotency_records from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Public admission configuration only exposes public states
-- ---------------------------------------------------------------------------

create or replace function app.admission_public_configuration(
  p_academic_year_id uuid default null
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'academicYears', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ay.id, 'ref', ay.reference, 'label', ay.label,
        'startsOn', ay.starts_on, 'endsOn', ay.ends_on, 'status', ay.status
      ) order by ay.starts_on desc)
      from public.academic_years ay
      where p_academic_year_id is null or ay.id = p_academic_year_id
    ), '[]'::jsonb),
    'grades', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'ref', g.code, 'code', g.code, 'label', g.label, 'sortOrder', g.sort_order
      ) order by g.sort_order, g.code)
      from public.grades g
    ), '[]'::jsonb),
    'windows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', aw.id, 'ref', aw.reference, 'academicYearId', aw.academic_year_id,
        'gradeId', aw.grade_id, 'opensAt', aw.opens_at, 'closesAt', aw.closes_at,
        'capacity', aw.capacity, 'status', aw.status, 'version', aw.version,
        'policy', aw.policy, 'eligibilityPolicy', aw.eligibility_policy
      ) order by aw.opens_at, aw.id)
      from public.admission_windows aw
      where (p_academic_year_id is null or aw.academic_year_id = p_academic_year_id)
        and aw.status in ('planned', 'open')
    ), '[]'::jsonb),
    'documentRequirements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', dr.id, 'ref', dr.reference, 'windowId', dr.admission_window_id,
        'code', dr.code, 'label', dr.label, 'required', dr.required,
        'allowedMimeTypes', dr.allowed_mime_types, 'maxBytes', dr.max_bytes,
        'status', dr.status, 'version', dr.version
      ) order by dr.admission_window_id, dr.version, dr.code)
      from public.admission_document_requirements dr
      join public.admission_windows aw on aw.id = dr.admission_window_id
      where dr.status = 'active'
        and aw.status in ('planned', 'open')
        and (p_academic_year_id is null or aw.academic_year_id = p_academic_year_id)
    ), '[]'::jsonb),
    'policy', coalesce((
      select jsonb_build_object('version', sv.version, 'status', sv.status, 'values', sv.policy)
      from public.settings_versions sv
      where sv.status = 'effective'
      order by sv.version desc
      limit 1
    ), 'null'::jsonb)
  )
$$;

revoke all on function app.admission_public_configuration(uuid) from public;
grant execute on function app.admission_public_configuration(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Public download register is a projection, not a table grant
-- ---------------------------------------------------------------------------

create or replace function app.documents_public_register()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(d) order by d.finalized_at desc, d.created_at desc), '[]'::jsonb)
  from (
    select d.reference, d.safe_filename, d.category, d.mime_type, d.size_bytes,
           d.created_at, d.finalized_at, d.retention_until, d.legal_hold_until
      from public.documents d
     where d.visibility = 'public_approved'
       and d.scan_status in ('clean', 'ready')
       and d.deleted_at is null
       and d.finalized_at is not null
  ) d
$$;

revoke all on function app.documents_public_register() from public;
grant execute on function app.documents_public_register() to anon, authenticated, service_role;

-- The register is the anonymous read path; column-level grants on the table
-- exposed storage keys and internal ids through raw PostgREST selects.
revoke select on public.documents from anon;

commit;
