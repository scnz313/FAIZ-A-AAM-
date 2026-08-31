/**
 * Server-row → domain-shape mapping for the finance facade (plan.md §10).
 *
 * The Supabase adapter returns RLS-filtered rows from `/api/adapter`; these
 * pure functions map them into the exact demo domain shapes the portal and
 * staff pages already consume, so no route or component changes at cutover.
 * Invoice totals come from immutable items, paid amounts come from unique
 * allocations, and the balance applies the append-only signed ledger effects.
 */

import type { Invoice, InvoiceItemKind, Payment, PaymentMethod, Receipt } from "@/modules/finance/demo";

export type ServerLedgerEntryRow = {
  reference?: string | null;
  entry_type: string;
  amount_paise: number;
  reason?: string | null;
  created_by_account_id?: string | null;
  created_at?: string | null;
  source_ref?: string | null;
};

type ServerStudentRelation = {
  display_name?: string | null;
  people?: { display_name?: string | null } | Array<{ display_name?: string | null }> | null;
};

export type ServerInvoiceRow = {
  reference: string;
  student_id: string | null;
  /** Optional denormalized/name relations supported by server projections. */
  student_name?: string | null;
  student?: ServerStudentRelation | ServerStudentRelation[] | null;
  students?: ServerStudentRelation | ServerStudentRelation[] | null;
  applicant_ref: string | null;
  term: string | null;
  status: string;
  issue_date: string;
  due_date: string | null;
  version: number;
  invoice_items: Array<{ label: string; amount_paise: number; kind: string }> | null;
  ledger_entries: ServerLedgerEntryRow[] | null;
  payment_allocations: Array<{
    amount_paise: number;
    payments: {
      id?: string;
      reference: string;
      method?: string | null;
      amount_paise: number;
      provider_txn_id?: string | null;
      attempt_id?: string | null;
      paid_at?: string;
      created_at: string;
      payment_attempts?: { method: string | null; provider_order_ref?: string | null } | null;
    } | null;
  }> | null;
  receipts: Array<{ reference: string; issued_at: string; payment_id?: string | null }> | null;
};

export type ServerReceiptRow = {
  reference: string;
  issued_at: string;
  payments: { method?: string | null; amount_paise: number; payment_attempts?: { method: string | null } | null } | null;
  invoices: { reference: string; student_id: string | null } | null;
};

export type MappedLedgerEntryKind = "concession" | "adjustment" | "write_off" | "refund";

export type MappedLedgerEntry = {
  ref: string;
  invoiceRef: string;
  kind: MappedLedgerEntryKind;
  amountPaise: number;
  reason: string;
  by: string;
  atIso: string;
  sourceRef: string;
};

export type MappedServerInvoiceView = {
  invoice: Invoice;
  studentId: string | null;
  studentName: string;
  status: Invoice["status"];
  version: number;
  totalPaise: number;
  paidPaise: number;
  balancePaise: number;
  payments: Payment[];
  receipts: Receipt[];
  ledgerEntries: MappedLedgerEntry[];
};

export type ServerReconciliationProjectionRow = {
  id: string;
  reference: string;
  run_at: string;
  status: string;
  summary: unknown;
  created_by_account_id: string | null;
  reconciliation_evidence?: Array<{
    id: string;
    reference: string;
    provider_txn_id: string | null;
    amount_paise: number;
    state: string;
  }> | null;
  reconciliation_exceptions?: Array<{
    id: string;
    evidence_id: string | null;
    kind: string;
    detail: unknown;
    status: string;
    resolution_reason: string | null;
    version: number;
    created_at: string;
    resolved_at: string | null;
    resolved_by_account_id?: string | null;
  }> | null;
};

export type MappedReconciliationException = {
  id: string;
  payRef: string;
  kind: "gateway-only" | "ledger-only" | "amount-mismatch" | "pending" | "refunded";
  amountPaise: number;
  note: string;
  status: "open" | "resolved";
  resolutionReason: string | null;
  resolvedBy: string | null;
  resolvedAtIso: string | null;
  version: number;
};

export type MappedReconciliationRun = {
  ref: string;
  ranAtIso: string;
  by: string;
  matchedCount: number;
  discrepancyCount: number;
  pendingCount: number;
  exceptions: MappedReconciliationException[];
};

const METHOD_LABELS: Array<PaymentMethod> = ["UPI", "Card", "Net banking", "Cash", "Challan"];
const LEDGER_ENTRY_KINDS = new Set<MappedLedgerEntryKind>(["concession", "adjustment", "write_off", "refund"]);

function toPaymentMethod(method: string | null): PaymentMethod {
  const match = METHOD_LABELS.find((label) => label.toLowerCase() === (method ?? "").toLowerCase());
  return match ?? "Challan";
}

function toInvoiceStatus(status: string): Invoice["status"] {
  if (status === "paid") return "paid";
  if (status === "partially_paid" || status === "partial") return "partial";
  if (status === "overdue") return "overdue";
  return "unpaid";
}

function toItemKind(kind: string): InvoiceItemKind {
  return kind === "concession" ? "concession" : "fee";
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** A single resolver is shared by server and client projections to avoid a
 * first-paint "Linked student" → "—" name flicker. */
export function serverInvoiceStudentName(row: ServerInvoiceRow): string {
  const student = firstRelation(row.students) ?? firstRelation(row.student);
  const person = firstRelation(student?.people);
  return (
    nonEmpty(row.student_name) ??
    nonEmpty(student?.display_name) ??
    nonEmpty(person?.display_name) ??
    (row.student_id === null ? "—" : "Linked student")
  );
}

function sourceReference(entry: ServerLedgerEntryRow, fallbackRef: string): string {
  const explicit = nonEmpty(entry.source_ref);
  if (explicit !== null) return explicit;
  const reasonPrefix = nonEmpty(entry.reason)?.split(":", 1)[0]?.trim();
  return reasonPrefix && /^[A-Z0-9][A-Z0-9-]*$/i.test(reasonPrefix) ? reasonPrefix : fallbackRef;
}

/** Map only balance-changing adjustment/refund rows. Charge and payment rows
 * remain represented by invoice items and allocations in the frozen UI shape. */
export function mapServerLedgerEntries(row: ServerInvoiceRow): MappedLedgerEntry[] {
  return (row.ledger_entries ?? []).flatMap((entry, index) => {
    if (!LEDGER_ENTRY_KINDS.has(entry.entry_type as MappedLedgerEntryKind)) return [];
    const kind = entry.entry_type as MappedLedgerEntryKind;
    const ref = nonEmpty(entry.reference) ?? `${row.reference}-LEDGER-${index + 1}`;
    return [{
      ref,
      invoiceRef: row.reference,
      kind,
      amountPaise: entry.amount_paise,
      reason: nonEmpty(entry.reason) ?? `${kind.replace("_", "-")} posted to the invoice ledger.`,
      by: nonEmpty(entry.created_by_account_id) ?? "Finance ledger",
      atIso: nonEmpty(entry.created_at) ?? row.issue_date,
      sourceRef: sourceReference(entry, ref),
    }];
  });
}

function ledgerPaymentEffect(row: ServerInvoiceRow): number | undefined {
  const paymentEntries = (row.ledger_entries ?? []).filter((entry) => entry.entry_type === "payment");
  if (paymentEntries.length === 0) return undefined;
  return paymentEntries.reduce((sum, entry) => sum + entry.amount_paise, 0);
}

export function mapServerInvoice(row: ServerInvoiceRow): Invoice {
  const items = (row.invoice_items ?? []).map((item) => ({
    label: item.label,
    amountPaise: item.amount_paise,
    kind: toItemKind(item.kind),
  }));

  const receiptRefs = (row.receipts ?? []).map((receipt) => receipt.reference);
  const receiptByPaymentId = new Map((row.receipts ?? []).flatMap((receipt) => receipt.payment_id ? [[receipt.payment_id, receipt.reference] as const] : []));
  const receiptsHavePaymentIds = receiptByPaymentId.size > 0;
  const paymentsByReference = new Map<string, Payment>();
  (row.payment_allocations ?? []).forEach((allocation, index) => {
    if (allocation.payments === null) return;
    const receiptRef = allocation.payments.id && receiptsHavePaymentIds
      ? receiptByPaymentId.get(allocation.payments.id) ?? ""
      : receiptRefs[index] ?? "";
    const mapped: Payment = {
      ref: allocation.payments.reference,
      paidAtIso: allocation.payments.paid_at ?? allocation.payments.created_at,
      method: toPaymentMethod(allocation.payments.method ?? allocation.payments.payment_attempts?.method ?? null),
      amountPaise: allocation.amount_paise,
      receiptRef,
      providerTxnRef: allocation.payments.provider_txn_id ?? undefined,
      attemptId: allocation.payments.attempt_id ?? undefined,
    };
    const existing = paymentsByReference.get(mapped.ref);
    if (existing === undefined) {
      paymentsByReference.set(mapped.ref, mapped);
    } else if (existing.receiptRef === "" && mapped.receiptRef !== "") {
      paymentsByReference.set(mapped.ref, { ...existing, receiptRef: mapped.receiptRef });
    }
  });

  const invoice: Invoice = {
    ref: row.reference,
    studentId: row.student_id,
    applicantRef: row.applicant_ref,
    term: row.term ?? "Fees",
    issuedAtIso: row.issue_date,
    dueAtIso: row.due_date ?? row.issue_date,
    status: toInvoiceStatus(row.status),
    items,
    payments: [...paymentsByReference.values()],
  };
  const entries = mapServerLedgerEntries(row);
  const summary = invoiceSummary(invoice, entries, ledgerPaymentEffect(row));
  const hasPaymentEvidence = invoice.payments.length > 0 || ledgerPaymentEffect(row) !== undefined;
  invoice.status = summary.balancePaise <= 0 && summary.totalPaise > 0
    ? "paid"
    : hasPaymentEvidence
      ? "partial"
      : toInvoiceStatus(row.status);
  return invoice;
}

/** Item/allocation totals plus signed concession, adjustment, write-off and
 * refund effects. When supplied, the signed payment-ledger effect is used for
 * balance truth while paidPaise remains allocation-backed. */
export function invoiceSummary(
  invoice: Invoice,
  ledgerEntries: readonly MappedLedgerEntry[] = [],
  ledgerPaymentEffectPaise?: number,
): { totalPaise: number; paidPaise: number; balancePaise: number } {
  const totalPaise = invoice.items.reduce((sum, item) => sum + item.amountPaise, 0);
  const paidPaise = invoice.payments.reduce((sum, payment) => sum + payment.amountPaise, 0);
  const signedAdjustmentPaise = ledgerEntries.reduce((sum, entry) => sum + entry.amountPaise, 0);
  const computedBalance = totalPaise + (ledgerPaymentEffectPaise ?? -paidPaise) + signedAdjustmentPaise;
  /* Preserve the historical narrow-embed fallback only when no signed ledger
     detail exists. A refund/adjustment must be able to reopen a paid invoice. */
  const balancePaise = invoice.status === "paid" && ledgerEntries.length === 0 && ledgerPaymentEffectPaise === undefined
    ? 0
    : Math.max(computedBalance, 0);
  return { totalPaise, paidPaise, balancePaise };
}

/** Complete Supabase InvoiceView projection shared by server first paint and
 * client refresh. This is the parity boundary for names, ledger effects and
 * duplicate-safe payments. */
export function mapServerInvoiceView(
  row: ServerInvoiceRow,
  receipts: readonly Receipt[] = [],
): MappedServerInvoiceView {
  const invoice = mapServerInvoice(row);
  const ledgerEntries = mapServerLedgerEntries(row);
  const summary = invoiceSummary(invoice, ledgerEntries, ledgerPaymentEffect(row));
  const hasPaymentEvidence = invoice.payments.length > 0 || ledgerPaymentEffect(row) !== undefined;
  const status: Invoice["status"] = summary.balancePaise <= 0 && summary.totalPaise > 0
    ? "paid"
    : hasPaymentEvidence
      ? "partial"
      : toInvoiceStatus(row.status);
  invoice.status = status;

  const seenReceipts = new Set<string>();
  const invoiceReceipts = receipts.filter((receipt) => {
    if (receipt.invoiceRef !== invoice.ref || seenReceipts.has(receipt.ref)) return false;
    seenReceipts.add(receipt.ref);
    return true;
  });

  return {
    invoice,
    studentId: invoice.studentId,
    studentName: serverInvoiceStudentName(row),
    status,
    version: row.version,
    ...summary,
    payments: invoice.payments,
    receipts: invoiceReceipts,
    ledgerEntries,
  };
}

export function mapServerReceipt(row: ServerReceiptRow): Receipt {
  return {
    ref: row.reference,
    invoiceRef: row.invoices?.reference ?? "",
    studentId: row.invoices?.student_id ?? null,
    issuedAtIso: row.issued_at,
    method: toPaymentMethod(row.payments?.method ?? row.payments?.payment_attempts?.method ?? null),
    amountPaise: row.payments?.amount_paise ?? 0,
    counter: "Online payment",
  };
}

/** Keep one posted payment row and suppress the succeeded attempt that created
 * it. Matching prefers the payment's `attemptId` (attempt.id) because provider
 * order refs and transaction ids are distinct identifiers that never align;
 * the provider ref is only a fallback for rows without an attempt id. */
export function mergePaymentRegisterRows<T extends {
  ref: string;
  status: "success" | "pending" | "failed";
  attemptId?: string | null;
  providerTxnRef?: string | null;
}>(postedRows: readonly T[], attemptRows: readonly T[]): T[] {
  const rows: T[] = [];
  const seenReferences = new Set<string>();
  const postedAttemptIds = new Set(
    postedRows.map((row) => nonEmpty(row.attemptId)).filter((id): id is string => id !== null),
  );
  const postedProviderRefs = new Set(
    postedRows.map((row) => nonEmpty(row.providerTxnRef)).filter((ref): ref is string => ref !== null),
  );

  for (const row of postedRows) {
    if (seenReferences.has(row.ref)) continue;
    seenReferences.add(row.ref);
    rows.push(row);
  }
  for (const row of attemptRows) {
    const attemptId = nonEmpty(row.attemptId);
    const providerRef = nonEmpty(row.providerTxnRef);
    const isPostedAttempt = row.status === "success" && (
      (attemptId !== null && postedAttemptIds.has(attemptId))
      || (attemptId === null && providerRef !== null && postedProviderRefs.has(providerRef))
    );
    if (isPostedAttempt || seenReferences.has(row.ref)) continue;
    seenReferences.add(row.ref);
    rows.push(row);
  }
  return rows;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numeric(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function reconciliationKind(kind: string, detail: Record<string, unknown>): MappedReconciliationException["kind"] {
  const explicit = nonEmpty(detail.kind)?.toLowerCase().replaceAll("_", "-");
  const normalized = explicit ?? kind.toLowerCase().replaceAll("_", "-");
  if (normalized.includes("amount-mismatch")) return "amount-mismatch";
  if (normalized.includes("ledger-only")) return "ledger-only";
  if (normalized.includes("refund")) return "refunded";
  if (normalized.includes("pending") || normalized.includes("failed")) return "pending";
  return "gateway-only";
}

export function mapServerReconciliationRun(row: ServerReconciliationProjectionRow): MappedReconciliationRun {
  const evidenceById = new Map((row.reconciliation_evidence ?? []).map((evidence) => [evidence.id, evidence]));
  const exceptions = (row.reconciliation_exceptions ?? []).map((exception) => {
    const detail = asRecord(exception.detail);
    const evidence = exception.evidence_id === null ? undefined : evidenceById.get(exception.evidence_id);
    const kind = reconciliationKind(exception.kind, detail);
    const payRef =
      nonEmpty(detail.payRef) ??
      nonEmpty(detail.paymentRef) ??
      nonEmpty(detail.providerTxnId) ??
      nonEmpty(detail.provider_txn_id) ??
      nonEmpty(evidence?.provider_txn_id) ??
      nonEmpty(evidence?.reference) ??
      exception.id;
    const amountPaise = numeric(detail.amountPaise, numeric(detail.amount_paise, evidence?.amount_paise ?? 0));
    const status = exception.status === "resolved" ? "resolved" as const : "open" as const;
    return {
      id: exception.id,
      payRef,
      kind,
      amountPaise,
      note: nonEmpty(detail.note) ?? `${exception.kind.replaceAll("_", " ")} reconciliation exception.`,
      status,
      resolutionReason: exception.resolution_reason,
      resolvedBy: exception.resolved_by_account_id ?? null,
      resolvedAtIso: exception.resolved_at,
      version: exception.version,
    };
  });
  const summary = asRecord(row.summary);
  const matchedCount = numeric(summary.matched);
  const derivedDiscrepancies = exceptions.filter((exception) =>
    exception.kind === "gateway-only" || exception.kind === "ledger-only" || exception.kind === "amount-mismatch",
  ).length;
  const derivedPending = exceptions.filter((exception) => exception.kind === "pending" || exception.kind === "refunded").length;

  return {
    ref: row.reference,
    ranAtIso: row.run_at,
    by: row.created_by_account_id ?? "Finance office",
    matchedCount,
    discrepancyCount: numeric(summary.discrepancies, derivedDiscrepancies),
    pendingCount: numeric(summary.pending, derivedPending),
    exceptions,
  };
}
