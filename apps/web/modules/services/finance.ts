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
import { adapterCall, clientAdapterMode } from "@/modules/services/adapter-client";
import {
  invoiceSummary,
  mapServerInvoice,
  mapServerReceipt,
  type ServerInvoiceRow,
  type ServerReceiptRow,
} from "@/modules/services/finance-server-map";
export type { PaymentProvider, PaymentOrder, PaymentRefund, PaymentProviderStatus } from "@/modules/services/payment-provider";
export { createLocalSandboxPaymentProvider } from "@/modules/services/payment-provider";

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
} as const;

/** Counter seeds: PAY-2026-0301, G-2026-0201, RC-2026-0145, INV-2026-0301. */
const ATTEMPT_COUNTER_SEED = 301;
const GATEWAY_COUNTER_SEED = 201;
const RECEIPT_COUNTER_SEED = 145;
const INVOICE_COUNTER_SEED = 301;

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
  const balance = total - paid;
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

export type ReconciliationRun = {
  id: string;
  reference: string;
  runAt: string;
  status: string;
  summary: unknown;
  createdByAccountId: string | null;
};

export async function applyConcession(input: {
  invoiceId: string;
  amountPaise: number;
  reason: string;
  type: string;
}): Promise<{ concessionId: string | null }> {
  if (isServerMode()) {
    const result = await adapterCall<{ concessionId: string | null }>(
      "finance.applyConcession",
      input as unknown as Record<string, unknown>,
    );
    if (!result.ok) throw new FinanceServiceError("gateway-unreachable", result.errors[0]?.message ?? "Concession failed.");
    return result.value;
  }
  throw new FinanceServiceError("policy-pending", "policy pending");
}

export async function requestRefund(input: {
  paymentId: string;
  amountPaise: number;
  reason: string;
}): Promise<{ refundRequestId: string | null }> {
  if (isServerMode()) {
    const result = await adapterCall<{ refundRequestId: string | null }>(
      "finance.requestRefund",
      input as unknown as Record<string, unknown>,
    );
    if (!result.ok) throw new FinanceServiceError("gateway-unreachable", result.errors[0]?.message ?? "Refund failed.");
    return result.value;
  }
  throw new FinanceServiceError("policy-pending", "policy pending");
}

export async function listReconciliationRuns(): Promise<ReconciliationRun[]> {
  if (isServerMode()) {
    const result = await adapterCall<ReconciliationRun[]>("finance.listReconciliationRuns");
    if (!result.ok) throw new FinanceServiceError("gateway-unreachable", result.errors[0]?.message ?? "Reconciliation unavailable.");
    return result.value;
  }
  throw new FinanceServiceError("policy-pending", "policy pending");
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
  applyConcession,
  requestRefund,
  listReconciliationRuns,
};
