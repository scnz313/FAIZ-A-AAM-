/**
 * Typed finance service boundary with a deterministic demo adapter.
 *
 * Pages and components import ONLY this module (or the grouped
 * `financeService` object); the fixture arrays and pure helpers in
 * `modules/finance/demo.ts` are never imported by the fee journey UI
 * directly. The backend phase replaces the demo adapter behind these exact
 * signatures — no route or component rewrite.
 *
 * Demo adapter contract:
 * - Session store (`modules/services/session.ts`) holds invoices with
 *   session payments, receipts, payment attempts, the receipt/gateway/attempt
 *   counters and the selected demo scenario. Fixtures are the fallback, so a
 *   fresh session shows exactly the fixture ledgers (Aarif + Mariam).
 * - All timestamps come from the injected demo clock (`demoNowIso`); all
 *   references come from session counters. Nothing is random, and nothing
 *   reads the wall clock.
 * - Every public function returns a Promise with ~200–350 ms simulated
 *   latency and never mutates the fixture objects.
 * - Ledger reads are student-scoped: `listInvoices(studentId)` returns one
 *   student's invoices (the no-argument call keeps the historical Aarif
 *   first-paint default), and `listAllInvoices()` returns the staff-wide
 *   view of both demo ledgers.
 *
 * Payment state machine (drive via refreshAttempt):
 *   created ──refresh──▶ processing ──refresh──▶ succeeded | failed | cancelled | delayed
 *   delayed ──refresh──▶ succeeded (gateway confirmed late)
 *   confirmSuccess posts exactly one payment and issues exactly one receipt;
 *   it is duplicate-safe — the same attempt always returns the same pair.
 */

import { demoNowIso } from "@/modules/demo/clock";
import {
  STUDENT_AARIF_ID,
  demoMariamStudent,
  demoStudent,
  invoiceBalance,
  invoicePaid,
  invoiceTotal,
  formatINR,
  INVOICE_STATUS_META,
  FINANCE_DEMO_NOTE,
  invoices as fixtureInvoices,
  mariamInvoices as fixtureMariamInvoices,
  mariamReceipts as fixtureMariamReceipts,
  receipts as fixtureReceipts,
  type Invoice,
  type InvoiceStatus,
  type Payment,
  type PaymentMethod,
  type Receipt,
} from "@/modules/finance/demo";
import { sessionGet, sessionKey, sessionSet } from "@/modules/services/session";
import { auditService } from "@/modules/services/audit";
import { enqueueOutboxEvent } from "@/modules/services/outbox";
import { getDemoPolicy } from "@/modules/services/demo-policy";
import { adapterCall, clientAdapterMode } from "@/modules/services/adapter-client";
import {
  invoiceSummary,
  mapServerInvoice,
  mapServerReceipt,
  type ServerInvoiceRow,
  type ServerReceiptRow,
} from "@/modules/services/finance-server-map";
export type { PaymentProvider, PaymentOrder, PaymentRefund, PaymentProviderStatus } from "@/modules/services/payment-provider";
import { createLocalSandboxPaymentProvider } from "@/modules/services/payment-provider";

/** Shared finance types re-exported at the service boundary. */
export type { Invoice, InvoiceStatus, Payment, PaymentMethod, Receipt } from "@/modules/finance/demo";
export { formatINR, invoiceTotal, INVOICE_STATUS_META, FINANCE_DEMO_NOTE } from "@/modules/finance/demo";

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export type PaymentAttemptStatus =
  | "created"
  | "processing"
  | "cancelled"
  | "failed"
  | "delayed"
  | "succeeded";

export type PaymentAttempt = {
  id: string;
  invoiceRef: string;
  method: PaymentMethod;
  amountPaise: number;
  status: PaymentAttemptStatus;
  createdAtIso: string;
  updatedAtIso: string;
  failureReason?: string;
  gatewayRef?: string;
};

/* ------------------------------------------------------------------ */
/* Local finance actions (plan L1.2)                                   */
/* ------------------------------------------------------------------ */

/** One append-only signed ledger entry for an invoice. */
export type LedgerEntryKind = "concession" | "adjustment" | "write_off" | "refund";

export type LedgerEntry = {
  ref: string;
  invoiceRef: string;
  kind: LedgerEntryKind;
  /** Signed: concessions/write-offs reduce the balance, refunds restore it. */
  amountPaise: number;
  reason: string;
  by: string;
  atIso: string;
  sourceRef: string;
};

export type ApprovalState = "pending" | "approved" | "rejected" | "posted";

export type AdjustmentRequest = {
  /** Supabase UUID; null in demo mode. */
  id?: string;
  ref: string;
  invoiceRef: string;
  type: "concession" | "adjustment" | "write_off";
  /** Signed amount: concession/write-off negative, adjustment may be either. */
  amountPaise: number;
  reason: string;
  requestedBy: string;
  requestedAtIso: string;
  status: ApprovalState;
  decidedBy: string | null;
  decidedAtIso: string | null;
  decisionReason: string | null;
  postedAtIso: string | null;
  version: number;
};

export type RefundRequest = {
  /** Supabase UUID; null in demo mode. */
  id?: string;
  ref: string;
  paymentRef: string;
  invoiceRef: string;
  amountPaise: number;
  reason: string;
  requestedBy: string;
  requestedAtIso: string;
  status: ApprovalState;
  decidedBy: string | null;
  decidedAtIso: string | null;
  decisionReason: string | null;
  providerRefundRef: string | null;
  postedAtIso: string | null;
  version: number;
};

export type ReconciliationExceptionKind =
  | "gateway-only"
  | "ledger-only"
  | "amount-mismatch"
  | "pending"
  | "refunded";

export type ReconciliationException = {
  id: string;
  payRef: string;
  kind: ReconciliationExceptionKind;
  amountPaise: number;
  note: string;
  status: "open" | "resolved";
  resolutionReason: string | null;
  resolvedBy: string | null;
  resolvedAtIso: string | null;
  version: number;
};

export type ReconciliationRun = {
  ref: string;
  ranAtIso: string;
  by: string;
  matchedCount: number;
  discrepancyCount: number;
  pendingCount: number;
  exceptions: ReconciliationException[];
};

/** Ledger presentation of one invoice: totals, session payments and its receipts. */
export type InvoiceView = {
  invoice: Invoice;
  /** Owning student id (invoice record); null while an admission invoice
      waits for enrollment conversion — presentation reads never guess it. */
  studentId: string | null;
  /** Owning student display name resolved by the demo adapter. */
  studentName: string;
  status: InvoiceStatus;
  totalPaise: number;
  paidPaise: number;
  balancePaise: number;
  payments: Payment[];
  receipts: Receipt[];
  /** Append-only signed ledger entries (concessions, adjustments, refunds). */
  ledgerEntries: LedgerEntry[];
};

/** Outcome the deterministic demo gateway produces for the next attempt. */
export type DemoPaymentScenario = "success" | "failed" | "cancelled" | "delayed" | "create-fails";

export type FinanceServiceErrorCode =
  | "gateway-unreachable"
  | "invoice-not-found"
  | "amount-mismatch"
  | "attempt-not-found"
  | "attempt-not-succeeded"
  | "policy-pending";

export class FinanceServiceError extends Error {
  readonly code: FinanceServiceErrorCode;

  constructor(code: FinanceServiceErrorCode, message: string) {
    super(message);
    this.name = "FinanceServiceError";
    this.code = code;
  }
}

/** Single source of truth for payment-attempt status labels and tones. */
export const ATTEMPT_STATUS_META: Record<PaymentAttemptStatus, { label: string; tone: "good" | "watch" | "alert" | "neutral" }> = {
  created: { label: "Created", tone: "neutral" },
  processing: { label: "Processing", tone: "watch" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  failed: { label: "Failed", tone: "alert" },
  delayed: { label: "Delayed", tone: "watch" },
  succeeded: { label: "Succeeded", tone: "good" },
};

/* ------------------------------------------------------------------ */
/* Session store                                                        */
/* ------------------------------------------------------------------ */

/** All keys the demo adapter owns — tests clear these between cases. */
export const FINANCE_SESSION_KEYS = {
  invoices: sessionKey("finance-invoices"),
  receipts: sessionKey("finance-receipts"),
  attempts: sessionKey("finance-attempts"),
  confirms: sessionKey("finance-confirms"),
  scenario: sessionKey("finance-scenario"),
  attemptCounter: sessionKey("finance-attempt-counter"),
  gatewayCounter: sessionKey("finance-gateway-counter"),
  receiptCounter: sessionKey("finance-receipt-counter"),
  invoiceCounter: sessionKey("finance-invoice-counter"),
  ledger: sessionKey("finance-ledger"),
  adjustments: sessionKey("finance-adjustments"),
  refunds: sessionKey("finance-refunds"),
  reconRuns: sessionKey("finance-recon-runs"),
  adjustmentCounter: sessionKey("finance-adjustment-counter"),
  refundCounter: sessionKey("finance-refund-counter"),
  reconCounter: sessionKey("finance-recon-counter"),
  ledgerCounter: sessionKey("finance-ledger-counter"),
} as const;

/** Counter seeds: PAY-2026-0301, G-2026-0201, RC-2026-0145, INV-2026-0301. */
const ATTEMPT_COUNTER_SEED = 301;
const GATEWAY_COUNTER_SEED = 201;
const RECEIPT_COUNTER_SEED = 145;
const INVOICE_COUNTER_SEED = 301;
const ADJUSTMENT_COUNTER_SEED = 401;
const REFUND_COUNTER_SEED = 501;
const RECON_COUNTER_SEED = 601;
const LEDGER_COUNTER_SEED = 701;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Simulated network latency — fixed so demo behavior stays deterministic. */
const latencyMs = (): number => 200;

async function respond<T>(compute: () => T): Promise<T> {
  await sleep(latencyMs());
  return compute();
}

function cloneInvoice(invoice: Invoice): Invoice {
  return { ...invoice, items: [...invoice.items], payments: [...invoice.payments] };
}

/** Fixtures by default; the session copy once a payment has been posted. */
function loadInvoices(): Invoice[] {
  const stored = sessionGet<Invoice[]>(FINANCE_SESSION_KEYS.invoices);
  if (stored) return stored.map(cloneInvoice);
  return [...fixtureInvoices, ...fixtureMariamInvoices].map(cloneInvoice);
}

function saveInvoices(invoices: Invoice[]): void {
  sessionSet(FINANCE_SESSION_KEYS.invoices, invoices);
}

function loadReceipts(): Receipt[] {
  const stored = sessionGet<Receipt[]>(FINANCE_SESSION_KEYS.receipts);
  return stored ? [...stored] : [...fixtureReceipts, ...fixtureMariamReceipts];
}

function saveReceipts(receipts: Receipt[]): void {
  sessionSet(FINANCE_SESSION_KEYS.receipts, receipts);
}

function loadAttempts(): PaymentAttempt[] {
  return sessionGet<PaymentAttempt[]>(FINANCE_SESSION_KEYS.attempts) ?? [];
}

function saveAttempts(attempts: PaymentAttempt[]): void {
  sessionSet(FINANCE_SESSION_KEYS.attempts, attempts);
}

type ConfirmedPair = { payment: Payment; receipt: Receipt };

function loadConfirms(): Record<string, ConfirmedPair> {
  return sessionGet<Record<string, ConfirmedPair>>(FINANCE_SESSION_KEYS.confirms) ?? {};
}

function saveConfirms(confirms: Record<string, ConfirmedPair>): void {
  sessionSet(FINANCE_SESSION_KEYS.confirms, confirms);
}

/** Monotonic session counter: returns the current value and stores next. */
function nextCounter(key: string, seed: number): number {
  const current = sessionGet<number>(key) ?? seed;
  sessionSet(key, current + 1);
  return current;
}

const pad4 = (value: number): string => String(value).padStart(4, "0");

/* ------------------------------------------------------------------ */
/* Local finance action stores (plan L1.2)                              */
/* ------------------------------------------------------------------ */

function loadLedgerEntries(): LedgerEntry[] {
  return sessionGet<LedgerEntry[]>(FINANCE_SESSION_KEYS.ledger) ?? [];
}

function saveLedgerEntries(entries: LedgerEntry[]): void {
  sessionSet(FINANCE_SESSION_KEYS.ledger, entries);
}

function loadAdjustments(): AdjustmentRequest[] {
  return sessionGet<AdjustmentRequest[]>(FINANCE_SESSION_KEYS.adjustments) ?? [];
}

function saveAdjustments(requests: AdjustmentRequest[]): void {
  sessionSet(FINANCE_SESSION_KEYS.adjustments, requests);
}

function loadRefunds(): RefundRequest[] {
  return sessionGet<RefundRequest[]>(FINANCE_SESSION_KEYS.refunds) ?? [];
}

function saveRefunds(requests: RefundRequest[]): void {
  sessionSet(FINANCE_SESSION_KEYS.refunds, requests);
}

function loadReconRuns(): ReconciliationRun[] {
  return sessionGet<ReconciliationRun[]>(FINANCE_SESSION_KEYS.reconRuns) ?? [];
}

function saveReconRuns(runs: ReconciliationRun[]): void {
  sessionSet(FINANCE_SESSION_KEYS.reconRuns, runs);
}

/** Signed sum of POSTED ledger entries for one invoice (balance effect). */
function postedLedgerSum(invoiceRef: string): number {
  return loadLedgerEntries()
    .filter((entry) => entry.invoiceRef === invoiceRef)
    .reduce((sum, entry) => sum + entry.amountPaise, 0);
}

/** Refundable amount for a payment: paid amount minus reserved (pending,
 * approved, or posted) refunds for that payment. */
function refundableForPayment(paymentRef: string): number {
  const reserved = loadRefunds()
    .filter(
      (request) =>
        request.paymentRef === paymentRef &&
        (request.status === "pending" || request.status === "approved" || request.status === "posted"),
    )
    .reduce((sum, request) => sum + request.amountPaise, 0);
  const invoice = [...fixtureInvoices, ...fixtureMariamInvoices, ...loadInvoices()].find((candidate) =>
    candidate.payments.some((payment) => payment.ref === paymentRef),
  );
  const payment = invoice?.payments.find((candidate) => candidate.ref === paymentRef);
  if (payment === undefined) return 0;
  return Math.max(0, payment.amountPaise - reserved);
}

function requireRequest<T extends { ref: string; status: ApprovalState; version: number }>(
  requests: T[],
  ref: string,
): T {
  const request = requests.find((candidate) => candidate.ref === ref);
  if (request === undefined) throw new Error(`No ${ref} request carries the reference ${ref}.`);
  return request;
}

/* ------------------------------------------------------------------ */
/* Demo scenario control (read by the gateway simulation)               */
/* ------------------------------------------------------------------ */

export function getDemoScenario(): DemoPaymentScenario {
  return sessionGet<DemoPaymentScenario>(FINANCE_SESSION_KEYS.scenario) ?? "success";
}

/** UI/test hook: choose the outcome the demo gateway produces. */
export function setDemoScenario(scenario: DemoPaymentScenario): void {
  sessionSet(FINANCE_SESSION_KEYS.scenario, scenario);
}

/* ------------------------------------------------------------------ */
/* Ledger                                                               */
/* ------------------------------------------------------------------ */

/** Demo adapter presentation labels for the two owned ledgers. */
const STUDENT_NAME_BY_ID: Record<string, string> = {
  [demoStudent.studentId]: demoStudent.name,
  [demoMariamStudent.studentId]: demoMariamStudent.name,
};

function toView(invoice: Invoice): InvoiceView {
  const total = invoiceTotal(invoice);
  const paid = invoicePaid(invoice);
  const entries = loadLedgerEntries().filter((entry) => entry.invoiceRef === invoice.ref);
  const balance = total - paid + entries.reduce((sum, entry) => sum + entry.amountPaise, 0);
  const status: InvoiceStatus = balance <= 0 ? "paid" : paid > 0 ? "partial" : invoice.status;
  return {
    invoice,
    studentId: invoice.studentId,
    studentName: invoice.studentId === null ? "—" : (STUDENT_NAME_BY_ID[invoice.studentId] ?? "—"),
    status,
    totalPaise: total,
    paidPaise: paid,
    balancePaise: balance,
    payments: invoice.payments,
    receipts: loadReceipts().filter((receipt) => receipt.invoiceRef === invoice.ref),
    ledgerEntries: entries,
  };
}

/* ------------------------------------------------------------------ */
/* Supabase adapter (server rows → the same domain shapes)              */
/* ------------------------------------------------------------------ */

async function serverInvoices(): Promise<InvoiceView[]> {
  const result = await adapterCall<ServerInvoiceRow[]>("finance.listInvoices");
  if (!result.ok) throw new FinanceServiceError("gateway-unreachable", result.errors[0]?.message ?? "The ledger is unavailable.");
  const receipts = await serverReceipts();
  return result.value.map((row) => {
    const invoice = mapServerInvoice(row);
    const summary = invoiceSummary(invoice);
    return {
      invoice,
      studentId: invoice.studentId,
      studentName: "—",
      status: invoice.status,
      totalPaise: summary.totalPaise,
      paidPaise: summary.paidPaise,
      balancePaise: summary.balancePaise,
      payments: invoice.payments,
      receipts: receipts.filter((receipt) => receipt.invoiceRef === invoice.ref),
      ledgerEntries: [],
    };
  });
}

async function serverReceipts(): Promise<Receipt[]> {
  const result = await adapterCall<ServerReceiptRow[]>("finance.listReceipts");
  if (!result.ok) throw new FinanceServiceError("gateway-unreachable", result.errors[0]?.message ?? "The ledger is unavailable.");
  return result.value.map(mapServerReceipt);
}

type ServerAttemptRow = {
  id: string;
  reference: string;
  amount_paise: number;
  method: string;
  status: string;
  failure_reason: string | null;
  provider_order_ref: string | null;
  created_at: string;
  updated_at: string;
  invoices: { reference: string } | null;
};

function mapServerAttempt(row: ServerAttemptRow): PaymentAttempt {
  const attempt: PaymentAttempt = {
    id: row.reference,
    invoiceRef: row.invoices?.reference ?? "",
    method: row.method as PaymentMethod,
    amountPaise: row.amount_paise,
    status: row.status as PaymentAttemptStatus,
    createdAtIso: row.created_at,
    updatedAtIso: row.updated_at,
    gatewayRef: row.provider_order_ref ?? undefined,
    failureReason: row.failure_reason ?? undefined,
  };
  serverAttempts.set(attempt.id, { ...attempt });
  return attempt;
}

/** True when the Supabase adapter owns the runtime data path. */
function isServerMode(): boolean {
  return clientAdapterMode() === "supabase";
}

/**
 * Live checkout attempts for this page session, keyed by server reference.
 * The server owns the durable state machine (migration 000019); this map
 * only preserves the facade's PaymentAttempt shape between PayFlow steps —
 * it never holds money state that outlives the checkout.
 */
const serverAttempts = new Map<string, PaymentAttempt>();

/**
 * One student's invoices with live totals. The no-argument call keeps the
 * historical Aarif first-paint default for the portal server render; pass a
 * student id for the active-child ledger. In supabase mode the RLS-filtered
 * server ledger is returned and `studentId` narrows it client-side.
 */
export async function listInvoices(studentId?: string): Promise<InvoiceView[]> {
  if (isServerMode()) {
    const views = await serverInvoices();
    return studentId === undefined ? views : views.filter((view) => view.studentId === studentId);
  }
  const target = studentId ?? STUDENT_AARIF_ID;
  return respond(() => loadInvoices().filter((invoice) => invoice.studentId === target).map(toView));
}

/** Staff-wide ledger across both demo students, in fixture order. */
export async function listAllInvoices(): Promise<InvoiceView[]> {
  if (isServerMode()) return serverInvoices();
  return respond(() => loadInvoices().map(toView));
}

/** One invoice view, or null when the reference does not exist. */
export async function getInvoice(invoiceRef: string): Promise<InvoiceView | null> {
  if (isServerMode()) {
    const views = await serverInvoices();
    return views.find((view) => view.invoice.ref === invoiceRef) ?? null;
  }
  return respond(() => {
    const invoice = loadInvoices().find((item) => item.ref === invoiceRef);
    return invoice ? toView(invoice) : null;
  });
}

/* ------------------------------------------------------------------ */
/* Admission invoices                                                   */
/* ------------------------------------------------------------------ */

/**
 * Issue the admission invoice for an accepted seat, exactly once per
 * applicant: a repeated call returns the SAME invoice reference. The invoice
 * is not owned by a student yet (studentId null, applicantRef set) — the
 * enrollment conversion adopts it, which also reparents its receipts.
 */
export async function createAdmissionInvoice(input: {
  applicantRef: string;
  grade: string;
  session: string;
  amountPaise: number;
  acceptByIso: string;
}): Promise<InvoiceView> {
  return respond(() => {
    const invoices = loadInvoices();
    const existing = invoices.find((invoice) => invoice.applicantRef === input.applicantRef);
    if (existing) return toView(existing);

    const invoice: Invoice = {
      ref: `INV-2026-${pad4(nextCounter(FINANCE_SESSION_KEYS.invoiceCounter, INVOICE_COUNTER_SEED))}`,
      studentId: null,
      applicantRef: input.applicantRef,
      term: "Admission",
      issuedAtIso: demoNowIso(),
      dueAtIso: input.acceptByIso,
      status: "unpaid",
      items: [{ label: `Admission fee — ${input.grade}, session ${input.session}`, amountPaise: input.amountPaise, kind: "fee" }],
      payments: [],
    };
    saveInvoices([...invoices, invoice]);
    return toView(invoice);
  });
}

/**
 * Adopt an admission invoice (and its receipts) into the created student's
 * ledger once enrollment conversion completes. No-op safe: re-running with
 * the same pair returns the same view.
 */
export async function assignInvoiceToStudent(invoiceRef: string, studentId: string): Promise<InvoiceView> {
  return respond(() => {
    const invoices = loadInvoices().map((invoice) =>
      invoice.ref === invoiceRef ? { ...invoice, studentId, applicantRef: null } : invoice,
    );
    saveInvoices(invoices);
    const receipts = loadReceipts().map((receipt) =>
      receipt.invoiceRef === invoiceRef ? { ...receipt, studentId } : receipt,
    );
    saveReceipts(receipts);
    const invoice = invoices.find((item) => item.ref === invoiceRef);
    if (!invoice) throw new FinanceServiceError("invoice-not-found", `Invoice ${invoiceRef} does not exist in this demo ledger.`);
    return toView(invoice);
  });
}

/* ------------------------------------------------------------------ */
/* Payment attempts                                                     */
/* ------------------------------------------------------------------ */

/**
 * Start a checkout: the demo gateway creates the attempt in "created"
 * state with a gateway reference. Rejects when the demo scenario is
 * "create-fails" (recoverable — the caller can retry), the invoice is
 * unknown, or the amount no longer matches the invoice balance.
 */
export async function createPaymentAttempt(
  invoiceRef: string,
  method: PaymentMethod,
  amountPaise: number,
  idempotencyKey?: string,
): Promise<PaymentAttempt> {
  if (isServerMode()) {
    const result = await adapterCall<{ attemptRef: string; providerOrderRef: string }>("finance.createAttempt", {
      invoiceRef,
      amountPaise,
      method,
      idempotencyKey,
    });
    if (!result.ok) {
      const message = result.errors[0]?.message ?? "The gateway could not be reached.";
      throw new FinanceServiceError(
        message.includes("amount mismatch") ? "amount-mismatch" : "gateway-unreachable",
        message.includes("amount mismatch")
          ? "The amount is out of date — refresh the invoice and try again."
          : message,
      );
    }
    const live: PaymentAttempt = {
      id: result.value.attemptRef,
      invoiceRef,
      method,
      amountPaise,
      status: "created",
      createdAtIso: new Date().toISOString(),
      updatedAtIso: new Date().toISOString(),
      gatewayRef: result.value.providerOrderRef,
    };
    serverAttempts.set(live.id, { ...live });
    return { ...live };
  }
  return respond(() => {
    if (getDemoScenario() === "create-fails") {
      throw new FinanceServiceError(
        "gateway-unreachable",
        "The payment gateway could not be reached. Choose another demo scenario and try again — nothing was charged.",
      );
    }
    const invoice = loadInvoices().find((item) => item.ref === invoiceRef);
    if (!invoice) {
      throw new FinanceServiceError("invoice-not-found", `Invoice ${invoiceRef} does not exist in this demo ledger.`);
    }
    if (amountPaise <= 0 || amountPaise !== invoiceBalance(invoice)) {
      throw new FinanceServiceError(
        "amount-mismatch",
        "The amount is out of date — refresh the invoice and try again.",
      );
    }
    const id = `PAY-2026-${pad4(nextCounter(FINANCE_SESSION_KEYS.attemptCounter, ATTEMPT_COUNTER_SEED))}`;
    const attempt: PaymentAttempt = {
      id,
      invoiceRef,
      method,
      amountPaise,
      status: "created",
      createdAtIso: demoNowIso(),
      updatedAtIso: demoNowIso(),
      gatewayRef: `G-2026-${pad4(nextCounter(FINANCE_SESSION_KEYS.gatewayCounter, GATEWAY_COUNTER_SEED))}`,
    };
    saveAttempts([...loadAttempts(), attempt]);
    return { ...attempt };
  });
}

/**
 * Poll the demo gateway. Idempotent per status: repeated refreshes at a
 * terminal status return the same state; "created" advances to
 * "processing"; the second refresh of a "processing" attempt produces the
 * selected scenario outcome; a "delayed" attempt resolves to "succeeded"
 * on its next refresh. Never creates or posts anything.
 */
export async function refreshAttempt(attemptId: string): Promise<PaymentAttempt> {
  if (isServerMode()) {
    /* The sandbox machine advances one step per poll, mirroring demo pacing.
       The stored attempt (below) keeps the facade shape stable for PayFlow. */
    const result = await adapterCall<{ status: PaymentAttemptStatus; version?: number }>("finance.refreshAttempt", {
      attemptRef: attemptId,
    });
    if (!result.ok) {
      const message = result.errors[0]?.message ?? "The gateway could not be reached.";
      throw new FinanceServiceError("attempt-not-found", message);
    }
    let known = serverAttempts.get(attemptId);
    if (known === undefined) {
      const recovered = await adapterCall<ServerAttemptRow>("finance.getAttempt", { attemptRef: attemptId });
      if (!recovered.ok) throw new FinanceServiceError("attempt-not-found", recovered.errors[0]?.message ?? `Payment attempt ${attemptId} was not found.`);
      known = mapServerAttempt(recovered.value);
    }
    known.status = result.value.status;
    known.updatedAtIso = new Date().toISOString();
    return { ...known };
  }
  return respond(() => {
    const attempts = loadAttempts();
    const attempt = attempts.find((item) => item.id === attemptId);
    if (!attempt) {
      throw new FinanceServiceError("attempt-not-found", `Payment attempt ${attemptId} was not found.`);
    }
    const now = demoNowIso();
    if (attempt.status === "created") {
      attempt.status = "processing";
      attempt.updatedAtIso = now;
    } else if (attempt.status === "processing") {
      switch (getDemoScenario()) {
        case "failed":
          attempt.status = "failed";
          attempt.failureReason = "Bank declined the transaction";
          break;
        case "cancelled":
          attempt.status = "cancelled";
          break;
        case "delayed":
          attempt.status = "delayed";
          break;
        default:
          attempt.status = "succeeded";
      }
      attempt.updatedAtIso = now;
    } else if (attempt.status === "delayed") {
      attempt.status = "succeeded";
      attempt.updatedAtIso = now;
    }
    saveAttempts(attempts);
    return { ...attempt };
  });
}

/**
 * Post a confirmed attempt to the ledger: appends exactly one payment to
 * the invoice and issues exactly one new receipt (RC-2026-0XXX from the
 * session counter seeded at 145). Requires status "succeeded". Duplicate
 * calls for the same attempt return the SAME payment and receipt — never a
 * double post and never a second receipt.
 */
export async function confirmSuccess(attemptId: string): Promise<ConfirmedPair> {
  if (isServerMode()) {
    let attempt = serverAttempts.get(attemptId);
    if (attempt === undefined) {
      const recovered = await adapterCall<ServerAttemptRow>("finance.getAttempt", { attemptRef: attemptId });
      if (!recovered.ok) throw new FinanceServiceError("attempt-not-found", recovered.errors[0]?.message ?? `Payment attempt ${attemptId} was not found.`);
      attempt = mapServerAttempt(recovered.value);
    }
    if (attempt.status !== "succeeded") {
      throw new FinanceServiceError(
        "attempt-not-succeeded",
        "This payment attempt has not been confirmed by the gateway yet — check its status again.",
      );
    }
    const result = await adapterCall<{ receiptRef: string }>("finance.postPayment", {
      invoiceRef: attempt.invoiceRef,
      attemptRef: attempt.id,
      providerTxnId: attempt.gatewayRef ?? attempt.id,
      amountPaise: attempt.amountPaise,
      method: attempt.method,
    });
    if (!result.ok) {
      throw new FinanceServiceError("gateway-unreachable", result.errors[0]?.message ?? "Posting failed.");
    }
    const receipts = await listReceipts();
    const receipt = receipts.find((candidate) => candidate.ref === result.value.receiptRef);
    const payment: Payment = {
      ref: attempt.id,
      paidAtIso: attempt.updatedAtIso,
      method: attempt.method,
      amountPaise: attempt.amountPaise,
      receiptRef: result.value.receiptRef,
    };
    return {
      payment,
      receipt:
        receipt ??
        ({
          ref: result.value.receiptRef,
          invoiceRef: attempt.invoiceRef,
          studentId: null,
          issuedAtIso: new Date().toISOString(),
          method: attempt.method,
          amountPaise: attempt.amountPaise,
          counter: "Online payment",
        } satisfies Receipt),
    };
  }
  return respond(() => {
    const confirms = loadConfirms();
    const confirmed = confirms[attemptId];
    if (confirmed) {
      return { payment: { ...confirmed.payment }, receipt: { ...confirmed.receipt } };
    }

    const attempts = loadAttempts();
    const attempt = attempts.find((item) => item.id === attemptId);
    if (!attempt) {
      throw new FinanceServiceError("attempt-not-found", `Payment attempt ${attemptId} was not found.`);
    }
    if (attempt.status !== "succeeded") {
      throw new FinanceServiceError(
        "attempt-not-succeeded",
        "This payment attempt has not been confirmed by the gateway yet — check its status again.",
      );
    }

    const invoices = loadInvoices();
    const invoice = invoices.find((item) => item.ref === attempt.invoiceRef);

    // State-derived duplicate guard: if the payment already posted (e.g. the
    // caller retried after a network hiccup), return the posted pair.
    const alreadyPosted = invoice?.payments.find((payment) => payment.ref === attempt.id);
    if (alreadyPosted) {
      const existingReceipt = loadReceipts().find((receipt) => receipt.ref === alreadyPosted.receiptRef);
      if (existingReceipt) {
        const existing: ConfirmedPair = { payment: alreadyPosted, receipt: existingReceipt };
        confirms[attemptId] = existing;
        saveConfirms(confirms);
        return { payment: { ...existing.payment }, receipt: { ...existing.receipt } };
      }
    }
    if (!invoice) {
      throw new FinanceServiceError("invoice-not-found", `Invoice ${attempt.invoiceRef} does not exist in this demo ledger.`);
    }

    const receipt: Receipt = {
      ref: `RC-2026-${pad4(nextCounter(FINANCE_SESSION_KEYS.receiptCounter, RECEIPT_COUNTER_SEED))}`,
      invoiceRef: attempt.invoiceRef,
      studentId: invoice.studentId,
      issuedAtIso: attempt.updatedAtIso,
      method: attempt.method,
      amountPaise: attempt.amountPaise,
      counter: "Finance office",
    };
    const payment: Payment = {
      ref: attempt.id,
      paidAtIso: attempt.updatedAtIso,
      method: attempt.method,
      amountPaise: attempt.amountPaise,
      receiptRef: receipt.ref,
    };

    saveInvoices(
      invoices.map((item) =>
        item.ref === attempt.invoiceRef ? { ...item, payments: [...item.payments, payment] } : item,
      ),
    );
    saveReceipts([...loadReceipts(), receipt]);
    const pair: ConfirmedPair = { payment, receipt };
    confirms[attemptId] = pair;
    saveConfirms(confirms);
    /* One outbox event + audit row per posted payment — idempotent by event
       id, so retries (including the state-derived duplicate guard above)
       never create a second event. */
    enqueueOutboxEvent({
      eventId: `payment.posted:${attempt.invoiceRef}`,
      kind: "payment.posted",
      targetRef: receipt.ref,
      actor: "Family portal checkout",
    });
    void auditService.record({
      actor: "Family portal checkout",
      action: "Payment posted",
      target: `${receipt.ref} · ${attempt.invoiceRef}`,
      outcome: "Success",
    });
    return { payment: { ...payment }, receipt: { ...receipt } };
  });
}

/** Attempts for one invoice in creation order (empty when none exist). */
export async function listAttempts(invoiceRef: string): Promise<PaymentAttempt[]> {
  if (isServerMode()) {
    const result = await adapterCall<ServerAttemptRow[]>("finance.listAttempts", { invoiceRef });
    if (!result.ok) throw new FinanceServiceError("attempt-not-found", result.errors[0]?.message ?? "Attempts unavailable.");
    return result.value.map(mapServerAttempt);
  }
  return respond(() =>
    loadAttempts()
      .filter((attempt) => attempt.invoiceRef === invoiceRef)
      .map((attempt) => ({ ...attempt })),
  );
}

/* ------------------------------------------------------------------ */
/* Receipts                                                             */
/* ------------------------------------------------------------------ */

/** All receipts: fixtures plus session-issued ones, in issue order. */
export async function listReceipts(): Promise<Receipt[]> {
  if (isServerMode()) return serverReceipts();
  return respond(() => loadReceipts().map((receipt) => ({ ...receipt })));
}

/** One receipt, or null when the reference does not exist. */
export async function getReceipt(receiptRef: string): Promise<Receipt | null> {
  if (isServerMode()) {
    const receipts = await serverReceipts();
    return receipts.find((receipt) => receipt.ref === receiptRef) ?? null;
  }
  return respond(() => {
    const receipt = loadReceipts().find((item) => item.ref === receiptRef);
    return receipt ? { ...receipt } : null;
  });
}

export type ServerReconciliationRun = {
  id: string;
  reference: string;
  runAt: string;
  status: string;
  summary: unknown;
  createdByAccountId: string | null;
};

/**
 * Request a concession/adjustment/write-off on an invoice (maker step —
 * finance officer workspace). The fictional demo policy (plan L1.1) gates
 * the workflow; the amount is validated against the current balance and a
 * reason is required.
 */
export async function requestAdjustment(input: {
  invoiceRef: string;
  amountPaise: number;
  reason: string;
  type: "concession" | "adjustment" | "write_off";
  requestedBy: string;
}): Promise<AdjustmentRequest> {
  if (isServerMode()) {
    const result = await adapterCall<{ concessionId: string | null; reference?: string; status?: string; version?: number }>(
      "finance.applyConcession",
      {
        invoiceRef: input.invoiceRef,
        amountPaise: Math.abs(input.amountPaise),
        reason: input.reason,
        type: input.type,
        expectedVersion: 1,
        idempotencyKey: `adjustment:${input.invoiceRef}:${input.requestedBy}`,
      } as unknown as Record<string, unknown>,
    );
    if (!result.ok) throw new FinanceServiceError("gateway-unreachable", result.errors[0]?.message ?? "Adjustment failed.");
    return {
      id: result.value.concessionId ?? undefined,
      ref: result.value.reference ?? `ADJ-${result.value.concessionId?.slice(0, 8) ?? "pending"}`,
      invoiceRef: input.invoiceRef,
      type: input.type,
      amountPaise: input.type === "adjustment" ? input.amountPaise : -Math.abs(input.amountPaise),
      reason: input.reason,
      requestedBy: input.requestedBy,
      requestedAtIso: new Date().toISOString(),
      status: (result.value.status as "pending" | "approved" | "rejected" | "posted") ?? "pending",
      decidedBy: null,
      decidedAtIso: null,
      decisionReason: null,
      postedAtIso: null,
      version: result.value.version ?? 1,
    };
  }
  return respond(() => {
    if (!getDemoPolicy()["finance.adjustments"]) {
      throw new FinanceServiceError("policy-pending", "Concessions and adjustments are pending school policy in this demo.");
    }
    const reason = input.reason.trim();
    if (reason.length < 10) throw new Error("A reason of at least 10 characters is required.");
    const invoice = loadInvoices().find((candidate) => candidate.ref === input.invoiceRef);
    if (!invoice) throw new Error("Invoice not found.");
    const balance = invoiceTotal(invoice) - invoicePaid(invoice) + postedLedgerSum(invoice.ref);
    const signed = input.type === "adjustment" ? input.amountPaise : -Math.abs(input.amountPaise);
    if (signed > 0 && signed > balance) {
      throw new Error("The adjustment exceeds the outstanding balance.");
    }
    const ref = `ADJ-2026-${pad4(nextCounter(FINANCE_SESSION_KEYS.adjustmentCounter, ADJUSTMENT_COUNTER_SEED))}`;
    const request: AdjustmentRequest = {
      ref,
      invoiceRef: input.invoiceRef,
      type: input.type,
      amountPaise: signed,
      reason,
      requestedBy: input.requestedBy,
      requestedAtIso: demoNowIso(),
      status: "pending",
      decidedBy: null,
      decidedAtIso: null,
      decisionReason: null,
      postedAtIso: null,
      version: 1,
    };
    saveAdjustments([...loadAdjustments(), request]);
    return { ...request };
  });
}

/** All adjustment requests, newest first (demo). */
export async function listAdjustments(): Promise<AdjustmentRequest[]> {
  if (isServerMode()) {
    const result = await adapterCall<AdjustmentRequest[]>("finance.listAdjustments");
    if (!result.ok) throw new FinanceServiceError("gateway-unreachable", result.errors[0]?.message ?? "Adjustments unavailable.");
    return result.value;
  }
  return respond(() =>
    [...loadAdjustments()].sort((a, b) => b.requestedAtIso.localeCompare(a.requestedAtIso)).map((request) => ({ ...request })),
  );
}

/**
 * Approve or reject a pending adjustment (checker step — finance approver
 * workspace). Self-approval is denied and the decision is audited.
 */
export async function approveAdjustment(input: {
  ref: string;
  approve: boolean;
  reason: string;
  decidedBy: string;
}): Promise<AdjustmentRequest> {
  if (isServerMode()) {
    const requests = await listAdjustments();
    const request = requests.find((candidate) => candidate.ref === input.ref);
    if (!request) throw new Error("Adjustment not found.");
    const result = await adapterCall<unknown>("finance.approveAdjustment", {
      adjustmentId: request.id ?? request.ref,
      expectedVersion: request.version,
      approve: input.approve,
      reason: input.reason,
    });
    if (!result.ok) throw new FinanceServiceError("gateway-unreachable", result.errors[0]?.message ?? "Approval failed.");
    return { ...request, status: input.approve ? "approved" : "rejected", version: request.version + 1 };
  }
  return respond(() => {
    if (!getDemoPolicy()["finance.adjustments"]) {
      throw new FinanceServiceError("policy-pending", "Concessions and adjustments are pending school policy in this demo.");
    }
    const requests = loadAdjustments();
    const request = requireRequest(requests, input.ref);
    if (request.status !== "pending") throw new Error(`Adjustment ${input.ref} is already ${request.status}.`);
    if (request.requestedBy === input.decidedBy) {
      throw new Error("The requesting officer cannot approve their own adjustment (maker/checker).");
    }
    if (input.reason.trim().length < 10) throw new Error("A decision reason of at least 10 characters is required.");
    const next: AdjustmentRequest = {
      ...request,
      status: input.approve ? "approved" : "rejected",
      decidedBy: input.decidedBy,
      decidedAtIso: demoNowIso(),
      decisionReason: input.reason.trim(),
      version: request.version + 1,
    };
    saveAdjustments(requests.map((candidate) => (candidate.ref === input.ref ? next : candidate)));
    return { ...next };
  });
}

/**
 * Post an approved adjustment: appends a signed ledger entry (append-only —
 * invoice items are never rewritten) and records the audit trail.
 */
export async function postAdjustment(input: { ref: string; postedBy: string }): Promise<AdjustmentRequest> {
  if (isServerMode()) {
    const requests = await listAdjustments();
    const request = requests.find((candidate) => candidate.ref === input.ref);
    if (!request) throw new Error("Adjustment not found.");
    if (request.status !== "approved") throw new Error(`Adjustment ${input.ref} must be approved before posting.`);
    const result = await adapterCall<unknown>("finance.postAdjustment", {
      adjustmentId: request.id ?? request.ref,
      expectedVersion: request.version,
      idempotencyKey: `post-adjustment:${request.ref}`,
    });
    if (!result.ok) throw new FinanceServiceError("gateway-unreachable", result.errors[0]?.message ?? "Posting failed.");
    return { ...request, status: "posted", postedAtIso: new Date().toISOString(), version: request.version + 1 };
  }
  return respond(() => {
    const requests = loadAdjustments();
    const request = requireRequest(requests, input.ref);
    if (request.status !== "approved") throw new Error(`Adjustment ${input.ref} must be approved before posting.`);
    const entry: LedgerEntry = {
      ref: `LED-2026-${pad4(nextCounter(FINANCE_SESSION_KEYS.ledgerCounter, LEDGER_COUNTER_SEED))}`,
      invoiceRef: request.invoiceRef,
      kind: request.type,
      amountPaise: request.amountPaise,
      reason: request.reason,
      by: input.postedBy,
      atIso: demoNowIso(),
      sourceRef: request.ref,
    };
    saveLedgerEntries([...loadLedgerEntries(), entry]);
    const next: AdjustmentRequest = { ...request, status: "posted", postedAtIso: demoNowIso(), version: request.version + 1 };
    saveAdjustments(requests.map((candidate) => (candidate.ref === input.ref ? next : candidate)));
    void auditService.record({
      actor: input.postedBy,
      action: "Payment reconciled",
      target: request.invoiceRef,
      outcome: "Success",
      reason: `${request.type} ${formatINR(request.amountPaise)} posted — ${request.reason}`,
    });
    return { ...next };
  });
}

/**
 * Request a refund against a posted payment (maker step). The amount cannot
 * exceed the payment's remaining refundable amount.
 */
export async function requestRefund(input: {
  paymentRef: string;
  amountPaise: number;
  reason: string;
  requestedBy: string;
}): Promise<RefundRequest> {
  if (isServerMode()) {
    const result = await adapterCall<{ refundRequestId: string | null; reference?: string; status?: string; version?: number }>(
      "finance.requestRefund",
      { paymentRef: input.paymentRef, amountPaise: input.amountPaise, reason: input.reason, expectedVersion: 1, idempotencyKey: `refund:${input.paymentRef}:${input.requestedBy}` } as unknown as Record<string, unknown>,
    );
    if (!result.ok) throw new FinanceServiceError("gateway-unreachable", result.errors[0]?.message ?? "Refund failed.");
    return {
      id: result.value.refundRequestId ?? undefined,
      ref: result.value.reference ?? `RFD-${result.value.refundRequestId?.slice(0, 8) ?? "pending"}`,
      paymentRef: input.paymentRef,
      invoiceRef: "",
      amountPaise: input.amountPaise,
      reason: input.reason,
      requestedBy: input.requestedBy,
      requestedAtIso: new Date().toISOString(),
      status: (result.value.status as ApprovalState) ?? "pending",
      decidedBy: null,
      decidedAtIso: null,
      decisionReason: null,
      providerRefundRef: null,
      postedAtIso: null,
      version: result.value.version ?? 1,
    };
  }
  return respond(() => {
    if (!getDemoPolicy()["finance.refunds"]) {
      throw new FinanceServiceError("policy-pending", "Refunds are pending school policy in this demo.");
    }
    const reason = input.reason.trim();
    if (reason.length < 10) throw new Error("A reason of at least 10 characters is required.");
    if (input.amountPaise <= 0) throw new Error("A refund must be a positive amount.");
    const holder = [...fixtureInvoices, ...fixtureMariamInvoices, ...loadInvoices()].find((candidate) =>
      candidate.payments.some((payment) => payment.ref === input.paymentRef),
    );
    if (!holder) throw new Error("The payment was not found on any invoice.");
    const refundable = refundableForPayment(input.paymentRef);
    if (input.amountPaise > refundable) {
      throw new Error(`The refund exceeds the refundable amount (${formatINR(refundable)}).`);
    }
    const ref = `RFD-2026-${pad4(nextCounter(FINANCE_SESSION_KEYS.refundCounter, REFUND_COUNTER_SEED))}`;
    const request: RefundRequest = {
      ref,
      paymentRef: input.paymentRef,
      invoiceRef: holder.ref,
      amountPaise: input.amountPaise,
      reason,
      requestedBy: input.requestedBy,
      requestedAtIso: demoNowIso(),
      status: "pending",
      decidedBy: null,
      decidedAtIso: null,
      decisionReason: null,
      providerRefundRef: null,
      postedAtIso: null,
      version: 1,
    };
    saveRefunds([...loadRefunds(), request]);
    return { ...request };
  });
}

/** All refund requests, newest first (demo). */
export async function listRefunds(): Promise<RefundRequest[]> {
  if (isServerMode()) {
    const result = await adapterCall<RefundRequest[]>("finance.listRefunds");
    if (!result.ok) throw new FinanceServiceError("gateway-unreachable", result.errors[0]?.message ?? "Refunds unavailable.");
    return result.value;
  }
  return respond(() =>
    [...loadRefunds()].sort((a, b) => b.requestedAtIso.localeCompare(a.requestedAtIso)).map((request) => ({ ...request })),
  );
}

/** Approve or reject a pending refund (checker step); self-approval denied. */
export async function approveRefund(input: {
  ref: string;
  approve: boolean;
  reason: string;
  decidedBy: string;
}): Promise<RefundRequest> {
  if (isServerMode()) {
    const requests = await listRefunds();
    const request = requests.find((candidate) => candidate.ref === input.ref);
    if (!request) throw new Error("Refund request not found.");
    const result = await adapterCall<unknown>("finance.approveRefund", {
      refundRequestId: request.id ?? request.ref,
      expectedVersion: request.version,
      approve: input.approve,
      reason: input.reason,
    });
    if (!result.ok) throw new FinanceServiceError("gateway-unreachable", result.errors[0]?.message ?? "Approval failed.");
    return { ...request, status: input.approve ? "approved" : "rejected", decidedBy: input.decidedBy, decidedAtIso: new Date().toISOString(), decisionReason: input.reason, version: request.version + 1 };
  }
  return respond(() => {
    if (!getDemoPolicy()["finance.refunds"]) {
      throw new FinanceServiceError("policy-pending", "Refunds are pending school policy in this demo.");
    }
    const requests = loadRefunds();
    const request = requireRequest(requests, input.ref);
    if (request.status !== "pending") throw new Error(`Refund ${input.ref} is already ${request.status}.`);
    if (request.requestedBy === input.decidedBy) {
      throw new Error("The requesting officer cannot approve their own refund (maker/checker).");
    }
    if (input.reason.trim().length < 10) throw new Error("A decision reason of at least 10 characters is required.");
    const next: RefundRequest = {
      ...request,
      status: input.approve ? "approved" : "rejected",
      decidedBy: input.decidedBy,
      decidedAtIso: demoNowIso(),
      decisionReason: input.reason.trim(),
      version: request.version + 1,
    };
    saveRefunds(requests.map((candidate) => (candidate.ref === input.ref ? next : candidate)));
    return { ...next };
  });
}

/**
 * Post an approved refund through the local sandbox provider: a refund
 * ledger entry restores the invoice balance (append-only — the original
 * payment and receipt stay on record).
 */
export async function postRefund(input: { ref: string; postedBy: string }): Promise<RefundRequest> {
  if (isServerMode()) {
    const requests = await listRefunds();
    const request = requests.find((candidate) => candidate.ref === input.ref);
    if (!request) throw new Error("Refund request not found.");
    if (request.status !== "approved") throw new Error(`Refund ${input.ref} must be approved before posting.`);
    const result = await adapterCall<unknown>("finance.postRefund", {
      refundRequestId: request.id ?? request.ref,
      expectedVersion: request.version,
      providerRef: null,
    });
    if (!result.ok) throw new FinanceServiceError("gateway-unreachable", result.errors[0]?.message ?? "Refund posting failed.");
    return { ...request, status: "posted", postedAtIso: new Date().toISOString(), version: request.version + 1 };
  }
  const requests = loadRefunds();
  const request = requireRequest(requests, input.ref);
  if (request.status !== "approved") throw new Error(`Refund ${input.ref} must be approved before posting.`);
  const provider = createLocalSandboxPaymentProvider();
  const refund = await provider.refund({
    providerTxnRef: request.paymentRef,
    amountPaise: request.amountPaise,
    idempotencyKey: `refund:${request.ref}`,
  });
  return respond(() => {
    const entry: LedgerEntry = {
      ref: `LED-2026-${pad4(nextCounter(FINANCE_SESSION_KEYS.ledgerCounter, LEDGER_COUNTER_SEED))}`,
      invoiceRef: request.invoiceRef,
      kind: "refund",
      amountPaise: request.amountPaise,
      reason: request.reason,
      by: input.postedBy,
      atIso: demoNowIso(),
      sourceRef: request.paymentRef,
    };
    saveLedgerEntries([...loadLedgerEntries(), entry]);
    const next: RefundRequest = {
      ...request,
      status: "posted",
      providerRefundRef: refund.providerRefundRef,
      postedAtIso: demoNowIso(),
      version: request.version + 1,
    };
    saveRefunds(loadRefunds().map((candidate) => (candidate.ref === input.ref ? next : candidate)));
    void auditService.record({
      actor: input.postedBy,
      action: "Payment reconciled",
      target: request.invoiceRef,
      outcome: "Success",
      reason: `Refund ${formatINR(request.amountPaise)} posted for ${request.paymentRef} — ${request.reason}`,
    });
    return { ...next };
  });
}

/**
 * Run a local reconciliation comparison: every ledger payment that also has
 * a gateway reference is matched; the fictional gateway events that are
 * absent from the ledger become open exceptions; unfinished attempts stay
 * pending. The run is recorded and nothing in the ledger is mutated.
 */
export async function startReconciliation(input: { by: string }): Promise<ReconciliationRun> {
  if (isServerMode()) {
    const result = await adapterCall<{ reference: string }>("finance.startReconciliation", { idempotencyKey: `reconciliation:${input.by}:${new Date().toISOString()}` });
    if (!result.ok) throw new FinanceServiceError("gateway-unreachable", result.errors[0]?.message ?? "Reconciliation failed.");
    const runs = await listReconciliationRuns();
    const run = runs.find((candidate) => candidate.ref === result.value.reference);
    return run ?? { ref: result.value.reference, ranAtIso: new Date().toISOString(), by: input.by, matchedCount: 0, discrepancyCount: 0, pendingCount: 0, exceptions: [] };
  }
  return respond(() => {
    if (!getDemoPolicy()["finance.reconciliation"]) {
      throw new FinanceServiceError("policy-pending", "Reconciliation is pending school policy in this demo.");
    }
    const views = loadInvoices().map(toView);
    const ledgerRefs = new Set<string>();
    const exceptions: ReconciliationException[] = [];
    let matchedCount = 0;
    for (const view of views) {
      for (const payment of view.invoice.payments) {
        ledgerRefs.add(payment.ref);
        matchedCount += 1;
      }
    }
    /* Fictional gateway events the demo ledger does not yet carry. */
    const gatewayEvents = [
      { payRef: "PAY-2026-0301", amountPaise: 500000, kind: "pending" as const, note: "Gateway order pending — no posted payment." },
      { payRef: "PAY-2026-0303", amountPaise: 200000, kind: "gateway-only" as const, note: "Gateway captured but not posted." },
      { payRef: "PAY-2026-0292", amountPaise: 120000, kind: "refunded" as const, note: "Refunded at the gateway — ledger entry appended." },
    ];
    for (const event of gatewayEvents) {
      if (ledgerRefs.has(event.payRef)) continue;
      exceptions.push({
        id: `exc-${event.payRef}`,
        payRef: event.payRef,
        kind: event.kind,
        amountPaise: event.amountPaise,
        note: event.note,
        status: "open",
        resolutionReason: null,
        resolvedBy: null,
        resolvedAtIso: null,
        version: 1,
      });
    }
    /* Unfinished payment attempts in the session count as pending. */
    const pendingAttempts = loadAttempts().filter((attempt) => attempt.status !== "succeeded" && attempt.status !== "failed" && attempt.status !== "cancelled");
    for (const attempt of pendingAttempts) {
      exceptions.push({
        id: `exc-${attempt.id}`,
        payRef: attempt.id,
        kind: "pending",
        amountPaise: attempt.amountPaise,
        note: `Payment attempt ${attempt.id} has not settled (${attempt.status}).`,
        status: "open",
        resolutionReason: null,
        resolvedBy: null,
        resolvedAtIso: null,
        version: 1,
      });
    }
    const discrepancyCount = exceptions.filter((exception) => exception.kind === "gateway-only" || exception.kind === "amount-mismatch").length;
    const pendingCount = exceptions.filter((exception) => exception.kind === "pending" || exception.kind === "refunded").length;
    const run: ReconciliationRun = {
      ref: `REC-2026-${pad4(nextCounter(FINANCE_SESSION_KEYS.reconCounter, RECON_COUNTER_SEED))}`,
      ranAtIso: demoNowIso(),
      by: input.by,
      matchedCount,
      discrepancyCount,
      pendingCount,
      exceptions,
    };
    saveReconRuns([...loadReconRuns(), run]);
    return { ...run, exceptions: run.exceptions.map((exception) => ({ ...exception })) };
  });
}

/** Reconciliation runs, newest first (demo). */
export async function listReconciliationRuns(): Promise<ReconciliationRun[]> {
  if (isServerMode()) {
    const result = await adapterCall<ReconciliationRun[]>("finance.listReconciliationRuns");
    if (!result.ok) throw new FinanceServiceError("gateway-unreachable", result.errors[0]?.message ?? "Reconciliation unavailable.");
    return result.value;
  }
  return respond(() =>
    [...loadReconRuns()].sort((a, b) => b.ranAtIso.localeCompare(a.ranAtIso)).map((run) => ({ ...run, exceptions: run.exceptions.map((exception) => ({ ...exception })) })),
  );
}

/** Resolve one open reconciliation exception with a reason (finance officer). */
export async function resolveReconciliationException(input: {
  runRef: string;
  exceptionId: string;
  reason: string;
  by: string;
}): Promise<ReconciliationRun> {
  if (isServerMode()) {
    const result = await adapterCall<unknown>("finance.resolveReconciliation", {
      exceptionId: input.exceptionId,
      resolutionReason: input.reason,
      expectedVersion: 1,
      idempotencyKey: `recon:${input.runRef}:${input.exceptionId}`,
    });
    if (!result.ok) throw new FinanceServiceError("gateway-unreachable", result.errors[0]?.message ?? "Resolution failed.");
    const runs = await listReconciliationRuns();
    const updated = runs.find((candidate) => candidate.ref === input.runRef);
    return updated ?? { ref: input.runRef, ranAtIso: new Date().toISOString(), by: input.by, matchedCount: 0, discrepancyCount: 0, pendingCount: 0, exceptions: [] };
  }
  return respond(() => {
    if (input.reason.trim().length < 3) throw new Error("A resolution reason is required.");
    const runs = loadReconRuns();
    const run = runs.find((candidate) => candidate.ref === input.runRef);
    if (!run) throw new Error("Reconciliation run not found.");
    const exception = run.exceptions.find((candidate) => candidate.id === input.exceptionId);
    if (!exception) throw new Error("Exception not found on the run.");
    if (exception.status !== "open") throw new Error(`Exception ${input.exceptionId} is already ${exception.status}.`);
    const next: ReconciliationRun = {
      ...run,
      exceptions: run.exceptions.map((candidate) =>
        candidate.id === input.exceptionId
          ? {
              ...candidate,
              status: "resolved",
              resolutionReason: input.reason.trim(),
              resolvedBy: input.by,
              resolvedAtIso: demoNowIso(),
              version: candidate.version + 1,
            }
          : candidate,
      ),
    };
    saveReconRuns(runs.map((candidate) => (candidate.ref === input.runRef ? next : candidate)));
    return { ...next, exceptions: next.exceptions.map((exception) => ({ ...exception })) };
  });
}

/* ------------------------------------------------------------------ */
/* Typed service boundary                                               */
/* ------------------------------------------------------------------ */

export const financeService = {
  listInvoices,
  listAllInvoices,
  getInvoice,
  createAdmissionInvoice,
  assignInvoiceToStudent,
  createPaymentAttempt,
  refreshAttempt,
  confirmSuccess,
  listAttempts,
  listReceipts,
  getReceipt,
  requestAdjustment,
  listAdjustments,
  approveAdjustment,
  postAdjustment,
  requestRefund,
  listRefunds,
  approveRefund,
  postRefund,
  startReconciliation,
  listReconciliationRuns,
  resolveReconciliationException,
};
