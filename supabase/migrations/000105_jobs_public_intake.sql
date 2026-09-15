-- =============================================================================
-- 000105 — Public job application intake (no account, no documents, one photo)
--
-- Owner requirement (15 September 2026): a job applicant must not need to log
-- in. `/apply/job/[slug]` is a dedicated public, secure application surface
-- with no auth prompt, no document uploads, and one optional profile photo.
-- HR reviews the application, contacts shortlisted candidates for interview,
-- and a rejection email carries the recorded decision reason.
--
-- A public intake is the highest-risk write surface in the platform. This
-- migration therefore:
--
--   1. Makes `job_applications.owner_account_id` nullable and adds the
--      ownerless applicant contact columns (name/email/phone/location). A
--      check constraint guarantees every application still has an identity
--      anchor: an owning account or a contact email.
--   2. Makes `job_application_versions.submitted_by_account_id` nullable so an
--      anonymous submission can append its immutable first version. No
--      existing account-bound row changes: the internal draft/submit flow
--      still records the submitting account exactly as before.
--   3. Confirms `documents.uploaded_by_account_id` nullable (000016 already
--      dropped NOT NULL for generated documents) and documents the RLS
--      analysis: no policy grants anonymous read through this column, so an
--      anonymous profile-photo row stays deny-by-default. The anonymous photo
--      is private (`visibility = 'private'`) and scan-pending, so neither the
--      `anon` public-register policy nor an owner policy can ever select it.
--   4. Extends outbox email delivery tracking to accountless recipients so the
--      applicant confirmation email can be delivered and its retries
--      deduplicated: `recipient_account_id` becomes nullable and a lowercased
--      `recipient_contact` supports a partial unique index for anonymous rows.
--      Account-bound rows keep their existing unique constraint.
--   5. Adds two SECURITY DEFINER commands that only `service_role` may
--      execute: `app.jobs_public_submit_application` (validated, deduplicated
--      application creation + immutable version + event + retention + audit +
--      confirmation outbox event) and `app.jobs_public_photo_intent` (one
--      validated, scan-pending private photo document per application). The
--      Next.js server routes hold the secret key and call these through
--      `callAppRpc`; the browser never sees a service credential.
--
-- Forward-only from 000104. Never edit migrations 000001–000104. This file is
-- validated and applied by the central process; it is intentionally not
-- applied to staging by the implementing agent.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Ownerless job applications carry their own contact identity
-- ---------------------------------------------------------------------------

alter table public.job_applications
  alter column owner_account_id drop not null,
  add column if not exists applicant_email text,
  add column if not exists applicant_phone text,
  add column if not exists applicant_location text;

-- Every application keeps one identity anchor. Existing rows all have an
-- owner account, so the constraint validates against current data; only the
-- public intake inserts a row without one, and it always carries an email.
alter table public.job_applications
  drop constraint if exists job_applications_identity_check;
alter table public.job_applications
  add constraint job_applications_identity_check
  check (owner_account_id is not null or applicant_email is not null);

-- Duplicate-submission window lookup (same vacancy + email within 24 hours).
create index if not exists job_applications_public_duplicate_idx
  on public.job_applications (vacancy_id, lower(applicant_email), created_at desc)
  where owner_account_id is null;

-- ---------------------------------------------------------------------------
-- 2. Anonymous submissions append an immutable first version
-- ---------------------------------------------------------------------------

alter table public.job_application_versions
  alter column submitted_by_account_id drop not null;

comment on column public.job_application_versions.submitted_by_account_id is
  'The submitting account for account-bound applications; null for anonymous public intake, whose identity is the application''s applicant_email.';

-- ---------------------------------------------------------------------------
-- 3. Anonymous profile photos (documents) stay deny-by-default
-- ---------------------------------------------------------------------------
-- `uploaded_by_account_id` is already nullable (000016) for generated
-- documents; restated here so the anonymous profile photo path is explicit.
-- RLS analysis: `public.documents` policies gate on `owner_domain` plus the
-- owning admission/job application row, on `app.document_staff_allowed`, or on
-- `visibility = 'public_approved' and scan_status = 'clean'` for anon. No
-- policy reads `uploaded_by_account_id`, and a null value makes the
-- `uploaderMatches` check in `/api/documents/[ref]/finalize` fail closed, so a
-- null uploader can never widen access. The anonymous photo row is private
-- and pending, so it is not selectable by anon or by any owner policy.

alter table public.documents
  alter column uploaded_by_account_id drop not null;

comment on column public.documents.uploaded_by_account_id is
  'Uploading account when a signed-in actor uploads; null for generated documents and anonymous public job-application profile photos. Never used for read authorization.';

-- ---------------------------------------------------------------------------
-- 4. Accountless outbox email delivery tracking
-- ---------------------------------------------------------------------------
-- The applicant confirmation email resolves from `job_applications.applicant_email`
-- with no account row. Delivery rows must still be recordable and retries must
-- not duplicate the send, so anonymous rows are keyed by their contact address
-- through a partial unique index. Account-bound rows keep the original unique
-- constraint unchanged.

alter table public.notification_deliveries
  alter column recipient_account_id drop not null,
  add column if not exists recipient_contact text;

create unique index if not exists notification_deliveries_contact_key
  on public.notification_deliveries (event_id, channel, template_version, recipient_contact)
  where recipient_account_id is null;

comment on column public.notification_deliveries.recipient_contact is
  'Lowercased email address for accountless recipients (for example a public job applicant). Null for account-bound deliveries.';

-- ---------------------------------------------------------------------------
-- 5. Public application submission (service role only)
-- ---------------------------------------------------------------------------
-- Validates and normalizes the browser payload, requires a published open
-- vacancy at the requesting version, rejects the same vacancy+email inside a
-- 24-hour window (serialized by an advisory lock so concurrent double-submits
-- cannot both pass), creates the application, its immutable first version,
-- the applicant-visible event, the retention record, audit evidence, and the
-- confirmation outbox event the worker already handles (`email.job_submitted`).

create or replace function app.jobs_public_submit_application(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vacancy public.job_vacancies%rowtype;
  v_version public.job_vacancy_versions%rowtype;
  v_app public.job_applications%rowtype;
  v_email text;
  v_name text;
  v_phone text;
  v_location text;
  v_snapshot jsonb;
  v_retention_days int;
  v_existing_ref text;
begin
  -- Service-role only: the route owns same-origin checks, rate limiting,
  -- honeypot rejection, and schema validation; no anon/authenticated grant
  -- exists on this function.
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'public job intake requires the service boundary';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_payload: application payload is required';
  end if;

  if jsonb_typeof(p_payload -> 'consent') <> 'boolean' or (p_payload ->> 'consent') <> 'true' then
    raise exception 'invalid_payload: the declaration must be accepted';
  end if;

  if nullif(btrim(coalesce(p_payload ->> 'vacancyRef', '')), '') is null then
    raise exception 'invalid_payload: vacancy reference is required';
  end if;
  if coalesce(p_payload ->> 'vacancyVersion', '') !~ '^[0-9]{1,6}$' then
    raise exception 'invalid_payload: vacancy version is required';
  end if;

  v_name := left(btrim(coalesce(p_payload ->> 'fullName', '')), 121);
  if length(v_name) < 2 then
    raise exception 'invalid_payload: full name is required';
  end if;
  if length(v_name) > 120 then
    raise exception 'invalid_payload: full name is too long';
  end if;

  v_email := lower(btrim(coalesce(p_payload ->> 'email', '')));
  if length(v_email) < 5 or length(v_email) > 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid_payload: a valid email address is required';
  end if;

  v_phone := nullif(btrim(coalesce(p_payload ->> 'phone', '')), '');
  if v_phone is not null and (length(v_phone) > 24 or v_phone !~ '^[0-9+()\-[:space:]]+$') then
    raise exception 'invalid_payload: the phone number is not accepted';
  end if;

  v_location := nullif(btrim(coalesce(p_payload ->> 'location', '')), '');
  if v_location is not null and length(v_location) > 160 then
    raise exception 'invalid_payload: the location is too long';
  end if;

  -- Serialize the duplicate window per vacancy+email.
  perform pg_advisory_xact_lock(hashtextextended(v_email || ':' || (p_payload ->> 'vacancyRef'), 0));

  select * into v_vacancy
    from public.job_vacancies
   where reference = p_payload ->> 'vacancyRef'
   for update;
  if v_vacancy.id is null then
    raise exception 'vacancy_not_found: this vacancy is not available';
  end if;
  if v_vacancy.current_status <> 'published' then
    raise exception 'vacancy_not_open: this vacancy is not open for applications';
  end if;

  select * into v_version
    from public.job_vacancy_versions
   where vacancy_id = v_vacancy.id
   order by version desc
   limit 1;
  if v_version.id is null or v_version.version <> (p_payload ->> 'vacancyVersion')::int then
    raise exception 'vacancy_version_mismatch: refresh the vacancy page and try again';
  end if;
  if (v_version.terms ->> 'deadlineIso') is not null
     and now() > (v_version.terms ->> 'deadlineIso')::timestamptz then
    raise exception 'deadline_passed: the application deadline has passed';
  end if;

  select reference into v_existing_ref
    from public.job_applications
   where vacancy_id = v_vacancy.id
     and owner_account_id is null
     and lower(applicant_email) = v_email
     and created_at > now() - interval '24 hours'
   order by created_at desc
   limit 1;
  if v_existing_ref is not null then
    raise exception 'duplicate_application: an application for this vacancy was already received from this email address';
  end if;

  v_snapshot := jsonb_build_object(
    'fullName', v_name,
    'email', v_email,
    'phone', v_phone,
    'location', v_location,
    'qualification', nullif(left(btrim(coalesce(p_payload ->> 'qualification', '')), 121), ''),
    'subject', nullif(left(btrim(coalesce(p_payload ->> 'subject', '')), 121), ''),
    'year', nullif(left(btrim(coalesce(p_payload ->> 'year', '')), 11), ''),
    'institution', nullif(left(btrim(coalesce(p_payload ->> 'institution', '')), 161), ''),
    'experience', nullif(left(btrim(coalesce(p_payload ->> 'experience', '')), 61), ''),
    'currentRole', nullif(left(btrim(coalesce(p_payload ->> 'currentRole', '')), 121), ''),
    'message', nullif(left(btrim(coalesce(p_payload ->> 'message', '')), 2001), ''),
    'consent', true,
    'vacancyRef', v_vacancy.reference,
    'vacancyVersion', v_version.version,
    'source', 'public_intake'
  );

  insert into public.job_applications
    (vacancy_id, vacancy_version, owner_account_id, applicant_name,
     applicant_email, applicant_phone, applicant_location,
     current_status, version)
  values
    (v_vacancy.id, v_version.version, null, v_name,
     v_email, v_phone, v_location,
     'submitted', 1)
  returning * into v_app;

  insert into public.job_application_versions
    (application_id, version, snapshot, submitted_by_account_id)
  values (v_app.id, 1, v_snapshot, null);

  insert into public.job_events (application_id, event_type, visible_to_applicant, copy)
  values (v_app.id, 'submitted', true, 'Application submitted');

  v_retention_days := greatest(1, coalesce((v_version.terms ->> 'retentionDays')::int, 365));
  insert into public.job_retention_records (application_id, eligible_at, status, reason)
  values (v_app.id, now() + make_interval(days => v_retention_days), 'retained', 'Vacancy retention policy')
  on conflict (application_id) do update
    set eligible_at = excluded.eligible_at, status = 'retained', reason = excluded.reason, updated_at = now();

  perform app.record_audit(
    'Job application submitted', 'job_application', v_app.reference, 'Success',
    'Public intake · no account', 'Careers public intake');

  perform app.enqueue_outbox(
    'email.job_submitted:' || v_app.reference, 'email.deliver',
    'job_application', v_app.reference, jsonb_build_object('channel', 'email'));

  return jsonb_build_object(
    'applicationId', v_app.id,
    'reference', v_app.reference,
    'status', v_app.current_status,
    'version', v_app.version);
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Public profile photo intent (service role only, one photo, scan pending)
-- ---------------------------------------------------------------------------
-- Creates the private document metadata row for an anonymous applicant photo.
-- The route validates the declared MIME/size first, creates a signed upload
-- URL for this opaque key, and the finalize route re-reads the stored bytes and
-- calls the existing `documents_finalize_upload` / `documents_link_attachment`
-- boundary (both already service-role gated). JPEG/PNG/WebP only, 2 MiB cap.

create or replace function app.jobs_public_photo_intent(
  p_application_reference text,
  p_safe_filename text,
  p_declared_mime_type text,
  p_declared_size bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.job_applications%rowtype;
  v_key text;
  v_ext text;
  v_id uuid;
  v_ref text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'public job intake requires the service boundary';
  end if;

  if p_declared_mime_type not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception 'photo_not_allowed: only JPEG, PNG, or WebP images are accepted';
  end if;
  if p_declared_size is null or p_declared_size <= 0 or p_declared_size > 2097152 then
    raise exception 'photo_not_allowed: the photo must be 2 MB or smaller';
  end if;

  v_ext := case p_declared_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    else 'webp'
  end;

  select * into v_app
    from public.job_applications
   where reference = btrim(coalesce(p_application_reference, ''))
   for update;
  if v_app.id is null then
    raise exception 'application_not_found: this application reference is not available';
  end if;
  if v_app.current_status not in ('submitted', 'eligibility_review', 'shortlisted', 'interview') then
    raise exception 'photo_not_allowed: a photo cannot be added at this stage';
  end if;
  if exists (
    select 1 from public.documents d
     where d.owner_domain = 'job_application'
       and d.owner_record_id = v_app.id
       and d.category = 'profile_photo'
       and d.checksum_verified
       and d.deleted_at is null
  ) then
    raise exception 'photo_already_attached: a profile photo is already attached to this application';
  end if;

  v_key := 'uploads/' || gen_random_uuid()::text || '.' || v_ext;

  insert into public.documents
    (owner_domain, owner_record_id, category, object_key, safe_filename,
     mime_type, size_bytes, scan_status, visibility,
     uploaded_by_account_id, declared_mime_type, allowed_mime_types, max_bytes,
     attachment_code)
  values
    ('job_application', v_app.id, 'profile_photo', v_key,
     left(regexp_replace(coalesce(nullif(btrim(p_safe_filename), ''), 'profile-photo'), '[^a-zA-Z0-9._-]+', '-', 'g'), 120),
     p_declared_mime_type, p_declared_size, 'pending_scan', 'private',
     null, p_declared_mime_type, array['image/jpeg','image/png','image/webp'], 2097152,
     'profile_photo')
  returning id, reference into v_id, v_ref;

  insert into public.document_processing_events (document_id, event_type, detail)
  values (v_id, 'upload_intent_created', 'job_application:profile_photo');

  return jsonb_build_object(
    'applicationId', v_app.id,
    'applicationReference', v_app.reference,
    'documentId', v_id,
    'documentRef', v_ref,
    'objectKey', v_key,
    'status', 'pending_scan');
end
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants: service boundary only
-- ---------------------------------------------------------------------------

revoke all on function app.jobs_public_submit_application(jsonb) from public, anon, authenticated;
revoke all on function app.jobs_public_photo_intent(text, text, text, bigint) from public, anon, authenticated;
grant execute on function app.jobs_public_submit_application(jsonb) to service_role;
grant execute on function app.jobs_public_photo_intent(text, text, text, bigint) to service_role;

commit;
