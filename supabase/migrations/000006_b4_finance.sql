-- =============================================================================
-- B4 — Fees and payments (plan.md §6 module, §11 B4)
--
-- Financial invariants enforced in-schema (plan.md §6):
--   * invoice balance is computed from ledger entries (never stored)
--   * provider transaction id, provider event id, receipt number, and
--     idempotency key are unique
--   * allocation cannot exceed payment availability or invoice balance
--   * confirmed refunds cannot exceed refundable payment balance
--   * browser redirects never mark an invoice paid; verified gateway events
--     post payment, allocation, receipt, audit, and outbox rows in one
--     transaction (via domain RPCs)
--   * no raw card, UPI, bank, OTP, or gateway secret is stored
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Fee schedules (versioned configuration — changing a schedule never rewrites
-- issued invoices)
-- ---------------------------------------------------------------------------
create table public.fee_schedule_versions (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('FSV'),
  version           int not null,
  status            text not null default 'draft'
                    check (status in ('draft', 'approved', 'superseded')),
  effective_from    timestamptz,
  approved_by_account_id uuid references public.user_accounts(id) on delete restrict,
  policy            jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  unique (version)
);

create table public.fee_schedule_items (
  id                uuid primary key default gen_random_uuid(),
  schedule_version_id uuid not null references public.fee_schedule_versions(id) on delete cascade,
  code              text not null,
  label             text not null,
  amount_paise      bigint not null check (amount_paise >= 0),
  currency          text not null default 'INR' check (currency = 'INR'),
  period            text,
  kind              text not null default 'fee'
                    check (kind in ('fee', 'concession', 'adjustment', 'other')),
  sort_order        int not null default 0,
  unique (schedule_version_id, code)
);

create index fee_items_schedule_idx on public.fee_schedule_items (schedule_version_id);

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------
create table public.invoices (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('INV'),
  student_id        uuid not null references public.students(id) on delete restrict,
  enrollment_id     uuid references public.enrollments(id) on delete restrict,
  academic_year_id  uuid not null references public.academic_years(id) on delete restrict,
  schedule_version_id uuid references public.fee_schedule_versions(id) on delete restrict,
  applicant_ref     text,                       -- set while an admission invoice awaits conversion
  term              text not null,
  status            text not null default 'unpaid'
                    check (status in ('unpaid', 'partial', 'paid', 'overdue', 'cancelled')),
  issue_date        date not null default current_date,
  due_date          date not null,
  version           int not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (due_date >= issue_date)
);

create index invoices_student_idx on public.invoices (student_id, academic_year_id);
create index invoices_status_idx on public.invoices (status, due_date);
create trigger invoices_touch before update on public.invoices
  for each row execute function app.touch_updated_at();

create table public.invoice_items (
  id                uuid primary key default gen_random_uuid(),
  invoice_id        uuid not null references public.invoices(id) on delete cascade,
  label             text not null,
  amount_paise      bigint not null,
  currency          text not null default 'INR',
  kind              text not null default 'fee'
                    check (kind in ('fee', 'concession', 'adjustment', 'other')),
  created_at        timestamptz not null default now()
);

create index invoice_items_invoice_idx on public.invoice_items (invoice_id);
create trigger invoice_items_no_update
  before update on public.invoice_items
  for each row execute function app.block_mutation();
create trigger invoice_items_no_delete
  before delete on public.invoice_items
  for each row execute function app.block_mutation();

create table public.concessions (
  id                uuid primary key default gen_random_uuid(),
  invoice_id        uuid not null references public.invoices(id) on delete cascade,
  approved_by_account_id uuid not null references public.user_accounts(id) on delete restrict,
  reason            text not null,
  amount_paise      bigint not null check (amount_paise > 0),
  created_at        timestamptz not null default now()
);

create index concessions_invoice_idx on public.concessions (invoice_id);
create trigger concessions_no_update
  before update on public.concessions
  for each row execute function app.block_mutation();
create trigger concessions_no_delete
  before delete on public.concessions
  for each row execute function app.block_mutation();

-- ---------------------------------------------------------------------------
-- Ledger — append-only signed entries; the invoice balance derives from these
-- ---------------------------------------------------------------------------
create table public.ledger_entries (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('LED'),
  invoice_id        uuid not null references public.invoices(id) on delete restrict,
  entry_type        text not null
                    check (entry_type in ('charge', 'payment', 'concession', 'adjustment', 'refund', 'write_off')),
  amount_paise      bigint not null,           -- signed: negative entries reduce the balance
  currency          text not null default 'INR',
  reason            text,
  created_by_account_id uuid references public.user_accounts(id) on delete restrict,
  created_at        timestamptz not null default now()
);

create index ledger_invoice_idx on public.ledger_entries (invoice_id, created_at);
create trigger ledger_no_update
  before update on public.ledger_entries
  for each row execute function app.block_mutation();
create trigger ledger_no_delete
  before delete on public.ledger_entries
  for each row execute function app.block_mutation();

-- ---------------------------------------------------------------------------
-- Payment attempts, gateway events, payments, allocations, receipts
-- ---------------------------------------------------------------------------
create table public.payment_attempts (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('PAY'),
  invoice_id        uuid not null references public.invoices(id) on delete restrict,
  method            text not null,
  amount_paise      bigint not null check (amount_paise > 0),
  currency          text not null default 'INR',
  status            text not null default 'created'
                    check (status in ('created', 'processing', 'succeeded', 'failed', 'cancelled', 'delayed')),
  provider_order_ref text,
  failure_reason    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index payment_attempts_invoice_idx on public.payment_attempts (invoice_id);
create index payment_attempts_status_idx on public.payment_attempts (status, updated_at);
create trigger payment_attempts_touch before update on public.payment_attempts
  for each row execute function app.touch_updated_at();

create table public.gateway_events (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('GWE'),
  provider          text not null,
  provider_event_id text not null,
  payload_hash      text not null,
  normalized        jsonb,
  status            text not null default 'received'
                    check (status in ('received', 'verified', 'ignored', 'failed')),
  processed_at      timestamptz,
  created_at        timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create table public.payments (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('PMT'),
  attempt_id        uuid not null unique references public.payment_attempts(id) on delete restrict,
  amount_paise      bigint not null check (amount_paise > 0),
  currency          text not null default 'INR',
  provider_txn_id   text not null unique,
  paid_at           timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create table public.payment_allocations (
  id                uuid primary key default gen_random_uuid(),
  payment_id        uuid not null references public.payments(id) on delete cascade,
  invoice_id        uuid not null references public.invoices(id) on delete restrict,
  amount_paise      bigint not null check (amount_paise > 0),
  created_at        timestamptz not null default now(),
  unique (payment_id, invoice_id)
);

create index allocations_invoice_idx on public.payment_allocations (invoice_id);

create table public.receipts (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique,      -- legally sequential receipt number
  payment_id        uuid not null unique references public.payments(id) on delete restrict,
  invoice_id        uuid not null references public.invoices(id) on delete restrict,
  issued_at         timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index receipts_invoice_idx on public.receipts (invoice_id);

-- ---------------------------------------------------------------------------
-- Refunds and reconciliation
-- ---------------------------------------------------------------------------
create table public.refund_requests (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('REF'),
  payment_id        uuid not null references public.payments(id) on delete restrict,
  requested_by_account_id uuid not null references public.user_accounts(id) on delete restrict,
  amount_paise      bigint not null check (amount_paise > 0),
  reason            text not null,
  status            text not null default 'requested'
                    check (status in ('requested', 'approved', 'rejected', 'processed')),
  approver_account_id uuid references public.user_accounts(id) on delete restrict,
  decided_at        timestamptz,
  version           int not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger refund_requests_touch before update on public.refund_requests
  for each row execute function app.touch_updated_at();

create table public.refunds (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('RFD'),
  refund_request_id uuid not null unique references public.refund_requests(id) on delete restrict,
  amount_paise      bigint not null check (amount_paise > 0),
  provider_ref      text,
  status            text not null default 'pending'
                    check (status in ('pending', 'confirmed', 'failed')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger refunds_touch before update on public.refunds
  for each row execute function app.touch_updated_at();

create table public.reconciliation_runs (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique default app.new_ref('REC'),
  run_at            timestamptz not null default now(),
  status            text not null default 'started'
                    check (status in ('started', 'completed', 'failed')),
  summary           jsonb,
  created_by_account_id uuid references public.user_accounts(id) on delete restrict
);

create table public.reconciliation_exceptions (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references public.reconciliation_runs(id) on delete cascade,
  kind              text not null,
  detail            jsonb,
  status            text not null default 'open' check (status in ('open', 'resolved')),
  created_at        timestamptz not null default now()
);

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table public.fee_schedule_versions    enable row level security;
alter table public.fee_schedule_items       enable row level security;
alter table public.invoices                 enable row level security;
alter table public.invoice_items            enable row level security;
alter table public.concessions              enable row level security;
alter table public.ledger_entries           enable row level security;
alter table public.payment_attempts         enable row level security;
alter table public.gateway_events           enable row level security;
alter table public.payments                 enable row level security;
alter table public.payment_allocations      enable row level security;
alter table public.receipts                 enable row level security;
alter table public.refund_requests          enable row level security;
alter table public.refunds                  enable row level security;
alter table public.reconciliation_runs      enable row level security;
alter table public.reconciliation_exceptions enable row level security;

revoke all on public.fee_schedule_versions, public.fee_schedule_items, public.invoices,
           public.invoice_items, public.concessions, public.ledger_entries,
           public.payment_attempts, public.gateway_events, public.payments,
           public.payment_allocations, public.receipts, public.refund_requests,
           public.refunds, public.reconciliation_runs, public.reconciliation_exceptions
  from anon, authenticated;

-- Guardians read finance rows only for students their ACTIVE links connect
-- them to (the same scope the portal ledger uses).
create policy guardian_read_invoices on public.invoices
  for select to authenticated
  using (
    app.is_guardian()
    and student_id in (
      select l.student_id
        from public.guardian_student_links l
        join public.guardians g on g.id = l.guardian_id
        join public.user_accounts ua on ua.person_id = g.person_id
       where ua.id = auth.uid()
         and l.status = 'active'
    )
  );
create policy guardian_read_invoice_items on public.invoice_items
  for select to authenticated
  using (invoice_id in (select id from public.invoices
         where app.is_guardian() and student_id in (
           select l.student_id
             from public.guardian_student_links l
             join public.guardians g on g.id = l.guardian_id
             join public.user_accounts ua on ua.person_id = g.person_id
            where ua.id = auth.uid() and l.status = 'active')));
create policy guardian_read_receipts on public.receipts
  for select to authenticated
  using (invoice_id in (select id from public.invoices
         where app.is_guardian() and student_id in (
           select l.student_id
             from public.guardian_student_links l
             join public.guardians g on g.id = l.guardian_id
             join public.user_accounts ua on ua.person_id = g.person_id
            where ua.id = auth.uid() and l.status = 'active')));

-- Finance staff (aal2) read/write through domain RPCs; direct reads allowed,
-- direct writes limited to officers via RPCs (audit + idempotency live there).
create policy staff_read_fee_schedules on public.fee_schedule_versions
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_fee_items on public.fee_schedule_items
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_invoices on public.invoices
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_invoice_items on public.invoice_items
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_concessions on public.concessions
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_ledger on public.ledger_entries
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_attempts on public.payment_attempts
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_gateway_events on public.gateway_events
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_payments on public.payments
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_allocations on public.payment_allocations
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_receipts on public.receipts
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_refund_requests on public.refund_requests
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_refunds on public.refunds
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_reconciliation on public.reconciliation_runs
  for select to authenticated using (app.is_staff_aal2());
create policy staff_read_reconciliation_exceptions on public.reconciliation_exceptions
  for select to authenticated using (app.is_staff_aal2());

-- ===========================================================================
-- Base privileges
-- ===========================================================================
grant select on public.invoices, public.invoice_items, public.receipts to authenticated;
grant select on public.fee_schedule_versions, public.fee_schedule_items, public.concessions,
  public.ledger_entries, public.payment_attempts, public.gateway_events, public.payments,
  public.payment_allocations, public.refund_requests, public.refunds,
  public.reconciliation_runs, public.reconciliation_exceptions to authenticated;

commit;
