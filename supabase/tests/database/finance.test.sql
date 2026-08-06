-- =============================================================================
-- B4 finance database tests (pgTAP, `supabase db test`).
-- plan.md §12: tables, checks, uniqueness, append-only triggers, idempotency,
-- indexes, and RLS for the fees/payments slice.
-- =============================================================================

begin;
select plan(54);

-- Tables exist.
select has_table('public', 'fee_schedule_versions', 'fee_schedule_versions exists');
select has_table('public', 'fee_schedule_items', 'fee_schedule_items exists');
select has_table('public', 'invoices', 'invoices exists');
select has_table('public', 'invoice_items', 'invoice_items exists');
select has_table('public', 'concessions', 'concessions exists');
select has_table('public', 'ledger_entries', 'ledger_entries exists');
select has_table('public', 'payment_attempts', 'payment_attempts exists');
select has_table('public', 'gateway_events', 'gateway_events exists');
select has_table('public', 'payments', 'payments exists');
select has_table('public', 'payment_allocations', 'payment_allocations exists');
select has_table('public', 'receipts', 'receipts exists');
select has_table('public', 'refund_requests', 'refund_requests exists');
select has_table('public', 'refunds', 'refunds exists');
select has_table('public', 'reconciliation_runs', 'reconciliation_runs exists');
select has_table('public', 'reconciliation_exceptions', 'reconciliation_exceptions exists');

-- Financial checks: statuses, amounts, currency, dates, kinds.
select col_has_check('public', 'fee_schedule_versions', 'status', 'schedule version status check');
select col_has_check('public', 'fee_schedule_items', 'amount_paise', 'fee item amount non-negative');
select col_has_check('public', 'fee_schedule_items', 'currency', 'fee item currency is INR');
select col_has_check('public', 'fee_schedule_items', 'kind', 'fee item kind check');
select col_has_check('public', 'invoices', 'status', 'invoice status check');
select col_has_check('public', 'invoices', 'due_date', 'due_date >= issue_date check');
select col_has_check('public', 'invoice_items', 'kind', 'invoice item kind check');
select col_has_check('public', 'concessions', 'amount_paise', 'concession amount positive');
select col_has_check('public', 'ledger_entries', 'entry_type', 'ledger entry type check (direction/kind invariant)');
select col_has_check('public', 'payment_attempts', 'amount_paise', 'attempt amount positive');
select col_has_check('public', 'payment_attempts', 'status', 'attempt status check');
select col_has_check('public', 'gateway_events', 'status', 'gateway event status check');
select col_has_check('public', 'payments', 'amount_paise', 'payment amount positive');
select col_has_check('public', 'payment_allocations', 'amount_paise', 'allocation amount positive');
select col_has_check('public', 'refund_requests', 'amount_paise', 'refund request amount positive');
select col_has_check('public', 'refund_requests', 'status', 'refund request status check');
select col_has_check('public', 'refunds', 'amount_paise', 'refund amount positive');
select col_has_check('public', 'refunds', 'status', 'refund status check');
select col_has_check('public', 'reconciliation_runs', 'status', 'reconciliation run status check');
select col_has_check('public', 'reconciliation_exceptions', 'status', 'reconciliation exception status check');

-- Uniqueness: versioned schedules, provider events, allocations, receipts,
-- provider transaction ids.
select col_is_unique('public', 'fee_schedule_versions', 'version', 'schedule version unique');
select col_is_unique('public', 'gateway_events', ARRAY['provider', 'provider_event_id'], 'provider event id unique per provider');
select col_is_unique('public', 'payment_allocations', ARRAY['payment_id', 'invoice_id'], 'one allocation per payment/invoice');
select col_is_unique('public', 'receipts', 'reference', 'receipt number unique');
select col_is_unique('public', 'payments', 'provider_txn_id', 'provider transaction id unique');

-- Append-only: invoice items, concessions, and ledger entries cannot be
-- updated or deleted.
select has_trigger('public', 'invoice_items', 'invoice_items_no_update', 'invoice item update is blocked');
select has_trigger('public', 'invoice_items', 'invoice_items_no_delete', 'invoice item delete is blocked');
select has_trigger('public', 'concessions', 'concessions_no_update', 'concession update is blocked');
select has_trigger('public', 'concessions', 'concessions_no_delete', 'concession delete is blocked');
select has_trigger('public', 'ledger_entries', 'ledger_no_update', 'ledger entry update is blocked');
select has_trigger('public', 'ledger_entries', 'ledger_no_delete', 'ledger entry delete is blocked');

-- Idempotency: a payment attempt reference is unique (retries reuse it).
select col_is_unique('public', 'payment_attempts', 'reference', 'attempt reference unique (idempotency key)');

-- RLS enabled on every finance table; no anonymous policies.
select is(
  (select count(*)::int from pg_tables t
    where t.schemaname = 'public'
      and t.tablename in ('fee_schedule_versions', 'fee_schedule_items', 'invoices',
                          'invoice_items', 'concessions', 'ledger_entries',
                          'payment_attempts', 'gateway_events', 'payments',
                          'payment_allocations', 'receipts', 'refund_requests',
                          'refunds', 'reconciliation_runs', 'reconciliation_exceptions')
      and t.rowsecurity),
  15,
  'all finance tables have RLS enabled'
);
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename in ('fee_schedule_versions', 'fee_schedule_items', 'invoices',
                        'invoice_items', 'concessions', 'ledger_entries',
                        'payment_attempts', 'gateway_events', 'payments',
                        'payment_allocations', 'receipts', 'refund_requests',
                        'refunds', 'reconciliation_runs', 'reconciliation_exceptions')
      and roles = '{anon}'),
  0,
  'no anonymous policies on finance tables'
);

-- Operational lookup indexes.
select has_index('public', 'invoices', 'invoices_student_idx', 'invoice student lookup index');
select has_index('public', 'invoices', 'invoices_status_idx', 'invoice status lookup index');
select has_index('public', 'ledger_entries', 'ledger_invoice_idx', 'ledger invoice lookup index');
select has_index('public', 'payment_attempts', 'payment_attempts_status_idx', 'attempt status lookup index');
select has_index('public', 'receipts', 'receipts_invoice_idx', 'receipt invoice lookup index');

rollback;
