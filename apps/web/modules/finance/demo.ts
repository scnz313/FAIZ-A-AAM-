/**
 * Fictional demo finance data for the two linked demo students. All amounts
 * are integer paise (₹1 = 100 paise). Official data arrives with the fee
 * ledger backend.
 *
 * `invoices`/`receipts` stay scoped to Aarif so existing child-scoped
 * consumers keep their meaning; the Mariam ledger lives in
 * `mariamInvoices`/`mariamReceipts` and the finance adapter composes both
 * when it seeds its session store.
 */

export const FINANCE_DEMO_NOTE = "Fictional demo fee data · the real ledger arrives with the backend.";

/** Stable demo student ids shared with the relationship graph. */
export const STUDENT_AARIF_ID = "00000000-0000-4000-8000-000000000901";
export const STUDENT_MARIAM_ID = "00000000-0000-4000-8000-000000000902";

export type DemoSibling = {
  studentId: string;
  name: string;
  className: string;
  rollRef: string;
  admissionRef: string;
};

export const demoStudent: DemoSibling = {
  studentId: STUDENT_AARIF_ID,
  name: "Aarif Hussain",
  className: "Class 8-A",
  rollRef: "FA-2023-0148",
  admissionRef: "APP-2023-0417",
};

export const demoMariamStudent: DemoSibling = {
  studentId: STUDENT_MARIAM_ID,
  name: "Mariam Hussain",
  className: "Class 8-A",
  rollRef: "FA-2024-0162",
  admissionRef: "APP-2024-0389",
};

export type InvoiceItemKind = "fee" | "concession";

export type InvoiceItem = {
  label: string;
  amountPaise: number;
  kind: InvoiceItemKind;
};

export type PaymentMethod = "UPI" | "Card" | "Net banking" | "Cash" | "Challan";

export type Payment = {
  ref: string;
  paidAtIso: string;
  method: PaymentMethod;
  amountPaise: number;
  receiptRef: string;
  /** Provider transaction/order identity used to collapse a posted payment
      with the succeeded attempt that produced it. Never shown as credentials. */
  providerTxnRef?: string;
  /** Durable attempt id when the server projection includes it. */
  attemptId?: string;
};

export type InvoiceStatus = "paid" | "partial" | "unpaid" | "overdue";

/** Single source of truth for invoice status labels and tones. */
export const INVOICE_STATUS_META: Record<InvoiceStatus, { label: string; tone: "good" | "watch" | "alert" | "neutral" }> = {
  paid: { label: "Paid", tone: "good" },
  partial: { label: "Partial", tone: "watch" },
  unpaid: { label: "Unpaid", tone: "neutral" },
  overdue: { label: "Overdue", tone: "alert" },
};

export type Invoice = {
  ref: string;
  /** Owning student (demo relationship-graph id); null while an admission
      invoice waits for enrollment conversion — the conversion adopts it. */
  studentId: string | null;
  /** Applicant reference while the invoice waits for conversion. */
  applicantRef?: string | null;
  term: string;
  issuedAtIso: string;
  dueAtIso: string;
  status: InvoiceStatus;
  items: InvoiceItem[];
  payments: Payment[];
};

const AARIF_TERM_1_ITEMS: InvoiceItem[] = [
  { label: "Tuition fee", amountPaise: 600000, kind: "fee" },
  { label: "Development fee", amountPaise: 200000, kind: "fee" },
  { label: "Computer fee", amountPaise: 100000, kind: "fee" },
  { label: "Examination fee", amountPaise: 80000, kind: "fee" },
  { label: "Merit concession — 10% of tuition", amountPaise: -60000, kind: "concession" },
];

const MARIAM_TERM_1_ITEMS: InvoiceItem[] = [
  { label: "Tuition fee", amountPaise: 550000, kind: "fee" },
  { label: "Development fee", amountPaise: 180000, kind: "fee" },
  { label: "Computer fee", amountPaise: 90000, kind: "fee" },
  { label: "Examination fee", amountPaise: 70000, kind: "fee" },
  { label: "Merit concession — 10% of tuition", amountPaise: -55000, kind: "concession" },
];

/** Aarif's ledger — unchanged amounts, now tagged with his student id. */
export const invoices: Invoice[] = [
  {
    ref: "INV-2026-0101",
    studentId: STUDENT_AARIF_ID,
    term: "Term 1",
    issuedAtIso: "2026-04-01T06:00:00Z",
    dueAtIso: "2026-04-20T14:00:00Z",
    status: "paid",
    items: AARIF_TERM_1_ITEMS,
    payments: [{ ref: "PAY-2026-0188", paidAtIso: "2026-04-05T08:30:00Z", method: "UPI", amountPaise: 920000, receiptRef: "RC-2026-0102" }],
  },
  {
    ref: "INV-2026-0102",
    studentId: STUDENT_AARIF_ID,
    term: "Term 2",
    issuedAtIso: "2026-06-01T06:00:00Z",
    dueAtIso: "2026-06-25T14:00:00Z",
    status: "partial",
    items: AARIF_TERM_1_ITEMS,
    payments: [{ ref: "PAY-2026-0277", paidAtIso: "2026-06-12T10:15:00Z", method: "Cash", amountPaise: 500000, receiptRef: "RC-2026-0131" }],
  },
  {
    ref: "INV-2026-0103",
    studentId: STUDENT_AARIF_ID,
    term: "Term 3",
    issuedAtIso: "2026-08-01T06:00:00Z",
    dueAtIso: "2026-08-20T14:00:00Z",
    status: "unpaid",
    items: AARIF_TERM_1_ITEMS,
    payments: [],
  },
];

/** Mariam's ledger — same structure and statuses, distinct refs and amounts. */
export const mariamInvoices: Invoice[] = [
  {
    ref: "INV-2026-0201",
    studentId: STUDENT_MARIAM_ID,
    term: "Term 1",
    issuedAtIso: "2026-04-01T06:00:00Z",
    dueAtIso: "2026-04-20T14:00:00Z",
    status: "paid",
    items: MARIAM_TERM_1_ITEMS,
    payments: [{ ref: "PAY-2026-0211", paidAtIso: "2026-04-18T09:45:00Z", method: "UPI", amountPaise: 835000, receiptRef: "RC-2026-0124" }],
  },
  {
    ref: "INV-2026-0202",
    studentId: STUDENT_MARIAM_ID,
    term: "Term 2",
    issuedAtIso: "2026-06-01T06:00:00Z",
    dueAtIso: "2026-06-25T14:00:00Z",
    status: "partial",
    items: MARIAM_TERM_1_ITEMS,
    payments: [{ ref: "PAY-2026-0263", paidAtIso: "2026-06-15T11:20:00Z", method: "Net banking", amountPaise: 400000, receiptRef: "RC-2026-0138" }],
  },
  {
    ref: "INV-2026-0203",
    studentId: STUDENT_MARIAM_ID,
    term: "Term 3",
    issuedAtIso: "2026-08-01T06:00:00Z",
    dueAtIso: "2026-08-20T14:00:00Z",
    status: "unpaid",
    items: MARIAM_TERM_1_ITEMS,
    payments: [],
  },
];

export type Receipt = {
  ref: string;
  invoiceRef: string;
  issuedAtIso: string;
  method: PaymentMethod;
  amountPaise: number;
  counter: string;
  /** Owning student; null until an admission receipt is adopted by conversion. */
  studentId: string | null;
};

export const receipts: Receipt[] = [
  { ref: "RC-2026-0102", invoiceRef: "INV-2026-0101", studentId: STUDENT_AARIF_ID, issuedAtIso: "2026-04-05T08:30:00Z", method: "UPI", amountPaise: 920000, counter: "Finance office" },
  { ref: "RC-2026-0131", invoiceRef: "INV-2026-0102", studentId: STUDENT_AARIF_ID, issuedAtIso: "2026-06-12T10:15:00Z", method: "Cash", amountPaise: 500000, counter: "Finance office" },
];

export const mariamReceipts: Receipt[] = [
  { ref: "RC-2026-0124", invoiceRef: "INV-2026-0201", studentId: STUDENT_MARIAM_ID, issuedAtIso: "2026-04-18T09:45:00Z", method: "UPI", amountPaise: 835000, counter: "Finance office" },
  { ref: "RC-2026-0138", invoiceRef: "INV-2026-0202", studentId: STUDENT_MARIAM_ID, issuedAtIso: "2026-06-15T11:20:00Z", method: "Net banking", amountPaise: 400000, counter: "Finance office" },
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Indian-format INR from integer paise: 920000 → "₹9,200". */
export function formatINR(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const fraction = abs % 100;
  const formatted = fraction === 0 ? rupees.toLocaleString("en-IN") : `${rupees.toLocaleString("en-IN")}.${String(fraction).padStart(2, "0")}`;
  return `${negative ? "−" : ""}₹${formatted}`;
}

export function invoiceTotal(invoice: Invoice): number {
  return invoice.items.reduce((sum, item) => sum + item.amountPaise, 0);
}

export function invoicePaid(invoice: Invoice): number {
  return invoice.payments.reduce((sum, payment) => sum + payment.amountPaise, 0);
}

export function invoiceBalance(invoice: Invoice): number {
  return invoiceTotal(invoice) - invoicePaid(invoice);
}

/** Outstanding balance across all invoices (excluding refunds, which the demo set does not have). */
export function totalOutstanding(): number {
  return invoices.reduce((sum, invoice) => sum + Math.max(0, invoiceBalance(invoice)), 0);
}

/** Staff queue demo counts across both demo ledgers. */
export const financeQueueCounts = {
  invoicesDueSoon: [...invoices, ...mariamInvoices].filter((i) => i.status === "unpaid").length,
  paymentsToReconcile: 2,
  receiptsAwaitingDispatch: 1,
};
