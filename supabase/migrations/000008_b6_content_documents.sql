-- =============================================================================
-- B6 — Content, notices, and documents (plan.md §6 modules, §11 B6)
--
-- Only published, active, public-audience content receives anonymous SELECT.
-- Drafts, scheduled items, recipient definitions, and protected attachments
-- stay private. Documents are never placed in /public; object keys are
-- domain + opaque ids; uploads stay quarantined until scan reports ready.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Content
-- ---------------------------------------------------------------------------
create table public.content_items (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('CTN'),
  kind              text not null default 'page'
                    check (kind in ('page', 'notice', 'download')),
  slug              text not null unique,
  current_status    text not null default 'draft'
                    check (current_status in ('draft', 'scheduled', 'published', 'expired', 'archived')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index content_items_status_idx on public.content_items (kind, current_status);
create trigger content_items_touch before update on public.content_items
  for each row execute function app.touch_updated_at();

create table public.content_versions (
  id                uuid primary key default gen_random_uuid(),
  content_item_id   uuid not null references public.content_items(id) on delete cascade,
  version           int not null,
  title             text not null,
  body              jsonb not null default '{}'::jsonb,
  author_account_id uuid not null references public.user_accounts(id) on delete restrict,
  review_status     text not null default 'draft'
                    check (review_status in ('draft', 'in_review', 'approved', 'published')),
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  unique (content_item_id, version)
);

create trigger content_versions_no_update
  before update on public.content_versions
  for each row execute function app.block_mutation();
create trigger content_versions_no_delete
  before delete on public.content_versions
  for each row execute function app.block_mutation();

create table public.notices (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('NTC'),
  content_item_id   uuid not null unique references public.content_items(id) on delete cascade,
  category          text not null default 'General',
  urgent            boolean not null default false,
  status            text not null default 'draft'
                    check (status in ('draft', 'scheduled', 'published', 'expired')),
  published_at      timestamptz,
  expires_at        timestamptz,
  review_due        date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index notices_status_idx on public.notices (status, published_at);
create trigger notices_touch before update on public.notices
  for each row execute function app.touch_updated_at();

create table public.notice_audiences (
  id                uuid primary key default gen_random_uuid(),
  notice_id         uuid not null references public.notices(id) on delete cascade,
  audience          text not null
                    check (audience in ('public', 'role', 'application', 'academic_year',
                                        'grade_section', 'student')),
  role_code         text references public.role_definitions(code) on delete restrict,
  academic_year_id  uuid references public.academic_years(id) on delete restrict,
  grade_section_id  uuid references public.grade_sections(id) on delete restrict,
  student_id        uuid references public.students(id) on delete restrict,
  unique (notice_id, audience, role_code, academic_year_id, grade_section_id, student_id)
);

-- ---------------------------------------------------------------------------
-- Documents (storage metadata; objects live in private buckets)
-- ---------------------------------------------------------------------------
create table public.documents (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('DOC'),
  owner_domain      text not null,
  owner_record_id   uuid not null,
  category          text not null,
  object_key        text not null unique,       -- domain + opaque ids + random filename
  safe_filename     text not null,
  mime_type         text not null,
  size_bytes        bigint not null check (size_bytes >= 0),
  checksum          text,
  scan_status       text not null default 'pending_scan'
                    check (scan_status in ('pending_scan', 'clean', 'quarantined', 'failed')),
  visibility        text not null default 'private'
                    check (visibility in ('private', 'public_approved')),
  version           int not null default 1,
  retention_class   text not null default 'standard',
  uploaded_by_account_id uuid not null references public.user_accounts(id) on delete restrict,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index documents_owner_idx on public.documents (owner_domain, owner_record_id);
create trigger documents_touch before update on public.documents
  for each row execute function app.touch_updated_at();

create table public.content_documents (
  id                uuid primary key default gen_random_uuid(),
  content_item_id   uuid not null references public.content_items(id) on delete cascade,
  document_id       uuid not null references public.documents(id) on delete restrict,
  unique (content_item_id, document_id)
);

-- ---------------------------------------------------------------------------
-- Support, notifications, and email operations (plan.md §6)
-- ---------------------------------------------------------------------------
create table public.support_requests (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('SR'),
  requester_account_id uuid not null references public.user_accounts(id) on delete restrict,
  category          text not null,
  subject           text not null,
  status            text not null default 'open'
                    check (status in ('open', 'assigned', 'in_progress', 'resolved', 'closed')),
  priority          text not null default 'normal'
                    check (priority in ('low', 'normal', 'high', 'urgent')),
  assignee_account_id uuid references public.user_accounts(id) on delete restrict,
  sla_due_at        timestamptz,
  resolved_at       timestamptz,
  version           int not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index support_requests_status_idx on public.support_requests (status, updated_at desc);
create index support_requests_requester_idx on public.support_requests (requester_account_id);
create trigger support_requests_touch before update on public.support_requests
  for each row execute function app.touch_updated_at();

create table public.support_messages (
  id                uuid primary key default gen_random_uuid(),
  support_request_id uuid not null references public.support_requests(id) on delete cascade,
  author_account_id uuid not null references public.user_accounts(id) on delete restrict,
  body              text not null check (length(trim(body)) > 0),
  is_staff          boolean not null default false,
  created_at        timestamptz not null default now()
);

create index support_messages_request_idx on public.support_messages (support_request_id, created_at);
create trigger support_messages_no_update
  before update on public.support_messages
  for each row execute function app.block_mutation();
create trigger support_messages_no_delete
  before delete on public.support_messages
  for each row execute function app.block_mutation();

create table public.support_private_notes (
  id                uuid primary key default gen_random_uuid(),
  support_request_id uuid not null references public.support_requests(id) on delete cascade,
  author_account_id uuid not null references public.user_accounts(id) on delete restrict,
  body              text not null check (length(trim(body)) > 0),
  created_at        timestamptz not null default now()
);

create index support_notes_request_idx on public.support_private_notes (support_request_id, created_at);
create trigger support_notes_no_update
  before update on public.support_private_notes
  for each row execute function app.block_mutation();
create trigger support_notes_no_delete
  before delete on public.support_private_notes
  for each row execute function app.block_mutation();

create table public.support_events (
  id                uuid primary key default gen_random_uuid(),
  support_request_id uuid not null references public.support_requests(id) on delete cascade,
  event_type        text not null,
  detail            text,
  actor_account_id  uuid references public.user_accounts(id) on delete restrict,
  created_at        timestamptz not null default now()
);

create index support_events_request_idx on public.support_events (support_request_id, created_at desc);
create trigger support_events_no_update
  before update on public.support_events
  for each row execute function app.block_mutation();
create trigger support_events_no_delete
  before delete on public.support_events
  for each row execute function app.block_mutation();

create table public.in_app_notifications (
  id                uuid primary key default gen_random_uuid(),
  recipient_account_id uuid not null references public.user_accounts(id) on delete cascade,
  kind              text not null,
  title             text not null,
  body              text,
  target_type       text,
  target_reference  text,
  read_at           timestamptz,
  created_at        timestamptz not null default now()
);

create index notifications_recipient_idx
  on public.in_app_notifications (recipient_account_id, read_at nulls first, created_at desc);
create trigger notifications_touch before update on public.in_app_notifications
  for each row execute function app.touch_updated_at();

create table public.notification_deliveries (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references public.outbox_events(id) on delete cascade,
  recipient_account_id uuid not null references public.user_accounts(id) on delete restrict,
  channel           text not null check (channel in ('email', 'push', 'sms')),
  template_version  text not null,
  provider_message_id text,
  status            text not null default 'pending'
                    check (status in ('pending', 'sent', 'delivered', 'bounced', 'complained', 'failed')),
  attempts          int not null default 0,
  last_error        text,
  next_attempt_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (event_id, recipient_account_id, channel, template_version)
);

create index deliveries_status_idx on public.notification_deliveries (status, next_attempt_at);
create trigger deliveries_touch before update on public.notification_deliveries
  for each row execute function app.touch_updated_at();

create table public.email_suppressions (
  id                uuid primary key default gen_random_uuid(),
  email_hash        text not null unique,
  reason            text not null check (reason in ('hard_bounce', 'complaint', 'manual')),
  suppressed_at     timestamptz not null default now(),
  created_by_account_id uuid not null references public.user_accounts(id) on delete restrict,
  note              text
);

create index suppressions_reason_idx on public.email_suppressions (reason, suppressed_at desc);
create trigger suppressions_no_update
  before update on public.email_suppressions
  for each row execute function app.block_mutation();
create trigger suppressions_no_delete
  before delete on public.email_suppressions
  for each row execute function app.block_mutation();

-- Attachment links (immutable applicant/generated documents).
create table public.admission_documents (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null references public.admission_applications(id) on delete cascade,
  document_id       uuid not null unique references public.documents(id) on delete restrict
);

create table public.job_documents (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null references public.job_applications(id) on delete cascade,
  document_id       uuid not null unique references public.documents(id) on delete restrict
);

create table public.student_documents (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references public.students(id) on delete cascade,
  document_id       uuid not null unique references public.documents(id) on delete restrict
);

create table public.invoice_documents (
  id                uuid primary key default gen_random_uuid(),
  invoice_id        uuid not null references public.invoices(id) on delete cascade,
  document_id       uuid not null unique references public.documents(id) on delete restrict
);

create table public.result_documents (
  id                uuid primary key default gen_random_uuid(),
  publication_id    uuid not null references public.result_publications(id) on delete cascade,
  document_id       uuid not null unique references public.documents(id) on delete restrict
);

create table public.support_documents (
  id                uuid primary key default gen_random_uuid(),
  support_request_id uuid not null references public.support_requests(id) on delete cascade,
  document_id       uuid not null unique references public.documents(id) on delete restrict
);

create table public.document_processing_events (
  id                uuid primary key default gen_random_uuid(),
  document_id       uuid not null references public.documents(id) on delete cascade,
  event_type        text not null,
  detail            text,
  created_at        timestamptz not null default now()
);

create trigger document_processing_events_no_update
  before update on public.document_processing_events
  for each row execute function app.block_mutation();
create trigger document_processing_events_no_delete
  before delete on public.document_processing_events
  for each row execute function app.block_mutation();

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table public.content_items        enable row level security;
alter table public.content_versions     enable row level security;
alter table public.notices              enable row level security;
alter table public.notice_audiences     enable row level security;
alter table public.content_documents    enable row level security;
alter table public.documents            enable row level security;
alter table public.admission_documents  enable row level security;
alter table public.job_documents        enable row level security;
alter table public.student_documents    enable row level security;
alter table public.invoice_documents    enable row level security;
alter table public.result_documents     enable row level security;
alter table public.support_documents    enable row level security;
alter table public.document_processing_events enable row level security;
alter table public.support_requests     enable row level security;
alter table public.support_messages     enable row level security;
alter table public.support_private_notes enable row level security;
alter table public.support_events      enable row level security;
alter table public.in_app_notifications enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.email_suppressions   enable row level security;

revoke all on public.content_items, public.content_versions, public.notices,
           public.notice_audiences, public.content_documents, public.documents,
           public.admission_documents, public.job_documents, public.student_documents,
           public.invoice_documents, public.result_documents, public.support_documents,
           public.document_processing_events, public.support_requests,
           public.support_messages, public.support_private_notes, public.support_events,
           public.in_app_notifications, public.notification_deliveries,
           public.email_suppressions
  from anon, authenticated;

-- Anonymous: published, active, PUBLIC-audience content only.
-- The audience table stays private (plan.md §6: recipient definitions remain
-- private), so anon visibility goes through a SECURITY DEFINER helper that
-- returns only ids of notices with a public audience.
create or replace function app.public_notice_ids()
returns uuid[]
language sql
security definer
set search_path = ''
as $$
  select array(
    select na.notice_id
      from public.notice_audiences na
     where na.audience = 'public'
  )
$$;
revoke all on function app.public_notice_ids() from public;
grant execute on function app.public_notice_ids() to anon, authenticated;

create policy anon_read_published_pages on public.content_items
  for select to anon
  using (kind = 'page' and current_status = 'published');
create policy anon_read_published_versions on public.content_versions
  for select to anon
  using (content_item_id in (select id from public.content_items
         where current_status = 'published' and kind = 'page'));
create policy anon_read_published_notices on public.notices
  for select to anon
  using (status = 'published' and id = any(app.public_notice_ids()));
create policy anon_read_public_documents on public.documents
  for select to anon
  using (visibility = 'public_approved' and scan_status = 'clean');

-- Authenticated: everything published and public-audience, plus family notices
-- targeted at the account's enrollment/student scope.
create policy auth_read_published_pages on public.content_items
  for select to authenticated
  using (current_status in ('published', 'expired'));
create policy auth_read_published_versions on public.content_versions
  for select to authenticated
  using (content_item_id in (select id from public.content_items
         where current_status in ('published', 'expired')));
create policy auth_read_notices on public.notices
  for select to authenticated
  using (status in ('published', 'expired') or id in (
    select na.notice_id from public.notice_audiences na
     where na.audience = 'role'
       and na.role_code in (select role_code from public.role_grants
                            where account_id = auth.uid() and status = 'active')));
create policy guardian_read_enrollment_notices on public.notices
  for select to authenticated
  using (id in (
    select na.notice_id from public.notice_audiences na
     where na.audience in ('academic_year', 'grade_section', 'student')
       and (
         na.student_id in (select l.student_id from public.guardian_student_links l
            join public.guardians g on g.id = l.guardian_id
            join public.user_accounts ua on ua.person_id = g.person_id
           where ua.id = auth.uid() and l.status = 'active')
         or na.grade_section_id in (select e.grade_section_id from public.enrollments e
            where e.student_id in (select l.student_id from public.guardian_student_links l
              join public.guardians g on g.id = l.guardian_id
              join public.user_accounts ua on ua.person_id = g.person_id
             where ua.id = auth.uid() and l.status = 'active')
              and e.status = 'active')
         or na.academic_year_id in (select e.academic_year_id from public.enrollments e
            where e.student_id in (select l.student_id from public.guardian_student_links l
              join public.guardians g on g.id = l.guardian_id
              join public.user_accounts ua on ua.person_id = g.person_id
             where ua.id = auth.uid() and l.status = 'active')
              and e.status = 'active')
       )));

-- Owners of a record may read their own attached documents (once clean).
create policy owner_read_clean_documents on public.documents
  for select to authenticated
  using (
    scan_status = 'clean'
    and (
      (owner_domain = 'admission_application' and owner_record_id in
        (select id from public.admission_applications where owner_account_id = auth.uid()))
      or (owner_domain = 'job_application' and owner_record_id in
        (select id from public.job_applications where owner_account_id = auth.uid()))
      or (owner_domain = 'invoice' and owner_record_id in
        (select i.id from public.invoices i where i.student_id in
          (select l.student_id from public.guardian_student_links l
            join public.guardians g on g.id = l.guardian_id
            join public.user_accounts ua on ua.person_id = g.person_id
           where ua.id = auth.uid() and l.status = 'active')))
      or (owner_domain = 'student' and owner_record_id in
        (select l.student_id from public.guardian_student_links l
          join public.guardians g on g.id = l.guardian_id
          join public.user_accounts ua on ua.person_id = g.person_id
         where ua.id = auth.uid() and l.status = 'active'))
    )
  );

-- Content staff (aal2) manage content and documents.
create policy staff_read_content_items on public.content_items
  for select to authenticated using (app.is_staff_aal2());
create policy staff_write_content_items on public.content_items
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['content_editor','content_publisher','system_administrator']));
create policy staff_update_content_items on public.content_items
  for update to authenticated
  using (app.is_staff_aal2() and app.has_any_role(array['content_editor','content_publisher','system_administrator']))
  with check (app.is_staff_aal2() and app.has_any_role(array['content_editor','content_publisher','system_administrator']));
create policy staff_read_content_versions on public.content_versions
  for select to authenticated using (app.is_staff_aal2());
create policy staff_write_content_versions on public.content_versions
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['content_editor','content_publisher','system_administrator']));
create policy staff_read_notices on public.notices
  for select to authenticated using (app.is_staff_aal2());
create policy staff_write_notices on public.notices
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['content_editor','content_publisher','system_administrator']));
create policy staff_update_notices on public.notices
  for update to authenticated
  using (app.is_staff_aal2() and app.has_any_role(array['content_editor','content_publisher','system_administrator']))
  with check (app.is_staff_aal2() and app.has_any_role(array['content_editor','content_publisher','system_administrator']));
create policy staff_read_notice_audiences on public.notice_audiences
  for select to authenticated using (app.is_staff_aal2());
create policy staff_write_notice_audiences on public.notice_audiences
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['content_editor','content_publisher','system_administrator']));
create policy staff_read_documents on public.documents
  for select to authenticated using (app.is_staff_aal2());
create policy staff_write_documents on public.documents
  for insert to authenticated with check (app.is_staff_aal2());
create policy staff_update_documents on public.documents
  for update to authenticated
  using (app.is_staff_aal2()) with check (app.is_staff_aal2());
create policy staff_read_document_events on public.document_processing_events
  for select to authenticated using (app.is_staff_aal2());
create policy staff_write_document_events on public.document_processing_events
  for insert to authenticated with check (app.is_staff_aal2());

-- Support: requester owns their requests and visible thread; staff (aal2) manage.
create policy requester_read_own_requests on public.support_requests
  for select to authenticated
  using (requester_account_id = auth.uid()
         or app.is_staff_aal2());
create policy requester_create_requests on public.support_requests
  for insert to authenticated
  with check (requester_account_id = auth.uid());
create policy staff_update_requests on public.support_requests
  for update to authenticated
  using (app.is_staff_aal2() and app.has_any_role(array['support_officer','system_administrator']))
  with check (app.is_staff_aal2() and app.has_any_role(array['support_officer','system_administrator']));
create policy requester_read_thread on public.support_messages
  for select to authenticated
  using (support_request_id in (select id from public.support_requests
                               where requester_account_id = auth.uid()));
create policy requester_write_thread on public.support_messages
  for insert to authenticated
  with check (is_staff = false
              and support_request_id in (select id from public.support_requests
                                         where requester_account_id = auth.uid()));
create policy staff_read_thread on public.support_messages
  for select to authenticated using (app.is_staff_aal2());
create policy staff_write_thread on public.support_messages
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['support_officer','system_administrator']));
create policy staff_read_private_notes on public.support_private_notes
  for select to authenticated using (app.is_staff_aal2());
create policy staff_write_private_notes on public.support_private_notes
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['support_officer','system_administrator']));
create policy staff_read_support_events on public.support_events
  for select to authenticated using (app.is_staff_aal2());
create policy staff_write_support_events on public.support_events
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['support_officer','system_administrator']));

-- Notifications: an account reads/updates its own in-app notifications only.
create policy account_read_own_notifications on public.in_app_notifications
  for select to authenticated using (recipient_account_id = auth.uid());
create policy account_update_own_notifications on public.in_app_notifications
  for update to authenticated
  using (recipient_account_id = auth.uid()) with check (recipient_account_id = auth.uid());
create policy staff_read_deliveries on public.notification_deliveries
  for select to authenticated using (app.is_staff_aal2());
create policy staff_write_deliveries on public.notification_deliveries
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['support_officer','system_administrator']));
create policy staff_update_deliveries on public.notification_deliveries
  for update to authenticated
  using (app.is_staff_aal2() and app.has_any_role(array['support_officer','system_administrator']))
  with check (app.is_staff_aal2() and app.has_any_role(array['support_officer','system_administrator']));
create policy staff_read_suppressions on public.email_suppressions
  for select to authenticated using (app.is_staff_aal2());
create policy staff_write_suppressions on public.email_suppressions
  for insert to authenticated with check (app.is_staff_aal2() and app.has_any_role(array['support_officer','system_administrator']));

-- ===========================================================================
-- Base privileges
-- ===========================================================================
grant select on public.content_items, public.content_versions, public.notices to anon;
grant select on public.documents to anon;
grant select on public.content_items, public.content_versions, public.notices,
  public.notice_audiences, public.documents to authenticated;
grant select, insert, update on public.content_items, public.content_versions,
  public.notices, public.notice_audiences, public.content_documents, public.documents,
  public.admission_documents, public.job_documents, public.student_documents,
  public.invoice_documents, public.result_documents, public.support_documents,
  public.document_processing_events, public.support_requests, public.support_messages,
  public.support_private_notes, public.support_events, public.in_app_notifications,
  public.notification_deliveries, public.email_suppressions to authenticated;

commit;
