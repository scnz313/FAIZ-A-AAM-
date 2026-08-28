/**
 * Server-row → domain-shape mapping for the finance facade (plan.md §10).
 *
 * The Supabase adapter returns RLS-filtered rows from `/api/adapter`; these
 * pure functions map them into the exact demo domain shapes the portal and
 * staff pages already consume, so no route or component changes at cutover.
 * Totals are computed from the append-only ledger (charges positive,
 * payments negative) — the same rule the finance RPCs enforce.
 */

import type { Invoice, InvoiceItemKind, Payment, PaymentMethod, Receipt } from "@/modules/finance/demo";

export type ServerInvoiceRow = {
  reference: string;
  student_id: string | null;
  applicant_ref: string | null;
  term: string | null;
  status: string;
  issue_date: string;
  due_date: string | null;
  invoice_items: Array<{ label: string; amount_paise: number; kind: string }> | null;
  ledger_entries: Array<{ entry_type: string; amount_paise: number }> | null;
  payment_allocations: Array<{
    amount_paise: number;
    payments: { reference: string; method: string | null; amount_paise: number; created_at: string } | null;
  }> | null;
  receipts: Array<{ reference: string; issued_at: string }> | null;
};

export type ServerReceiptRow = {
  reference: string;
  issued_at: string;
  payments: { method: string | null; amount_paise: number } | null;
  invoices: { reference: string; student_id: string | null } | null;
};

const METHOD_LABELS: Array<PaymentMethod> = ["UPI", "Card", "Net banking", "Cash", "Challan"];

function toPaymentMethod(method: string | null): PaymentMethod {
  const match = METHOD_LABELS.find((label) => label.toLowerCase() === (method ?? "").toLowerCase());
  return match ?? "Challan";
}

function toInvoiceStatus(status: string): Invoice["status"] {
  if (status === "paid") return "paid";
  if (status === "partially_paid") return "partial";
  if (status === "overdue") return "overdue";
  return "unpaid";
}

function toItemKind(kind: string): InvoiceItemKind {
  return kind === "concession" ? "concession" : "fee";
}

export function mapServerInvoice(row: ServerInvoiceRow): Invoice {
  const items = (row.invoice_items ?? []).map((item) => ({
    label: item.label,
    amountPaise: item.amount_paise,
    kind: toItemKind(item.kind),
  }));
  const entries = row.ledger_entries ?? [];
  const totalPaise = items.reduce((sum, item) => sum + item.amountPaise, 0);
  const paidPaise = entries
    .filter((entry) => entry.amount_paise < 0)
    .reduce((sum, entry) => sum + -entry.amount_paise, 0);
  const balancePaise = Math.max(totalPaise - paidPaise, 0);

  const receiptRefs = (row.receipts ?? []).map((receipt) => receipt.reference);
  const payments: Payment[] = [];
  (row.payment_allocations ?? []).forEach((allocation, index) => {
    if (allocation.payments === null) return;
    payments.push({
      ref: allocation.payments.reference,
      paidAtIso: allocation.payments.created_at,
      method: toPaymentMethod(allocation.payments.method),
      amountPaise: allocation.amount_paise,
      /* Receipts pair with their original allocation slot, so a missing
         allocation never shifts another payment's receipt reference. */
      receiptRef: receiptRefs[index] ?? "",
    });
  });
  const derivedStatus: Invoice["status"] =
    balancePaise <= 0 && totalPaise > 0 ? "paid" : paidPaise > 0 ? "partial" : toInvoiceStatus(row.status);

  return {
    ref: row.reference,
    studentId: row.student_id,
    applicantRef: row.applicant_ref,
    term: row.term ?? "Fees",
    issuedAtIso: row.issue_date,
    dueAtIso: row.due_date ?? row.issue_date,
    status: derivedStatus,
    items,
    payments,
  };
}

/** Ledger-derived totals for one mapped invoice (same rule as the RPCs). */
export function invoiceSummary(invoice: Invoice): { totalPaise: number; paidPaise: number; balancePaise: number } {
  const totalPaise = invoice.items.reduce((sum, item) => sum + item.amountPaise, 0);
  const paidPaise = invoice.payments.reduce((sum, payment) => sum + payment.amountPaise, 0);
  /* A settled invoice never shows a residual balance even when the ledger
     embed arrives narrower than the payment evidence (overpayment, refunds). */
  const balancePaise = invoice.status === "paid" ? 0 : Math.max(totalPaise - paidPaise, 0);
  return { totalPaise, paidPaise, balancePaise };
}

export function mapServerReceipt(row: ServerReceiptRow): Receipt {
  return {
    ref: row.reference,
    invoiceRef: row.invoices?.reference ?? "",
    studentId: row.invoices?.student_id ?? null,
    issuedAtIso: row.issued_at,
    method: toPaymentMethod(row.payments?.method ?? null),
    amountPaise: row.payments?.amount_paise ?? 0,
    counter: "Online payment",
  };
}
