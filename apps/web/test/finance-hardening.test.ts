// @vitest-environment node
/**
 * S4 domain-logic hardening tests (demo + adapter-facade only).
 *
 * Locks in the blueprint finance rules without touching the database, secrets,
 * network, or UI:
 * - money is integer paise; webhook-verified posting is the ONLY success path;
 * - adjustments/refunds are versioned request → approve → post with
 *   maker/checker separation;
 * - postings append ledger entries, never rewrite;
 * - retries use idempotency keys and never duplicate;
 * - guardian and staff ledgers read the same state (parity).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adapterMocks = vi.hoisted(() => ({
  call: vi.fn(),
  mode: vi.fn((): "demo" | "supabase" => "demo"),
}));

vi.mock("@/modules/services/adapter-client", () => ({
  adapterCall: adapterMocks.call,
  clientAdapterMode: adapterMocks.mode,
}));

import { setDemoNow } from "@/modules/demo/clock";
import { STUDENT_AARIF_ID, STUDENT_MARIAM_ID } from "@/modules/finance/demo";
import {
  FINANCE_SESSION_KEYS,
  FinanceServiceError,
  financeService,
  setDemoScenario,
} from "@/modules/services/finance";
import {
  mapServerInvoice,
  type ServerInvoiceRow,
} from "@/modules/services/finance-server-map";
import { resetDemoPolicy } from "@/modules/services/demo-policy";
import { sessionRemove } from "@/modules/services/session";

const PINNED = new Date("2026-08-05T09:30:00Z");

const OFFICER = "00000000-0000-4000-8000-000000000203";
const APPROVER = "00000000-0000-4000-8000-000000000205";

const AARIF_UNPAID = "INV-2026-0103";
const AARIF_FULL = 920000;
const MARIAM_UNPAID = "INV-2026-0203";
const MARIAM_FULL = 835000;
const PAID_REF = "PAY-2026-0188";

function clearFinance(): void {
  Object.values(FINANCE_SESSION_KEYS).forEach((key) => sessionRemove(key));
}

beforeEach(() => {
  setDemoNow(PINNED);
  setDemoScenario("success");
  resetDemoPolicy();
  clearFinance();
  adapterMocks.mode.mockReturnValue("demo");
  adapterMocks.call.mockReset();
});

afterEach(() => {
  setDemoNow(null);
  setDemoScenario("success");
  resetDemoPolicy();
  clearFinance();
  vi.unstubAllEnvs();
});

async function settleHappyPath(attemptId: string): Promise<void> {
  expect((await financeService.refreshAttempt(attemptId)).status).toBe("processing");
  expect((await financeService.refreshAttempt(attemptId)).status).toBe("succeeded");
}

describe("hardening: maker/checker actor separation (demo)", () => {
  it("denies an approver posting their own approval for adjustments", async () => {
    const requested = await financeService.requestAdjustment({
      invoiceRef: AARIF_UNPAID,
      amountPaise: 40000,
      reason: "Hardening check on the adjustment post separation.",
      type: "concession",
      requestedBy: OFFICER,
    });
    await financeService.approveAdjustment({
      ref: requested.ref,
      approve: true,
      reason: "Checker approval recorded for the hardening test.",
      decidedBy: APPROVER,
    });

    await expect(
      financeService.postAdjustment({ ref: requested.ref, postedBy: APPROVER }),
    ).rejects.toThrow(/maker\/checker/);

    const viewBefore = await financeService.getInvoice(AARIF_UNPAID);
    expect(viewBefore?.ledgerEntries).toHaveLength(0);

    const posted = await financeService.postAdjustment({ ref: requested.ref, postedBy: OFFICER });
    expect(posted.status).toBe("posted");
    const viewAfter = await financeService.getInvoice(AARIF_UNPAID);
    expect(viewAfter?.ledgerEntries).toHaveLength(1);
  });

  it("denies an approver posting their own approval for refunds", async () => {
    const requested = await financeService.requestRefund({
      paymentRef: PAID_REF,
      amountPaise: 50000,
      reason: "Hardening check on the refund post separation duty.",
      requestedBy: OFFICER,
    });
    await financeService.approveRefund({
      ref: requested.ref,
      approve: true,
      reason: "Checker approval recorded for the refund test.",
      decidedBy: APPROVER,
    });

    await expect(
      financeService.postRefund({ ref: requested.ref, postedBy: APPROVER }),
    ).rejects.toThrow(/maker\/checker/);

    const viewBefore = await financeService.getInvoice("INV-2026-0101");
    expect(viewBefore?.ledgerEntries).toHaveLength(0);

    const posted = await financeService.postRefund({ ref: requested.ref, postedBy: OFFICER });
    expect(posted.status).toBe("posted");
  });
});

describe("hardening: idempotent retries never duplicate (demo)", () => {
  it("duplicate webhook delivery posts exactly once (confirm twice, single ledger effect)", async () => {
    const created = await financeService.createPaymentAttempt(AARIF_UNPAID, "UPI", AARIF_FULL);
    await settleHappyPath(created.id);

    const first = await financeService.confirmSuccess(created.id);
    const second = await financeService.confirmSuccess(created.id);

    expect(second.payment.ref).toBe(first.payment.ref);
    expect(second.receipt.ref).toBe(first.receipt.ref);

    const view = await financeService.getInvoice(AARIF_UNPAID);
    expect(view?.payments.filter((payment) => payment.ref === created.id)).toHaveLength(1);
    expect(view?.payments).toHaveLength(1);
    expect(view?.paidPaise).toBe(AARIF_FULL);
    expect(view?.balancePaise).toBe(0);
    expect((await financeService.listReceipts()).filter((receipt) => receipt.invoiceRef === AARIF_UNPAID)).toHaveLength(1);
  });

  it("double-posting an adjustment never appends a second ledger entry", async () => {
    const requested = await financeService.requestAdjustment({
      invoiceRef: AARIF_UNPAID,
      amountPaise: 30000,
      reason: "Double-post guard check for the adjustment ledger.",
      type: "concession",
      requestedBy: OFFICER,
    });
    await financeService.approveAdjustment({
      ref: requested.ref,
      approve: true,
      reason: "Checker approval for the double-post guard test.",
      decidedBy: APPROVER,
    });
    await financeService.postAdjustment({ ref: requested.ref, postedBy: OFFICER });
    await expect(financeService.postAdjustment({ ref: requested.ref, postedBy: OFFICER })).rejects.toThrow(
      /approved before posting/,
    );

    const view = await financeService.getInvoice(AARIF_UNPAID);
    expect(view?.ledgerEntries).toHaveLength(1);
    expect(view?.ledgerEntries[0]?.sourceRef).toBe(requested.ref);
    expect(view?.balancePaise).toBe(AARIF_FULL - 30000);
  });

  it("double-posting a refund never appends a second ledger entry", async () => {
    const requested = await financeService.requestRefund({
      paymentRef: PAID_REF,
      amountPaise: 60000,
      reason: "Double-post guard check for the refund ledger entry.",
      requestedBy: OFFICER,
    });
    await financeService.approveRefund({
      ref: requested.ref,
      approve: true,
      reason: "Checker approval for the refund double-post test.",
      decidedBy: APPROVER,
    });
    const posted = await financeService.postRefund({ ref: requested.ref, postedBy: OFFICER });
    expect(posted.status).toBe("posted");

    await expect(financeService.postRefund({ ref: requested.ref, postedBy: OFFICER })).rejects.toThrow(
      /approved before posting/,
    );

    const view = await financeService.getInvoice("INV-2026-0101");
    expect(view?.ledgerEntries.filter((entry) => entry.kind === "refund")).toHaveLength(1);
    expect(view?.balancePaise).toBe(60000);
    expect(view?.payments).toHaveLength(1);
  });

  it("retried create with the same idempotency key returns the same attempt", async () => {
    const key = "hardening-key-001";
    const first = await financeService.createPaymentAttempt(AARIF_UNPAID, "UPI", AARIF_FULL, key);
    const second = await financeService.createPaymentAttempt(AARIF_UNPAID, "UPI", AARIF_FULL, key);

    expect(second.id).toBe(first.id);
    expect(second.gatewayRef).toBe(first.gatewayRef);
    expect(await financeService.listAttempts(AARIF_UNPAID)).toHaveLength(1);
  });

  it("rejects an idempotency-key reuse with different checkout parameters", async () => {
    const key = "hardening-key-002";
    await financeService.createPaymentAttempt(AARIF_UNPAID, "UPI", AARIF_FULL, key);
    await expect(
      financeService.createPaymentAttempt(AARIF_UNPAID, "Card", AARIF_FULL, key),
    ).rejects.toMatchObject({ code: "amount-mismatch" });
    expect(await financeService.listAttempts(AARIF_UNPAID)).toHaveLength(1);
  });
});

describe("hardening: amount and fee invariants (demo)", () => {
  it("rejects partial and non-integer checkout amounts (partial-payment gate)", async () => {
    await expect(
      financeService.createPaymentAttempt(AARIF_UNPAID, "UPI", Math.floor(AARIF_FULL / 2)),
    ).rejects.toMatchObject({ code: "amount-mismatch" });
    await expect(
      financeService.createPaymentAttempt(AARIF_UNPAID, "UPI", AARIF_FULL + 0.5),
    ).rejects.toMatchObject({ code: "amount-mismatch" });
    expect(await financeService.listAttempts(AARIF_UNPAID)).toHaveLength(0);
  });

  it("rejects a stale webhook post after a concession changed the balance", async () => {
    const created = await financeService.createPaymentAttempt(AARIF_UNPAID, "UPI", AARIF_FULL);
    await settleHappyPath(created.id);

    const requested = await financeService.requestAdjustment({
      invoiceRef: AARIF_UNPAID,
      amountPaise: 100000,
      reason: "Stale-attempt guard concession posted before webhook.",
      type: "concession",
      requestedBy: OFFICER,
    });
    await financeService.approveAdjustment({
      ref: requested.ref,
      approve: true,
      reason: "Checker approval for the stale-attempt guard test.",
      decidedBy: APPROVER,
    });
    await financeService.postAdjustment({ ref: requested.ref, postedBy: OFFICER });

    await expect(financeService.confirmSuccess(created.id)).rejects.toMatchObject({ code: "amount-mismatch" });

    const view = await financeService.getInvoice(AARIF_UNPAID);
    expect(view?.payments).toHaveLength(0);
    expect(view?.balancePaise).toBe(AARIF_FULL - 100000);
  });

  it("rejects non-integer and zero adjustment/refund amounts", async () => {
    await expect(
      financeService.requestAdjustment({
        invoiceRef: AARIF_UNPAID,
        amountPaise: 0,
        reason: "Zero-amount adjustment must be rejected by validation.",
        type: "concession",
        requestedBy: OFFICER,
      }),
    ).rejects.toThrow(/non-zero integer paise/);
    await expect(
      financeService.requestAdjustment({
        invoiceRef: AARIF_UNPAID,
        amountPaise: 1000.5,
        reason: "Fractional paise adjustment must be rejected here.",
        type: "concession",
        requestedBy: OFFICER,
      }),
    ).rejects.toThrow(/non-zero integer paise/);
    await expect(
      financeService.requestRefund({
        paymentRef: PAID_REF,
        amountPaise: 100.5,
        reason: "Fractional paise refund must be rejected by validation.",
        requestedBy: OFFICER,
      }),
    ).rejects.toThrow(/positive integer paise/);
    await expect(
      financeService.requestRefund({
        paymentRef: PAID_REF,
        amountPaise: AARIF_FULL + 1,
        reason: "Over-paid refund must be capped at the refundable amount.",
        requestedBy: OFFICER,
      }),
    ).rejects.toThrow(/refundable amount/);
  });

  it("posts exactly the approved amount to the append-only ledger", async () => {
    const adjustment = await financeService.requestAdjustment({
      invoiceRef: AARIF_UNPAID,
      amountPaise: 25000,
      reason: "Approved-amount parity check for the adjustment post.",
      type: "concession",
      requestedBy: OFFICER,
    });
    await financeService.approveAdjustment({
      ref: adjustment.ref,
      approve: true,
      reason: "Checker approval for the approved-amount parity test.",
      decidedBy: APPROVER,
    });
    await financeService.postAdjustment({ ref: adjustment.ref, postedBy: OFFICER });
    const adjustedView = await financeService.getInvoice(AARIF_UNPAID);
    expect(adjustedView?.ledgerEntries[0]?.amountPaise).toBe(adjustment.amountPaise);

    const refund = await financeService.requestRefund({
      paymentRef: PAID_REF,
      amountPaise: 75000,
      reason: "Approved-amount parity check for the refund posting.",
      requestedBy: OFFICER,
    });
    await financeService.approveRefund({
      ref: refund.ref,
      approve: true,
      reason: "Checker approval for the refund amount parity test.",
      decidedBy: APPROVER,
    });
    await financeService.postRefund({ ref: refund.ref, postedBy: OFFICER });
    const refundedView = await financeService.getInvoice("INV-2026-0101");
    expect(refundedView?.ledgerEntries[0]?.amountPaise).toBe(refund.amountPaise);
  });
});

describe("hardening: guardian vs staff ledger parity (demo)", () => {
  it("guardian and staff reads agree on refs, balances, and receipt refs", async () => {
    const staff = await financeService.listAllInvoices();
    for (const studentId of [STUDENT_AARIF_ID, STUDENT_MARIAM_ID]) {
      const guardian = await financeService.listInvoices(studentId);
      const staffSlice = staff.filter((view) => view.studentId === studentId);
      expect(staffSlice.map((view) => view.invoice.ref).sort()).toEqual(
        guardian.map((view) => view.invoice.ref).sort(),
      );
      for (const view of guardian) {
        const match = staffSlice.find((candidate) => candidate.invoice.ref === view.invoice.ref);
        expect(match).toBeDefined();
        expect(match?.balancePaise).toBe(view.balancePaise);
        expect(match?.totalPaise).toBe(view.totalPaise);
        expect(match?.paidPaise).toBe(view.paidPaise);
        expect(match?.status).toBe(view.status);
        expect(match?.receipts.map((receipt) => receipt.ref).sort()).toEqual(
          view.receipts.map((receipt) => receipt.ref).sort(),
        );
        expect(match?.payments.map((payment) => payment.ref).sort()).toEqual(
          view.payments.map((payment) => payment.ref).sort(),
        );
      }
    }
  });

  it("parity holds after a fresh payment posts to one child's ledger", async () => {
    const created = await financeService.createPaymentAttempt(MARIAM_UNPAID, "UPI", MARIAM_FULL);
    await settleHappyPath(created.id);
    const pair = await financeService.confirmSuccess(created.id);

    const guardian = await financeService.listInvoices(STUDENT_MARIAM_ID);
    const staff = await financeService.listAllInvoices();
    const guardianView = guardian.find((view) => view.invoice.ref === MARIAM_UNPAID);
    const staffView = staff.find((view) => view.invoice.ref === MARIAM_UNPAID);
    expect(guardianView?.balancePaise).toBe(0);
    expect(staffView?.balancePaise).toBe(0);
    expect(staffView?.receipts.map((receipt) => receipt.ref)).toEqual(
      guardianView?.receipts.map((receipt) => receipt.ref),
    );
    expect(staffView?.receipts.map((receipt) => receipt.ref)).toEqual([pair.receipt.ref]);

    const aarifGuardian = await financeService.listInvoices(STUDENT_AARIF_ID);
    const aarifStaff = staff.filter((view) => view.studentId === STUDENT_AARIF_ID);
    expect(aarifStaff.map((view) => view.invoice.ref)).toEqual(aarifGuardian.map((view) => view.invoice.ref));
    expect(aarifGuardian.find((view) => view.invoice.ref === AARIF_UNPAID)?.balancePaise).toBe(AARIF_FULL);
  });
});

describe("hardening: refresh/retry of a pending attempt never charges (demo)", () => {
  it("polling created/processing/delayed/failed attempts posts nothing", async () => {
    setDemoScenario("delayed");
    const created = await financeService.createPaymentAttempt(AARIF_UNPAID, "Net banking", AARIF_FULL);

    await expect(financeService.confirmSuccess(created.id)).rejects.toMatchObject({
      code: "attempt-not-succeeded",
    });

    expect((await financeService.refreshAttempt(created.id)).status).toBe("processing");
    expect((await financeService.refreshAttempt(created.id)).status).toBe("delayed");
    const viewDuring = await financeService.getInvoice(AARIF_UNPAID);
    expect(viewDuring?.payments).toHaveLength(0);
    expect((await financeService.listReceipts()).filter((receipt) => receipt.invoiceRef === AARIF_UNPAID)).toHaveLength(
      0,
    );

    expect((await financeService.refreshAttempt(created.id)).status).toBe("succeeded");
    expect((await financeService.refreshAttempt(created.id)).status).toBe("succeeded");
    const pair = await financeService.confirmSuccess(created.id);
    expect(pair.receipt.amountPaise).toBe(AARIF_FULL);
    expect((await financeService.listAttempts(AARIF_UNPAID))).toHaveLength(1);

    setDemoScenario("failed");
    const failing = await financeService.createPaymentAttempt(MARIAM_UNPAID, "UPI", MARIAM_FULL);
    expect((await financeService.refreshAttempt(failing.id)).status).toBe("processing");
    expect((await financeService.refreshAttempt(failing.id)).status).toBe("failed");
    expect((await financeService.refreshAttempt(failing.id)).status).toBe("failed");
    await expect(financeService.confirmSuccess(failing.id)).rejects.toBeInstanceOf(FinanceServiceError);
    expect((await financeService.getInvoice(MARIAM_UNPAID))?.payments).toHaveLength(0);
  });
});

describe("hardening: adapter-facade duplicate-safe mapping", () => {
  function row(overrides: Partial<ServerInvoiceRow> = {}): ServerInvoiceRow {
    return {
      reference: "INV-2026-0001",
      student_id: "student-1",
      applicant_ref: null,
      term: "Term 1",
      status: "unpaid",
      issue_date: "2026-04-01T06:00:00Z",
      due_date: "2026-04-20T14:00:00Z",
      version: 1,
      invoice_items: [{ label: "Tuition fee", amount_paise: 100000, kind: "fee" }],
      ledger_entries: [],
      payment_allocations: [],
      receipts: [],
      ...overrides,
    };
  }

  it("collapses duplicate allocation rows for the same payment reference", () => {
    const invoice = mapServerInvoice(
      row({
        payment_allocations: [
          {
            amount_paise: 40000,
            payments: { reference: "PAY-1", method: "UPI", amount_paise: 40000, created_at: "2026-04-06T08:30:00Z" },
          },
          {
            amount_paise: 40000,
            payments: { reference: "PAY-1", method: "UPI", amount_paise: 40000, created_at: "2026-04-06T08:30:00Z" },
          },
        ],
        receipts: [{ reference: "RC-1", issued_at: "2026-04-06T08:30:00Z" }],
      }),
    );
    expect(invoice.payments).toHaveLength(1);
    expect(invoice.payments[0]?.amountPaise).toBe(40000);
  });
});

describe("hardening: server facade actor denial and idempotency keys (mocked adapter)", () => {
  it("denies server-side self-approval before calling the adapter", async () => {
    adapterMocks.mode.mockReturnValue("supabase");
    adapterMocks.call.mockImplementation(async (op: string) => {
      if (op === "finance.listAdjustments") {
        return {
          ok: true,
          value: [
            {
              id: "adj-1",
              ref: "ADJ-HARDEN-1",
              invoiceRef: AARIF_UNPAID,
              type: "concession",
              amountPaise: -10000,
              reason: "Hardening self-approval check.",
              requestedBy: OFFICER,
              requestedAtIso: "2026-08-05T09:30:00.000Z",
              status: "pending",
              decidedBy: null,
              decidedAtIso: null,
              decisionReason: null,
              postedAtIso: null,
              version: 1,
            },
          ],
          errors: [],
        };
      }
      return { ok: false, errors: [{ code: "unavailable", message: "unexpected op", field: null }] };
    });

    await expect(
      financeService.approveAdjustment({
        ref: "ADJ-HARDEN-1",
        approve: true,
        reason: "Self-approval must fail on the server facade.",
        decidedBy: OFFICER,
      }),
    ).rejects.toThrow(/maker\/checker/);
    expect(adapterMocks.call).not.toHaveBeenCalledWith(
      "finance.approveAdjustment",
      expect.anything(),
    );

    await expect(
      financeService.approveAdjustment({
        ref: "ADJ-HARDEN-1",
        approve: true,
        reason: "Short.",
        decidedBy: APPROVER,
      }),
    ).rejects.toThrow(/at least 10 characters/);
  });

  it("denies server-side self-approval for refunds and self-posting", async () => {
    adapterMocks.mode.mockReturnValue("supabase");
    adapterMocks.call.mockImplementation(async (op: string) => {
      if (op === "finance.listRefunds") {
        return {
          ok: true,
          value: [
            {
              id: "rfd-1",
              ref: "RFD-HARDEN-1",
              paymentRef: PAID_REF,
              invoiceRef: "INV-2026-0101",
              amountPaise: 10000,
              reason: "Hardening refund self-approval check.",
              requestedBy: OFFICER,
              requestedAtIso: "2026-08-05T09:30:00.000Z",
              status: "pending",
              decidedBy: null,
              decidedAtIso: null,
              decisionReason: null,
              providerRefundRef: null,
              postedAtIso: null,
              version: 1,
            },
          ],
          errors: [],
        };
      }
      if (op === "finance.listAdjustments") {
        return {
          ok: true,
          value: [
            {
              id: "adj-2",
              ref: "ADJ-HARDEN-2",
              invoiceRef: AARIF_UNPAID,
              type: "concession",
              amountPaise: -5000,
              reason: "Hardening self-post check.",
              requestedBy: OFFICER,
              requestedAtIso: "2026-08-05T09:30:00.000Z",
              status: "approved",
              decidedBy: APPROVER,
              decidedAtIso: "2026-08-05T09:31:00.000Z",
              decisionReason: "Checker approval for self-post check.",
              postedAtIso: null,
              version: 2,
            },
          ],
          errors: [],
        };
      }
      return { ok: false, errors: [{ code: "unavailable", message: "unexpected op", field: null }] };
    });

    await expect(
      financeService.approveRefund({
        ref: "RFD-HARDEN-1",
        approve: true,
        reason: "Self-approval must fail on the refund facade.",
        decidedBy: OFFICER,
      }),
    ).rejects.toThrow(/maker\/checker/);
    expect(adapterMocks.call).not.toHaveBeenCalledWith("finance.approveRefund", expect.anything());

    await expect(financeService.postAdjustment({ ref: "ADJ-HARDEN-2", postedBy: APPROVER })).rejects.toThrow(
      /maker\/checker/,
    );
    expect(adapterMocks.call).not.toHaveBeenCalledWith("finance.postAdjustment", expect.anything());
  });

  it("sends idempotency keys for webhook posting and refund posting", async () => {
    adapterMocks.mode.mockReturnValue("supabase");
    const seen: Array<{ op: string; payload: Record<string, unknown> }> = [];
    adapterMocks.call.mockImplementation(async (op: string, payload: Record<string, unknown> = {}) => {
      seen.push({ op, payload });
      if (op === "finance.getAttempt") {
        return {
          ok: true,
          value: {
            id: "attempt-row-1",
            reference: "PAY-HARDEN-1",
            amount_paise: AARIF_FULL,
            method: "UPI",
            status: "succeeded",
            failure_reason: null,
            provider_order_ref: "G-HARDEN-1",
            created_at: "2026-08-05T09:30:00.000Z",
            updated_at: "2026-08-05T09:31:00.000Z",
            invoices: { reference: AARIF_UNPAID },
          },
          errors: [],
        };
      }
      if (op === "finance.postPayment") return { ok: true, value: { receiptRef: "RC-HARDEN-1" }, errors: [] };
      if (op === "finance.listReceipts") return { ok: true, value: [], errors: [] };
      if (op === "finance.listRefunds") {
        return {
          ok: true,
          value: [
            {
              id: "rfd-2",
              ref: "RFD-HARDEN-2",
              paymentRef: PAID_REF,
              invoiceRef: "INV-2026-0101",
              amountPaise: 10000,
              reason: "Hardening refund idempotency check.",
              requestedBy: OFFICER,
              requestedAtIso: "2026-08-05T09:30:00.000Z",
              status: "approved",
              decidedBy: APPROVER,
              decidedAtIso: "2026-08-05T09:31:00.000Z",
              decisionReason: "Checker approval for idempotency check.",
              providerRefundRef: null,
              postedAtIso: null,
              version: 2,
            },
          ],
          errors: [],
        };
      }
      if (op === "finance.postRefund") return { ok: true, value: {}, errors: [] };
      return { ok: false, errors: [{ code: "unavailable", message: "unexpected op", field: null }] };
    });

    const pair = await financeService.confirmSuccess("PAY-HARDEN-1");
    expect(pair.receipt.ref).toBe("RC-HARDEN-1");
    const postPayment = seen.find((entry) => entry.op === "finance.postPayment");
    expect(postPayment?.payload).toMatchObject({ attemptRef: "PAY-HARDEN-1", idempotencyKey: "payment:PAY-HARDEN-1" });

    const posted = await financeService.postRefund({ ref: "RFD-HARDEN-2", postedBy: OFFICER });
    expect(posted.status).toBe("posted");
    const postRefund = seen.find((entry) => entry.op === "finance.postRefund");
    expect(postRefund?.payload).toMatchObject({ idempotencyKey: "refund:RFD-HARDEN-2" });
  });
});

describe("hardening: adjustment idempotency and the requester-post boundary (demo)", () => {
  const INPUT = {
    invoiceRef: AARIF_UNPAID,
    amountPaise: 15000,
    type: "concession" as const,
    requestedBy: OFFICER,
  };

  it("collapses two overlapping identical adjustment requests into one", async () => {
    /* A double-click submits twice at the same ledger state — the idempotency
       key replays the first request instead of appending a duplicate. */
    const [first, second] = await Promise.all([
      financeService.requestAdjustment({ ...INPUT, reason: "Double-submit collapse check for the adjustment request." }),
      financeService.requestAdjustment({ ...INPUT, reason: "Double-submit collapse check for the adjustment request." }),
    ]);
    expect(second.ref).toBe(first.ref);
    const adjustments = await financeService.listAdjustments();
    expect(adjustments.filter((request) => request.reason === "Double-submit collapse check for the adjustment request.")).toHaveLength(1);
  });

  it("replays a still-pending identical request instead of stacking duplicates", async () => {
    const reason = "Pending replay check for the adjustment request.";
    const first = await financeService.requestAdjustment({ ...INPUT, reason });
    const second = await financeService.requestAdjustment({ ...INPUT, reason });
    expect(second.ref).toBe(first.ref);
    expect((await financeService.listAdjustments()).filter((request) => request.reason === reason)).toHaveLength(1);
  });

  it("allows a deliberate re-request once the first adjustment has settled", async () => {
    const reason = "Settled repeat check for the adjustment request.";
    const first = await financeService.requestAdjustment({ ...INPUT, reason });
    await financeService.approveAdjustment({
      ref: first.ref,
      approve: true,
      reason: "Checker approval for the settled repeat check.",
      decidedBy: APPROVER,
    });
    await financeService.postAdjustment({ ref: first.ref, postedBy: OFFICER });

    /* Posting moved the ledger state, so the same intent may be raised again. */
    const second = await financeService.requestAdjustment({ ...INPUT, reason });
    expect(second.ref).not.toBe(first.ref);
  });

  it("allows the requester to post after an independent approval (only self-approval is barred)", async () => {
    /* Blueprint rule: no account approves its own originating work. Posting an
       already-approved decision is execution, not approval — so the requester
       may post it; the approving officer still may not. */
    const requested = await financeService.requestAdjustment({
      invoiceRef: AARIF_UNPAID,
      amountPaise: 20000,
      reason: "Requester-post boundary check for the adjustment flow.",
      type: "concession",
      requestedBy: OFFICER,
    });
    await financeService.approveAdjustment({
      ref: requested.ref,
      approve: true,
      reason: "Independent checker approval for the boundary check.",
      decidedBy: APPROVER,
    });
    const posted = await financeService.postAdjustment({ ref: requested.ref, postedBy: OFFICER });
    expect(posted.status).toBe("posted");
    expect(posted.decidedBy).toBe(APPROVER);
  });
});
